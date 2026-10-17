/**
 * Currency rates catalog (stage 5b; docs/MERHELE-5-AY-BAGLANISI.md §3.3, QERARLAR 2026-10-17 §4).
 * One official AMB rate per date and currency, for all companies; typed by hand or loaded from
 * the AMB file. A rate a posted revaluation used is not changed: the revaluation is cancelled first.
 */
import { currencies, type CurrencyCode } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { AZN_RATE } from '../domain/invoice.js';
import { formatPrice, parsePrice } from '../domain/quantity.js';
import { parseDate } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type { RateView } from '../contracts/queries.js';
import type { Db } from '../infrastructure/sqlite/db.js';
import type { Tx } from './tx.js';

const dmy = (iso: string) => iso.split('-').reverse().join('.');

export function currencyOf(value: string, field: string): CurrencyCode {
  const c = value.trim().toUpperCase();
  if (!(currencies as readonly string[]).includes(c))
    throw new DomainError(`Valyuta tanınmır: ${value}.`, field);
  return c as CurrencyCode;
}

/** The revaluation that used this rate, if a posted one did. */
function usedBy(db: Db, date: string, currency: string) {
  return db.get(
    `SELECT r.number, c.name FROM revaluations r JOIN companies c ON c.id=r.company_id
     WHERE r.status='posted' AND json_extract(r.rates, '$.' || ? || '.date')=?`,
    currency,
    date,
  );
}

export function saveRates(tx: Tx, cmd: CommandOf<'rates.save'>): CommandResult {
  tx.company(cmd.companyId);
  const date = parseDate(cmd.date, 'Tarix');
  let added = 0;
  let updated = 0;
  let same = 0;
  const changes: string[] = [];
  const seen = new Set<string>();
  cmd.rates.forEach((r, i) => {
    const currency = currencyOf(r.currency, `rates.${i}.currency`);
    if (seen.has(currency))
      throw new DomainError(`${currency} iki dəfə yazılıb.`, `rates.${i}.currency`);
    seen.add(currency);
    const rate = parsePrice(r.rate, `${currency} məzənnəsi`);
    const old = tx.db.get(
      'SELECT rate FROM currency_rates WHERE date=? AND currency=?',
      date,
      currency,
    );
    if (old && (old.rate as bigint) === rate) {
      same++;
      return;
    }
    if (old) {
      const user = usedBy(tx.db, date, currency);
      if (user)
        throw new DomainError(
          `${dmy(date)} tarixli ${currency} məzənnəsi ${String(user.name)} şirkətinin yenidən qiymətləndirilməsində (${String(user.number)}) istifadə olunub; əvvəlcə onu ləğv edin.`,
          `rates.${i}.rate`,
          'conflict',
        );
      tx.db.run(
        'UPDATE currency_rates SET rate=?,source=?,loaded_at=?,actor=? WHERE date=? AND currency=?',
        rate,
        cmd.source,
        tx.clock.now(),
        tx.ctx.actor,
        date,
        currency,
      );
      updated++;
      changes.push(`${currency} ${formatPrice(old.rate as bigint)} → ${formatPrice(rate)}`);
    } else {
      tx.db.run(
        'INSERT INTO currency_rates(date,currency,rate,source,loaded_at,actor) VALUES(?,?,?,?,?,?)',
        date,
        currency,
        rate,
        cmd.source,
        tx.clock.now(),
        tx.ctx.actor,
      );
      added++;
      changes.push(`${currency} ${formatPrice(rate)}`);
    }
  });
  // Rates are shared: every company's audit trail shows the change.
  if (changes.length)
    for (const c of tx.db.all('SELECT id FROM companies'))
      tx.audit(
        String(c.id),
        added && !updated ? 'Yükləndi' : 'Dəyişdirildi',
        'Valyuta məzənnəsi',
        date,
        `${dmy(date)} · ${cmd.source === 'amb' ? 'AMB' : 'əl ilə'} · ${changes.join(', ')}`,
      );
  return { id: date, version: 1, added, updated, same };
}

const view = (r: Record<string, unknown>): RateView => ({
  date: String(r.date),
  currency: String(r.currency),
  rate: formatPrice(r.rate as bigint),
  source: r.source as RateView['source'],
  loadedAt: String(r.loaded_at),
  actor: String(r.actor),
});

export function ratesList(db: Db, from: string, to: string, currency?: string): RateView[] {
  return db
    .all(
      `SELECT * FROM currency_rates WHERE date>=? AND date<=?${currency ? ' AND currency=?' : ''}
       ORDER BY date DESC, currency`,
      parseDate(from),
      parseDate(to),
      ...(currency ? [currency] : []),
    )
    .map(view);
}

/** How old a catalog rate may be for a date (weekends, holidays) before it counts as missing. */
export const RATE_DAYS = 6;

const daysBefore = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

/** The catalog rate for a date: that day's, or the latest within RATE_DAYS before it. */
export function catalogRate(db: Db, currency: string, date: string) {
  const r = db.get(
    'SELECT date,rate FROM currency_rates WHERE currency=? AND date<=? AND date>=? ORDER BY date DESC LIMIT 1',
    currency,
    date,
    daysBefore(date, RATE_DAYS),
  );
  return r ? { date: String(r.date), rate: r.rate as bigint } : null;
}

/**
 * The rate of a document: none for AZN; for a currency the typed one, or — left empty — the
 * catalog rate of the document date (QERARLAR 2026-10-17 §4: filled in, can be changed).
 */
export function documentRate(
  db: Db,
  input: string,
  currency: CurrencyCode,
  date: string,
  aznMessage: string,
): bigint {
  if (currency === 'AZN') {
    if (input.trim() && parsePrice(input, 'Məzənnə') !== AZN_RATE)
      throw new DomainError(aznMessage, 'rate');
    return AZN_RATE;
  }
  if (input.trim()) return parsePrice(input, `${currency} məzənnəsi`);
  const r = /^\d{4}-\d{2}-\d{2}$/.test(date) ? catalogRate(db, currency, date) : null;
  if (!r)
    throw new DomainError(
      `${dmy(date)} üçün ${currency} məzənnəsi yoxdur: məzənnəni yazın və ya Valyuta məzənnələri kitabçasında AMB-dən yükləyin.`,
      'rate',
    );
  return r.rate;
}

/** The catalog rate a document of that date takes (see catalogRate), as shown to the user. */
export function rateOn(db: Db, currency: string, date: string): RateView | null {
  const r = catalogRate(db, currency, date);
  return r
    ? view(db.get('SELECT * FROM currency_rates WHERE date=? AND currency=?', r.date, currency)!)
    : null;
}
