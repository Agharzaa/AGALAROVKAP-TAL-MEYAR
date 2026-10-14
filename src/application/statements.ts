/**
 * Bank statement import (stage 3c; docs/MERHELE-3-BANK.md §6, docs/QERARLAR.md "Avtomatik
 * idxalın əsas prinsipi").
 *
 * A loaded file is kept as the bank wrote it: its rows are staged in statement_lines, each with a
 * fingerprint, so loading the same rows again (the same file, or an overlapping period) adds
 * nothing. A row is booked by an ordinary bank document — the same rules, journal and audit as a
 * document typed by hand — or linked to a bank document already entered by hand, or set aside
 * with a reason. Nothing is posted by guessing: what the system recognises is offered as a
 * proposal for the accountant to confirm (automatic posting comes with confirmed rules, 3d).
 */
import { createHash } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney, type Minor } from '../domain/money.js';
import { classifyStatementLine, findIban, type ClassifyContext } from '../domain/statement.js';
import { numberKey, parseDate, parseText, searchKey } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type {
  StatementImportView,
  StatementLineView,
  StatementProposal,
  StatementView,
} from '../contracts/queries.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import type { Tx } from './tx.js';

/** Days between a statement row and a bank document typed by hand for the same payment. */
export const MATCH_DAYS = 2;

const signed = (value: string, field: string): Minor => {
  const v = value.trim();
  return v.startsWith('-') ? -parseMoney(v.slice(1), field) : parseMoney(v, field);
};
const money = (m: Minor) => formatMinor(m);

// ---------------------------------------------------------------------------------------------
// Commands

export function importStatement(tx: Tx, cmd: CommandOf<'statement.import'>): CommandResult {
  tx.company(cmd.companyId);
  const fileName = parseText(cmd.fileName, 'Fayl', 240);
  // The account: by the IBAN printed in the file; the user's choice only when it prints none.
  const iban = cmd.iban.trim() ? findIban(cmd.iban) : undefined;
  if (cmd.iban.trim() && !iban)
    throw new DomainError(`Fayldakı hesab nömrəsi IBAN deyil: ${cmd.iban}.`, 'iban');
  let bank: Row | undefined;
  if (iban) {
    bank = tx.db.get(
      'SELECT * FROM bank_accounts WHERE company_id=? AND iban=?',
      cmd.companyId,
      iban,
    );
    if (!bank)
      throw new DomainError(
        `Çıxarış ${iban} hesabı üzrədir; bu IBAN bank hesabları kitabçasında yoxdur. Əvvəlcə hesabı əlavə edin.`,
        'iban',
        'not-found',
      );
    if (cmd.bankAccountId && cmd.bankAccountId !== bank.id)
      throw new DomainError(
        `Çıxarış ${iban} hesabı üzrədir, seçilən bank hesabı isə başqadır.`,
        'bankAccountId',
      );
  } else {
    if (!cmd.bankAccountId)
      throw new DomainError('Faylda IBAN yoxdur; bank hesabını seçin.', 'bankAccountId');
    bank = tx.db.get(
      'SELECT * FROM bank_accounts WHERE company_id=? AND id=?',
      cmd.companyId,
      cmd.bankAccountId,
    );
    if (!bank) throw new DomainError('Bank hesabı tapılmadı.', 'bankAccountId', 'not-found');
  }
  if (bank.archived === 1n) throw new DomainError('Bank hesabı arxivdədir.', 'bankAccountId');
  const bankId = String(bank.id);
  const importId = tx.id();
  const rejected: { row: number; message: string }[] = [];
  const staged: {
    row: number;
    date: string;
    direction: string;
    amount: bigint;
    reference: string;
    counterparty: string;
    counterpartyTaxId: string;
    counterpartyIban: string;
    purpose: string;
    fingerprint: string;
  }[] = [];
  const seen = new Map<string, number>();
  cmd.lines.forEach((l) => {
    try {
      const date = parseDate(l.date, `Sətir ${l.row}: tarix`);
      const amount = parseMoney(l.amount, `Sətir ${l.row}: məbləğ`);
      if (amount <= 0n) throw new DomainError(`Sətir ${l.row}: məbləğ müsbət olmalıdır.`);
      const reference = parseText(l.reference, 'Sənəd', 80, false);
      const taxId = /^\d{10}$/.test(l.counterpartyTaxId.trim()) ? l.counterpartyTaxId.trim() : '';
      const purpose = parseText(l.purpose, 'Təyinat', 500, false);
      // Two identical rows in one file (two equal fees on one day) are both real; the occurrence
      // number keeps them apart while a second load of the same rows still matches them.
      const base = [
        bankId,
        date,
        l.direction,
        money(amount),
        numberKey(reference),
        taxId,
        searchKey(purpose),
      ].join('|');
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      staged.push({
        row: l.row,
        date,
        direction: l.direction,
        amount,
        reference,
        counterparty: parseText(l.counterparty, 'Kontragent', 240, false),
        counterpartyTaxId: taxId,
        counterpartyIban: findIban(l.counterpartyIban) ?? '',
        purpose,
        fingerprint: createHash('sha256').update(`${base}|${n}`).digest('hex').slice(0, 40),
      });
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      rejected.push({ row: l.row, message: e.message });
    }
  });
  if (!staged.length) throw new DomainError('Faylda uçota alına bilən sətir yoxdur.', 'lines');
  const dates = staged.map((s) => String(s.date)).sort();
  const opening = cmd.opening?.trim() ? signed(cmd.opening, 'Əvvələ qalıq') : null;
  const closing = cmd.closing?.trim() ? signed(cmd.closing, 'Sona qalıq') : null;
  const now = tx.clock.now();
  tx.db.run(
    `INSERT INTO statement_imports(id,company_id,bank_account_id,file_name,file_hash,period_from,period_to,
       opening,closing,rows_read,rows_added,imported_at,actor) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)`,
    importId,
    cmd.companyId,
    bankId,
    fileName,
    cmd.fileHash,
    dates[0]!,
    dates[dates.length - 1]!,
    opening,
    closing,
    cmd.lines.length,
    now,
    tx.ctx.actor,
  );
  let added = 0;
  for (const s of staged) {
    const r = tx.db.run(
      `INSERT INTO statement_lines(id,company_id,import_id,bank_account_id,row_no,date,direction,amount,reference,
         counterparty,counterparty_tax_id,counterparty_iban,purpose,fingerprint)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id,bank_account_id,fingerprint) DO NOTHING`,
      tx.id(),
      cmd.companyId,
      importId,
      bankId,
      s.row,
      s.date,
      s.direction,
      s.amount,
      s.reference,
      s.counterparty,
      s.counterpartyTaxId,
      s.counterpartyIban,
      s.purpose,
      s.fingerprint,
    );
    added += Number(r.changes);
  }
  tx.db.run('UPDATE statement_imports SET rows_added=? WHERE id=?', added, importId);
  const duplicates = staged.length - added;
  tx.audit(
    cmd.companyId,
    'Çıxarış yükləndi',
    'Bank çıxarışı',
    importId,
    `${fileName} · ${String(bank.iban)} · ${dates[0]}–${dates[dates.length - 1]} · yeni ${added}, təkrar ${duplicates}, rədd ${rejected.length}`,
  );
  return { id: importId, added, duplicates, rejected };
}

function line(tx: Tx, companyId: string, lineId: string): Row {
  const r = tx.db.get(
    'SELECT * FROM statement_lines WHERE company_id=? AND id=?',
    companyId,
    lineId,
  );
  if (!r) throw new DomainError('Çıxarış sətri tapılmadı.', 'lineId', 'not-found');
  return r;
}
const describeLine = (r: Row) =>
  `${String(r.date)} · ${r.direction === 'in' ? 'daxilolma' : 'məxaric'} ${money(r.amount as bigint)}${r.reference ? ` · ${String(r.reference)}` : ''}`;

export function ignoreStatementLine(tx: Tx, cmd: CommandOf<'statement.ignore'>): CommandResult {
  tx.company(cmd.companyId);
  const r = line(tx, cmd.companyId, cmd.lineId);
  const reason = parseText(cmd.reason, 'Səbəb');
  if (r.state !== 'new')
    throw new DomainError(
      r.state === 'posted'
        ? 'Sətir uçota alınıb; əvvəlcə bank sənədini ləğv edin.'
        : 'Sətir artıq kənara qoyulub.',
      undefined,
      'conflict',
    );
  tx.db.run("UPDATE statement_lines SET state='ignored', reason=? WHERE id=?", reason, cmd.lineId);
  tx.audit(
    cmd.companyId,
    'Kənara qoyuldu',
    'Çıxarış sətri',
    cmd.lineId,
    `${describeLine(r)} · ${reason}`,
  );
  return { id: cmd.lineId };
}

export function restoreStatementLine(tx: Tx, cmd: CommandOf<'statement.restore'>): CommandResult {
  tx.company(cmd.companyId);
  const r = line(tx, cmd.companyId, cmd.lineId);
  if (r.state !== 'ignored')
    throw new DomainError('Sətir kənara qoyulmayıb.', undefined, 'conflict');
  tx.db.run("UPDATE statement_lines SET state='new', reason='' WHERE id=?", cmd.lineId);
  tx.audit(cmd.companyId, 'Geri qaytarıldı', 'Çıxarış sətri', cmd.lineId, describeLine(r));
  return { id: cmd.lineId };
}

/** Why `doc` cannot book statement row `r`; empty when it can. */
function mismatch(r: Row, doc: Row, dateDays: number): string {
  if (doc.bank_account_id !== r.bank_account_id) return 'bank hesabı fərqlidir';
  if (doc.direction !== r.direction)
    return r.direction === 'in' ? 'sətir daxilolmadır' : 'sətir məxaricdir';
  if (doc.amount !== r.amount)
    return `məbləğ ${money(doc.amount as bigint)}, çıxarışda ${money(r.amount as bigint)}`;
  const days = Math.abs(Date.parse(String(doc.date)) - Date.parse(String(r.date))) / 86_400_000;
  if (days > dateDays) return `tarix ${String(doc.date)}, çıxarışda ${String(r.date)}`;
  return '';
}

/**
 * Called by bank.save: a document saved for a statement row (or already booking one) must stay
 * what the bank wrote — account, direction, date and amount.
 */
export function bindStatementLine(
  tx: Tx,
  companyId: string,
  doc: Row,
  requested: string | undefined,
  previous: string | undefined,
): void {
  if (requested && previous && requested !== previous)
    throw new DomainError(
      'Sənəd artıq başqa çıxarış sətrini uçota alır.',
      'statementLineId',
      'conflict',
    );
  const lineId = requested ?? previous;
  if (!lineId) return;
  const r = line(tx, companyId, lineId);
  if (r.state === 'ignored')
    throw new DomainError(
      'Çıxarış sətri kənara qoyulub; əvvəlcə geri qaytarın.',
      'statementLineId',
      'conflict',
    );
  if (r.state === 'posted' && r.document_id !== doc.id)
    throw new DomainError(
      'Çıxarış sətri artıq başqa sənədlə uçota alınıb.',
      'statementLineId',
      'conflict',
    );
  // A row booked by this very document may have been linked by hand (a day or two apart).
  const why = mismatch(r, doc, r.state === 'posted' ? MATCH_DAYS : 0);
  if (why) throw new DomainError(`Sənəd çıxarış sətrinə uyğun deyil: ${why}.`, 'statementLineId');
  if (r.state === 'new') {
    tx.db.run(
      "UPDATE bank_documents SET statement_line_id=?, origin='statement' WHERE company_id=? AND id=?",
      lineId,
      companyId,
      String(doc.id),
    );
    tx.db.run(
      "UPDATE statement_lines SET state='posted', document_id=? WHERE id=?",
      String(doc.id),
      lineId,
    );
  }
}

/** Called when a bank document is cancelled: its statement row waits again. */
export function releaseStatementLine(tx: Tx, companyId: string, documentId: string): void {
  tx.db.run(
    "UPDATE statement_lines SET state='new', document_id=NULL WHERE company_id=? AND document_id=?",
    companyId,
    documentId,
  );
}

export function linkStatementLine(tx: Tx, cmd: CommandOf<'statement.link'>): CommandResult {
  tx.company(cmd.companyId);
  const r = line(tx, cmd.companyId, cmd.lineId);
  if (r.state !== 'new')
    throw new DomainError('Sətir artıq uçota alınıb və ya kənara qoyulub.', undefined, 'conflict');
  const doc = tx.db.get(
    'SELECT * FROM bank_documents WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.documentId,
  );
  if (!doc) throw new DomainError('Bank sənədi tapılmadı.', 'documentId', 'not-found');
  if (doc.status !== 'posted') throw new DomainError('Sənəd ləğv edilib.', 'documentId');
  if (
    doc.statement_line_id &&
    tx.db.get(
      "SELECT 1 AS x FROM statement_lines WHERE id=? AND state='posted'",
      String(doc.statement_line_id),
    )
  )
    throw new DomainError('Sənəd artıq başqa çıxarış sətrinə bağlıdır.', 'documentId', 'conflict');
  const why = mismatch(r, doc, MATCH_DAYS);
  if (why) throw new DomainError(`Sənəd bu sətrə uyğun deyil: ${why}.`, 'documentId');
  tx.db.run('UPDATE bank_documents SET statement_line_id=? WHERE id=?', cmd.lineId, cmd.documentId);
  tx.db.run(
    "UPDATE statement_lines SET state='posted', document_id=? WHERE id=?",
    cmd.documentId,
    cmd.lineId,
  );
  tx.audit(
    cmd.companyId,
    'Mövcud sənədlə bağlandı',
    'Çıxarış sətri',
    cmd.lineId,
    `${describeLine(r)} → ${String(doc.number)}`,
  );
  return { id: cmd.lineId };
}

// ---------------------------------------------------------------------------------------------
// Read side: proposals and the balance check

const contractKind = { in: 'sale', out: 'purchase' } as const;

interface ProposalContext extends ClassifyContext {
  db: Db;
  companyId: string;
  bankCurrency: string;
  closedThrough: string;
  /** Unlinked posted bank documents of the account, for matching rows typed by hand. */
  manual: Row[];
  capitalIn?: string;
}

function proposalContext(db: Db, companyId: string, bank: Row): ProposalContext {
  const company = db.get('SELECT tax_id, closed_through FROM companies WHERE id=?', companyId)!;
  const partners = db.all(
    'SELECT id, name, tax_id FROM partners WHERE company_id=? AND archived=0',
    companyId,
  );
  const fee = db
    .all(
      "SELECT id, name FROM items WHERE company_id=? AND kind='expenseItem' AND archived=0",
      companyId,
    )
    .find((i) => searchKey(String(i.name)).startsWith('bank xidm'));
  const capital = db.get(
    "SELECT id FROM items WHERE company_id=? AND kind='capitalChange' AND archived=0 ORDER BY rowid LIMIT 1",
    companyId,
  );
  return {
    db,
    companyId,
    companyTaxId: String(company.tax_id),
    closedThrough: String(company.closed_through),
    bankCurrency: String(bank.currency),
    partnersByTaxId: new Map(
      partners
        .filter((p) => p.tax_id)
        .map((p) => [String(p.tax_id), { id: String(p.id), name: String(p.name) }]),
    ),
    partnersByName: new Map(
      partners.map((p) => [
        searchKey(String(p.name).trim()),
        { id: String(p.id), name: String(p.name) },
      ]),
    ),
    ...(fee ? { bankFeeItemId: String(fee.id) } : {}),
    ...(capital ? { capitalIn: String(capital.id) } : {}),
    manual: db.all(
      `SELECT b.* FROM bank_documents b WHERE b.company_id=? AND b.bank_account_id=? AND b.status='posted'
         AND (b.statement_line_id IS NULL OR NOT EXISTS(
           SELECT 1 FROM statement_lines s WHERE s.id=b.statement_line_id AND s.state='posted'))`,
      companyId,
      String(bank.id),
    ),
  };
}

/** The only active contract of the partner for this kind of payment in the bank's currency. */
function onlyContract(ctx: ProposalContext, partner: string, kind: string): string {
  const list = ctx.db.all(
    'SELECT id FROM contracts WHERE company_id=? AND partner_id=? AND kind=? AND currency=? AND archived=0',
    ctx.companyId,
    partner,
    kind,
    ctx.bankCurrency,
  );
  return list.length === 1 ? String(list[0]!.id) : '';
}

function propose(ctx: ProposalContext, r: Row): StatementProposal {
  const direction = r.direction as 'in' | 'out';
  const matches = ctx.manual
    .filter((d) => !mismatch(r, d, MATCH_DAYS))
    .map((d) => ({ id: String(d.id), number: String(d.number), date: String(d.date) }));
  const closed = String(r.date) <= ctx.closedThrough;
  const s = classifyStatementLine(
    {
      direction,
      counterparty: String(r.counterparty),
      counterpartyTaxId: String(r.counterparty_tax_id),
      purpose: String(r.purpose),
    },
    ctx,
  );
  const suffix = ctx.bankCurrency === 'AZN' ? '.01' : '.02';
  let account = '';
  let sk: string[] = [];
  const p = s.partnerId ?? '';
  switch (s.kind) {
    case 'settlement':
      account = (direction === 'in' ? '211' : '531') + suffix;
      sk = p ? [p, onlyContract(ctx, p, contractKind[direction])] : [];
      break;
    case 'refund':
      // Money back: a supplier returns an advance (243), we return a customer's advance (543).
      account = (direction === 'in' ? '243' : '543') + suffix;
      sk = p ? [p, onlyContract(ctx, p, contractKind[direction === 'in' ? 'out' : 'in']), ''] : [];
      break;
    case 'capital':
      account = '301';
      sk = p ? [p, ctx.capitalIn ?? ''] : [];
      break;
    case 'loan':
      account = '501';
      sk = p ? [p, onlyContract(ctx, p, 'loan')] : [];
      break;
    case 'salary':
      account = '533';
      break;
    case 'transfer':
      account = '222.01';
      break;
    case 'fee':
      account = '721';
      sk = s.expenseItemId ? [s.expenseItemId] : [];
      break;
    // Taxes and social payments: the sub-account is the accountant's (or a rule's) choice.
    default:
      account = '';
  }
  const known = s.confidence !== 'low' || matches.length > 0;
  return {
    state: known ? 'proposal' : 'unknown',
    reason: [
      matches.length
        ? `Əl ilə daxil edilmiş ${matches.map((m) => m.number).join(', ')} bu ödənişə uyğundur — yeni sənəd yaratmayın, bağlayın.`
        : s.reason,
      closed ? 'Tarix bağlı dövrdədir: əvvəlcə dövrü açmaq lazımdır.' : '',
    ]
      .filter(Boolean)
      .join(' '),
    account,
    sk,
    ...(s.createPartner && !p && String(r.counterparty_tax_id)
      ? { newPartner: { name: String(r.counterparty), taxId: String(r.counterparty_tax_id) } }
      : {}),
    matches,
  };
}

function lineView(
  ctx: ProposalContext | null,
  r: Row,
  numbers: Map<string, string>,
): StatementLineView {
  return {
    id: String(r.id),
    importId: String(r.import_id),
    bankAccountId: String(r.bank_account_id),
    row: Number(r.row_no),
    date: String(r.date),
    direction: r.direction as 'in' | 'out',
    amount: money(r.amount as bigint),
    reference: String(r.reference),
    counterparty: String(r.counterparty),
    counterpartyTaxId: String(r.counterparty_tax_id),
    counterpartyIban: String(r.counterparty_iban),
    purpose: String(r.purpose),
    state: r.state as StatementLineView['state'],
    documentId: r.document_id ? String(r.document_id) : '',
    documentNumber: r.document_id ? (numbers.get(String(r.document_id)) ?? '') : '',
    reason: String(r.reason),
    proposal: ctx && r.state === 'new' ? propose(ctx, r) : null,
  };
}

/** Net balance of one bank account in the ledger before `date` (AZN and currency). */
function ledgerBalance(db: Db, companyId: string, account: string, bankId: string, before: string) {
  const r = db.get(
    `SELECT COALESCE(SUM(a),0) AS a, COALESCE(SUM(c),0) AS c FROM (
       SELECT amount AS a, dt_cur AS c FROM postings WHERE company_id=? AND dt_account=? AND dt_s1=? AND date<?
       UNION ALL
       SELECT -amount, -kt_cur FROM postings WHERE company_id=? AND kt_account=? AND kt_s1=? AND date<?
     )`,
    companyId,
    account,
    bankId,
    before,
    companyId,
    account,
    bankId,
    before,
  )!;
  return { amount: r.a as bigint, currency: r.c as bigint };
}

const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

function importView(db: Db, r: Row): StatementImportView {
  const counts = db.get(
    `SELECT COUNT(*) AS n, SUM(state='new') AS waiting, SUM(state='posted') AS posted, SUM(state='ignored') AS ignored
     FROM statement_lines WHERE company_id=? AND import_id=?`,
    String(r.company_id),
    String(r.id),
  )!;
  return {
    id: String(r.id),
    bankAccountId: String(r.bank_account_id),
    fileName: String(r.file_name),
    from: String(r.period_from),
    to: String(r.period_to),
    importedAt: String(r.imported_at),
    rowsRead: Number(r.rows_read),
    rowsAdded: Number(r.rows_added),
    waiting: Number(counts.waiting ?? 0),
    posted: Number(counts.posted ?? 0),
    ignored: Number(counts.ignored ?? 0),
  };
}

export function statementImports(
  db: Db,
  companyId: string,
  bankAccountId?: string,
): StatementImportView[] {
  return db
    .all(
      `SELECT * FROM statement_imports WHERE company_id=?${bankAccountId ? ' AND bank_account_id=?' : ''}
       ORDER BY imported_at DESC, rowid DESC LIMIT 200`,
      companyId,
      ...(bankAccountId ? [bankAccountId] : []),
    )
    .map((r) => importView(db, r));
}

export function statementView(db: Db, companyId: string, importId: string): StatementView {
  const imp = db.get(
    'SELECT * FROM statement_imports WHERE company_id=? AND id=?',
    companyId,
    importId,
  );
  if (!imp) throw new DomainError('Çıxarış tapılmadı.', 'id', 'not-found');
  const bank = db.get(
    'SELECT * FROM bank_accounts WHERE company_id=? AND id=?',
    companyId,
    String(imp.bank_account_id),
  )!;
  const ctx = proposalContext(db, companyId, bank);
  const rows = db.all(
    'SELECT * FROM statement_lines WHERE company_id=? AND import_id=? ORDER BY row_no',
    companyId,
    importId,
  );
  const numbers = new Map(
    db
      .all(
        `SELECT b.id, b.number FROM bank_documents b JOIN statement_lines s ON s.document_id=b.id
         WHERE s.company_id=? AND s.import_id=?`,
        companyId,
        importId,
      )
      .map((d) => [String(d.id), String(d.number)]),
  );
  // Balances are compared in the account's own currency.
  const foreign = bank.currency !== 'AZN';
  const pick = (b: { amount: bigint; currency: bigint }) => (foreign ? b.currency : b.amount);
  const account = String(bank.account);
  const ledgerOpening = pick(
    ledgerBalance(db, companyId, account, String(bank.id), String(imp.period_from)),
  );
  const ledgerClosing = pick(
    ledgerBalance(db, companyId, account, String(bank.id), nextDay(String(imp.period_to))),
  );
  const fmt = (v: unknown) => (v === null || v === undefined ? '' : money(v as bigint));
  const diff = (file: unknown, ledger: bigint) =>
    file === null || file === undefined ? '' : money((file as bigint) - ledger);
  return {
    ...importView(db, imp),
    bankAccount: `${String(bank.account)} · ${String(bank.name) || String(bank.iban)}`,
    iban: String(bank.iban),
    currency: String(bank.currency),
    balances: {
      fileOpening: fmt(imp.opening),
      fileClosing: fmt(imp.closing),
      ledgerOpening: money(ledgerOpening),
      ledgerClosing: money(ledgerClosing),
      openingDifference: diff(imp.opening, ledgerOpening),
      closingDifference: diff(imp.closing, ledgerClosing),
    },
    lines: rows.map((r) => lineView(ctx, r, numbers)),
  };
}

export function statementLineView(db: Db, companyId: string, lineId: string): StatementLineView {
  const r = db.get('SELECT * FROM statement_lines WHERE company_id=? AND id=?', companyId, lineId);
  if (!r) throw new DomainError('Çıxarış sətri tapılmadı.', 'id', 'not-found');
  const bank = db.get(
    'SELECT * FROM bank_accounts WHERE company_id=? AND id=?',
    companyId,
    String(r.bank_account_id),
  )!;
  const number = r.document_id
    ? String(
        db.get('SELECT number FROM bank_documents WHERE id=?', String(r.document_id))?.number ?? '',
      )
    : '';
  return lineView(
    proposalContext(db, companyId, bank),
    r,
    new Map([[String(r.document_id), number]]),
  );
}
