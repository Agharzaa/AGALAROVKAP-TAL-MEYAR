/** Stage 8 — payroll by the 2026 rates (docs/MERHELE-8-EMEK-HAQQI.md §5, §9; tests Ə1, Ə2). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMinor } from '../../src/domain/money.js';
import {
  byBrackets,
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
  // 10 000: 75 + 550 + 2 000 × 14%; medical 2 500 × 2% + 7 500 × 0,5%; DSMF 6 + 9 800 × 10%.
  const big = show(1_000_000n);
  assert.deepEqual(
    [big.incomeTax, big.medicalEmployee, big.dsmfEmployee, big.dsmfEmployer],
    ['905.00', '87.50', '986.00', '1514.00'],
  );
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
