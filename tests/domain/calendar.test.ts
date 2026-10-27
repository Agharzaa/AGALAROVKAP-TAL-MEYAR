/**
 * Stage 8d — the production calendar, vacations without holidays, the timesheet's pay and the
 * vacation entitlement (docs/MERHELE-8-EMEK-HAQQI.md §13: Ə16, Ə17, Ə18, Ə19).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMinor } from '../../src/domain/money.js';
import {
  calendar2026,
  eachDay,
  normHours,
  vacationDays,
  vacationEnd,
  WorkCalendar,
  workdaysIn,
} from '../../src/domain/calendar.js';
import {
  parseRates,
  rates2026,
  salaryFor,
  splitByMonth,
  timesheetPay,
  vacationEarned,
} from '../../src/domain/payroll.js';

const cal = new WorkCalendar(calendar2026);
const month = (m: string) => {
  const last = new Date(Date.UTC(2026, Number(m), 0)).toISOString().slice(0, 10);
  return [workdaysIn(cal, `2026-${m}-01`, last), normHours(cal, `2026-${m}-01`, last)];
};

test('Ə16: the 2026 calendar — the ministry’s working days and norm hours', () => {
  assert.deepEqual(
    ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map(month),
    [
      [19, 151],
      [20, 160],
      [14, 111],
      [22, 176],
      [17, 134],
      [20, 159],
      [23, 184],
      [21, 168],
      [22, 176],
      [22, 176],
      [19, 152],
      [22, 175],
    ],
  );
  assert.deepEqual(
    [workdaysIn(cal, '2026-01-01', '2026-12-31'), normHours(cal, '2026-01-01', '2026-12-31')],
    [241, 1922],
  );
  // A day the calendar does not know: Monday to Friday.
  assert.equal(new WorkCalendar().isWorkday('2026-03-20'), true);
  assert.equal(cal.isWorkday('2026-03-25'), false);
  assert.equal(cal.isHoliday('2026-03-25'), false);
  // November's salary by the calendar: 9 and 10 November are not working days.
  assert.equal(salaryFor(100_000n, '2026-11', '2026-11-11', '', [], cal), 73_684n);
});

test('Ə17: a vacation in March — the Novruz holidays are not vacation days, it grows by them; split by month', () => {
  // 21 days from 16 March: 16–19, then 20–24 March are holidays, then 25 March – 10 April.
  assert.equal(vacationEnd(cal, '2026-03-16', 21), '2026-04-10');
  assert.equal(vacationDays(cal, '2026-03-16', '2026-04-10'), 21);
  // The transferred rest days (25–27, 30 March) are vacation days: only holidays are left out.
  const days = eachDay('2026-03-16', '2026-04-10').filter((d) => !cal.isHoliday(d));
  const parts = splitByMonth(69_069n, days, 3_289n);
  assert.deepEqual(
    [...parts].map(([m, v]) => [m, formatMinor(v)]),
    [
      ['2026-03', '361.79'],
      ['2026-04', '328.90'],
    ],
  );
  // Without a daily rate (sick pay): by the share of days, the last month what is left.
  assert.deepEqual(
    [...splitByMonth(33_306n, eachDay('2026-11-25', '2026-12-08'))].map(([m, v]) => [m, v]),
    [
      ['2026-11', 14_274n],
      ['2026-12', 19_032n],
    ],
  );
});

test('Ə18: the timesheet’s pay — norm hours, overtime × 2, a holiday × 2, night + 40%', () => {
  const pay = parseRates(rates2026).pay;
  const p = timesheetPay({
    salary: 100_000n,
    norm: 17_600,
    worked: 17_600,
    overtime: 1_000,
    holidayWork: 800,
    night: 2_000,
    pay,
  });
  assert.deepEqual([p.salary, p.overtime, p.holidayWork, p.night].map(formatMinor), [
    '1000.00',
    '113.64',
    '90.91',
    '45.45',
  ]);
  // 3 days absent without a reason: 152 of 176 hours.
  assert.equal(
    formatMinor(
      timesheetPay({
        salary: 100_000n,
        norm: 17_600,
        worked: 15_200,
        overtime: 0,
        holidayWork: 0,
        night: 0,
        pay,
      }).salary,
    ),
    '863.64',
  );
});

test('Ə19: the vacation entitlement — 21 days, 2 / 4 / 6 for tenure, the current year by months', () => {
  // Tenure from 2014: at the working years from 01.03.2020 it is 6–9 years (+2), then 10–11 (+4).
  const e = vacationEarned({
    hired: '2020-03-01',
    tenureFrom: '2014-01-01',
    base: 21,
    extra: 0,
    date: '2026-10-27',
  });
  assert.deepEqual(e, { years: 6, earned: 4 * 23 + 2 * 25 + 15, annual: 25 });
  // In the first year: by the months gone; extra days for a condition of work.
  assert.deepEqual(
    vacationEarned({ hired: '2026-01-12', tenureFrom: '', base: 21, extra: 3, date: '2026-10-27' }),
    { years: 0, earned: 18, annual: 24 },
  );
});
