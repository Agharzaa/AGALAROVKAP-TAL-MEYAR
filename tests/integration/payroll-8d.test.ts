/**
 * Stage 8d — the production calendar, the timesheet, vacations split by month and without the
 * holidays, the vacation balance and the compensation (docs/MERHELE-8-EMEK-HAQQI.md §13: Ə16–Ə20).
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
  TimesheetDetail,
  TimesheetFill,
  VacationBalanceRow,
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
const absence = (f: F, kind: string, employeeId: string, from: string, extra: object = {}) =>
  run(f, {
    type: 'absence.save',
    companyId: f.companyId,
    kind,
    employeeId,
    from,
    to: from,
    ...extra,
  });
const absenceView = (f: F, id: string) =>
  f.query<AbsenceView>({ type: 'absence', companyId: f.companyId, id });
const sheetFill = (f: F, month: string) =>
  f.query<TimesheetFill>({ type: 'timesheetFill', companyId: f.companyId, month });
const sheet = (f: F, id: string) =>
  f.query<TimesheetDetail>({ type: 'timesheet', companyId: f.companyId, id });

test('Ə16: the company’s calendar — 2026 seeded; a year is set by the accountant; closed months keep theirs', (t) => {
  const f = fixture(t);
  const y = f.query<CalendarView>({ type: 'calendar', companyId: f.companyId, year: 2026 });
  assert.deepEqual(
    [y.known, y.workdays, y.hours, y.months[2]!.workdays, y.months[2]!.hours],
    [true, 241, 1922, 14, 111],
  );
  const next = f.query<CalendarView>({ type: 'calendar', companyId: f.companyId, year: 2027 });
  assert.deepEqual([next.known, next.workdays], [false, 261]);
  run(f, {
    type: 'calendar.save',
    companyId: f.companyId,
    year: 2027,
    days: [
      { date: '2027-01-01', kind: 'holiday', name: 'Yeni il' },
      { date: '2027-01-02', kind: 'holiday', name: 'Yeni il' },
      { date: '2027-01-09', kind: 'work', name: 'İş günü (köçürmə)' },
    ],
  });
  const set = f.query<CalendarView>({ type: 'calendar', companyId: f.companyId, year: 2027 });
  assert.deepEqual([set.known, set.months[0]!.workdays], [true, 21]);
  assert.throws(
    () =>
      run(f, {
        type: 'calendar.save',
        companyId: f.companyId,
        year: 2027,
        days: [{ date: '2027-01-04', kind: 'work', name: '' }],
      }),
    /onsuz da iş günüdür/,
  );
  run(f, { type: 'period.close', companyId: f.companyId, through: '2026-03-31' });
  assert.throws(
    () =>
      run(f, {
        type: 'calendar.save',
        companyId: f.companyId,
        year: 2026,
        days: y.days.filter((d) => d.date !== '2026-03-09'),
      }),
    /2026-03-09 bağlı dövrdədir/,
  );
});

test('Ə17: a vacation from 16 March for 21 days ends on 10 April; its pay goes to both months', (t) => {
  const f = fixture(t);
  const e = employee(f, 'Sürücü');
  const v = absence(f, 'vacation', e, '2026-03-16', { days: 21, manual: '1216' });
  const a = absenceView(f, v.id!);
  assert.deepEqual([a.to, a.days, a.daily, a.amount], ['2026-04-10', 21, '40.00', '840.00']);
  // March: 14 working days, 5 on vacation (16–19, 31); 11 vacation days. April: 22, 8; 10 days.
  const pick = (m: string) => fill(f, m).find((l) => l.employeeId === e)!;
  assert.deepEqual([pick('2026-03').salary, pick('2026-03').vacation], ['642.86', '440.00']);
  assert.deepEqual([pick('2026-04').salary, pick('2026-04').vacation], ['636.36', '400.00']);
  // A vacation of only holidays has no day.
  assert.throws(
    () => absence(f, 'vacation', e, '2026-03-20', { to: '2026-03-24', manual: '1216' }),
    /yalnız bayramlar/,
  );
});

test('Ə18 / Ə20: the timesheet — filled from the calendar; hours, overtime, a day off and night are paid; a later vacation makes it stale', (t) => {
  const f = fixture(t);
  // 1 760 a month, October 176 norm hours: 10,00 an hour.
  const e = employee(f, 'Sürücü', { salary: '1760' });
  const october = sheetFill(f, '2026-10');
  assert.equal(october.days.length, 31);
  const cells = october.rows[0]!.cells;
  assert.deepEqual([cells[0], cells[2], cells[3]], ['8', 'B', 'B']);
  cells[4] = '10'; // Monday 5 October: 2 hours over the norm
  cells[5] = 'Q'; // Tuesday 6 October: absent without a reason
  cells[9] = '8'; // Saturday 10 October: a day off worked
  const ts = run(f, {
    type: 'timesheet.save',
    companyId: f.companyId,
    month: '2026-10',
    rows: [{ employeeId: e, cells, overtime: '3', night: '20' }],
  });
  assert.equal(ts.number, 'TB-2026-10');
  const row = sheet(f, ts.id!).rows[0]!;
  assert.deepEqual(
    [
      row.days,
      row.hours,
      row.holidayHours,
      row.overtimeTotal,
      row.night,
      row.norm,
      row.absent.truancy,
    ],
    [22, '168', '8', '5', '20', '176', 1],
  );
  assert.throws(
    () =>
      run(f, {
        type: 'timesheet.save',
        companyId: f.companyId,
        month: '2026-11',
        rows: [{ employeeId: e, cells: ['8', 'Z'] }],
      }),
    /"Z" tanınmadı/,
  );
  // 168 of 176 hours → 1 680; overtime 5 h × 10 × 2 = 100; a day off 8 h × 10 × 2 = 160; night 20 h × 10 × 40% = 80.
  const line = fill(f, '2026-10')[0]!;
  assert.deepEqual(
    [line.byTimesheet, line.salary, line.overtime, line.holidayWork, line.night],
    [true, '1680.00', '100.00', '160.00', '80.00'],
  );
  const doc = run(f, {
    type: 'payroll.save',
    companyId: f.companyId,
    month: '2026-10',
    lines: [line],
  });
  const posted = f.query<PayrollDocumentDetail>({
    type: 'payrollDocument',
    companyId: f.companyId,
    id: doc.id,
  });
  assert.deepEqual(
    [
      posted.lines[0]!.gross,
      posted.lines[0]!.overtime,
      posted.lines[0]!.holidayWork,
      posted.lines[0]!.night,
    ],
    ['2020.00', '100.00', '160.00', '80.00'],
  );
  // A vacation on 20–21 October after the timesheet: it and the payroll are stale; the closing waits.
  absence(f, 'vacation', e, '2026-10-20', { to: '2026-10-21', manual: '1216' });
  assert.deepEqual(sheet(f, ts.id!).stale, ['Sürücü']);
  assert.throws(
    () =>
      run(f, {
        type: 'closing.post',
        companyId: f.companyId,
        month: '2026-10',
        acknowledged: true,
      }),
    /TB-2026-10 tabeli məzuniyyət \/ xəstəlik sənədlərinə uyğun deyil/,
  );
  const again = sheetFill(f, '2026-10').rows[0]!.cells;
  assert.deepEqual([again[19], again[20]], ['M', 'M']);
  const ts2 = run(f, {
    type: 'timesheet.save',
    companyId: f.companyId,
    id: ts.id,
    version: ts.version,
    month: '2026-10',
    rows: [{ employeeId: e, cells: again }],
  });
  assert.deepEqual(sheet(f, ts2.id!).stale, []);
  assert.throws(
    () =>
      run(f, {
        type: 'timesheet.save',
        companyId: f.companyId,
        month: '2026-10',
        rows: [{ employeeId: e, cells: again }],
      }),
    /tabeli artıq var/,
  );
});

test('Ə19: the vacation balance — 21 days with tenure, the years worked, the days used; the compensation takes what is left', (t) => {
  const f = fixture(t);
  const e = employee(f, 'Köhnə sürücü', { hired: '2020-03-01', tenureFrom: '2014-01-01' });
  const v = absence(f, 'vacation', e, '2026-07-01', { days: 25, manual: '1216' });
  assert.equal(v.warning, undefined);
  const rows = f.query<VacationBalanceRow[]>({
    type: 'vacationBalances',
    companyId: f.companyId,
    date: '2026-10-27',
  });
  assert.deepEqual(
    rows.map((r) => [r.years, r.annual, r.earned, r.used, r.balance]),
    [[6, 25, 157, 25, 132]],
  );
  // Leaving on 31 October: 132 days not taken, at 40,00 a day — in October's payroll.
  run(f, {
    type: 'employee.save',
    companyId: f.companyId,
    id: e,
    version: 1,
    name: 'Köhnə sürücü',
    archived: false,
    hired: '2020-03-01',
    left: '2026-10-31',
    tenureFrom: '2014-01-01',
    salary: '1000',
    expenseAccount: '721',
  });
  const c = absence(f, 'compensation', e, '2026-10-31', { manual: '1216' });
  assert.equal(c.number, 'MK-000001');
  const k = absenceView(f, c.id!);
  assert.deepEqual([k.days, k.amount], [132, '5280.00']);
  assert.match(k.basis, /İstifadə olunmamış 132 gün/);
  assert.equal(fill(f, '2026-10').find((l) => l.employeeId === e)!.vacation, '5280.00');
  // A vacation beyond the balance is a warning.
  const fresh = employee(f, 'Yeni', { hired: '2026-09-01' });
  const w = absence(f, 'vacation', fresh, '2026-10-05', { days: 21, manual: '1216' });
  assert.match(String(w.warning), /məzuniyyət qalığı 2 gündür, sənəd 21 gün/);
});

test('schema v18 → v19: the calendar, the vacation terms; absences keep their rows through the rebuild', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-v18-'));
  const path = join(dir, 'm.sqlite');
  const raw = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  for (const m of migrations.filter((x) => x.version <= 18)) raw.exec(m.sql);
  raw.exec(`PRAGMA user_version=18;
INSERT INTO companies(id,name,tax_id,created_at) VALUES('a','a','1000000001','2026-10-01');
INSERT INTO employees(id,company_id,name) VALUES('e','a','İşçi');
INSERT INTO payroll_absences(id,company_id,kind,number,number_key,employee_id,date_from,date_to,days,status,version,created_at,updated_at)
  VALUES('x','a','vacation','MZ-1','mz-1','e','2026-10-05','2026-10-09',5,'posted',1,'t','t');`);
  raw.close();
  const db = new Db(path);
  assert.equal(
    Number(db.get("SELECT COUNT(*) AS n FROM work_calendar WHERE company_id='a'")!.n),
    31,
  );
  assert.deepEqual(
    [
      db.get("SELECT vacation_days AS v FROM employees WHERE id='e'")!.v,
      db.get("SELECT number FROM payroll_absences WHERE id='x'")!.number,
    ],
    [21n, 'MZ-1'],
  );
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
