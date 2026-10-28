/** Stage 8 — payroll by the 2026 rates, exemptions, vacation and sick pay (plan §5, §9, §12; Ə1, Ə2, Ə4, Ə10–Ə12). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMinor } from '../../src/domain/money.js';
import {
  byBrackets,
  calendarDays,
  fourQuartersBefore,
  noExemption,
  sickPay,
  vacationPay,
  parseRate,
  parseRates,
  payrollFor,
  rates2026,
  ratesInput,
  salaryFor,
  workdays,
} from '../../src/domain/payroll.js';

const rates = parseRates(rates2026);
const show = (gross: bigint) =>
  Object.fromEntries(Object.entries(payrollFor(gross, rates)).map(([k, v]) => [k, formatMinor(v)]));

test('Ə1: the §9 driver — 1 000,00 gross, 865,00 net, the employer adds 189,00', () => {
  assert.deepEqual(show(100_000n), {
    gross: '1000.00',
    sick: '0.00',
    exemption: '200.00',
    incomeTax: '24.00',
    dsmfEmployee: '86.00',
    unemploymentEmployee: '5.00',
    medicalEmployee: '20.00',
    dsmfEmployer: '164.00',
    unemploymentEmployer: '5.00',
    medicalEmployer: '20.00',
    net: '865.00',
  });
});

test('Ə2: the bracket bounds — the 200 relief ends above 2 500; 10% and 14% on their parts only', () => {
  // 2 500,00: relief kept (2 300 × 3%), medical 2% on all of it.
  assert.deepEqual([show(250_000n).incomeTax, show(250_000n).medicalEmployee], ['69.00', '50.00']);
  // 2 500,01: no relief — 2 500 × 3% + 0,01 × 10%.
  assert.equal(show(250_001n).incomeTax, '75.00');
  assert.equal(show(800_000n).incomeTax, '625.00');
  // 10 000: 75 + 550 + 2 000 × 14%; medical 2 500 × 2% + 7 500 × 0,5%; DSMF 6 + 9 800 × 10%; the
  // employer 44 + 7 800 × 15% + 2 000 × 11% (DVX 2026; QERARLAR 2026-10-28 mərhələ 9 §2).
  const big = show(1_000_000n);
  assert.deepEqual(
    [big.incomeTax, big.medicalEmployee, big.dsmfEmployee, big.dsmfEmployer],
    ['905.00', '87.50', '986.00', '1434.00'],
  );
  // V4: 9 000 — the employee 886, the employer 1 214 + 1 000 × 11%; 8 000 itself — 1 214.
  assert.deepEqual(
    [show(900_000n).dsmfEmployee, show(900_000n).dsmfEmployer],
    ['886.00', '1324.00'],
  );
  assert.equal(show(800_000n).dsmfEmployer, '1214.00');
  // Rounded once, after the brackets: 6,00 + 103,457 → 109,46.
  assert.equal(show(123_457n).dsmfEmployee, '109.46');
  assert.equal(show(123_457n).incomeTax, '31.04');
  assert.equal(show(0n).net, '0.00');
});

test('rates: percent with a comma or a point, rising bounds, the last open; the stored form round-trips', () => {
  assert.deepEqual(
    [parseRate('0,5', 'x'), parseRate('3', 'x'), parseRate('14.25', 'x')],
    [50, 300, 1425],
  );
  assert.throws(() => parseRate('101', 'x'), /0–100/);
  assert.throws(() => parseRate('-1', 'x'), /0–100/);
  assert.throws(
    () =>
      parseRates({
        ...rates2026,
        incomeTax: [
          { upTo: '2500.00', rate: '3' },
          { upTo: '2000.00', rate: '10' },
          { upTo: '', rate: '14' },
        ],
      }),
    /əvvəlkindən böyük/,
  );
  assert.throws(
    () => parseRates({ ...rates2026, unemploymentEmployee: [{ upTo: '100.00', rate: '1' }] }),
    /son pillənin/,
  );
  assert.deepEqual(ratesInput(rates), rates2026);
  assert.equal(byBrackets(1n, rates.dsmfEmployee), 0n);
});

test('Ə4: a month started or left halfway is paid by its working days', () => {
  // October 2026: 22 working days; from Thursday the 15th — 12 of them.
  assert.equal(workdays('2026-10-01', '2026-10-31'), 22);
  assert.equal(salaryFor(100_000n, '2026-10', '2026-10-15', ''), 54_545n);
  assert.equal(salaryFor(100_000n, '2026-10', '2026-01-10', ''), 100_000n);
  assert.equal(salaryFor(100_000n, '2026-10', '', '2026-10-14'), 45_455n);
  assert.equal(salaryFor(100_000n, '2026-10', '2026-11-01', ''), 0n);
  assert.equal(salaryFor(100_000n, '2026-10', '', '2026-09-30'), 0n);
});

test('Ə10: exemptions — the larger of the 2026 relief and the own one, the extra 50 on top', () => {
  const tax = (gross: bigint, amount: bigint, extra = 0n, sick = 0n) =>
    formatMinor(payrollFor(gross, rates, { amount, extra }, sick).incomeTax);
  // 1 000: 400 beats the 200 relief → 600 × 3%; with the 50 → 550 × 3%.
  assert.equal(tax(100_000n, 40_000n), '18.00');
  assert.equal(tax(100_000n, 40_000n, 5_000n), '16.50');
  // 100 is smaller than the 200 relief: the relief counts.
  assert.equal(tax(100_000n, 10_000n), '24.00');
  // 3 000: no 2026 relief; 200 own → 2 800 = 75 + 30.
  assert.deepEqual([tax(300_000n, 0n), tax(300_000n, 20_000n)], ['125.00', '105.00']);
  // Sick pay alone: income tax (500 − 200) × 3%, no contributions.
  const sick = payrollFor(0n, rates, noExemption, 50_000n);
  assert.deepEqual(
    [sick.incomeTax, sick.dsmfEmployee, sick.dsmfEmployer, sick.net].map(formatMinor),
    ['9.00', '0.00', '0.00', '491.00'],
  );
  // The exemption never exceeds the income.
  assert.equal(
    formatMinor(payrollFor(10_000n, rates, { amount: 40_000n, extra: 0n }).exemption),
    '100.00',
  );
});

test('Ə11: vacation pay — 12 months over 12 / 30,4, the daily rate rounded first', () => {
  const year = Array.from({ length: 12 }, () => 100_000n);
  assert.deepEqual(Object.values(vacationPay(year, 21)).map(formatMinor), [
    '1000.00',
    '32.89',
    '690.69',
  ]);
  // Fewer months worked: 13 800 over 9 → 1 533,33 a month, 50,44 a day, 1 059,24 for 21 days.
  const nine = [...Array.from({ length: 8 }, () => 153_333n), 153_336n];
  assert.deepEqual(Object.values(vacationPay(nine, 21)).map(formatMinor), [
    '1533.33',
    '50.44',
    '1059.24',
  ]);
  // No history in Meyar: the accountant's average.
  assert.equal(formatMinor(vacationPay([], 14, 120_000n).amount), '552.58');
  // October 2026 with a vacation over two working weeks: 12 of 22 working days paid.
  assert.equal(
    salaryFor(100_000n, '2026-10', '', '', [{ from: '2026-10-19', to: '2026-11-01' }]),
    54_545n,
  );
});

test('Ə12: sick pay — four full quarters over their calendar days; the employer pays 14 days', () => {
  assert.deepEqual(fourQuartersBefore('2026-11-10'), { from: '2025-10-01', to: '2026-09-30' });
  assert.deepEqual(fourQuartersBefore('2026-10-01'), { from: '2025-10-01', to: '2026-09-30' });
  assert.deepEqual(fourQuartersBefore('2026-01-15'), { from: '2025-01-01', to: '2025-12-31' });
  assert.equal(calendarDays('2025-10-01', '2026-09-30'), 365);
  // 7 200 over 365 days → 19,73 a day; 25 days sick: 14 by the employer, 11 by DSMF.
  const s = sickPay({
    base: 720_000n,
    baseDays: 365,
    manualDaily: null,
    days: 25,
    percent: 100,
    employerAll: false,
  });
  assert.deepEqual(
    [formatMinor(s.daily), s.employerDays, s.fundDays, formatMinor(s.amount)],
    ['19.73', 14, 11, '276.22'],
  );
  // 80% service, 5 days; an accident the employer is at fault for: all days by the employer.
  assert.equal(
    formatMinor(
      sickPay({
        base: 720_000n,
        baseDays: 365,
        manualDaily: null,
        days: 5,
        percent: 80,
        employerAll: false,
      }).amount,
    ),
    '78.92',
  );
  assert.equal(
    sickPay({
      base: 0n,
      baseDays: 0,
      manualDaily: 3_000n,
      days: 20,
      percent: 100,
      employerAll: true,
    }).amount,
    60_000n,
  );
});
