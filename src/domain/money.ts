/**
 * Exact money arithmetic. Amounts are integers in the currency's minor unit (qəpik for AZN) and
 * are carried as `bigint` inside the domain, as decimal strings across process boundaries and as
 * SQLite INTEGER at rest. Floating point is never used for money.
 */
import { DomainError } from './errors.js';

export type Minor = bigint;

/** ISO 4217 minor-unit exponents of supported currencies. Only AZN is enabled in stage A. */
export const currencyScale = { AZN: 2 } as const;
export type Currency = keyof typeof currencyScale;

/** Largest single amount accepted: 999 999 999 999.99 — far below SQLite's int64 range. */
export const MAX_MINOR = 99_999_999_999_999n;

const AMOUNT = /^(\d{1,15})(?:[.,](\d{1,2}))?$/;

/**
 * Parses a user-entered non-negative amount. Accepts "1234", "1234.5", "1234,50" and spaces as
 * thousands separators. More than two decimals is an error — it is never rounded silently.
 */
export function parseMoney(value: unknown, field = 'Məbləğ'): Minor {
  if (typeof value !== 'string') throw new DomainError(`${field} mətn kimi verilməlidir.`, field);
  const text = value.replace(/[\s ]/g, '');
  const match = AMOUNT.exec(text);
  if (!match)
    throw new DomainError(
      `${field}: müsbət ədəd yazın, ən çox 2 onluq rəqəm (məsələn 1250,50).`,
      field,
    );
  const minor = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (minor > MAX_MINOR) throw new DomainError(`${field} icazə verilən həddi keçir.`, field);
  return minor;
}

/** Canonical machine form: "-1234.05". Used in contracts and storage payloads. */
export function formatMinor(value: Minor): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Display form for Azerbaijani UI: "1 234,05" with a narrow no-break space. */
export function displayMinor(value: Minor): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '−' : ''}${whole},${fraction}`;
}

export function sumMinor(values: Iterable<Minor>): Minor {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/** Rounds a rational `numerator / denominator` to the nearest integer, halves away from zero. */
export function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new DomainError('Bölən müsbət olmalıdır.');
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = (abs * 2n + denominator) / (2n * denominator);
  return negative ? -quotient : quotient;
}

/**
 * VAT helper used only on the user's request (the "18%" button). The rate is an explicit
 * argument in basis points; nothing in the posting rules assumes a rate.
 */
export function percentOf(amount: Minor, basisPoints: number): Minor {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000)
    throw new DomainError('Faiz dərəcəsi düzgün deyil.');
  return roundHalfAwayFromZero(amount * BigInt(basisPoints), 10_000n);
}
