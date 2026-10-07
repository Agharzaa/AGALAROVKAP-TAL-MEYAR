/**
 * Invoice arithmetic (docs/QERARLAR.md, "Satış və ƏDV", "Alış", 2026-10-07 decisions).
 *
 * - A line is quantity × price, rounded once to the qəpik. The price either excludes VAT (as on
 *   an e-qaimə) or includes it; the invoice says which.
 * - VAT exists only at the 18% rate: 18/100 of the net amount, or 18/118 of a VAT-inclusive
 *   amount, rounded per line. 0%, exempt and non-taxable lines carry no VAT.
 * - A currency invoice converts each line's gross amount and its VAT to AZN at the invoice rate
 *   (AMB rate, 4 decimals); the net AZN amount is their difference, so AZN lines always add up.
 * - Goods leave stock at FIFO cost; advances are offset oldest first.
 */
import { DomainError } from './errors.js';
import { roundHalfAwayFromZero, type Minor } from './money.js';
import { formatQty, lineAmount, PRICE_SCALE, type Price, type Qty } from './quantity.js';
import type { VatRate } from './chart.js';

export type InvoiceDirection = 'sale' | 'purchase';

export interface LineAmounts {
  net: Minor;
  vat: Minor;
  gross: Minor;
}

export function lineAmounts(
  quantity: Qty,
  price: Price,
  rate: VatRate,
  pricesIncludeVat: boolean,
): LineAmounts {
  const base = lineAmount(quantity, price);
  if (rate !== '18') return { net: base, vat: 0n, gross: base };
  if (pricesIncludeVat) {
    const vat = roundHalfAwayFromZero(base * 18n, 118n);
    return { net: base - vat, vat, gross: base };
  }
  const vat = roundHalfAwayFromZero(base * 18n, 100n);
  return { net: base, vat, gross: base + vat };
}

/** AMB rate with 4 decimals (1.7000 → 17000n); AZN invoices use 1.0000. */
export const AZN_RATE = PRICE_SCALE;

export function toAzn(amount: Minor, rate: bigint): Minor {
  return rate === AZN_RATE ? amount : roundHalfAwayFromZero(amount * rate, PRICE_SCALE);
}

/** Line amounts in AZN: gross and VAT converted, net as their difference. */
export function aznAmounts(a: LineAmounts, rate: bigint): LineAmounts {
  const gross = toAzn(a.gross, rate);
  const vat = toAzn(a.vat, rate);
  return { net: gross - vat, vat, gross };
}

// ---------------------------------------------------------------------------------------------
// FIFO

/** A receipt of one product by one document: its net quantity and value. */
export interface StockLayer {
  source: string;
  quantity: Qty;
  value: Minor;
}

/**
 * Value of units [from, to) of a layer. Rounding is cumulative, so the slices of a layer always
 * add up to its value exactly — no residue is ever left in stock.
 */
export function sliceValue(layer: StockLayer, from: Qty, to: Qty): Minor {
  const at = (x: Qty) => roundHalfAwayFromZero(layer.value * x, layer.quantity);
  return at(to) - at(from);
}

/**
 * One product on one stock account, read from the journal: the receipts up to the issue date
 * (oldest first), the units other documents issued up to that date, and the quantity and value
 * left on the account today.
 */
export interface StockState {
  layers: readonly StockLayer[];
  issuedBefore: Qty;
  quantity: Qty;
  value: Minor;
}

/** Value of units [start, start + quantity) of the layers, or null when they do not reach. */
function layerSlice(layers: readonly StockLayer[], start: Qty, quantity: Qty): Minor | null {
  const end = start + quantity;
  let position = 0n;
  let cost = 0n;
  for (const layer of layers) {
    if (layer.quantity <= 0n) continue;
    const from = position;
    const to = position + layer.quantity;
    const a = start > from ? start : from;
    const b = end < to ? end : to;
    if (b > a) cost += sliceValue(layer, a - from, b - from);
    position = to;
    if (position >= end) return cost;
  }
  return null;
}

/**
 * FIFO cost of issuing `quantity` units on the issue date: the oldest units not yet issued by
 * then. The journal is the judge of what is really left, so the cost always reconciles with it:
 * - the issue that empties the stock takes exactly the value left on the account;
 * - a partial issue costs at least one qəpik (a cheap unit would round to zero) and leaves value
 *   behind it;
 * - when the records no longer follow FIFO order (a receipt entered with an earlier date after
 *   later issues), the issue is valued at the average of what is left, so nothing is ever blocked
 *   or stranded; month-end re-costing (stage 5) restores strict FIFO.
 */
export function fifoCost(stock: StockState, quantity: Qty, label: string): Minor {
  if (quantity <= 0n) throw new DomainError('Silinən miqdar müsbət olmalıdır.');
  if (stock.quantity < quantity) {
    const available = stock.quantity > 0n ? stock.quantity : 0n;
    throw new DomainError(
      `${label}: anbarda kifayət qədər qalıq yoxdur (qalıq ${formatQty(available)}, tələb ${formatQty(quantity)}).`,
      undefined,
      'insufficient-stock',
    );
  }
  if (quantity === stock.quantity) return stock.value;
  const slice = layerSlice(stock.layers, stock.issuedBefore, quantity);
  if (slice !== null) {
    const cost = slice < 1n ? 1n : slice;
    if (cost < stock.value) return cost;
  }
  let cost = roundHalfAwayFromZero(stock.value * quantity, stock.quantity);
  if (cost < 1n) cost = 1n;
  if (cost >= stock.value && stock.value > 1n) cost = stock.value - 1n;
  return cost;
}

// ---------------------------------------------------------------------------------------------
// Advances

/** An open advance (243 / 543) of one partner and contract, by the document that created it. */
export interface OpenAdvance {
  document: string;
  /** AZN carrying amount. */
  amount: Minor;
  /** Currency amount on currency accounts; 0 on AZN accounts. */
  currency: Minor;
}
export interface AdvanceOffset {
  document: string;
  amount: Minor;
  currency: Minor;
}

/**
 * Offsets an invoice against open advances, oldest first, up to the invoice total. On currency
 * contracts the offset is measured in the contract currency and valued at the advance's own
 * carrying rate (a currency advance is not revalued at the invoice rate).
 */
export function allocateAdvances(
  advances: readonly OpenAdvance[],
  invoiceAzn: Minor,
  invoiceCurrency: Minor | null,
): AdvanceOffset[] {
  const out: AdvanceOffset[] = [];
  if (invoiceCurrency === null) {
    let left = invoiceAzn;
    for (const a of advances) {
      if (left <= 0n) break;
      if (a.amount <= 0n) continue;
      const take = a.amount < left ? a.amount : left;
      out.push({ document: a.document, amount: take, currency: 0n });
      left -= take;
    }
    return out;
  }
  let left = invoiceCurrency;
  for (const a of advances) {
    if (left <= 0n) break;
    if (a.currency <= 0n || a.amount <= 0n) continue;
    const take = a.currency < left ? a.currency : left;
    const amount =
      take === a.currency ? a.amount : roundHalfAwayFromZero(a.amount * take, a.currency);
    out.push({ document: a.document, amount, currency: take });
    left -= take;
  }
  return out;
}
