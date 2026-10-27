/**
 * Stage 8 audit (payroll 0.9.0–0.9.2): each defect the independent review found, as a test that
 * failed before its fix (PROJECT_STATE.md, "Mərhələ 8 auditi").
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
  CalendarView,
  PayrollDocumentDetail,
  PayrollFillLine,
  PayrollTaxesView,
  TimesheetFill,
} from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;
const run = (f: F, cmd: object) => f.exec(cmd as never);
const employee = (f: F, name: string, extra: object = {}) =>
  run(f, {
    type: 'employee.save',
    companyId: f.companyId,
    name,
    archived: false,
    hired: '2025-01-01',
    salary: '1000',
    expenseAccount: '721',
    ...extra,
  }).id!;
const fill = (f: F, month: string) =>
  f.query<PayrollFillLine[]>({ type: 'payrollFill', companyId: f.companyId, month });
const payroll = (f: F, month: string, lines: object[], extra: object = {}) =>
  run(f, { type: 'payroll.save', companyId: f.companyId, month, lines, ...extra });
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
const sheetFill = (f: F, month: string) =>
  f.query<TimesheetFill>({ type: 'timesheetFill', companyId: f.companyId, month });
const closeMonth = (f: F, month: string) =>
  run(f, { type: 'closing.post', companyId: f.companyId, month, acknowledged: true });

test('audit: the sick leave base and the vacation average include the timesheet’s extra pay', (t) => {
  const f = fixture(t);
  // June 2026: 159 norm hours; 1 590 a month is 10,00 an hour; 10 night hours × 40% = 40,00.
  const e = employee(f, 'Sürücü', { salary: '1590' });
  const june = sheetFill(f, '2026-06');
  run(f, {
    type: 'timesheet.save',
    companyId: f.companyId,
    month: '2026-06',
    rows: [{ employeeId: e, cells: june.rows[0]!.cells, overtime: '', night: '10' }],
  });
  const doc = payroll(f, '2026-06', fill(f, '2026-06'));
  assert.equal(detail(f, doc.id!).lines[0]!.gross, '1630.00');
  // The insured income of the four quarters is the gross: 1 630,00 / 365 days = 4,47 a day.
  const s = absence(f, 'sick', e, '2026-10-05', '2026-10-07', { sheetNo: 'X-1', percent: 100 });
  assert.deepEqual([absenceView(f, s.id!).daily, absenceView(f, s.id!).amount], ['4.47', '13.41']);
  // The vacation average is the month's earnings with the night pay: 1 630,00 / 30,4 = 53,62.
  const v = absence(f, 'vacation', e, '2026-10-12', '', { days: 1 });
  assert.equal(absenceView(f, v.id!).daily, '53.62');
});

test('audit: a sick leave continuing another one gets only what is left of the 14 employer days', (t) => {
  const f = fixture(t);
  const e = employee(f, 'Sürücü');
  const first = absence(f, 'sick', e, '2026-10-01', '2026-10-10', {
    sheetNo: 'X-1',
    percent: 100,
    manual: '50',
  });
  assert.deepEqual(
    [absenceView(f, first.id!).employerDays, absenceView(f, first.id!).amount],
    [10, '500.00'],
  );
  const next = absence(f, 'sick', e, '2026-10-11', '2026-10-20', {
    sheetNo: 'X-2',
    percent: 100,
    manual: '50',
  });
  const v = absenceView(f, next.id!);
  assert.deepEqual([v.employerDays, v.fundDays, v.amount], [4, 6, '200.00']);
  assert.match(v.basis, /Davamı: XV-000001/);
  // A new illness after a break starts its own 14 days.
  const later = absence(f, 'sick', e, '2026-11-02', '2026-11-04', {
    sheetNo: 'X-3',
    percent: 100,
    manual: '50',
  });
  assert.equal(absenceView(f, later.id!).employerDays, 3);
});

test('audit: a posted payroll goes stale when an unpaid leave, the timesheet, the calendar or the hire dates change', (t) => {
  const f = fixture(t);
  const e = employee(f, 'Sürücü');
  // An unpaid leave (no pay of its own) after the payroll: the salary is less.
  const doc = payroll(f, '2026-10', fill(f, '2026-10'));
  assert.deepEqual(detail(f, doc.id!).stale, []);
  const unpaid = absence(f, 'unpaid', e, '2026-10-20', '2026-10-21');
  assert.match(String(unpaid.warning), /ƏH-000001/);
  assert.deepEqual(detail(f, doc.id!).stale, ['Sürücü']);
  assert.throws(() => closeMonth(f, '2026-10'), /köhnəlib/);
  const again = payroll(f, '2026-10', fill(f, '2026-10'), { id: doc.id, version: doc.version });
  assert.deepEqual(detail(f, doc.id!).stale, []);
  run(f, {
    type: 'absence.cancel',
    companyId: f.companyId,
    id: unpaid.id,
    version: unpaid.version,
    reason: 'səhv',
  });
  assert.deepEqual(detail(f, doc.id!).stale, ['Sürücü']);
  const third = payroll(f, '2026-10', fill(f, '2026-10'), { id: doc.id, version: again.version });

  // The timesheet changed after the payroll: a day becomes an absence without a reason.
  const sheet = sheetFill(f, '2026-10');
  const ts = run(f, {
    type: 'timesheet.save',
    companyId: f.companyId,
    month: '2026-10',
    rows: [{ employeeId: e, cells: sheet.rows[0]!.cells, overtime: '', night: '' }],
  });
  const fourth = payroll(f, '2026-10', fill(f, '2026-10'), { id: doc.id, version: third.version });
  assert.deepEqual(detail(f, doc.id!).stale, []);
  const cells = [...sheet.rows[0]!.cells];
  cells[5] = 'Q';
  run(f, {
    type: 'timesheet.save',
    companyId: f.companyId,
    id: ts.id,
    version: ts.version,
    month: '2026-10',
    rows: [{ employeeId: e, cells, overtime: '', night: '' }],
  });
  assert.deepEqual(detail(f, doc.id!).stale, ['Sürücü']);
  payroll(f, '2026-10', fill(f, '2026-10'), { id: doc.id, version: fourth.version });
  assert.deepEqual(detail(f, doc.id!).stale, []);

  // The calendar of an open month changed after November’s payroll (no timesheet there): with an
  // unpaid leave the salary is 17 of 19 working days, then 16 of 18.
  absence(f, 'unpaid', e, '2026-11-23', '2026-11-24');
  const nov = payroll(f, '2026-11', fill(f, '2026-11'));
  assert.equal(detail(f, nov.id!).lines[0]!.salary, '894.74');
  const y = f.query<CalendarView>({ type: 'calendar', companyId: f.companyId, year: 2026 });
  run(f, {
    type: 'calendar.save',
    companyId: f.companyId,
    year: 2026,
    days: [...y.days, { date: '2026-11-20', kind: 'rest', name: 'Köçürülmüş' }],
  });
  assert.deepEqual(detail(f, nov.id!).stale, ['Sürücü']);
});

test('audit: a raise of the contract salary does not make an earlier posted payroll stale', (t) => {
  const f = fixture(t);
  const e = employee(f, 'Sürücü', { salary: '1760' });
  const sheet = sheetFill(f, '2026-10');
  run(f, {
    type: 'timesheet.save',
    companyId: f.companyId,
    month: '2026-10',
    rows: [{ employeeId: e, cells: sheet.rows[0]!.cells, overtime: '2', night: '' }],
  });
  const doc = payroll(f, '2026-10', fill(f, '2026-10'));
  assert.equal(detail(f, doc.id!).lines[0]!.overtime, '40.00');
  run(f, {
    type: 'employee.save',
    companyId: f.companyId,
    id: e,
    version: 1,
    name: 'Sürücü',
    archived: false,
    hired: '2025-01-01',
    salary: '2000',
    expenseAccount: '721',
  });
  assert.deepEqual(detail(f, doc.id!).stale, []);
});

test('audit: an absence of an employee who is not on the posted payroll makes it stale', (t) => {
  const f = fixture(t);
  const a = employee(f, 'Əli');
  const b = employee(f, 'Vəli', { left: '2026-10-31' });
  const doc = payroll(
    f,
    '2026-10',
    fill(f, '2026-10').filter((l) => l.employeeId === a),
  );
  assert.deepEqual(detail(f, doc.id!).stale, []);
  absence(f, 'compensation', b, '2026-10-31', '', { days: 5, manual: '1216' });
  assert.deepEqual(detail(f, doc.id!).stale, ['Vəli']);
  assert.throws(() => closeMonth(f, '2026-10'), /köhnəlib/);
});

test('audit: taxes and funds — "paid" is what was transferred, not what is left over', (t) => {
  const f = fixture(t);
  const e = employee(f, 'Sürücü');
  payroll(f, '2026-10', fill(f, '2026-10'));
  // Income tax from another source (not the payroll) in the month: it is owed, not paid.
  const kind = f.item('paymentKind', 'Vergi (haqq)');
  f.operation('2026-10-15', [f.line('533', [e], '521.03', [kind], '10')]);
  const row = f
    .query<PayrollTaxesView>({ type: 'payrollTaxes', companyId: f.companyId, month: '2026-10' })
    .rows.find((r) => r.account === '521.03')!;
  assert.deepEqual([row.accrued, row.paid, row.closing], ['24.00', '0.00', '34.00']);
});

test('audit: schema v13 → v20 at once keeps the employees and seeds the payroll', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-v13-'));
  const path = join(dir, 'm.sqlite');
  const raw = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  for (const m of migrations.filter((x) => x.version <= 13)) raw.exec(m.sql);
  raw.exec(`PRAGMA user_version=13;
INSERT INTO companies(id,name,tax_id,created_at) VALUES('a','a','1000000001','2026-10-01');
INSERT INTO employees(id,company_id,name,position,fin) VALUES('e','a','İşçi','Sürücü','5ABC123');
INSERT INTO items(id,company_id,kind,name,archived) VALUES('i1','a','expenseItem','Əmək haqqı',0);`);
  raw.close();
  const db = new Db(path);
  assert.equal(Number(db.get('PRAGMA user_version')!.user_version), migrations.at(-1)!.version);
  assert.deepEqual(
    [
      { ...db.get("SELECT fin, salary, vacation_days AS v FROM employees WHERE id='e'") },
      db.get("SELECT role FROM items WHERE id='i1'")!.role,
      Number(db.get("SELECT COUNT(*) AS n FROM payroll_rates WHERE company_id='a'")!.n),
      Number(db.get("SELECT COUNT(*) AS n FROM work_calendar WHERE company_id='a'")!.n),
    ],
    [{ fin: '5ABC123', salary: 0n, v: 21n }, 'salary', 1, 31],
  );
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
