/**
 * The VAT deposit pair (stage 3b; docs/QERARLAR.md 2026-10-14 §3, docs/MERHELE-3-BANK.md §5).
 *
 * A VAT payer's customer pays an invoice with two payment orders: the VAT to the VAT deposit
 * account (224.04) and the rest to a current account (223.xx). They arrive as two bank documents,
 * often on different statements, and are linked here as a pair — analytics only, the journal is
 * not touched. A pair is checked against 18/118: the deposit part should be 18/118 of the whole.
 *
 * Automatic pairing never guesses: a document is paired only when it has exactly one candidate
 * and that candidate has exactly one candidate — this document. Anything else is left to the
 * accountant (manual pairing), and an unpaired deposit document is shown as a control signal.
 */
import { inFamily } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { formatMinor, roundHalfAwayFromZero, type Minor } from '../domain/money.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import type { Tx } from './tx.js';

/** Days between the two halves of one payment that still count as one payment. */
export const PAIR_DAYS = 3;
/** Rounding allowance of the 18/118 check, in qəpik. */
export const VAT_TOLERANCE = 1n;

const settlement = ['211', '531', '243', '543'];
const select = `SELECT b.*, x.account AS account FROM bank_documents b
  JOIN bank_accounts x ON x.company_id=b.company_id AND x.id=b.bank_account_id`;

export const isDeposit = (account: string) => inFamily(account, '224');
const isCurrent = (account: string) => inFamily(account, '223');
const settlementLines = (r: Row) =>
  (JSON.parse(String(r.lines)) as { account: string; sk: string[] }[]).filter((l) =>
    settlement.some((f) => inFamily(l.account, f)),
  );
/**
 * Pairs are payments between the company and its customers or suppliers: AZN documents on
 * 223.xx or 224.xx with a settlement line. A VAT payment from the deposit to the budget, a
 * capital contribution or a transfer between own accounts has no other half.
 */
export const isPairable = (r: Row) =>
  r.status === 'posted' &&
  r.currency === 'AZN' &&
  (isDeposit(String(r.account)) || isCurrent(String(r.account))) &&
  settlementLines(r).length > 0;

export function bankDocument(db: Db, companyId: string, id: string): Row | undefined {
  return db.get(`${select} WHERE b.company_id=? AND b.id=?`, companyId, id);
}

/**
 * Who paid or was paid: the VÖEN printed by the bank, else the VÖEN of the partner on the first
 * settlement line, else that partner itself. Empty when the document names nobody.
 */
export function payer(db: Db, companyId: string, r: Row): string {
  const tax = String(r.counterparty_tax_id).trim();
  if (tax) return `tax:${tax}`;
  const line = settlementLines(r).find((l) => l.sk[0]);
  if (!line) return '';
  const partner = db.get(
    'SELECT tax_id FROM partners WHERE company_id=? AND id=?',
    companyId,
    line.sk[0]!,
  );
  return partner?.tax_id ? `tax:${String(partner.tax_id)}` : `partner:${line.sk[0]!}`;
}

/**
 * Unpaired documents that can complete `doc`: same direction and payer, the other kind of
 * account (deposit ↔ current), at most PAIR_DAYS apart, in an open period.
 */
export function pairCandidates(db: Db, companyId: string, doc: Row): Row[] {
  if (!isPairable(doc) || doc.pair_id) return [];
  const who = payer(db, companyId, doc);
  if (!who) return [];
  const deposit = isDeposit(String(doc.account));
  return db
    .all(
      `${select} WHERE b.company_id=? AND b.id<>? AND b.direction=? AND b.status='posted'
         AND b.pair_id IS NULL AND b.currency='AZN'
         AND ABS(julianday(b.date)-julianday(?))<=?
         AND b.date>(SELECT closed_through FROM companies WHERE id=b.company_id)
       ORDER BY b.date, b.rowid`,
      companyId,
      String(doc.id),
      String(doc.direction),
      String(doc.date),
      PAIR_DAYS,
    )
    .filter(
      (r) =>
        (deposit ? isCurrent(String(r.account)) : isDeposit(String(r.account))) &&
        payer(db, companyId, r) === who,
    );
}

export interface VatCheck {
  /** The whole payment: both documents. */
  total: Minor;
  deposit: Minor;
  expected: Minor;
  /** deposit − expected */
  difference: Minor;
  ok: boolean;
}

/** 18/118 of the whole payment should have reached the VAT deposit. */
export function vatCheck(a: Row, b: Row): VatCheck {
  const [deposit, current] = isDeposit(String(a.account)) ? [a, b] : [b, a];
  const total = (deposit.amount as bigint) + (current.amount as bigint);
  const expected = roundHalfAwayFromZero(total * 18n, 118n);
  const difference = (deposit.amount as bigint) - expected;
  const abs = difference < 0n ? -difference : difference;
  return {
    total,
    deposit: deposit.amount as bigint,
    expected,
    difference,
    ok: abs <= VAT_TOLERANCE,
  };
}

const describe = (c: VatCheck) =>
  c.ok
    ? `18/118 uyğundur (${formatMinor(c.deposit)} / ${formatMinor(c.total)})`
    : `18/118 uyğun deyil: depozitə ${formatMinor(c.deposit)}, gözlənilən ${formatMinor(c.expected)} (fərq ${formatMinor(c.difference)})`;

function link(tx: Tx, companyId: string, a: Row, b: Row, how: string) {
  tx.db.run(
    'UPDATE bank_documents SET pair_id=? WHERE company_id=? AND id=?',
    String(b.id),
    companyId,
    String(a.id),
  );
  tx.db.run(
    'UPDATE bank_documents SET pair_id=? WHERE company_id=? AND id=?',
    String(a.id),
    companyId,
    String(b.id),
  );
  tx.audit(
    companyId,
    `ƏDV cütü bağlandı (${how})`,
    'Bank sənədi',
    String(a.id),
    `${String(a.number)} + ${String(b.number)} · ${describe(vatCheck(a, b))}`,
  );
}

function unlink(tx: Tx, companyId: string, a: Row, reason: string) {
  const other = a.pair_id ? bankDocument(tx.db, companyId, String(a.pair_id)) : undefined;
  tx.db.run(
    'UPDATE bank_documents SET pair_id=NULL WHERE company_id=? AND id=?',
    companyId,
    String(a.id),
  );
  if (other && other.pair_id === a.id)
    tx.db.run(
      'UPDATE bank_documents SET pair_id=NULL WHERE company_id=? AND id=?',
      companyId,
      String(other.id),
    );
  tx.audit(
    companyId,
    'ƏDV cütü ayrıldı',
    'Bank sənədi',
    String(a.id),
    `${String(a.number)}${other ? ` + ${String(other.number)}` : ''} · ${reason}`,
  );
}

/**
 * After a bank document was saved or cancelled: a pair that no longer holds (the document was
 * cancelled, moved to another kind of account or currency, or to another direction) is undone;
 * an unpaired document is paired when the choice is unambiguous on both sides.
 */
export function refreshPair(tx: Tx, companyId: string, id: string) {
  const doc = bankDocument(tx.db, companyId, id)!;
  if (doc.pair_id) {
    const other = bankDocument(tx.db, companyId, String(doc.pair_id));
    const valid =
      !!other &&
      isPairable(doc) &&
      isPairable(other) &&
      other.direction === doc.direction &&
      isDeposit(String(doc.account)) !== isDeposit(String(other.account));
    if (valid) return;
    unlink(
      tx,
      companyId,
      doc,
      doc.status === 'posted' ? 'sənəd dəyişdirildi' : 'sənəd ləğv edildi',
    );
  }
  const fresh = bankDocument(tx.db, companyId, id)!;
  const candidates = pairCandidates(tx.db, companyId, fresh);
  if (candidates.length !== 1) return;
  const other = candidates[0]!;
  const back = pairCandidates(tx.db, companyId, other);
  if (back.length === 1 && back[0]!.id === fresh.id) link(tx, companyId, fresh, other, 'avtomatik');
}

/** The accountant pairs two documents (or, with an empty `pairId`, undoes a pair). */
export function pairBankDocuments(
  tx: Tx,
  companyId: string,
  id: string,
  pairId: string,
): { id: string } {
  tx.company(companyId);
  const doc = bankDocument(tx.db, companyId, id);
  if (!doc) throw new DomainError('Bank sənədi tapılmadı.', 'id', 'not-found');
  tx.open(companyId, String(doc.date));
  if (!pairId) {
    if (doc.pair_id) unlink(tx, companyId, doc, 'əl ilə');
    return { id };
  }
  const other = bankDocument(tx.db, companyId, pairId);
  if (!other) throw new DomainError('Cüt sənəd tapılmadı.', 'pairId', 'not-found');
  tx.open(companyId, String(other.date), 'pairId');
  if (!isPairable(doc) || !isPairable(other))
    throw new DomainError(
      'Cüt yalnız uçotda olan manat sənədləri arasında olur (223 və 224.04).',
      'pairId',
    );
  if (doc.direction !== other.direction)
    throw new DomainError('Daxilolma məxaricdə cütləşdirilmir.', 'pairId');
  if (isDeposit(String(doc.account)) === isDeposit(String(other.account)))
    throw new DomainError(
      'Cütün bir sənədi ƏDV depozitində (224.04), digəri cari hesabda (223) olmalıdır.',
      'pairId',
    );
  if (doc.pair_id === other.id) return { id };
  if (doc.pair_id) unlink(tx, companyId, doc, 'başqa sənədlə cütləşdirildi');
  const current = bankDocument(tx.db, companyId, pairId)!;
  if (current.pair_id) unlink(tx, companyId, current, 'başqa sənədlə cütləşdirildi');
  link(
    tx,
    companyId,
    bankDocument(tx.db, companyId, id)!,
    bankDocument(tx.db, companyId, pairId)!,
    'əl ilə',
  );
  return { id };
}
