/**
 * Tax depreciation (stage 9c; docs/MERHELE-9-VERGI-BEYANNAMELERI.md §5.3, QERARLAR 2026-10-28
 * mərhələ 9 §5): Vergi Məcəlləsi 114. Each category has an annual rate, at most the code's one,
 * applied to the residual value at the year's end (declining balance); a micro / small business
 * multiplies it by 2 / 1,5. An asset put into service during the year counts for the whole year;
 * one sold or written off leaves with its residual value and gets no depreciation that year. A
 * category whose residual falls below the threshold (100 ₼) is written off whole. The rules the
 * sources do not settle are parameters, and the accountant confirms them.
 *
 * Meyar knows every asset, so the residual is kept per asset; the category is their sum.
 */
import { DomainError } from './errors.js';
import { roundHalfAwayFromZero, type Minor } from './money.js';

export const taxCategories = ['buildings', 'machinery', 'computers', 'transport', 'other'] as const;
export type TaxCategory = (typeof taxCategories)[number];

/** The category of an asset's group (stage 7a) — the groups were made to match VM 114.3. */
export const taxCategoryOf = (group: string): TaxCategory =>
  (taxCategories as readonly string[]).includes(group) ? (group as TaxCategory) : 'other';

export const taxCategoryLabel: Record<TaxCategory, string> = {
  buildings: 'Binalar, tikililər və qurğular',
  machinery: 'Maşınlar və avadanlıq',
  computers: 'Hesablama texnikası',
  transport: 'Nəqliyyat vasitələri',
  other: 'Digər əsas vəsaitlər',
};

/** VM 114.3: the highest annual rates, in hundredths of a percent (25% → 2 500). */
export const maxTaxRates: Record<TaxCategory, number> = {
  buildings: 700,
  machinery: 2000,
  computers: 2500,
  transport: 2500,
  other: 2000,
};

/** VM 114.3-1, 114.3-2: an ordinary business 1, a small one 1,5, a micro one 2 (in hundredths). */
export const taxCoefficients = [100, 150, 200] as const;

export interface TaxYearParams {
  rates: Record<TaxCategory, number>;
  coefficient: number;
  /** A category whose residual at the year's end is below this is written off whole. */
  writeOff: Minor;
}
export const defaultTaxYear = (): TaxYearParams => ({
  rates: { ...maxTaxRates },
  coefficient: 100,
  writeOff: 10_000n,
});

export function checkTaxYear(p: TaxYearParams): TaxYearParams {
  for (const c of taxCategories)
    if (p.rates[c] < 0 || p.rates[c] > maxTaxRates[c])
      throw new DomainError(
        `${taxCategoryLabel[c]}: norma ${maxTaxRates[c] / 100}%-dən çox ola bilməz (VM 114.3).`,
        `rates.${c}`,
      );
  if (!(taxCoefficients as readonly number[]).includes(p.coefficient))
    throw new DomainError('Əmsal 1, 1,5 və ya 2 olmalıdır (VM 114.3-1, 114.3-2).', 'coefficient');
  if (p.writeOff < 0n) throw new DomainError('Hədd mənfi ola bilməz.', 'writeOff');
  return p;
}

/** An asset as the tax sees it: its value when it came in, and when it left (if it did). */
export interface TaxAsset {
  id: string;
  category: TaxCategory;
  /** The year it was put into service (or taken over with an opening balance). */
  inYear: number;
  /** Its tax value then: the cost, or the residual value taken over. */
  value: Minor;
  /** The year it was sold or written off; 0 — still in service. */
  outYear: number;
  /** What it was sold for, without VAT (0 for a write-off). */
  proceeds: Minor;
}

export interface TaxAssetYear {
  id: string;
  category: TaxCategory;
  /** Residual value at the year's start. */
  opening: Minor;
  /** Put into service this year. */
  added: Minor;
  /** Sold or written off this year: its residual value then. */
  removed: Minor;
  proceeds: Minor;
  /** Residual at the year's end, before depreciation (the base of VM 114.3). */
  base: Minor;
  depreciation: Minor;
  /** Written off whole: its category fell below the threshold. */
  writtenOff: Minor;
  /** Residual carried into the next year. */
  closing: Minor;
}

/** One year's depreciation of an asset's base: rate × coefficient, rounded to the qəpik. */
export const yearDepreciation = (base: Minor, rate: number, coefficient: number): Minor =>
  roundHalfAwayFromZero(base * BigInt(rate) * BigInt(coefficient), 1_000_000n);

/**
 * Every asset's year `year`, walking the years from the first asset in. `params` gives each
 * year's rates (the defaults where the accountant set none).
 */
export function taxDepreciation(
  assets: readonly TaxAsset[],
  params: (year: number) => TaxYearParams,
  year: number,
): TaxAssetYear[] {
  const first = Math.min(year, ...assets.map((a) => a.inYear));
  const residual = new Map<string, Minor>(assets.map((a) => [a.id, 0n]));
  let rows: TaxAssetYear[] = [];
  for (let y = first; y <= year; y++) {
    const p = params(y);
    rows = [];
    for (const a of assets) {
      if (a.inYear > y || (a.outYear && a.outYear < y)) continue;
      const opening = residual.get(a.id)!;
      const added = a.inYear === y ? a.value : 0n;
      // Written off to nothing in an earlier year: no row, unless it is sold now (its price counts).
      if (!opening && a.inYear !== y && a.outYear !== y) continue;
      const base = opening + added;
      const out = a.outYear === y;
      const depreciation = out ? 0n : yearDepreciation(base, p.rates[a.category], p.coefficient);
      rows.push({
        id: a.id,
        category: a.category,
        opening,
        added,
        removed: out ? base : 0n,
        proceeds: out ? a.proceeds : 0n,
        base: out ? 0n : base,
        depreciation,
        writtenOff: 0n,
        closing: out ? 0n : base - depreciation,
      });
    }
    for (const c of taxCategories) {
      const mine = rows.filter((r) => r.category === c && !r.removed);
      const left = mine.reduce((s, r) => s + r.closing, 0n);
      if (left > 0n && left < p.writeOff)
        for (const r of mine) {
          r.writtenOff = r.closing;
          r.closing = 0n;
        }
    }
    for (const r of rows) residual.set(r.id, r.closing);
  }
  return rows;
}
