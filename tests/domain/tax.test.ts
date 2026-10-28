/** Stage 9c — tax depreciation by VM 114 (docs/MERHELE-9-VERGI-BEYANNAMELERI.md §5.3, §8: V5). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMinor } from '../../src/domain/money.js';
import {
  checkTaxYear,
  defaultTaxYear,
  taxCategoryOf,
  taxDepreciation,
  type TaxAsset,
  type TaxYearParams,
} from '../../src/domain/tax.js';

const asset = (id: string, extra: Partial<TaxAsset>): TaxAsset => ({
  id,
  category: 'transport',
  inYear: 2026,
  value: 0n,
  outYear: 0,
  proceeds: 0n,
  ...extra,
});
const defaults = () => defaultTaxYear();
const show = (rows: ReturnType<typeof taxDepreciation>) =>
  rows.map((r) => [
    r.id,
    formatMinor(r.opening),
    formatMinor(r.added),
    formatMinor(r.removed),
    formatMinor(r.depreciation),
    formatMinor(r.writtenOff),
    formatMinor(r.closing),
  ]);

test('V5: the §8 truck — 50 000 at 25%: 12 500, then 9 375 on 37 500; a building at 7%', () => {
  const truck = asset('truck', { value: 5_000_000n });
  const office = asset('office', { category: 'buildings', value: 10_000_000n, inYear: 2027 });
  assert.deepEqual(show(taxDepreciation([truck, office], defaults, 2026)), [
    ['truck', '0.00', '50000.00', '0.00', '12500.00', '0.00', '37500.00'],
  ]);
  assert.deepEqual(show(taxDepreciation([truck, office], defaults, 2027)), [
    ['truck', '37500.00', '0.00', '0.00', '9375.00', '0.00', '28125.00'],
    ['office', '0.00', '100000.00', '0.00', '7000.00', '0.00', '93000.00'],
  ]);
});

test('V5: a rate below the highest, the micro coefficient; the year chosen each year', () => {
  const truck = asset('truck', { value: 5_000_000n });
  const params = (y: number): TaxYearParams =>
    y === 2026
      ? { ...defaults(), rates: { ...defaults().rates, transport: 2000 } }
      : { ...defaults(), coefficient: 200 };
  // 2026: 20% → 10 000; 2027: 25% × 2 on 40 000 → 20 000.
  assert.deepEqual(show(taxDepreciation([truck], params, 2027)), [
    ['truck', '40000.00', '0.00', '0.00', '20000.00', '0.00', '20000.00'],
  ]);
});

test('V5: a sale leaves with its residual and no depreciation that year; a small category goes whole', () => {
  const truck = asset('truck', { value: 5_000_000n, outYear: 2027, proceeds: 4_000_000n });
  const mouse = asset('mouse', { category: 'computers', value: 12_000n });
  const both = [truck, mouse];
  const r2027 = taxDepreciation(both, defaults, 2027);
  assert.deepEqual(
    show(r2027).find((r) => r[0] === 'truck'),
    ['truck', '37500.00', '0.00', '37500.00', '0.00', '0.00', '0.00'],
  );
  assert.equal(r2027.find((r) => r.id === 'truck')!.proceeds, 4_000_000n);
  // 120 at 25% → 30, 90 left < 100: written off whole in its first year.
  assert.deepEqual(
    show(taxDepreciation(both, defaults, 2026)).find((r) => r[0] === 'mouse'),
    ['mouse', '0.00', '120.00', '0.00', '30.00', '90.00', '0.00'],
  );
  assert.deepEqual(taxDepreciation(both, defaults, 2028), [], 'nothing left after the sale');
  // In and out in the same year: no depreciation, its value leaves.
  const flip = asset('flip', { value: 100_000n, outYear: 2026 });
  assert.deepEqual(show(taxDepreciation([flip], defaults, 2026)), [
    ['flip', '0.00', '1000.00', '1000.00', '0.00', '0.00', '0.00'],
  ]);
});

test('V5: the rates are checked against VM 114.3; the groups map to the categories', () => {
  const d = defaults();
  assert.throws(
    () => checkTaxYear({ ...d, rates: { ...d.rates, transport: 3000 } }),
    /25%-dən çox ola bilməz/,
  );
  assert.throws(() => checkTaxYear({ ...d, coefficient: 300 }), /Əmsal/);
  assert.deepEqual(
    ['transport', 'buildings', 'computers', 'machinery', 'other', 'x'].map(taxCategoryOf),
    ['transport', 'buildings', 'computers', 'machinery', 'other', 'other'],
  );
});
