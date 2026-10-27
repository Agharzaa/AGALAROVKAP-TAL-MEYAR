/**
 * Stage 8a — payroll: employees' terms, the dated rates and the month's payroll document
 * (docs/MERHELE-8-EMEK-HAQQI.md §4, §8: Ə3–Ə5; QERARLAR 2026-10-27).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from '../../src/infrastructure/sqlite/db.js';
import { migrations } from '../../src/infrastructure/sqlite/schema.js';
import { rates2026 } from '../../src/domain/payroll.js';
import type {
  PayrollDocumentDetail,
  PayrollFillLine,
  PayrollRatesView,
} from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;
const run = (f: F, cmd: object) => f.exec(cmd as never);
const balance = (f: F, account: string, s1?: string) =>
  BigInt(
    String(
      f.db.get(
        `SELECT COALESCE(SUM(debit-credit),0) AS b FROM registers WHERE company_id=? AND account=?${s1 ? ' AND s1=?' : ''}`,
        f.companyId,
        account,
        ...(s1 ? [s1] : []),
      )!.b,
    ),
  );
const employee = (f: F, name: string, extra: object = {}) =>
  run(f, {
    type: 'employee.save',
    companyId: f.companyId,
    name,
    archived: false,
    hired: '2026-01-12',
    salary: '1000',
    expenseAccount: '701',
    expenseSk: [f.item('productGroup', 'Əsas nomenklatura qrupu')],
    ...extra,
  }).id!;
const fill = (f: F, month: string) =>
  f.query<PayrollFillLine[]>({ type: 'payrollFill', companyId: f.companyId, month });
const payroll = (f: F, month: string, lines: object[], extra: object = {}) =>
  run(f, { type: 'payroll.save', companyId: f.companyId, month, lines, ...extra });
const detail = (f: F, id: string) =>
  f.query<PayrollDocumentDetail>({ type: 'payrollDocument', companyId: f.companyId, id });

/** The §9 driver (1 000, 701) and an office worker (2 000, 721). */
function staff(f: F) {
  const driver = employee(f, 'Sürücü Məmmədov', { tabNo: '001', position: 'Sürücü' });
  const office = employee(f, 'Mühasib Əliyeva', {
    tabNo: '002',
    salary: '2000',
    expenseAccount: '721',
    expenseSk: [],
  });
  return { driver, office };
}

test('Ə3: the month payroll — gross to 701 / 721, withheld to 521.03 / 522.xx, the employer on top', (t) => {
  const f = fixture(t);
  const { driver, office } = staff(f);
  const lines = fill(f, '2026-10');
  assert.deepEqual(
    lines.map((l) => [l.name, l.salary]),
    [
      ['Sürücü Məmmədov', '1000.00'],
      ['Mühasib Əliyeva', '2000.00'],
    ],
  );
  const doc = payroll(f, '2026-10', lines);
  assert.equal(doc.number, 'ƏH-000001');
  const d = detail(f, doc.id);
  assert.deepEqual(
    d.lines.map((l) => [l.name, l.gross, l.incomeTax, l.dsmfEmployee, l.net, l.dsmfEmployer]),
    [
      ['Sürücü Məmmədov', '1000.00', '24.00', '86.00', '865.00', '164.00'],
      ['Mühasib Əliyeva', '2000.00', '54.00', '186.00', '1710.00', '314.00'],
    ],
  );
  assert.deepEqual([d.gross, d.net, d.employees, d.date], ['3000.00', '2575.00', 2, '2026-10-31']);
  assert.deepEqual([balance(f, '533', driver), balance(f, '533', office)], [-86_500n, -171_000n]);
  assert.deepEqual(
    ['521.03', '522.01', '522.03.1', '522.03.2', '522.04.1', '522.04.2'].map((a) => balance(f, a)),
    [-7_800n, -75_000n, -1_500n, -1_500n, -6_000n, -6_000n],
  );
  assert.deepEqual([balance(f, '701'), balance(f, '721')], [118_900n, 236_400n]);
  // The salary and the employer's share keep their expense items.
  const items = new Set(d.postings.filter((p) => p.dt.account === '721').map((p) => p.dt.sk[0]));
  assert.deepEqual(
    [...items].sort(),
    [
      f.item('expenseItem', 'Sosial sığorta ayırmaları'),
      f.item('expenseItem', 'Əmək haqqı'),
    ].sort(),
  );

  // One posted document a month.
  assert.throws(() => payroll(f, '2026-10', [lines[0]!]), /artıq ƏH-000001/);

  // A correction (a bonus of 500 for the office: 2 500, the 200 relief still applies) stornoes and reposts.
  const v2 = payroll(f, '2026-10', [lines[0]!, { ...lines[1]!, bonus: '500' }], {
    id: doc.id,
    version: doc.version,
  });
  assert.equal(v2.version, 2);
  const office2 = detail(f, doc.id).lines[1]!;
  assert.deepEqual(
    [office2.gross, office2.incomeTax, office2.dsmfEmployee, office2.medicalEmployee, office2.net],
    ['2500.00', '69.00', '236.00', '50.00', '2132.50'],
  );
  assert.equal(balance(f, '533', office), -213_250n);

  // Cancelling takes everything back.
  run(f, {
    type: 'payroll.cancel',
    companyId: f.companyId,
    id: doc.id,
    version: v2.version,
    reason: 'səhv',
  });
  assert.deepEqual(
    ['533', '521.03', '522.01', '701', '721'].map((a) => balance(f, a)),
    [0n, 0n, 0n, 0n, 0n],
  );
  // After cancelling, the month takes a new document; a closed month takes none.
  payroll(f, '2026-10', lines);
  run(f, { type: 'period.close', companyId: f.companyId, through: '2026-11-30' });
  assert.throws(() => payroll(f, '2026-11', lines), /bağlanıb/);
});

test('Ə4: an employee hired halfway is paid by the working days; one who left is not filled in', (t) => {
  const f = fixture(t);
  employee(f, 'Yeni sürücü', { hired: '2026-10-15' });
  employee(f, 'Gedən sürücü', { hired: '2025-01-01', left: '2026-09-30' });
  employee(f, 'Hələ gəlməyib', { hired: '2026-11-02' });
  assert.deepEqual(
    fill(f, '2026-10').map((l) => [l.name, l.salary]),
    [['Yeni sürücü', '545.45']],
  );
  assert.throws(
    () => employee(f, 'Səhv', { hired: '2026-10-15', left: '2026-10-01' }),
    /çıxma tarixi işə qəbuldan əvvəl/,
  );
});

test('Ə5: new rates from a day — earlier months keep theirs; a set a posted month used is not changed', (t) => {
  const f = fixture(t);
  const driver = employee(f, 'Sürücü');
  payroll(f, '2026-10', fill(f, '2026-10'));
  const sets = () => f.query<PayrollRatesView[]>({ type: 'payrollRates', companyId: f.companyId });
  assert.deepEqual(
    sets().map((s) => [s.validFrom, s.used]),
    [['2026-01-01', true]],
  );
  const five = {
    ...rates2026,
    incomeTax: [
      { upTo: '2500.00', rate: '5' },
      { upTo: '8000.00', rate: '10' },
      { upTo: '', rate: '14' },
    ],
  };
  const save = (validFrom: string, rates: object) =>
    run(f, { type: 'payrollRates.save', companyId: f.companyId, validFrom, rates });
  assert.throws(() => save('2026-01-01', five), /ƏH-000001 bu dərəcələrlə hesablanıb/);
  assert.throws(() => save('2026-10-01', five), /ƏH-000001/);
  // A set nothing used yet can still be corrected.
  save('2026-11-01', rates2026);
  save('2026-11-01', five);
  assert.equal(sets()[0]!.rates.incomeTax[0]!.rate, '5');
  const nov = payroll(f, '2026-11', fill(f, '2026-11'));
  assert.equal(detail(f, nov.id).lines[0]!.incomeTax, '40.00');
  const oct = f.query<{ id: string; month: string; lines: { incomeTax: string }[] }[]>({
    type: 'payrollDocuments',
    companyId: f.companyId,
  });
  assert.deepEqual(
    oct.map((d) => [d.month, d.lines[0]!.incomeTax]),
    [
      ['2026-11', '40.00'],
      ['2026-10', '24.00'],
    ],
  );
  assert.equal(balance(f, '533', driver), -86_500n - 84_900n);
  assert.deepEqual(
    sets().map((s) => [s.validFrom, s.used]),
    [
      ['2026-11-01', true],
      ['2026-01-01', true],
    ],
  );
});

test('8a: the employee needs an expense account with an expense item; the payroll says which one is missing', (t) => {
  const f = fixture(t);
  assert.throws(
    () => employee(f, 'Səhv hesab', { expenseAccount: '211.01', expenseSk: [] }),
    /701, 711, 721 və ya 202/,
  );
  assert.throws(() => employee(f, 'Qrupsuz', { expenseSk: [] }), /subkontosunu seçin/);
  const bare = employee(f, 'Hesabsız', { expenseAccount: '', expenseSk: [] });
  assert.throws(
    () => payroll(f, '2026-10', [{ employeeId: bare, salary: '1000' }]),
    /Hesabsız — işçinin kartında xərc hesabını/,
  );
  const x = employee(f, 'İki dəfə');
  assert.throws(
    () =>
      payroll(f, '2026-10', [
        { employeeId: x, salary: '1000' },
        { employeeId: x, salary: '100' },
      ]),
    /ikinci dəfədir/,
  );
  assert.throws(() => payroll(f, '2026-10', [{ employeeId: x, salary: '0' }]), /məbləğ yoxdur/);
});

test('schema v16 → v17: the 2026 rates, the payroll roles, employees keep their rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-v16-'));
  const path = join(dir, 'm.sqlite');
  const raw = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  for (const m of migrations.filter((x) => x.version <= 16)) raw.exec(m.sql);
  raw.exec(`PRAGMA user_version=16;
INSERT INTO companies(id,name,tax_id,created_at) VALUES('a','a','1000000001','2026-10-01');
INSERT INTO items(id,company_id,kind,name) VALUES('s','a','expenseItem','Əmək haqqı');
INSERT INTO employees(id,company_id,name) VALUES('e','a','Köhnə işçi');`);
  raw.close();
  const db = new Db(path);
  assert.deepEqual(
    db.all('SELECT valid_from FROM payroll_rates WHERE company_id=?', 'a').map((r) => r.valid_from),
    ['2026-01-01'],
  );
  assert.deepEqual(
    JSON.parse(String(db.get("SELECT rates FROM payroll_rates WHERE company_id='a'")!.rates)),
    rates2026,
  );
  assert.equal(db.get("SELECT id FROM items WHERE company_id='a' AND role='salary'")!.id, 's');
  assert.equal(
    db.get("SELECT name FROM items WHERE company_id='a' AND role='socialInsurance'")!.name,
    'Sosial sığorta ayırmaları',
  );
  const e = db.get("SELECT * FROM employees WHERE id='e'")!;
  assert.deepEqual(
    [e.name, e.salary, e.expense_account, e.expense_sk],
    ['Köhnə işçi', 0n, '', '[]'],
  );
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
