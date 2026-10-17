/**
 * Bank documents (stage 3a; docs/QERARLAR.md 2026-10-14, docs/MERHELE-3-BANK.md §3–4).
 *
 * Receipt ("Bank daxilolması"), per line:  Dt 223.xx / 224.04 (bank account) / Kt counter account
 * Payment ("Bank məxarici"), per line:     Dt counter account / Kt 223.xx / 224.04 (bank account)
 *
 * The lines, the matching to open invoices and the advance guard are the money-document core
 * shared with cash orders (money.ts). What is bank-only lives here: the bank account, the VAT
 * deposit (a 224.04 document settles only the VAT of each invoice, a current-account document
 * only the rest), the statement row and the VAT pair.
 *
 * Like invoices, saving posts at once, a correction stornoes the previous entry before the new one
 * is computed (so matching sees the ledger without this document) and cancelling stornoes it. An
 * advance of this document that a later invoice has already used is never taken back.
 */
import type { SettlementPart } from '../domain/bank.js';
import { inFamily, type Chart, type CurrencyCode } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { storno, type Posting } from '../domain/posting.js';
import { formatPrice } from '../domain/quantity.js';
import { numberKey, parseDate, parseText } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type { Row } from '../infrastructure/sqlite/db.js';
import { refreshPair } from './bank-pair.js';
import {
  buildMoneyPostings,
  documentRate,
  guardAdvances,
  money,
  nextNumber,
  normalizeLines,
  type Holder,
} from './money.js';
import { bindStatementLine, releaseStatementLine } from './statements.js';
import { expectVersion, type Tx } from './tx.js';

export const BANK = 'bank';
type SaveBank = CommandOf<'bank.save'>;

const label = { in: 'Bank daxilolması', out: 'Bank məxarici' } as const;
const prefix = { in: 'BD', out: 'BX' } as const;

function normalize(tx: Tx, cmd: SaveBank, chart: Chart) {
  tx.company(cmd.companyId);
  const bank = tx.db.get(
    'SELECT * FROM bank_accounts WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.bankAccountId,
  );
  if (!bank) throw new DomainError('Bank hesabını seçin.', 'bankAccountId', 'not-found');
  if (bank.archived === 1n) throw new DomainError('Bank hesabı arxivdədir.', 'bankAccountId');
  const holder: Holder = {
    id: String(bank.id),
    account: chart.require(String(bank.account), 'bankAccountId'),
    currency: String(bank.currency) as CurrencyCode,
    of: 'bank hesabının',
  };
  const currency = holder.currency;
  const rate = documentRate(cmd.rate, currency, 'Manat hesabında məzənnə yazılmır.');
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
    bank,
    holder,
    currency,
    foreign: currency !== 'AZN',
    rate,
    lines,
    total,
    totalAzn,
    header: {
      direction: cmd.direction,
      date: parseDate(cmd.date),
      bankAccountId: String(bank.id),
      currency,
      rate: formatPrice(rate),
      bankReference: parseText(cmd.bankReference, 'Bank sənədinin nömrəsi', 80, false),
      counterpartyName: parseText(cmd.counterpartyName, 'Kontragent (bankda)', 240, false),
      counterpartyTaxId: parseText(cmd.counterpartyTaxId, 'VÖEN (bankda)', 20, false),
      purpose: parseText(cmd.purpose, 'Ödənişin təyinatı', 500, false),
    },
  };
}

type Normalized = ReturnType<typeof normalize>;

/**
 * A deposit document pays VAT, a current account the rest; currency invoices as a whole.
 * Individuals and foreign partners have no VAT deposit account: their VAT comes with the rest.
 */
const bankPart =
  (n: Normalized) =>
  (kind: string | undefined): SettlementPart =>
    n.foreign
      ? 'whole'
      : inFamily(n.holder.account.code, '224')
        ? 'vat'
        : kind === 'individual' || kind === 'foreign'
          ? 'whole'
          : 'net';

function buildPostings(tx: Tx, companyId: string, chart: Chart, id: string, n: Normalized) {
  return buildMoneyPostings(tx, companyId, chart, id, {
    type: BANK,
    direction: n.header.direction,
    date: n.header.date,
    holder: n.holder,
    rate: n.rate,
    lines: n.lines,
    memo: n.header.purpose || label[n.header.direction],
    part: bankPart(n),
  });
}

function payload(number: string, n: Normalized) {
  return { number, ...n.header, lines: n.lines.map((l) => l.stored) };
}

export function saveBankDocument(tx: Tx, cmd: SaveBank): CommandResult {
  const chart = tx.chart(cmd.companyId);
  const n = normalize(tx, cmd, chart);
  const existing = cmd.id
    ? tx.db.get('SELECT * FROM bank_documents WHERE company_id=? AND id=?', cmd.companyId, cmd.id)
    : undefined;
  if (cmd.id && !existing) throw new DomainError('Bank sənədi tapılmadı.', 'id', 'not-found');
  if (existing) {
    expectVersion(existing, cmd.version, label[cmd.direction]);
    if (existing.status !== 'posted')
      throw new DomainError('Ləğv edilmiş sənəd dəyişdirilmir.', undefined, 'conflict');
    if (existing.direction !== cmd.direction)
      throw new DomainError('Sənədin növü (daxilolma / məxaric) dəyişdirilmir.', 'direction');
  }
  const number =
    parseText(cmd.number, 'Nömrə', 40, false) ||
    (existing
      ? String(existing.number)
      : nextNumber(tx, 'bank_documents', cmd.companyId, cmd.direction, prefix[cmd.direction]));
  const key = numberKey(number);
  const same = tx.db.get(
    'SELECT id FROM bank_documents WHERE company_id=? AND direction=? AND number_key=?',
    cmd.companyId,
    cmd.direction,
    key,
  );
  if (same && same.id !== cmd.id)
    throw new DomainError('Bu nömrə ilə sənəd artıq var.', 'number', 'conflict');
  const id = existing ? String(existing.id) : tx.id();
  const data = payload(number, n);
  if (existing) {
    const last = tx.db.get(
      "SELECT payload FROM document_history WHERE company_id=? AND doc_type=? AND doc_id=? AND version=? AND status='posted'",
      cmd.companyId,
      BANK,
      id,
      existing.version as bigint,
    );
    // Unchanged content is not posted again; binding a statement row is done by statement.link.
    if (last && String(last.payload) === JSON.stringify(data)) {
      if (cmd.statementLineId && cmd.statementLineId !== existing.statement_line_id)
        throw new DomainError(
          'Mövcud sənədi çıxarış sətrinə bağlamaq üçün çıxarışda “Bu sənədlə bağla” seçin.',
          'statementLineId',
        );
      return { id, version: Number(existing.version), number };
    }
    tx.open(cmd.companyId, String(existing.date));
  }
  tx.open(cmd.companyId, n.header.date);
  const version = existing ? Number(existing.version) + 1 : 1;
  const now = tx.clock.now();
  // Reverse the previous version first: invoice matching must not see this document twice.
  let previous: Posting[] = [];
  if (existing) {
    const prev = tx.entryPostings(cmd.companyId, BANK, id, Number(existing.version));
    previous = prev.postings;
    tx.post(
      cmd.companyId,
      chart,
      { type: BANK, id, number: String(existing.number), version: Number(existing.version) },
      prev.date,
      true,
      storno(prev.postings),
    );
  }
  const values = [
    number,
    key,
    n.header.date,
    n.header.bankAccountId,
    n.currency,
    n.rate,
    n.total,
    n.totalAzn,
    n.header.bankReference,
    n.header.counterpartyName,
    n.header.counterpartyTaxId,
    n.header.purpose,
    JSON.stringify(data.lines),
    version,
    now,
  ] as const;
  if (existing)
    tx.db.run(
      `UPDATE bank_documents SET number=?,number_key=?,date=?,bank_account_id=?,currency=?,rate=?,amount=?,
         amount_azn=?,bank_reference=?,counterparty_name=?,counterparty_tax_id=?,purpose=?,lines=?,version=?,
         updated_at=? WHERE id=?`,
      ...values,
      id,
    );
  else
    tx.db.run(
      `INSERT INTO bank_documents(number,number_key,date,bank_account_id,currency,rate,amount,amount_azn,
         bank_reference,counterparty_name,counterparty_tax_id,purpose,lines,version,updated_at,
         id,company_id,direction,status,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'posted',?)`,
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
    { type: BANK, id, number, version },
    n.header.date,
    false,
    postings,
  );
  guardAdvances(tx, cmd.companyId, BANK, id, previous);
  // The statement row stays what the bank wrote: account, direction, date and amount.
  const bound =
    existing?.statement_line_id &&
    tx.db.get(
      "SELECT 1 AS x FROM statement_lines WHERE company_id=? AND id=? AND state='posted' AND document_id=?",
      cmd.companyId,
      String(existing.statement_line_id),
      id,
    )
      ? String(existing.statement_line_id)
      : undefined;
  bindStatementLine(
    tx,
    cmd.companyId,
    tx.db.get('SELECT * FROM bank_documents WHERE company_id=? AND id=?', cmd.companyId, id)!,
    cmd.statementLineId,
    bound,
  );
  refreshPair(tx, cmd.companyId, id);
  tx.history(cmd.companyId, BANK, id, version, 'posted', data);
  tx.audit(
    cmd.companyId,
    existing ? 'Düzəliş edildi (storno + yeni yazılış)' : 'Uçota alındı',
    label[cmd.direction],
    id,
    `${number} · ${n.header.date} · ${String(n.bank.name) || String(n.bank.iban)} · ${money(n.total)} ${n.currency}`,
  );
  return { id, version, number };
}

export function cancelBankDocument(tx: Tx, cmd: CommandOf<'bank.cancel'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = parseText(cmd.reason, 'Ləğv səbəbi');
  const row: Row | undefined = tx.db.get(
    'SELECT * FROM bank_documents WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('Bank sənədi tapılmadı.', 'id', 'not-found');
  const direction = row.direction as 'in' | 'out';
  expectVersion(row, cmd.version, label[direction]);
  if (row.status !== 'posted')
    throw new DomainError('Sənəd artıq ləğv edilib.', undefined, 'conflict');
  const prev = tx.entryPostings(cmd.companyId, BANK, cmd.id, Number(row.version));
  tx.open(cmd.companyId, prev.date);
  const chart = tx.chart(cmd.companyId);
  tx.post(
    cmd.companyId,
    chart,
    { type: BANK, id: cmd.id, number: String(row.number), version: Number(row.version) },
    prev.date,
    true,
    storno(prev.postings),
  );
  const version = Number(row.version) + 1;
  tx.db.run(
    "UPDATE bank_documents SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  guardAdvances(tx, cmd.companyId, BANK, cmd.id, prev.postings);
  refreshPair(tx, cmd.companyId, cmd.id);
  releaseStatementLine(tx, cmd.companyId, cmd.id);
  tx.history(cmd.companyId, BANK, cmd.id, version, 'cancelled', { reason });
  tx.audit(
    cmd.companyId,
    'Ləğv edildi (storno)',
    label[direction],
    cmd.id,
    `${row.number} · ${reason}`,
  );
  return { id: cmd.id, version };
}
