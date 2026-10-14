/**
 * Bank document arithmetic (stage 3; docs/QERARLAR.md 2026-10-14, docs/MERHELE-3-BANK.md §4–5).
 *
 * A receipt from a customer (or a payment to a supplier) whose settlement document is left empty
 * is matched to the open invoices of the partner and contract, oldest first; what is left is an
 * advance. A VAT-payer's invoice is paid in two parts: its VAT to the VAT deposit account (224.04)
 * and the rest to a current account (223.xx). Each bank document settles only its own part.
 */
import { roundHalfAwayFromZero, type Minor } from './money.js';

/**
 * Starting list of "Pul vəsaitlərinin hərəkəti maddələri" (cash-flow items) for a new company,
 * grouped the way IAS 7 reads cash flows. The accountant renames, adds and archives them; the
 * list was not taken from a real 1C base.
 */
export const CASH_FLOW_ITEMS = [
  'Alıcılardan daxilolmalar',
  'Malsatan və podratçılara ödənişlər',
  'İşçilərə ödənişlər',
  'Vergi və məcburi ödənişlər',
  'Kreditlər və faizlər',
  'Təsisçilərlə əməliyyatlar',
  'Öz hesabları arasında köçürmələr',
  'Sair daxilolmalar və ödənişlər',
];

/** Which part of an invoice a bank document can settle. */
export type SettlementPart = 'vat' | 'net' | 'whole';

export interface OpenInvoice {
  document: string;
  /** Still owed on the invoice: AZN, or the contract currency on currency accounts. */
  open: Minor;
  /** VAT of the invoice not yet paid through the VAT deposit (AZN invoices only). */
  vatOpen: Minor;
}

/** What `part` may still take from an invoice. */
export function openPart(invoice: OpenInvoice, part: SettlementPart): Minor {
  if (invoice.open <= 0n) return 0n;
  const vat =
    invoice.vatOpen <= 0n ? 0n : invoice.vatOpen < invoice.open ? invoice.vatOpen : invoice.open;
  if (part === 'vat') return vat;
  if (part === 'net') return invoice.open - vat;
  return invoice.open;
}

export interface Allocation {
  document: string;
  amount: Minor;
}

/** Spreads `amount` over the invoices in the given order; the rest is returned as `left`. */
export function allocatePayment(
  invoices: readonly OpenInvoice[],
  amount: Minor,
  part: SettlementPart,
): { allocations: Allocation[]; left: Minor } {
  const allocations: Allocation[] = [];
  let left = amount;
  for (const invoice of invoices) {
    if (left <= 0n) break;
    const available = openPart(invoice, part);
    if (available <= 0n) continue;
    const take = available < left ? available : left;
    allocations.push({ document: invoice.document, amount: take });
    left -= take;
  }
  return { allocations, left };
}

/**
 * Splits `total` in proportion to `parts` (which add up to `whole`) with cumulative rounding, so
 * the pieces always add up to `total` exactly — used for the AZN value of currency pieces.
 */
export function splitProportionally(parts: readonly Minor[], whole: Minor, total: Minor): Minor[] {
  let cumulative = 0n;
  let previous = 0n;
  return parts.map((p) => {
    cumulative += p;
    const at = whole === 0n ? 0n : roundHalfAwayFromZero(total * cumulative, whole);
    const piece = at - previous;
    previous = at;
    return piece;
  });
}
