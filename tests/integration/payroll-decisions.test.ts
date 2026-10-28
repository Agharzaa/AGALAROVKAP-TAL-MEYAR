/**
 * Stage 8 audit — the open questions as the user decided them (QERARLAR 2026-10-28 §1–§5): the
 * dated contract salary, the vacation average without months with absences, continuation sick
 * sheets worked out again, the bank salary register, a shortened day only on a weekday.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AbsenceView,
  Catalog,
  PayrollFillLine,
  StatementView,
  TimesheetFill,
} from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;
const run = (f: F, cmd: object) => f.exec(cmd as never);
const card = {
  archived: false,
  hired: '2025-01-01',
  salary: '1000',
  expenseAccount: '721',
};
const employee = (f: F, name: string, extra: object = {}) =>
  run(f, { type: 'employee.save', companyId: f.companyId, name, ...card, ...extra }).id!;
const fill = (f: F, month: string) =>
  f.query<PayrollFillLine[]>({ type: 'payrollFill', companyId: f.companyId, month });
const post = (f: F, month: string) =>
  run(f, { type: 'payroll.save', companyId: f.companyId, month, lines: fill(f, month) });
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

test('2026-10-28 §1: the contract salary is dated — a raise from the 16th pays each day at its salary', (t) => {
  const f = fixture(t);
  const e = employee(f, 'Sürücü');
  const raise = (salary: string, salaryFrom: string, version: number) =>
    run(f, {
      type: 'employee.save',
      companyId: f.companyId,
      id: e,
      version,
      name: 'Sürücü',
      ...card,
      salary,
      salaryFrom,
    });
  raise('1200', '2026-10-16', 1);
  // October: 22 working days, 11 at 1 000 and 11 at 1 200.
  const salaryIn = (m: string) => fill(f, m).find((l) => l.employeeId === e)!.salary;
  assert.deepEqual(
    [salaryIn('2026-09'), salaryIn('2026-10'), salaryIn('2026-11')],
    ['1000.00', '1100.00', '1200.00'],
  );
  const emp = f
    .query<Catalog>({ type: 'catalog', companyId: f.companyId })
    .employees.find((x) => x.id === e)!;
  assert.deepEqual(emp.salaries, [
    { from: '', salary: '1000.00' },
    { from: '2026-10-16', salary: '1200.00' },
  ]);
  // By the timesheet: 88 hours at each salary of 176.
  const sheet = f.query<TimesheetFill>({
    type: 'timesheetFill',
    companyId: f.companyId,
    month: '2026-10',
  });
  run(f, {
    type: 'timesheet.save',
    companyId: f.companyId,
    month: '2026-10',
    rows: [{ employeeId: e, cells: sheet.rows[0]!.cells, overtime: '', night: '' }],
  });
  assert.deepEqual(
    fill(f, '2026-10').map((l) => [l.byTimesheet, l.salary]),
    [[true, '1100.00']],
  );
  // A change into a closed month is refused; without a date — from the current month.
  run(f, { type: 'period.close', companyId: f.companyId, through: '2026-09-30' });
  assert.throws(() => raise('1300', '2026-09-15', 2), /bağlanıb/);
  raise('1300', '', 2);
  assert.deepEqual([salaryIn('2026-11'), salaryIn('2026-12')], ['1200.00', '1300.00']);
});

test('2026-10-28 §2: the vacation average leaves out a month with an unpaid leave', (t) => {
  const f = fixture(t);
  const e = employee(f, 'Sürücü');
  absence(f, 'unpaid', e, '2026-06-15', '2026-06-16');
  for (let m = 1; m <= 9; m++) post(f, `2026-${String(m).padStart(2, '0')}`);
  const v = absence(f, 'vacation', e, '2026-10-12', '', { days: 1 });
  const a = absenceView(f, v.id!);
  assert.deepEqual([a.average, a.daily], ['1000.00', '32.89']);
  assert.match(a.basis, /8 ay .*çıxılıb: 2026-06/);
});

test('2026-10-28 §3: a continuation sheet is worked out again when the sheet before it changes', (t) => {
  const f = fixture(t);
  const e = employee(f, 'Sürücü');
  const sick = (from: string, to: string, sheetNo: string, extra: object = {}) =>
    absence(f, 'sick', e, from, to, { sheetNo, percent: 100, manual: '50', ...extra });
  const first = sick('2026-10-01', '2026-10-10', 'X-1');
  const next = sick('2026-10-11', '2026-10-20', 'X-2');
  assert.equal(absenceView(f, next.id!).employerDays, 4);
  // The first one shortened to 5 days: the second gets 9 employer days.
  const short = sick('2026-10-06', '2026-10-10', 'X-1', { id: first.id, version: first.version });
  assert.match(String(short.warning), /Davam vərəqəsi yenidən hesablandı: XV-000002/);
  assert.deepEqual(
    [absenceView(f, next.id!).employerDays, absenceView(f, next.id!).amount],
    [9, '450.00'],
  );
  // Cancelled: the second starts the illness — all 10 days by the employer.
  const c = run(f, {
    type: 'absence.cancel',
    companyId: f.companyId,
    id: first.id,
    version: short.version,
    reason: 'səhv',
  });
  assert.match(String(c.warning), /XV-000002/);
  assert.deepEqual(
    [absenceView(f, next.id!).employerDays, absenceView(f, next.id!).fundDays],
    [10, 0],
  );
});

test('2026-10-28 §4: one bank payment of all the salaries owed is split by employee', (t) => {
  const f = fixture(t);
  const a = employee(f, 'Əliyev Anar');
  const b = employee(f, 'Bayramova Sevda');
  post(f, '2026-10');
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  f.bankAccount(bank, 'AZ12AIIB38060019441234567890', '223.01', 'AZN', 'Kapital');
  const line = (row: number, amount: string) => ({
    row,
    date: '2026-11-05',
    direction: 'out',
    amount,
    reference: `R${row}`,
    counterparty: 'Kart hesabı',
    counterpartyTaxId: '',
    counterpartyIban: '',
    purpose: 'Əmək haqqı (siyahı ilə)',
  });
  const imp = run(f, {
    type: 'statement.import',
    companyId: f.companyId,
    iban: 'AZ12AIIB38060019441234567890',
    fileName: 'x.xlsx',
    fileHash: 'c'.repeat(64),
    lines: [line(1, '1730'), line(2, '1000')],
  });
  const v = f.query<StatementView>({ type: 'statement', companyId: f.companyId, id: imp.id });
  assert.deepEqual(
    v.lines[0]!.proposal?.lines?.map((l) => [l.account, l.sk, l.amount]),
    [
      ['533', [b], '865.00'],
      ['533', [a], '865.00'],
    ],
  );
  assert.match(String(v.lines[0]!.proposal?.reason), /Əmək haqqı reyestri: 2 işçi/);
  // By name in the Azerbaijani alphabet (B before Ə). Not the sum owed: the accountant picks the employee.
  assert.equal(v.lines[1]!.proposal?.lines, undefined);
  assert.match(String(v.lines[1]!.proposal?.reason), /İşçi tanınmadı/);
});

test('2026-10-28 §5: a shortened day is a weekday', (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      run(f, {
        type: 'calendar.save',
        companyId: f.companyId,
        year: 2027,
        days: [{ date: '2027-01-02', kind: 'short', name: '' }],
      }),
    /qısaldılmış gün yalnız iş günü/,
  );
});
