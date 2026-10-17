/**
 * Cash orders (stage 5a; docs/MERHELE-5-AY-BAGLANISI.md §4.1, docs/QERARLAR.md 2026-10-17).
 *
 * Mədaxil orderi (KMO), per line:  Dt 221.xx (cashbox) / Kt counter account
 * Məxaric orderi (KXO), per line:  Dt counter account / Kt 221.xx (cashbox)
 *
 * The lines, the matching to open invoices, the advance of the order and its guard are the
 * money-document core shared with bank documents (money.ts). Cash settles an invoice as a whole:
 * there is no VAT deposit in a cashbox. Money moves between the bank and the cashbox through
 * 222.01 (a bank document and a cash order, each matched to its own statement or cash book).
 *
 * The cash balance may not fall below zero on any day: checked day by day from the earliest date
 * the change touches, after the new entry is posted (a back-dated payment too).
 */
import type { Chart } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import type { Minor } from '../domain/money.js';
import { storno, type Posting } from '../domain/posting.js';
import { formatPrice } from '../domain/quantity.js';
import { numberKey, parseDate, parseText } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import {
  buildMoneyPostings,
  cashboxHolder,
  documentRate,
  guardAdvances,
  money,
  nextNumber,
  normalizeLines,
  type Holder,
} from './money.js';
import { expectVersion, type Tx } from './tx.js';

export const CASH = 'cash';
type SaveCash = CommandOf<'cash.save'>;

export const cashLabel = { in: 'Kassa mədaxil orderi', out: 'Kassa məxaric orderi' } as const;
const prefix = { in: 'KMO', out: 'KXO' } as const;

function normalize(tx: Tx, cmd: SaveCash, chart: Chart) {
  tx.company(cmd.companyId);
  const box = tx.db.get(
    'SELECT * FROM cashboxes WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.cashboxId,
  );
  if (!box) throw new DomainError('Kassanı seçin.', 'cashboxId', 'not-found');
  if (box.archived === 1n) throw new DomainError('Kassa arxivdədir.', 'cashboxId');
  const holder = cashboxHolder(box, chart, 'cashboxId');
  const rate = documentRate(cmd.rate, holder.currency, 'Manat kassasında məzənnə yazılmır.');
  const { lines, total, totalAzn } = normalizeLines(
    tx,
    cmd.companyId,
    chart,
    cmd.direction,
    holder,
    rate,
    cmd.lines,
  );
  return {
    box,
    holder,
    rate,
    lines,
    total,
    totalAzn,
    header: {
      direction: cmd.direction,
      date: parseDate(cmd.date),
      cashboxId: holder.id,
      currency: holder.currency,
      rate: formatPrice(rate),
      counterpartyName: parseText(
        cmd.counterpartyName,
        cmd.direction === 'in' ? 'Kimdən qəbul edilib' : 'Kimə verilib',
        240,
        false,
      ),
      basis: parseText(cmd.basis, 'Əsas', 500, false),
      attachment: parseText(cmd.attachment, 'Əlavə', 240, false),
    },
  };
}

type Normalized = ReturnType<typeof normalize>;

function buildPostings(tx: Tx, companyId: string, chart: Chart, id: string, n: Normalized) {
  return buildMoneyPostings(tx, companyId, chart, id, {
    type: CASH,
    direction: n.header.direction,
    date: n.header.date,
    holder: n.holder,
    rate: n.rate,
    lines: n.lines,
    memo: n.header.basis || cashLabel[n.header.direction],
    part: () => 'whole',
  });
}

const dmy = (iso: string) => iso.split('-').reverse().join('.');

/**
 * Cash on hand of one cashbox at the end of each day from `from` on may not be negative (in AZN,
 * and in the currency of a currency cashbox).
 */
export function guardCash(
  tx: Tx,
  companyId: string,
  holder: Pick<Holder, 'id' | 'account' | 'currency'>,
  from: string,
) {
  const account = holder.account.code;
  const month = from.slice(0, 7);
  const opening = tx.db.get(
    `SELECT COALESCE(SUM(debit-credit),0) AS a, COALESCE(SUM(cur_dt-cur_kt),0) AS c FROM registers
     WHERE company_id=? AND account=? AND s1=? AND month<?`,
    companyId,
    account,
    holder.id,
    month,
  )!;
  const days = tx.db.all(
    `SELECT date, SUM(a) AS a, SUM(c) AS c FROM (
       SELECT date, amount AS a, dt_cur AS c FROM postings
         WHERE company_id=? AND dt_account=? AND dt_s1=? AND date>=?
       UNION ALL
       SELECT date, -amount, -kt_cur FROM postings
         WHERE company_id=? AND kt_account=? AND kt_s1=? AND date>=?
     ) GROUP BY date ORDER BY date`,
    companyId,
    account,
    holder.id,
    `${month}-01`,
    companyId,
    account,
    holder.id,
    `${month}-01`,
  );
  let amount = opening.a as Minor;
  let cur = opening.c as Minor;
  const foreign = holder.currency !== 'AZN';
  for (const d of days) {
    amount += d.a as Minor;
    cur += d.c as Minor;
    if (String(d.date) < from) continue;
    if (amount < 0n || (foreign && cur < 0n))
      throw new DomainError(
        `Kassa qalığı ${dmy(String(d.date))} tarixində mənfi olur: ${
          foreign && cur < 0n ? `${money(cur)} ${holder.currency}` : `${money(amount)} AZN`
        }. Kassadan olduğundan çox pul verilə bilməz — əvvəlcə mədaxili uçota alın və ya tarixi yoxlayın.`,
        'lines',
        'conflict',
      );
  }
}

function payload(number: string, n: Normalized) {
  return { number, ...n.header, lines: n.lines.map((l) => l.stored) };
}

export function saveCashDocument(tx: Tx, cmd: SaveCash): CommandResult {
  const chart = tx.chart(cmd.companyId);
  const n = normalize(tx, cmd, chart);
  const existing = cmd.id
    ? tx.db.get('SELECT * FROM cash_documents WHERE company_id=? AND id=?', cmd.companyId, cmd.id)
    : undefined;
  if (cmd.id && !existing) throw new DomainError('Kassa sənədi tapılmadı.', 'id', 'not-found');
  if (existing) {
    expectVersion(existing, cmd.version, cashLabel[cmd.direction]);
    if (existing.status !== 'posted')
      throw new DomainError('Ləğv edilmiş sənəd dəyişdirilmir.', undefined, 'conflict');
    if (existing.direction !== cmd.direction)
      throw new DomainError('Sənədin növü (mədaxil / məxaric) dəyişdirilmir.', 'direction');
  }
  const number =
    parseText(cmd.number, 'Nömrə', 40, false) ||
    (existing
      ? String(existing.number)
      : nextNumber(tx, 'cash_documents', cmd.companyId, cmd.direction, prefix[cmd.direction]));
  const key = numberKey(number);
  const same = tx.db.get(
    'SELECT id FROM cash_documents WHERE company_id=? AND direction=? AND number_key=?',
    cmd.companyId,
    cmd.direction,
    key,
  );
  if (same && same.id !== cmd.id)
    throw new DomainError('Bu nömrə ilə sənəd artıq var.', 'number', 'conflict');
  const id = existing ? String(existing.id) : tx.id();
  const data = payload(number, n);
  let previousBox: { id: string; date: string } | undefined;
  if (existing) {
    const last = tx.db.get(
      "SELECT payload FROM document_history WHERE company_id=? AND doc_type=? AND doc_id=? AND version=? AND status='posted'",
      cmd.companyId,
      CASH,
      id,
      existing.version as bigint,
    );
    // Unchanged content is not posted again.
    if (last && String(last.payload) === JSON.stringify(data))
      return { id, version: Number(existing.version), number };
    tx.open(cmd.companyId, String(existing.date));
    previousBox = { id: String(existing.cashbox_id), date: String(existing.date) };
  }
  tx.open(cmd.companyId, n.header.date);
  const version = existing ? Number(existing.version) + 1 : 1;
  const now = tx.clock.now();
  // Reverse the previous version first: invoice matching must not see this document twice.
  let previous: Posting[] = [];
  if (existing) {
    const prev = tx.entryPostings(cmd.companyId, CASH, id, Number(existing.version));
    previous = prev.postings;
    tx.post(
      cmd.companyId,
      chart,
      { type: CASH, id, number: String(existing.number), version: Number(existing.version) },
      prev.date,
      true,
      storno(prev.postings),
    );
  }
  const values = [
    number,
    key,
    n.header.date,
    n.header.cashboxId,
    n.header.currency,
    n.rate,
    n.total,
    n.totalAzn,
    n.header.counterpartyName,
    n.header.basis,
    n.header.attachment,
    JSON.stringify(data.lines),
    version,
    now,
  ] as const;
  if (existing)
    tx.db.run(
      `UPDATE cash_documents SET number=?,number_key=?,date=?,cashbox_id=?,currency=?,rate=?,amount=?,
         amount_azn=?,counterparty_name=?,basis=?,attachment=?,lines=?,version=?,updated_at=? WHERE id=?`,
      ...values,
      id,
    );
  else
    tx.db.run(
      `INSERT INTO cash_documents(number,number_key,date,cashbox_id,currency,rate,amount,amount_azn,
         counterparty_name,basis,attachment,lines,version,updated_at,id,company_id,direction,status,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'posted',?)`,
      ...values,
      id,
      cmd.companyId,
      cmd.direction,
      now,
    );
  const postings = buildPostings(tx, cmd.companyId, chart, id, n);
  tx.post(
    cmd.companyId,
    chart,
    { type: CASH, id, number, version },
    n.header.date,
    false,
    postings,
  );
  guardAdvances(tx, cmd.companyId, CASH, id, previous);
  // The new cashbox from the earlier of both dates; the cashbox it left from its old date.
  const from =
    previousBox && previousBox.id === n.holder.id && previousBox.date < n.header.date
      ? previousBox.date
      : n.header.date;
  guardCash(tx, cmd.companyId, n.holder, from);
  if (previousBox && previousBox.id !== n.holder.id) {
    const old = tx.db.get(
      'SELECT * FROM cashboxes WHERE company_id=? AND id=?',
      cmd.companyId,
      previousBox.id,
    )!;
    guardCash(tx, cmd.companyId, cashboxHolder(old, chart, 'cashboxId'), previousBox.date);
  }
  tx.history(cmd.companyId, CASH, id, version, 'posted', data);
  tx.audit(
    cmd.companyId,
    existing ? 'Düzəliş edildi (storno + yeni yazılış)' : 'Uçota alındı',
    cashLabel[cmd.direction],
    id,
    `${number} · ${n.header.date} · ${String(n.box.name)} · ${money(n.total)} ${n.header.currency}`,
  );
  return { id, version, number };
}

export function cancelCashDocument(tx: Tx, cmd: CommandOf<'cash.cancel'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = parseText(cmd.reason, 'Ləğv səbəbi');
  const row = tx.db.get(
    'SELECT * FROM cash_documents WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('Kassa sənədi tapılmadı.', 'id', 'not-found');
  const direction = row.direction as 'in' | 'out';
  expectVersion(row, cmd.version, cashLabel[direction]);
  if (row.status !== 'posted')
    throw new DomainError('Sənəd artıq ləğv edilib.', undefined, 'conflict');
  const prev = tx.entryPostings(cmd.companyId, CASH, cmd.id, Number(row.version));
  tx.open(cmd.companyId, prev.date);
  const chart = tx.chart(cmd.companyId);
  tx.post(
    cmd.companyId,
    chart,
    { type: CASH, id: cmd.id, number: String(row.number), version: Number(row.version) },
    prev.date,
    true,
    storno(prev.postings),
  );
  const version = Number(row.version) + 1;
  tx.db.run(
    "UPDATE cash_documents SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  guardAdvances(tx, cmd.companyId, CASH, cmd.id, prev.postings);
  // Cancelling a receipt takes money out of the cashbox: later payments must still be covered.
  if (direction === 'in') {
    const box = tx.db.get(
      'SELECT * FROM cashboxes WHERE company_id=? AND id=?',
      cmd.companyId,
      String(row.cashbox_id),
    )!;
    guardCash(tx, cmd.companyId, cashboxHolder(box, chart, 'cashboxId'), String(row.date));
  }
  tx.history(cmd.companyId, CASH, cmd.id, version, 'cancelled', { reason });
  tx.audit(
    cmd.companyId,
    'Ləğv edildi (storno)',
    cashLabel[direction],
    cmd.id,
    `${row.number} · ${reason}`,
  );
  return { id: cmd.id, version };
}
