/**
 * The AMB rate fills itself into a currency document (QERARLAR 2026-10-17 §4): when the rate is
 * empty, or still the one filled in before, it follows the catalog for the document's date and
 * currency. A rate the accountant typed is never replaced.
 */
import { useEffect, useRef } from 'react';
import type { RateView } from '../contracts/queries';
import { formatPrice } from '../domain/quantity';
import { parseAmbXml } from '../domain/rates';
import { api } from './api';
import { toField } from './format';
import { useQuery } from './hooks';

export function useAutoRate(
  companyId: string,
  currency: string,
  date: string,
  rate: string,
  setRate: (rate: string) => void,
): RateView | null {
  const filled = useRef('');
  const foreign = !!currency && currency !== 'AZN';
  const valid = foreign && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const q = useQuery<RateView | null>(valid ? { type: 'rate', companyId, currency, date } : null);
  const found = valid && q.data && q.data.currency === currency ? q.data : null;
  const value = found ? toField(found.rate) : '';
  useEffect(() => {
    if (!value) return;
    if (rate.trim() === '' || rate === filled.current) {
      filled.current = value;
      if (rate !== value) setRate(value);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return found;
}

/** Hint under a rate field: where the rate came from. */
export const rateHint = (found: RateView | null, rate: string) =>
  found && toField(found.rate) === rate
    ? `${found.source === 'amb' ? 'AMB' : 'Kitabça'}, ${found.date.split('-').reverse().join('.')}`
    : 'AMB məzənnəsi, 4 onluq';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Loads the AMB files of the given days (desktop app only) and saves their rates. On a weekend,
 * holiday or future day cbar.az answers with the latest bulletin, dated by its own day: rates are
 * saved under the date the file names, once, and the day counts as one without a bulletin.
 */
export async function loadAmb(
  companyId: string,
  from: string,
  to: string,
  onProgress?: (done: number, total: number) => void,
) {
  const days: string[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    iso(d) <= to && days.length < 93;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    days.push(iso(d));
  let loaded = 0;
  let added = 0;
  let updated = 0;
  const empty: string[] = [];
  const saved = new Set<string>();
  for (const [i, day] of days.entries()) {
    onProgress?.(i, days.length);
    const xml = await api.ambFetch(day);
    if (!xml) {
      empty.push(day);
      continue;
    }
    const file = parseAmbXml(xml);
    if (file.date !== day) empty.push(day);
    if (saved.has(file.date)) continue;
    saved.add(file.date);
    const r = await api.command({
      type: 'rates.save',
      companyId,
      date: file.date,
      source: 'amb',
      rates: file.rates.map((x) => ({
        currency: x.currency,
        rate: formatPrice(x.rate),
      })),
    });
    loaded++;
    added += r.added ?? 0;
    updated += r.updated ?? 0;
  }
  return { days: days.length, loaded, added, updated, empty };
}
