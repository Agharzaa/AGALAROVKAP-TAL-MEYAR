/**
 * Stage 8b / 8c — payroll: income tax exemptions, vacations, sick leaves, other deductions, the
 * bank statement, the payslip and the reports (docs/MERHELE-8-EMEK-HAQQI.md §12: Ə10–Ə15;
 * QERARLAR 2026-10-27 §7–§12).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from '../../src/infrastructure/sqlite/db.js';
import { migrations } from '../../src/infrastructure/sqlite/schema.js';
import type {
  AbsenceView,
  ClosingView,
  PayrollDocumentDetail,
  PayrollFillLine,
  PayrollSettlementRow,
  PayrollTaxesView,
  PayslipView,
  StatementView,
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
const post = (f: F, month: string) => payroll(f, month, fill(f, month));
const detail = (f: F, id: string) =>
  f.query<PayrollDocumentDetail>({ type: 'payrollDocument', companyId: f.companyId, id });
const absence = (
  f: F,
  kind: string,
  employeeId: string,
  from: string,
  to: string,
  extra: object = {},
) => run(f, { type: 'absence.save', companyId: f.companyId, kind, employeeId, from, to, ...extra });
const absenceView = (f: F, id: string) =>
  f.query<AbsenceView>({ type: 'absence', companyId: f.companyId, id });
const months = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `2026-${String(from + i).padStart(2, '0')}`);

test('Ə10: an employee’s exemption — the larger of it and the 2026 relief, only at the main workplace', (t) => {
  const f = fixture(t);
  const veteran = employee(f, 'Veteran', { exemption: '400', exemptionFrom: '2026-01-01' });
  const plus = employee(f, 'Əlavə 50', { exemption: '100', exemptionExtra: true });
  const later = employee(f, 'Noyabrdan', { exemption: '400', exemptionFrom: '2026-11-01' });
  const doc = post(f, '2026-10');
  const tax = new Map(
    detail(f, doc.id!).lines.map((l) => [l.employeeId, [l.exemption, l.incomeTax]]),
  );
  // 400 → 600 × 3%; 100 is smaller than the 200 relief, plus 50 → 750 × 3%; not yet in force → 200.
  assert.deepEqual(tax.get(veteran), ['400.00', '18.00']);
  assert.deepEqual(tax.get(plus), ['250.00', '22.50']);
  assert.deepEqual(tax.get(later), ['200.00', '24.00']);
  assert.throws(
    () => employee(f, 'İkinci iş yeri', { exemption: '200', mainJob: false }),
    /yalnız əsas iş yerində/,
  );
});

test('Ə11: vacation — 12 months over 30,4; the month pays it and fewer working days; a later change makes the payroll stale', (t) => {
  const f = fixture(t);
  const driver = employee(f, 'Sürücü');
  for (const m of months(1, 10)) post(f, m);
  // No Meyar history before: refused without the accountant's average.
  const fresh = employee(f, 'Yeni', { hired: '2026-11-02' });
  assert.throws(() => absence(f, 'vacation', fresh, '2026-11-09', '2026-11-12'), /əl ilə yazın/);
  // January (hired on the 12th) is not a full month: February–October, 9 × 1 000.
  const v = absence(f, 'vacation', driver, '2026-11-02', '2026-11-22');
  assert.equal(v.number, 'MZ-000001');
  const a = absenceView(f, v.id!);
  // 2–22 November: 21 calendar days, the holidays of 8 and 9 November are not vacation days (8d).
  assert.deepEqual([a.days, a.average, a.daily, a.amount], [19, '1000.00', '32.89', '624.91']);
  assert.match(a.basis, /9 ay .*9 000,00 ₼ \/ 9 = 1 000,00 ₼.*32,89 ₼ × 19 gün/);
  // November: 19 working days by the calendar (9, 10 November off), 13 on vacation → 6 / 19.
  const nov = fill(f, '2026-11');
  assert.deepEqual(
    nov.filter((l) => l.employeeId === driver).map((l) => [l.salary, l.vacation]),
    [['315.79', '624.91']],
  );
  const doc = post(f, '2026-11');
  const line = detail(f, doc.id!).lines.find((l) => l.employeeId === driver)!;
  assert.deepEqual([line.gross, line.vacation, line.incomeTax], ['940.70', '624.91', '22.22']);
  assert.deepEqual(detail(f, doc.id!).stale, []);
  // Overlapping absences are refused.
  assert.throws(
    () => absence(f, 'sick', driver, '2026-11-20', '2026-11-24', { sheetNo: 'X1' }),
    /məzuniyyətdədir/,
  );
  // Shortened after the payroll: the payroll is stale and the November closing waits for it.
  const changed = absence(f, 'vacation', driver, '2026-11-02', '2026-11-15', {
    id: v.id,
    version: v.version,
  });
  assert.match(String(changed.warning), /ƏH-000011 əmək haqqı sənədi uçotdadır/);
  assert.deepEqual(detail(f, doc.id!).stale, ['Sürücü']);
  assert.throws(
    () =>
      run(f, {
        type: 'closing.post',
        companyId: f.companyId,
        month: '2026-11',
        acknowledged: true,
      }),
    /köhnəlib/,
  );
  // Filled in again and saved: 12 days of vacation (2–15 November less the holidays), 11 working days.
  payroll(f, '2026-11', fill(f, '2026-11'), { id: doc.id, version: doc.version });
  const again = detail(f, doc.id!);
  assert.deepEqual(again.stale, []);
  assert.deepEqual(
    again.lines.filter((l) => l.employeeId === driver).map((l) => [l.salary, l.vacation]),
    [['578.95', '394.68']],
  );
  // Unpaid leave: no pay, only fewer working days.
  const u = absence(f, 'unpaid', driver, '2026-12-01', '2026-12-04');
  assert.equal(absenceView(f, u.id!).amount, '0.00');
  // December: 22 working days (31 December off), 4 of them unpaid → 18 / 22.
  assert.equal(fill(f, '2026-12').find((l) => l.employeeId === driver)!.salary, '818.18');
});

test('Ə12: sick leave — four quarters over their days; 14 days by the employer, income tax only', (t) => {
  const f = fixture(t);
  const driver = employee(f, 'Sürücü', { hired: '2026-01-12' });
  for (const m of months(1, 11)) post(f, m);
  assert.throws(
    () => absence(f, 'sick', driver, '2026-12-01', '2026-12-25'),
    /vərəqəsinin nömrəsini/,
  );
  const s = absence(f, 'sick', driver, '2026-12-01', '2026-12-25', { sheetNo: 'XV-77' });
  assert.equal(s.number, 'XV-000001');
  const a = absenceView(f, s.id!);
  // 01.10.2025–30.09.2026: January 736,84 (14 of 19 working days) + 8 × 1 000 over 365 days → 23,94.
  assert.deepEqual([a.daily, a.employerDays, a.fundDays, a.amount], ['23.94', 14, 11, '335.16']);
  assert.match(a.basis, /8 736,84 ₼ \/ 365 gün = 23,94 ₼.*11 gün — DSMF ödəyir/);
  const doc = post(f, '2026-12');
  const d = detail(f, doc.id!);
  const line = d.lines[0]!;
  // December: 22 working days, 19 sick → 3 / 22 of the salary; the sick pay bears income tax only.
  assert.deepEqual(
    [line.salary, line.sick, line.gross, line.incomeTax, line.dsmfEmployee, line.net],
    ['136.36', '335.16', '136.36', '8.15', '4.09', '455.87'],
  );
  const sickItem = f.item('expenseItem', 'Xəstəlik vərəqəsi üzrə müavinət');
  assert.ok(
    d.postings.some(
      (p) => p.dt.account === '701' && p.dt.sk[1] === sickItem && p.amount === '335.16',
    ),
  );
  // 80% service and an accident the employer is at fault for: all 25 days by the employer.
  run(f, {
    type: 'payroll.cancel',
    companyId: f.companyId,
    id: doc.id,
    version: doc.version,
    reason: 'yox',
  });
  const s2 = absence(f, 'sick', driver, '2026-12-01', '2026-12-25', {
    id: s.id,
    version: s.version,
    sheetNo: 'XV-77',
    percent: 80,
    employerAll: true,
  });
  assert.equal(absenceView(f, s2.id!).amount, '478.80');
  // A tenure under 6 months is a warning, not a refusal.
  const fresh = employee(f, 'Yeni', { hired: '2026-10-01' });
  const w = absence(f, 'sick', fresh, '2026-12-01', '2026-12-03', {
    sheetNo: 'XV-78',
    manual: '30',
  });
  assert.match(String(w.warning), /6 aydan az/);
  assert.equal(absenceView(f, w.id!).amount, '90.00');
});

test('Ə13 / Ə15: a deduction to 538, the payment, the payslip, settlements and taxes', (t) => {
  const f = fixture(t);
  const driver = employee(f, 'Sürücü');
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const account = f.bankAccount(bank, 'AZ12AIIB38060019441234567890', '223.01', 'AZN', 'Kapital');
  const founder = f.partner('Təsisçi', '', 'individual');
  f.bank('in', '2026-08-31', account, [
    f.bankLine('301', [founder, f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş')], '5000'),
  ]);
  const recipient = f.partner('Alimentin alıcısı', '', 'individual');
  const order = f.contract(recipient, 'AL-1', 'other');
  post(f, '2026-09');
  // September's 865 is paid in October.
  f.bank('out', '2026-10-05', account, [f.bankLine('533', [driver], '865')]);
  const oct = fill(f, '2026-10').map((l) => ({
    ...l,
    deductions: [{ amount: '100', account: '538', sk: [recipient, order], memo: 'Aliment' }],
  }));
  assert.throws(
    () =>
      payroll(
        f,
        '2026-10',
        oct.map((l) => ({ ...l, deductions: [{ ...l.deductions[0]!, amount: '900' }] })),
      ),
    /tutulmalar .*ödəniləcəkdən .*çoxdur/,
  );
  const doc = payroll(f, '2026-10', oct);
  const line = detail(f, doc.id!).lines[0]!;
  // Taxes as without it; the net is less by the deduction.
  assert.deepEqual([line.incomeTax, line.deducted, line.net], ['24.00', '100.00', '765.00']);
  assert.equal(balance(f, '538', recipient), -10_000n);
  const slip = f.query<PayslipView>({
    type: 'payslip',
    companyId: f.companyId,
    employeeId: driver,
    month: '2026-10',
  });
  assert.deepEqual(
    [
      slip.opening,
      slip.accrued,
      slip.withheld.map((w) => w.label),
      slip.paid.map((p) => p.amount),
      slip.closing,
    ],
    [
      '865.00',
      [{ label: 'Əmək haqqı', amount: '1000.00' }],
      ['Gəlir vergisi', 'DSMF', 'İşsizlik sığortası', 'İcbari tibbi sığorta', 'Aliment'],
      ['865.00'],
      '765.00',
    ],
  );
  const rows = f.query<PayrollSettlementRow[]>({
    type: 'payrollSettlements',
    companyId: f.companyId,
    from: '2026-10-01',
    to: '2026-10-31',
  });
  assert.deepEqual(
    rows.map((r) => [r.opening, r.accrued, r.withheld, r.paid, r.closing]),
    [['865.00', '1000.00', '235.00', '865.00', '765.00']],
  );
  // Income tax of September and October paid in November: owed, then transferred.
  const kind = f.item('paymentKind', 'Vergi (haqq)');
  f.bank('out', '2026-11-10', account, [f.bankLine('521.03', [kind], '48')]);
  const taxes = (month: string) =>
    f.query<PayrollTaxesView>({ type: 'payrollTaxes', companyId: f.companyId, month });
  const octTaxes = taxes('2026-10');
  assert.deepEqual([octTaxes.employees, octTaxes.base], [1, '1000.00']);
  assert.deepEqual(
    octTaxes.rows.find((r) => r.account === '521.03'),
    {
      account: '521.03',
      label: 'Gəlir vergisi',
      opening: '24.00',
      accrued: '24.00',
      paid: '0.00',
      closing: '48.00',
    },
  );
  assert.deepEqual(taxes('2026-11').rows.find((r) => r.account === '521.03')!.paid, '48.00');
});

test('Ə14: a salary row of the bank statement finds the employee by FİN or by name', (t) => {
  const f = fixture(t);
  const driver = employee(f, 'Məmmədov Elvin', { fin: '5ABC123' });
  const office = employee(f, 'Əliyeva Günay', { expenseAccount: '721', expenseSk: [] });
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  f.bankAccount(bank, 'AZ12AIIB38060019441234567890', '223.01', 'AZN', 'Kapital');
  const line = (row: number, counterparty: string, purpose: string) => ({
    row,
    date: '2026-11-05',
    direction: 'out',
    amount: '865',
    reference: `R${row}`,
    counterparty,
    counterpartyTaxId: '',
    counterpartyIban: '',
    purpose,
  });
  const imp = run(f, {
    type: 'statement.import',
    companyId: f.companyId,
    iban: 'AZ12AIIB38060019441234567890',
    fileName: 'x.xlsx',
    fileHash: 'b'.repeat(64),
    lines: [
      line(1, 'Kart hesabı', 'Oktyabr ayı üçün əmək haqqı, FİN 5ABC123'),
      line(2, 'ƏLİYEVA GÜNAY', 'Əmək haqqı oktyabr'),
      line(3, 'Kart hesabı', 'Əmək haqqı (siyahı ilə)'),
    ],
  });
  const v = f.query<StatementView>({ type: 'statement', companyId: f.companyId, id: imp.id });
  assert.deepEqual(
    v.lines.map((l) => [l.proposal?.account, l.proposal?.sk]),
    [
      ['533', [driver]],
      ['533', [office]],
      ['533', []],
    ],
  );
  assert.match(String(v.lines[0]!.proposal?.reason), /İşçi: Məmmədov Elvin \(FİN 5ABC123\)/);
  assert.match(String(v.lines[2]!.proposal?.reason), /İşçi tanınmadı/);
});

test('8b: the month closing warns when employees are at work and no payroll is posted', (t) => {
  const f = fixture(t);
  employee(f, 'Sürücü');
  const view = () =>
    f.query<ClosingView>({ type: 'closing', companyId: f.companyId, month: '2026-10' });
  assert.ok(
    view().warnings.some((w) => /2026-10 ayının əmək haqqı hesablanmayıb \(1 işçi/.test(w.text)),
  );
  post(f, '2026-10');
  assert.ok(!view().warnings.some((w) => /əmək haqqı hesablanmayıb/.test(w.text)));
});

test('8c: absences — within employment, not in a closed month, cancelled not deleted', (t) => {
  const f = fixture(t);
  const driver = employee(f, 'Sürücü', { left: '2026-11-30' });
  assert.throws(
    () => absence(f, 'vacation', driver, '2025-12-20', '2026-01-02', { manual: '1000' }),
    /işləmir/,
  );
  assert.throws(
    () => absence(f, 'vacation', driver, '2026-11-20', '2026-12-05', { manual: '1000' }),
    /işləmir/,
  );
  assert.throws(
    () => absence(f, 'vacation', driver, '2026-11-20', '2026-11-10', { manual: '1000' }),
    /başlamadan əvvəl/,
  );
  const v = absence(f, 'vacation', driver, '2026-10-05', '2026-10-09', { manual: '1216' });
  assert.equal(absenceView(f, v.id!).amount, '200.00');
  run(f, {
    type: 'absence.cancel',
    companyId: f.companyId,
    id: v.id,
    version: v.version,
    reason: 'səhv',
  });
  assert.equal(absenceView(f, v.id!).status, 'cancelled');
  assert.deepEqual(fill(f, '2026-10')[0]!.vacation, '0.00');
  run(f, { type: 'period.close', companyId: f.companyId, through: '2026-10-31' });
  assert.throws(
    () => absence(f, 'vacation', driver, '2026-10-20', '2026-10-22', { manual: '1000' }),
    /bağlanıb/,
  );
});

test('schema v17 → v18: exemptions, absences and the sick pay item', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-v17-'));
  const path = join(dir, 'm.sqlite');
  const raw = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  for (const m of migrations.filter((x) => x.version <= 17)) raw.exec(m.sql);
  raw.exec(`PRAGMA user_version=17;
INSERT INTO companies(id,name,tax_id,created_at) VALUES('a','a','1000000001','2026-10-01');
INSERT INTO employees(id,company_id,name,salary) VALUES('e','a','Köhnə işçi',100000);`);
  raw.close();
  const db = new Db(path);
  const e = db.get("SELECT * FROM employees WHERE id='e'")!;
  assert.deepEqual([e.main_job, e.exemption, e.exemption_extra, e.salary], [1n, 0n, 0n, 100_000n]);
  assert.equal(
    db.get("SELECT name FROM items WHERE company_id='a' AND role='sickPay'")!.name,
    'Xəstəlik vərəqəsi üzrə müavinət',
  );
  assert.ok(db.get("SELECT 1 AS x FROM sqlite_master WHERE name='payroll_absences'"));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
