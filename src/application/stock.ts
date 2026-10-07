/**
 * Ledger lookups for invoices: the FIFO state of a product, open advances of a contract and what
 * is still owed on a document. All of them read the journal itself (indexed by account + first
 * subkonto), so they always agree with it.
 */
import { formatQty } from '../domain/quantity.js';
import type { OpenAdvance, StockLayer, StockState } from '../domain/invoice.js';
import type { Db } from '../infrastructure/sqlite/db.js';

const src = "e.source_type||':'||e.source_id";

/**
 * Receipts of `product` on `account` (all dates), oldest first, and what is left of it on the
 * account apart from document `exclude`. A document's corrections and cancellation net out inside
 * its own group (storno is posted on the original date).
 */
export function stockState(
  db: Db,
  companyId: string,
  account: string,
  product: string,
  exclude: string,
): StockState {
  const layers: StockLayer[] = db
    .all(
      `SELECT ${src} AS s, p.date AS d, MIN(e.rowid) AS seq, SUM(p.dt_qty) AS q, SUM(p.amount) AS a
       FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE p.company_id=? AND p.dt_account=? AND p.dt_s1=? AND p.dt_qty<>0
       GROUP BY e.source_type, e.source_id, p.date
       HAVING SUM(p.dt_qty)>0
       ORDER BY p.date, seq`,
      companyId,
      account,
      product,
    )
    .map((r) => ({ source: String(r.s), quantity: r.q as bigint, value: r.a as bigint }));
  const left = db.get(
    `SELECT COALESCE(SUM(CASE WHEN p.dt_account=? THEN p.dt_qty ELSE -p.kt_qty END),0) AS q,
            COALESCE(SUM(CASE WHEN p.dt_account=? THEN p.amount ELSE -p.amount END),0) AS v
     FROM postings p JOIN entries e ON e.id=p.entry_id
     WHERE p.company_id=? AND ((p.dt_account=? AND p.dt_s1=?) OR (p.kt_account=? AND p.kt_s1=?))
       AND ${src}<>?`,
    account,
    account,
    companyId,
    account,
    product,
    account,
    product,
    exclude,
  )!;
  return { layers, quantity: left.q as bigint, value: left.v as bigint };
}

/** Quantity of `product` on `account` at the end of `date`, apart from document `exclude`. */
export function quantityAt(
  db: Db,
  companyId: string,
  account: string,
  product: string,
  date: string,
  exclude: string,
): bigint {
  return db.get(
    `SELECT COALESCE(SUM(CASE WHEN p.dt_account=? THEN p.dt_qty ELSE -p.kt_qty END),0) AS q
     FROM postings p JOIN entries e ON e.id=p.entry_id
     WHERE p.company_id=? AND ((p.dt_account=? AND p.dt_s1=?) OR (p.kt_account=? AND p.kt_s1=?))
       AND p.date<=? AND ${src}<>?`,
    account,
    companyId,
    account,
    product,
    account,
    product,
    date,
    exclude,
  )!.q as bigint;
}

/**
 * The first day on which the stock of `product` on `account` is below zero, with that quantity;
 * null when it never is. Run after a document changed receipts, so a purchase that has already
 * been sold cannot be cancelled, reduced or moved after the sale.
 */
export function firstNegative(
  db: Db,
  companyId: string,
  account: string,
  product: string,
): { date: string; quantity: string } | null {
  const days = db.all(
    `SELECT date, SUM(q) AS q FROM (
       SELECT date, dt_qty AS q FROM postings WHERE company_id=? AND dt_account=? AND dt_s1=?
       UNION ALL
       SELECT date, -kt_qty FROM postings WHERE company_id=? AND kt_account=? AND kt_s1=?
     ) GROUP BY date ORDER BY date`,
    companyId,
    account,
    product,
    companyId,
    account,
    product,
  );
  let running = 0n;
  for (const d of days) {
    running += d.q as bigint;
    if (running < 0n) return { date: String(d.date), quantity: formatQty(running) };
  }
  return null;
}

/** Net debit (AZN and currency) of one settlement key: account, partner, contract, document. */
export function settlementBalance(
  db: Db,
  companyId: string,
  account: string,
  partner: string,
  contract: string,
  document: string,
): { amount: bigint; currency: bigint } {
  const r = db.get(
    `SELECT COALESCE(SUM(a),0) AS a, COALESCE(SUM(c),0) AS c FROM (
       SELECT amount AS a, dt_cur AS c FROM postings
         WHERE company_id=? AND dt_account=? AND dt_s1=? AND dt_s2=? AND dt_s3=?
       UNION ALL
       SELECT -amount, -kt_cur FROM postings
         WHERE company_id=? AND kt_account=? AND kt_s1=? AND kt_s2=? AND kt_s3=?
     )`,
    companyId,
    account,
    partner,
    contract,
    document,
    companyId,
    account,
    partner,
    contract,
    document,
  )!;
  return { amount: r.a as bigint, currency: r.c as bigint };
}

function advanceBalances(
  db: Db,
  companyId: string,
  account: string,
  partner: string,
  contract: string,
  side: 'credit' | 'debit',
  date: string,
): Map<string, { amount: bigint; currency: bigint; first: string }> {
  // Credit balances for received advances (543), debit balances for issued ones (243).
  const sign = side === 'credit' ? '' : '-';
  const rows = db.all(
    `SELECT s, ${sign}SUM(a) AS a, ${sign}SUM(c) AS c, MIN(d) AS d FROM (
       SELECT kt_s3 AS s, amount AS a, kt_cur AS c, date AS d FROM postings
         WHERE company_id=? AND kt_account=? AND kt_s1=? AND kt_s2=? AND date<=?
       UNION ALL
       SELECT dt_s3, -amount, -dt_cur, date FROM postings
         WHERE company_id=? AND dt_account=? AND dt_s1=? AND dt_s2=? AND date<=?
     ) GROUP BY s`,
    companyId,
    account,
    partner,
    contract,
    date,
    companyId,
    account,
    partner,
    contract,
    date,
  );
  return new Map(
    rows.map((r) => [
      String(r.s),
      { amount: r.a as bigint, currency: r.c as bigint, first: String(r.d) },
    ]),
  );
}

/**
 * Advances of one partner and contract that are still open on `date` — and still open today, so
 * an advance already used by a later document is never offset twice. The smaller of the two
 * balances is taken as a pair (AZN with its own currency amount). Oldest first.
 */
export function openAdvances(
  db: Db,
  companyId: string,
  account: string,
  partner: string,
  contract: string,
  side: 'credit' | 'debit',
  date: string,
  currencyAccount: boolean,
): OpenAdvance[] {
  const atDate = advanceBalances(db, companyId, account, partner, contract, side, date);
  const now = advanceBalances(db, companyId, account, partner, contract, side, '9999-12-31');
  const out: (OpenAdvance & { first: string })[] = [];
  for (const [document, b] of atDate) {
    const n = now.get(document);
    if (!n) continue;
    const smaller = currencyAccount
      ? b.currency <= n.currency
        ? b
        : n
      : b.amount <= n.amount
        ? b
        : n;
    if (smaller.amount > 0n && (!currencyAccount || smaller.currency > 0n))
      out.push({
        document,
        amount: smaller.amount,
        currency: currencyAccount ? smaller.currency : 0n,
        first: b.first,
      });
  }
  out.sort((x, y) => x.first.localeCompare(y.first) || x.document.localeCompare(y.document));
  return out.map(({ document, amount, currency }) => ({ document, amount, currency }));
}
