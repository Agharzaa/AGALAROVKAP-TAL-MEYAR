/** Stage 7 — straight-line depreciation (docs/MERHELE-7-ESAS-VESAITLER.md §4.2, §9; test Ə2). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  depreciatedThrough,
  depreciationFor,
  monthAfter,
  monthlyAmount,
  monthsLeftAfter,
  type DepreciationTerms,
} from '../../src/domain/assets.js';

const actros: DepreciationTerms = {
  cost: 5_000_000n,
  salvage: 0n,
  accumulated: 0n,
  months: 60,
  start: monthAfter('2026-10-15'),
};

test('Ə2: 50 000 over 60 months — 833,33 a month, the last 833,53, exactly 50 000 in all', () => {
  assert.equal(actros.start, '2026-11');
  assert.equal(monthlyAmount(actros), 83_333n);
  assert.equal(depreciationFor(actros, '2026-10'), 0n);
  assert.equal(depreciationFor(actros, '2026-11'), 83_333n);
  assert.equal(depreciationFor(actros, '2031-09'), 83_333n);
  assert.equal(depreciationFor(actros, '2031-10'), 83_353n);
  assert.equal(depreciationFor(actros, '2031-11'), 0n);
  let sum = 0n;
  for (let i = 0; i < 70; i++) {
    const y = 2026 + Math.floor((10 + i) / 12);
    const m = ((10 + i) % 12) + 1;
    sum += depreciationFor(actros, `${y}-${String(m).padStart(2, '0')}`);
  }
  assert.equal(sum, 5_000_000n);
  assert.equal(depreciatedThrough(actros, '2026-12'), 166_666n);
  assert.equal(depreciatedThrough(actros, '2040-01'), 5_000_000n);
  assert.equal(monthsLeftAfter(actros, '2026-10'), 60);
  assert.equal(monthsLeftAfter(actros, '2026-12'), 58);
  assert.equal(monthsLeftAfter(actros, '2032-01'), 0);
});

test('Ə6: an opening balance depreciates what is left over the months left', () => {
  const t: DepreciationTerms = {
    cost: 3_000_000n,
    salvage: 0n,
    accumulated: 1_200_000n,
    months: 24,
    start: monthAfter('2026-09-30'),
  };
  assert.equal(t.start, '2026-10');
  assert.equal(monthlyAmount(t), 75_000n);
  assert.equal(depreciatedThrough(t, '2028-09'), 1_800_000n);
});

test('stage 7: salvage stays; a tiny base never goes negative; December rolls the year', () => {
  assert.equal(monthAfter('2026-12-31'), '2027-01');
  const t: DepreciationTerms = {
    cost: 1_000_000n,
    salvage: 100_000n,
    accumulated: 0n,
    months: 12,
    start: '2027-01',
  };
  assert.equal(depreciatedThrough(t, '2027-12'), 900_000n);
  const tiny: DepreciationTerms = {
    cost: 2n,
    salvage: 0n,
    accumulated: 0n,
    months: 4,
    start: '2027-01',
  };
  const parts = ['2027-01', '2027-02', '2027-03', '2027-04'].map((m) => depreciationFor(tiny, m));
  assert.deepEqual(parts, [1n, 1n, 0n, 0n]);
});
