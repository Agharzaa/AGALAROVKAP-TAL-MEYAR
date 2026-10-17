/**
 * Cash queries (stage 5a): the order journal, one order with its entry, and the cash book — one
 * cashbox day by day, read from the journal so it always agrees with the ledger (a corrected
 * order shows once with its last amounts; a cancelled one is gone from the book).
 */
import { DomainError } from '../domain/errors.js';
import { formatMinor, type Minor } from '../domain/money.js';
import { formatPrice } from '../domain/quantity.js';
import { parseDate } from '../domain/values.js';
import { amountInWords } from '../domain/words.js';
import type {
  BankLineView,
  CashBookDay,
  CashBookLine,
  CashBookView,
  CashDocumentDetail,
  CashDocumentSummary,
} from '../contracts/queries.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import { documentEntry, type Names } from './reports.js';
import { loadChart } from './tx.js';

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const money = (v: bigint) => formatMinor(v);

interface StoredCashLine {
  account: string;
  sk: string[];
  amount: string;
  curAmount: string;
  cashFlowItem?: string;
  memo: string;
}

export const cashSelect = `SELECT d.*, x.account AS account, x.name AS cashbox_name FROM cash_documents d
  JOIN cashboxes x ON x.company_id=d.company_id AND x.id=d.cashbox_id`;

export function cashSummary(r: Row): CashDocumentSummary {
  const lines = JSON.parse(str(r.lines)) as StoredCashLine[];
  return {
    id: str(r.id),
    version: Number(r.version),
    direction: r.direction as CashDocumentSummary['direction'],
    number: str(r.number),
    date: str(r.date),
    cashboxId: str(r.cashbox_id),
    cashbox: str(r.cashbox_name),
    account: str(r.account),
    currency: str(r.currency),
    amount: money(r.amount as bigint),
    amountAzn: money(r.amount_azn as bigint),
    counterpartyName: str(r.counterparty_name),
    basis: str(r.basis),
    attachment: str(r.attachment),
    accounts: [...new Set(lines.map((l) => l.account))].join(', '),
    status: r.status as CashDocumentSummary['status'],
  };
}

export function cashDocuments(
  db: Db,
  companyId: string,
  from: string,
  to: string,
  cashboxId?: string,
): CashDocumentSummary[] {
  return db
    .all(
      `${cashSelect} WHERE d.company_id=? AND d.date>=? AND d.date<=?${cashboxId ? ' AND d.cashbox_id=?' : ''}
       ORDER BY d.date DESC, d.rowid DESC`,
      companyId,
      parseDate(from),
      parseDate(to),
      ...(cashboxId ? [cashboxId] : []),
    )
    .map(cashSummary);
}

export function cashDetail(db: Db, companyId: string, id: string): CashDocumentDetail {
  const r = db.get(`${cashSelect} WHERE d.company_id=? AND d.id=?`, companyId, id);
  if (!r) throw new DomainError('Kassa sənədi tapılmadı.', 'id', 'not-found');
  const { postings, history, names } = documentEntry(db, companyId, 'cash', id);
  const chart = loadChart(db, companyId);
  const lines = (JSON.parse(str(r.lines)) as StoredCashLine[]).map((l): BankLineView => {
    const kinds = chart.get(l.account)?.subkonto ?? [];
    return {
      account: l.account,
      sk: l.sk,
      skNames: kinds.map((k, i) => (l.sk[i] ? names.name(k, l.sk[i]!) : '')),
      amount: l.amount,
      curAmount: l.curAmount,
      cashFlowItem: l.cashFlowItem ?? '',
      cashFlowItemName: l.cashFlowItem
        ? str(
            db.get('SELECT name FROM items WHERE company_id=? AND id=?', companyId, l.cashFlowItem)
              ?.name,
          )
        : '',
      memo: l.memo,
    };
  });
  return {
    ...cashSummary(r),
    rate: formatPrice(r.rate as bigint),
    lines,
    amountWords: amountInWords(r.amount as bigint, str(r.currency)),
    postings,
    history,
  };
}

const sourceLabel: Record<string, string> = {
  operation: 'Əməliyyat',
  invoice: 'Qaimə',
  bank: 'Bank sənədi',
};

export function cashBook(
  db: Db,
  companyId: string,
  cashboxId: string,
  fromInput: string,
  toInput: string,
  names: Names,
): CashBookView {
  const from = parseDate(fromInput);
  const to = parseDate(toInput);
  const box = db.get('SELECT * FROM cashboxes WHERE company_id=? AND id=?', companyId, cashboxId);
  if (!box) throw new DomainError('Kassa tapılmadı.', 'cashboxId', 'not-found');
  const account = str(box.account);
  const currency = str(box.currency);
  const foreign = currency !== 'AZN';
  const month = from.slice(0, 7);
  const before = db.get(
    `SELECT COALESCE(SUM(debit-credit),0) AS a, COALESCE(SUM(cur_dt-cur_kt),0) AS c FROM registers
     WHERE company_id=? AND account=? AND s1=? AND month<?`,
    companyId,
    account,
    cashboxId,
    month,
  )!;
  const early = db.get(
    `SELECT COALESCE(SUM(a),0) AS a, COALESCE(SUM(c),0) AS c FROM (
       SELECT amount AS a, dt_cur AS c FROM postings
         WHERE company_id=? AND dt_account=? AND dt_s1=? AND date>=? AND date<?
       UNION ALL
       SELECT -amount, -kt_cur FROM postings
         WHERE company_id=? AND kt_account=? AND kt_s1=? AND date>=? AND date<?)`,
    companyId,
    account,
    cashboxId,
    `${month}-01`,
    from,
    companyId,
    account,
    cashboxId,
    `${month}-01`,
    from,
  )!;
  const LIMIT = 5000;
  const rows = db.all(
    `SELECT date, t, sid, MAX(n) AS n, SUM(inc) AS inc, SUM(exp) AS exp, SUM(incc) AS incc,
       SUM(expc) AS expc, GROUP_CONCAT(DISTINCT acc) AS acc, MIN(seq) AS seq, MAX(memo) AS memo
     FROM (
       SELECT p.date, e.source_type AS t, e.source_id AS sid, e.source_number AS n,
         p.amount AS inc, 0 AS exp, p.dt_cur AS incc, 0 AS expc,
         CASE WHEN p.amount>0 THEN p.kt_account END AS acc, e.rowid AS seq,
         CASE WHEN p.amount>0 THEN p.memo END AS memo
       FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE p.company_id=? AND p.dt_account=? AND p.dt_s1=? AND p.date>=? AND p.date<=?
       UNION ALL
       SELECT p.date, e.source_type, e.source_id, e.source_number,
         0, p.amount, 0, p.kt_cur,
         CASE WHEN p.amount>0 THEN p.dt_account END, e.rowid,
         CASE WHEN p.amount>0 THEN p.memo END
       FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE p.company_id=? AND p.kt_account=? AND p.kt_s1=? AND p.date>=? AND p.date<=?
     ) GROUP BY date, t, sid HAVING SUM(inc)<>0 OR SUM(exp)<>0
     ORDER BY date, seq LIMIT ${LIMIT + 1}`,
    companyId,
    account,
    cashboxId,
    from,
    to,
    companyId,
    account,
    cashboxId,
    from,
    to,
  );
  const truncated = rows.length > LIMIT;
  const cash = new Map(
    rows.some((r) => r.t === 'cash')
      ? db
          .all(
            'SELECT id,direction,counterparty_name,basis FROM cash_documents WHERE company_id=? AND cashbox_id=? AND date>=? AND date<=?',
            companyId,
            cashboxId,
            from,
            to,
          )
          .map((r) => [str(r.id), r])
      : [],
  );
  const opening = (before.a as Minor) + (early.a as Minor);
  const openingCur = (before.c as Minor) + (early.c as Minor);
  let balance = opening;
  let balanceCur = openingCur;
  let income = 0n;
  let expense = 0n;
  let dayIncome = 0n;
  let dayExpense = 0n;
  const days: CashBookDay[] = [];
  const cur = (v: Minor) => (foreign ? money(v) : '');
  for (const r of rows.slice(0, LIMIT)) {
    const date = str(r.date);
    let day = days[days.length - 1];
    if (!day || day.date !== date) {
      day = {
        date,
        opening: money(balance),
        openingCur: cur(balanceCur),
        lines: [],
        income: '0.00',
        expense: '0.00',
        closing: '',
        closingCur: '',
      };
      days.push(day);
      dayIncome = 0n;
      dayExpense = 0n;
    }
    const inc = r.inc as Minor;
    const exp = r.exp as Minor;
    balance += inc - exp;
    balanceCur += (r.incc as Minor) - (r.expc as Minor);
    income += inc;
    expense += exp;
    dayIncome += inc;
    dayExpense += exp;
    const doc = r.t === 'cash' ? cash.get(str(r.sid)) : undefined;
    const line: CashBookLine = {
      date,
      number: str(r.n),
      sourceType: str(r.t),
      sourceId: str(r.sid),
      direction: doc ? (doc.direction as 'in' | 'out') : '',
      counterparty: doc ? str(doc.counterparty_name) : (sourceLabel[str(r.t)] ?? ''),
      account: str(r.acc).split(',').filter(Boolean).join(', '),
      memo: doc ? str(doc.basis) || str(r.memo) : str(r.memo),
      income: inc ? money(inc) : '',
      expense: exp ? money(exp) : '',
      incomeCur: foreign && r.incc ? money(r.incc as Minor) : '',
      expenseCur: foreign && r.expc ? money(r.expc as Minor) : '',
    };
    day.lines.push(line);
    day.income = money(dayIncome);
    day.expense = money(dayExpense);
    day.closing = money(balance);
    day.closingCur = cur(balanceCur);
  }
  return {
    cashboxId,
    cashbox: names.name('cashbox', cashboxId),
    account,
    currency,
    opening: money(opening),
    openingCur: cur(openingCur),
    income: money(income),
    expense: money(expense),
    closing: money(balance),
    closingCur: cur(balanceCur),
    days,
    truncated,
  };
}
