/**
 * Stage 9b — the muzdlu iş return of a quarter and the employer's DSMF above 8 000
 * (docs/MERHELE-9-VERGI-BEYANNAMELERI.md §5.2, §7: V3, V4; QERARLAR 2026-10-28 mərhələ 9 §2, §4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from '../../src/infrastructure/sqlite/db.js';
import { migrations } from '../../src/infrastructure/sqlite/schema.js';
import type { PayrollFillLine } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';
import { declaration, figures } from './declarations.test.js';

type F = ReturnType<typeof fixture>;
const run = (f: F, cmd: object) => f.exec(cmd as never);
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
const post = (f: F, month: string) =>
  run(f, {
    type: 'payroll.save',
    companyId: f.companyId,
    month,
    lines: f.query<PayrollFillLine[]>({ type: 'payrollFill', companyId: f.companyId, month }),
  });

test('V3, V4: the quarter month by month — bases, contributions, the books and the employees', (t) => {
  const f = fixture(t);
  employee(f, 'Sürücü Məmmədov', { fin: '5AAA111', tabNo: '001' });
  employee(f, 'Mühasib Əliyeva', { salary: '2000', expenseAccount: '721', expenseSk: [] });
  employee(f, 'Direktor Həsənov', {
    fin: '5BBB222',
    salary: '9000',
    expenseAccount: '721',
    expenseSk: [],
  });
  for (const m of ['2026-10', '2026-11', '2026-12']) post(f, m);
  const v = declaration(f, 'payroll', '2026-Q4');
  assert.deepEqual(v.sections[0]!.columns, ['2026-10', '2026-11', '2026-12', 'Rüb']);
  assert.deepEqual(figures(v, 'p:employees'), ['3', '3', '3', '']);
  assert.deepEqual(figures(v, 'p:income'), ['12000.00', '12000.00', '12000.00', '36000.00']);
  // The 200 relief of incomes up to 2 500: the driver and the accountant.
  assert.equal(figures(v, 'p:exemption')[0], '400.00');
  assert.equal(figures(v, 'p:taxable')[0], '11600.00');
  // 24,00 + 1 800 × 3% + (75 + 550 + 1 000 × 14%).
  assert.deepEqual(figures(v, 'p:incomeTax'), ['843.00', '843.00', '843.00', '2529.00']);
  // V4: 9 000 — the employee 6 + 8 800 × 10% = 886; the employer 44 + 7 800 × 15% + 1 000 × 11%
  // = 1 324. With the driver (86 / 164) and the accountant (186 / 314).
  assert.equal(figures(v, 'p:dsmfEmployee')[0], '1158.00');
  assert.equal(figures(v, 'p:dsmfEmployer')[0], '1802.00');
  assert.equal(figures(v, 'p:medicalLow')[0], '5500.00');
  assert.equal(figures(v, 'p:medicalHigh')[0], '6500.00');
  // The books: accrued by the payroll documents, nothing paid yet, owed at the end.
  assert.deepEqual(figures(v, 'l:521.03'), ['0.00', '2529.00', '0.00', '2529.00']);
  assert.ok(!v.checks.some((c) => /fərq var/.test(c.text)), JSON.stringify(v.checks));
  assert.ok(v.checks.some((c) => /FİN-i yazılmayan işçilər.*Mühasib Əliyeva/.test(c.text)));
  assert.ok(!v.checks.some((c) => /11%/.test(c.text)), 'the 2026 set has the third bracket');
  const appendix = v.appendices[0]!;
  assert.equal(appendix.rows.length, 9);
  const director = appendix.rows.find((r) => r[1] === 'Direktor Həsənov' && r[3] === '2026-10')!;
  // Income, income tax, DSMF 886 + 1 324, unemployment 45 + 45, medical (50 + 32,50) × 2.
  assert.deepEqual(director.slice(4), ['9000.00', '765.00', '2210.00', '90.00', '165.00']);
  assert.throws(() => declaration(f, 'payroll', '2026-Q5'), /Rüb düzgün deyil/);
  // A quarter with no payroll says so for each month.
  const empty = declaration(f, 'payroll', '2026-Q1');
  assert.equal(empty.checks.filter((c) => /əmək haqqı sənədi yoxdur/.test(c.text)).length, 3);
});

test('V4: schema v21 → v22 — the 2026 set gets 11% above 8 000 unless a payroll above 8 000 used it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-v21-'));
  const path = join(dir, 'm.sqlite');
  const raw = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  for (const m of migrations.filter((x) => x.version <= 21)) raw.exec(m.sql);
  const old = [
    { upTo: '200.00', rate: '22' },
    { upTo: '', rate: '15' },
  ];
  raw.exec(`PRAGMA user_version=21;
INSERT INTO companies(id,name,tax_id,created_at) VALUES('a','a','1000000001','2026-10-01'),('b','b','1000000002','2026-10-01');
INSERT INTO payroll_rates SELECT id,'2026-01-01','{}','' FROM companies;
INSERT INTO employees(id,company_id,name) VALUES('e','b','Direktor');
INSERT INTO payroll_documents VALUES('d','b','2026-09','ƏH-1','1','2026-09-30','','posted',1,'','');
INSERT INTO payroll_lines(company_id,document_id,line_no,employee_id,salary,gross,income_tax,dsmf_employee,
  unemployment_employee,medical_employee,net,dsmf_employer,unemployment_employer,medical_employer,expense_account,expense_sk)
  VALUES('b','d',1,'e',900000,900000,0,0,0,0,0,0,0,0,'721','[]');`);
  const stmt = raw.prepare('UPDATE payroll_rates SET rates=? WHERE company_id=?');
  for (const c of ['a', 'b']) stmt.run(JSON.stringify({ dsmfEmployer: old, other: 1 }), c);
  raw.close();
  const db = new Db(path);
  const rates = (c: string) =>
    JSON.parse(String(db.get('SELECT rates FROM payroll_rates WHERE company_id=?', c)!.rates));
  assert.deepEqual(rates('a'), {
    dsmfEmployer: [
      { upTo: '200.00', rate: '22' },
      { upTo: '8000.00', rate: '15' },
      { upTo: '', rate: '11' },
    ],
    other: 1,
  });
  assert.deepEqual(rates('b').dsmfEmployer, old, 'a set in use is not changed');
  assert.match(
    String(
      db.get("SELECT detail FROM audit WHERE company_id='b' AND correlation_id='migration-22'")!
        .detail,
    ),
    /8 000-dən çox gəlir var/,
  );
  assert.equal(
    db.get("SELECT 1 AS x FROM audit WHERE company_id='a' AND correlation_id='migration-22'"),
    undefined,
  );
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
