/**
 * Stock is not a separate table: quantities and values live on the journal lines of
 * quantitative accounts (201, 205, 113 and their sub-accounts), so the stock register and the
 * ledger can never disagree.
 *
 * Chronology policy (stage A): a document may not move an item on a date earlier than that
 * item's latest movement from another document. A back-dated receipt or issue would silently
 * change the cost of later issues; until a controlled recalculation exists it is refused.
 */
import { DomainError } from '../domain/errors.js';
import type { StockBalance } from '../domain/stock.js';
import type { Tx } from './tx.js';

export interface StockKey {
  account: string;
  warehouseId: string;
  productId: string;
}
const keyOf = (k: StockKey) => `${k.account}|${k.warehouseId}|${k.productId}`;

export function stockBalance(tx: Tx, companyId: string, k: StockKey): StockBalance {
  const r = tx.db.get(
    'SELECT COALESCE(SUM(quantity),0) AS q, COALESCE(SUM(debit-credit),0) AS v FROM journal_lines WHERE company_id=? AND account=? AND warehouse_id=? AND product_id=?',
    companyId,
    k.account,
    k.warehouseId,
    k.productId,
  )!;
  return { quantity: r.q as bigint, value: r.v as bigint };
}

export function guardChronology(
  tx: Tx,
  companyId: string,
  keys: readonly StockKey[],
  date: string,
  source: { type: string; id: string },
) {
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(keyOf(k))) continue;
    seen.add(keyOf(k));
    const later = tx.db.get(
      `SELECT e.date, e.source_number FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
       WHERE l.company_id=? AND l.account=? AND l.warehouse_id=? AND l.product_id=? AND l.quantity IS NOT NULL
         AND e.date>? AND NOT (e.source_type=? AND e.source_id=?)
       ORDER BY e.date DESC LIMIT 1`,
      companyId,
      k.account,
      k.warehouseId,
      k.productId,
      date,
      source.type,
      source.id,
    );
    if (later) {
      const product = tx.db.get('SELECT name FROM products WHERE id=?', k.productId);
      throw new DomainError(
        `"${product?.name ?? k.productId}" üzrə ${later.date} tarixli sonrakı hərəkət var (${later.source_number}). Daha əvvəlki tarixlə anbar hərəkəti sonrakı maya dəyərini dəyişərdi; sənədi ${later.date} və ya sonrakı tarixlə daxil edin.`,
        'date',
        'conflict',
      );
    }
  }
}

/** After all postings of a command: no item may end below zero, and zero stock holds no value. */
export function guardNonNegative(tx: Tx, companyId: string, keys: readonly StockKey[]) {
  for (const k of keys) {
    const b = stockBalance(tx, companyId, k);
    if (b.quantity < 0n || b.value < 0n || (b.quantity === 0n && b.value !== 0n)) {
      const product = tx.db.get('SELECT name FROM products WHERE id=?', k.productId);
      throw new DomainError(
        `"${product?.name ?? k.productId}" üzrə anbar qalığı mənfiyə düşür. Əvvəl satış və ya silinmə sənədlərini yoxlayın.`,
        undefined,
        'insufficient-stock',
      );
    }
  }
}
