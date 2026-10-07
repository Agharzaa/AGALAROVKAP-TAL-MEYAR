/**
 * Ledger lookups for invoices: FIFO layers of a product and open advances of a contract. Both
 * read the journal itself (indexed by account + first subkonto), so they always agree with it.
 */
import type { OpenAdvance, StockLayer } from '../domain/invoice.js';
import type { Db } from '../infrastructure/sqlite/db.js';

const src = "e.source_type||':'||e.source_id";

/**
 * Receipts of `product` on `account` up to `date`, oldest first. A document's corrections and
 * cancellation net out inside its own group (storno is posted on the original date).
 */
export function stockLayers(
  db: Db,
  companyId: string,
  account: string,
  product: string,
  date: string,
): StockLayer[] {
  return db
    .all(
      `SELECT ${src} AS s, p.date AS d, MIN(e.rowid) AS seq, SUM(p.dt_qty) AS q, SUM(p.amount) AS a
       FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE p.company_id=? AND p.dt_account=? AND p.dt_s1=? AND p.date<=? AND p.dt_qty<>0
       GROUP BY e.source_type, e.source_id, p.date
       HAVING SUM(p.dt_qty)>0
       ORDER BY p.date, seq`,
      companyId,
      account,
      product,
      date,
    )
    .map((r) => ({ source: String(r.s), quantity: r.q as bigint, value: r.a as bigint }));
}

/** Units of `product` that left `account` up to `date`, other documents than `exclude`. */
export function issuedBefore(
  db: Db,
  companyId: string,
  account: string,
  product: string,
  date: string,
  exclude: string,
): bigint {
  return db.get(
    `SELECT COALESCE(SUM(p.kt_qty),0) AS q FROM postings p JOIN entries e ON e.id=p.entry_id
     WHERE p.company_id=? AND p.kt_account=? AND p.kt_s1=? AND p.date<=? AND ${src}<>?`,
    companyId,
    account,
    product,
    date,
    exclude,
  )!.q as bigint;
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
 * an advance already used by a later document is never offset twice. Oldest first.
 */
export function openAdvances(
  db: Db,
  companyId: string,
  account: string,
  partner: string,
  contract: string,
  side: 'credit' | 'debit',
  date: string,
): OpenAdvance[] {
  const atDate = advanceBalances(db, companyId, account, partner, contract, side, date);
  const now = advanceBalances(db, companyId, account, partner, contract, side, '9999-12-31');
  const out: (OpenAdvance & { first: string })[] = [];
  for (const [document, b] of atDate) {
    const n = now.get(document);
    if (!n) continue;
    const amount = b.amount < n.amount ? b.amount : n.amount;
    const currency = b.currency < n.currency ? b.currency : n.currency;
    if (amount > 0n) out.push({ document, amount, currency, first: b.first });
  }
  out.sort((x, y) => x.first.localeCompare(y.first) || x.document.localeCompare(y.document));
  return out.map(({ document, amount, currency }) => ({ document, amount, currency }));
}
