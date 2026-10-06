/**
 * Bank statement import → bank documents.
 *
 * Imported rows are staged in bank_statement_lines (deduplicated by a fingerprint, so loading the
 * same file twice changes nothing). Each row is shown with a booking proposal; posting a row
 * creates an ordinary bank document through savePayment — the same rules, journal and audit as a
 * document typed by hand — and, for customer/supplier settlements, links it to the partner's open
 * invoices oldest first. Whatever is not linked stays the partner's advance.
 */
import { createHash } from 'node:crypto';
import { bankFamilies } from '../domain/posting.js';
import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney } from '../domain/money.js';
import { inFamily } from '../domain/accounts.js';
import {
  classifyStatementLine,
  type ClassifyContext,
  type StatementSuggestion,
} from '../domain/statement.js';
import { numberKey, parseDate, parseTaxId, parseText, searchKey } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type { StatementLineView } from '../contracts/queries.js';
import type { Db } from '../infrastructure/sqlite/db.js';
import { autoAllocate, savePayment } from './payments.js';
import type { Tx } from './tx.js';

export function importStatement(tx: Tx, cmd: CommandOf<'bankStatement.import'>): CommandResult {
  tx.company(cmd.companyId);
  const chart = tx.chart(cmd.companyId);
  if (!bankFamilies.some((f) => inFamily(cmd.bankAccount, f)))
    throw new DomainError('Bank hesabı 223 və ya 224.04 olmalıdır.', 'bankAccount');
  if (!chart.postable(cmd.bankAccount))
    throw new DomainError(`${cmd.bankAccount} hesabına yazılış etmək olmaz.`, 'bankAccount');
  const fileName = parseText(cmd.fileName, 'Fayl', 240, false);
  const seen = new Map<string, number>();
  let count = 0;
  let skipped = 0;
  cmd.lines.forEach((l, i) => {
    const field = `lines.${i}`;
    const date = parseDate(l.date, `Sətir ${i + 1}: tarix`);
    const amount = parseMoney(l.amount, `Sətir ${i + 1}: məbləğ`);
    if (amount <= 0n)
      throw new DomainError(`Sətir ${i + 1}: məbləğ sıfırdan böyük olmalıdır.`, `${field}.amount`);
    const reference = parseText(l.reference, 'Sənəd', 80, false);
    const counterparty = parseText(l.counterparty, 'Kontragent', 240, false);
    const taxId = /^\d{10}$/.test(l.counterpartyTaxId.trim()) ? l.counterpartyTaxId.trim() : '';
    const purpose = parseText(l.purpose, 'Təyinat', 500, false);
    // Two identical rows in one file (e.g. two equal fees on one day) are both real; the
    // occurrence number keeps them apart while a re-import of the same file still matches.
    const base = [
      date,
      l.direction,
      formatMinor(amount),
      numberKey(reference),
      taxId,
      searchKey(purpose),
    ].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const fingerprint = createHash('sha256').update(`${base}|${n}`).digest('hex').slice(0, 32);
    const inserted = tx.db.run(
      `INSERT OR IGNORE INTO bank_statement_lines(id,company_id,bank_account,date,direction,amount,reference,counterparty,counterparty_tax_id,purpose,fingerprint,source_file,status,imported_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'new',?)`,
      tx.id(),
      cmd.companyId,
      cmd.bankAccount,
      date,
      l.direction,
      amount,
      reference,
      counterparty,
      taxId,
      purpose,
      fingerprint,
      fileName,
      tx.clock.now(),
    );
    if (Number(inserted.changes)) count++;
    else skipped++;
  });
  tx.audit(
    cmd.companyId,
    'Yükləndi',
    'Bank çıxarışı',
    cmd.bankAccount,
    `${fileName || 'çıxarış'} · ${count} yeni sətir${skipped ? `, ${skipped} təkrar keçildi` : ''}`,
  );
  return { id: cmd.bankAccount, count, skipped };
}

/** A unique bank document number for a statement row on its bank account. */
function documentNumber(tx: Tx, companyId: string, line: Record<string, unknown>): string {
  const base = String(line.reference || '').trim() || `ÇX-${String(line.date).replaceAll('-', '')}`;
  for (let n = 1; ; n++) {
    const candidate = n === 1 && line.reference ? base : `${base}/${n}`;
    const taken = tx.db.get(
      'SELECT 1 AS x FROM payments WHERE company_id=? AND direction=? AND bank_account=? AND reference_key=?',
      companyId,
      String(line.direction),
      String(line.bank_account),
      numberKey(candidate),
    );
    if (!taken) return candidate.slice(0, 80);
  }
}

function partnerFor(
  tx: Tx,
  companyId: string,
  line: Record<string, unknown>,
  partnerId: string | undefined,
  create: boolean,
): string | undefined {
  if (partnerId) return String(tx.partner(companyId, partnerId).id);
  if (!create) return undefined;
  const taxId = parseTaxId(String(line.counterparty_tax_id ?? ''), 'Çıxarışdakı VÖEN');
  const found = tx.db.get(
    'SELECT id FROM partners WHERE company_id=? AND tax_id=?',
    companyId,
    taxId,
  );
  if (found) return String(found.id);
  const name =
    parseText(String(line.counterparty || ''), 'Kontragentin adı', 240, false) || `VÖEN ${taxId}`;
  const id = tx.id();
  tx.db.run(
    'INSERT INTO partners(id,company_id,name,tax_id) VALUES(?,?,?,?)',
    id,
    companyId,
    name,
    taxId,
  );
  tx.audit(companyId, 'Yaradıldı', 'Kontragent', id, `${name} · VÖEN ${taxId} · bank çıxarışından`);
  return id;
}

export function postStatement(tx: Tx, cmd: CommandOf<'bankStatement.post'>): CommandResult {
  tx.company(cmd.companyId);
  let count = 0;
  let allocations = 0;
  cmd.lines.forEach((input, i) => {
    const line = tx.db.get(
      'SELECT * FROM bank_statement_lines WHERE company_id=? AND id=?',
      cmd.companyId,
      input.lineId,
    );
    if (!line)
      throw new DomainError(`Sətir ${i + 1}: çıxarış sətri tapılmadı.`, `lines.${i}`, 'not-found');
    if (line.status !== 'new')
      throw new DomainError(
        `Sətir ${i + 1}: bu çıxarış sətri artıq ${line.status === 'posted' ? 'keçirilib' : 'kənarlaşdırılıb'}.`,
        `lines.${i}`,
        'conflict',
      );
    try {
      const partnerId = partnerFor(tx, cmd.companyId, line, input.partnerId, input.createPartner);
      const result = savePayment(tx, {
        type: 'payment.save',
        key: 'statement-line',
        companyId: cmd.companyId,
        direction: line.direction as 'in' | 'out',
        kind: input.kind,
        bankAccount: String(line.bank_account),
        reference: documentNumber(tx, cmd.companyId, line),
        date: String(line.date),
        ...(partnerId ? { partnerId } : {}),
        ...(input.counterAccount ? { counterAccount: input.counterAccount } : {}),
        ...(input.expenseItemId ? { expenseItemId: input.expenseItemId } : {}),
        amount: formatMinor(line.amount as bigint),
        note: [line.purpose, line.counterparty && !partnerId ? String(line.counterparty) : '']
          .filter(Boolean)
          .join(' · ')
          .slice(0, 500),
        allocations: [],
      });
      if (input.kind === 'settlement' && input.autoAllocate)
        allocations += autoAllocate(tx, cmd.companyId, result.id);
      tx.db.run(
        "UPDATE bank_statement_lines SET status='posted',payment_id=? WHERE id=?",
        result.id,
        input.lineId,
      );
      count++;
    } catch (e) {
      if (e instanceof DomainError)
        throw new DomainError(
          `Çıxarış sətri ${String(line.date)} · ${formatMinor(line.amount as bigint)}: ${e.message}`,
          `lines.${i}`,
          e.code,
        );
      throw e;
    }
  });
  return { id: cmd.companyId, count, skipped: allocations };
}

export function ignoreStatement(tx: Tx, cmd: CommandOf<'bankStatement.ignore'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = parseText(cmd.reason, 'Səbəb');
  let count = 0;
  for (const id of cmd.lineIds) {
    const r = tx.db.run(
      "UPDATE bank_statement_lines SET status='ignored',reason=? WHERE company_id=? AND id=? AND status='new'",
      reason,
      cmd.companyId,
      id,
    );
    count += Number(r.changes);
  }
  if (count)
    tx.audit(
      cmd.companyId,
      'Kənarlaşdırıldı',
      'Bank çıxarışı',
      cmd.companyId,
      `${count} sətir · ${reason}`,
    );
  return { id: cmd.companyId, count };
}

export function classifyContext(db: Db, companyId: string): ClassifyContext {
  const company = db.get('SELECT tax_id FROM companies WHERE id=?', companyId);
  const partners = db.all('SELECT id,name,tax_id FROM partners WHERE company_id=?', companyId);
  const fee = db.get(
    "SELECT id FROM expense_items WHERE company_id=? AND name='Bank xidmətləri' AND archived=0",
    companyId,
  );
  return {
    companyTaxId: String(company?.tax_id ?? ''),
    partnersByTaxId: new Map(
      partners.map((p) => [String(p.tax_id), { id: String(p.id), name: String(p.name) }]),
    ),
    partnersByName: new Map(
      partners.map((p) => [
        searchKey(String(p.name).trim()),
        { id: String(p.id), name: String(p.name) },
      ]),
    ),
    ...(fee ? { bankFeeItemId: String(fee.id) } : {}),
  };
}

export function statementLines(
  db: Db,
  companyId: string,
  filter: {
    bankAccount?: string | undefined;
    status?: 'new' | 'posted' | 'ignored' | 'all' | undefined;
  },
): StatementLineView[] {
  const ctx = classifyContext(db, companyId);
  const where: string[] = ['s.company_id=?'];
  const args: string[] = [companyId];
  if (filter.bankAccount) {
    where.push('s.bank_account=?');
    args.push(filter.bankAccount);
  }
  if (filter.status && filter.status !== 'all') {
    where.push('s.status=?');
    args.push(filter.status);
  }
  return db
    .all(
      `SELECT s.*, p.reference AS payment_reference, p.kind AS payment_kind FROM bank_statement_lines s
       LEFT JOIN payments p ON p.id=s.payment_id
       WHERE ${where.join(' AND ')} ORDER BY s.date, s.rowid`,
      ...args,
    )
    .map((r) => {
      const line = {
        direction: r.direction as 'in' | 'out',
        counterparty: String(r.counterparty),
        counterpartyTaxId: String(r.counterparty_tax_id),
        purpose: String(r.purpose),
      };
      const suggestion: StatementSuggestion | null =
        r.status === 'new' ? classifyStatementLine(line, ctx) : null;
      return {
        id: String(r.id),
        bankAccount: String(r.bank_account),
        date: String(r.date),
        direction: line.direction,
        amount: formatMinor(r.amount as bigint),
        reference: String(r.reference),
        counterparty: line.counterparty,
        counterpartyTaxId: line.counterpartyTaxId,
        purpose: line.purpose,
        sourceFile: String(r.source_file),
        status: r.status as StatementLineView['status'],
        reason: String(r.reason),
        paymentId: r.payment_id ? String(r.payment_id) : null,
        paymentReference: r.payment_reference ? String(r.payment_reference) : null,
        suggestion,
      };
    });
}
