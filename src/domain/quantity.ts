/**
 * Quantities and unit prices are fixed-point integers: quantity and conversion factors carry
 * 6 decimals, unit prices 4 decimals. Line amounts are rounded once, to the qəpik, half away
 * from zero — this is the single documented rounding point of a document line.
 */
import { DomainError } from './errors.js';
import { MAX_MINOR, roundHalfAwayFromZero, type Minor } from './money.js';

export const QTY_SCALE = 1_000_000n;
export const PRICE_SCALE = 10_000n;
export type Qty = bigint;
export type Price = bigint;

const MAX_QTY = 999_999_999_999_999n; // 999 999 999.999999

function parseFixed(value: unknown, digits: number, field: string): bigint {
  if (typeof value !== 'string') throw new DomainError(`${field} mətn kimi verilməlidir.`, field);
  const text = value.replace(/[\s ]/g, '');
  const match = new RegExp(`^(\\d{1,9})(?:[.,](\\d{1,${digits}}))?$`).exec(text);
  if (!match)
    throw new DomainError(`${field}: müsbət ədəd yazın, ən çox ${digits} onluq rəqəm.`, field);
  return BigInt(match[1]!) * 10n ** BigInt(digits) + BigInt((match[2] ?? '').padEnd(digits, '0'));
}

export function parseQty(value: unknown, field = 'Miqdar'): Qty {
  const q = parseFixed(value, 6, field);
  if (q <= 0n) throw new DomainError(`${field} sıfırdan böyük olmalıdır.`, field);
  if (q > MAX_QTY) throw new DomainError(`${field} icazə verilən həddi keçir.`, field);
  return q;
}

export function parsePrice(value: unknown, field = 'Vahid qiyməti'): Price {
  const p = parseFixed(value, 4, field);
  if (p <= 0n) throw new DomainError(`${field} sıfırdan böyük olmalıdır.`, field);
  return p;
}

export function formatScaled(value: bigint, digits: number): string {
  const scale = 10n ** BigInt(digits);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const fraction = (abs % scale).toString().padStart(digits, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${abs / scale}${fraction ? `.${fraction}` : ''}`;
}
export const formatQty = (q: Qty) => formatScaled(q, 6);
export const formatPrice = (p: Price) => formatScaled(p, 4);

/** quantity × unit price, rounded to qəpik. */
export function lineAmount(quantity: Qty, unitPrice: Price): Minor {
  const amount = roundHalfAwayFromZero(quantity * unitPrice, (QTY_SCALE * PRICE_SCALE) / 100n);
  if (amount <= 0n) throw new DomainError('Sətrin məbləği ən azı 0,01 AZN olmalıdır.');
  if (amount > MAX_MINOR) throw new DomainError('Sətrin məbləği icazə verilən həddi keçir.');
  return amount;
}

/**
 * Converts a quantity in a purchase/packaging unit to the base unit. The factor says how many
 * base units one packaging unit holds (box of 12 → 12). The result must stay within 6 decimals.
 */
export function toBaseQty(quantity: Qty, factor: Qty): Qty {
  const product = quantity * factor;
  if (product % QTY_SCALE !== 0n)
    throw new DomainError('Əsas vahiddə miqdar 6 onluq rəqəm dəqiqliyini aşır.', 'quantity');
  const base = product / QTY_SCALE;
  if (base > MAX_QTY) throw new DomainError('Əsas vahiddə miqdar həddi keçir.', 'quantity');
  return base;
}
