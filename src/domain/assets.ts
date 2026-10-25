/**
 * Fixed assets (stage 7; docs/MERHELE-7-ESAS-VESAITLER.md, QERARLAR 2026-10-26): groups with
 * their standard useful life, and straight-line depreciation by month. Depreciation starts in the
 * month after the asset is put into service (or after the opening balance date) and runs for the
 * given number of months; each month is rounded to the qəpik and the last one takes what is left.
 */
import { roundHalfAwayFromZero, type Minor } from './money.js';

export type AssetGroup = 'transport' | 'machinery' | 'computers' | 'buildings' | 'other';

/** Standard useful life (months) by group; the accountant may change it per asset. */
export const assetGroups: readonly { id: AssetGroup; name: string; months: number }[] = [
  { id: 'transport', name: 'Nəqliyyat vasitələri', months: 60 },
  { id: 'machinery', name: 'Maşın və avadanlıq', months: 60 },
  { id: 'computers', name: 'Hesablama texnikası', months: 36 },
  { id: 'buildings', name: 'Binalar və tikililər', months: 240 },
  { id: 'other', name: 'Digər', months: 60 },
];

export interface DepreciationTerms {
  /** Initial cost (111). */
  cost: Minor;
  /** Residual value kept at the end. */
  salvage: Minor;
  /** Depreciation already on 112 when the terms start (opening balances). */
  accumulated: Minor;
  /** Months to depreciate from `start`. */
  months: number;
  /** First month of depreciation, "YYYY-MM". */
  start: string;
}

/** "2026-10-15" → "2026-11": depreciation starts the month after. */
export function monthAfter(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Whole months from `from` to `to` ("YYYY-MM"); negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

/** What is left to depreciate when the terms start. */
export function depreciable(t: DepreciationTerms): Minor {
  const base = t.cost - t.salvage - t.accumulated;
  return base > 0n ? base : 0n;
}

/** The regular monthly amount (every month but the last). */
export function monthlyAmount(t: DepreciationTerms): Minor {
  if (t.months <= 0) return 0n;
  return roundHalfAwayFromZero(depreciable(t), BigInt(t.months));
}

/** Depreciation of one month ("YYYY-MM"): 0 before the start and after the last month. */
export function depreciationFor(t: DepreciationTerms, month: string): Minor {
  const i = monthsBetween(t.start, month);
  if (i < 0 || i >= t.months) return 0n;
  const base = depreciable(t);
  const regular = monthlyAmount(t);
  // Months before this one, never more than the base (tiny bases round up to 0,01 a month).
  const before = regular * BigInt(i) < base ? regular * BigInt(i) : base;
  const rest = base - before;
  return i === t.months - 1 ? rest : regular < rest ? regular : rest;
}

/** Depreciation from the start up to and including `month`. */
export function depreciatedThrough(t: DepreciationTerms, month: string): Minor {
  const n = Math.min(monthsBetween(t.start, month) + 1, t.months);
  if (n <= 0) return 0n;
  if (n === t.months) return depreciable(t);
  const base = depreciable(t);
  const sum = monthlyAmount(t) * BigInt(n);
  return sum < base ? sum : base;
}

/** Months still to depreciate after `month` ("YYYY-MM"). */
export function monthsLeftAfter(t: DepreciationTerms, month: string): number {
  const done = Math.max(0, Math.min(monthsBetween(t.start, month) + 1, t.months));
  return t.months - done;
}

/**
 * Months of the schedule that `amount` (depreciation posted since the start) covers: the month
 * closings may post two months at once (a month closed without it), so months are not counted.
 */
export function monthsDepreciated(t: DepreciationTerms, amount: Minor): number {
  if (amount >= depreciable(t)) return t.months;
  const regular = monthlyAmount(t);
  if (regular <= 0n || amount <= 0n) return 0;
  return Math.min(t.months - 1, Number(amount / regular));
}
