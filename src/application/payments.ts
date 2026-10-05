/**
 * Bank payments and their settlement against invoices.
 *
 * Policy (stage A): a payment always posts its full amount to the partner's settlement account
 * (Dt bank / Kt 211 for customers, Dt 531 / Kt bank for suppliers). Linking a payment to
 * invoices ("allocation") is settlement analytics only — it never changes journal entries.
 * Whatever is not linked is the partner's advance on the same account and can be linked later.
 */
import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney, sumMinor, type Minor } from '../domain/money.js';
import { postPayment, reverse } from '../domain/posting.js';
import { numberKey, parseDate, parseText } from '../domain/values.js';
import type { AllocationInput, CommandOf, CommandResult } from '../contracts/commands.js';
import type { Row } from '../infrastructure/sqlite/db.js';
import { expectVersion, type Tx } from './tx.js';

interface Link {
  invoiceId: string;
  amount: Minor;
}

function parseLinks(input: readonly AllocationInput[], field: string): Link[] {
  const seen = new Set<string>();
  return input.map((a, i) => {
    if (seen.has(a.invoiceId))
      throw new DomainError(
        'Eyni qaimə bölgüdə iki dəfə seçilib; məbləği bir sətirdə yazın.',
        `${field}.${i}.invoiceId`,
      );
    seen.add(a.invoiceId);
    const amount = parseMoney(a.amount, `Bölgü sətri ${i + 1}`);
    if (amount <= 0n)
      throw new DomainError(
        `Bölgü sətri ${i + 1}: məbləğ sıfırdan böyük olmalıdır.`,
        `${field}.${i}.amount`,
      );
    return { invoiceId: a.invoiceId, amount };
  });
}

const allocated = (tx: Tx, column: 'payment_id' | 'invoice_id', id: string): Minor =>
  tx.db.get(
    `SELECT COALESCE(SUM(amount),0) AS s FROM allocations WHERE ${column}=? AND status='active'`,
    id,
  )!.s as bigint;

/** Inserts links after explaining every rule the database guard also enforces. */
function link(tx: Tx, companyId: string, payment: Row, links: readonly Link[], date: string) {
  tx.open(companyId, date);
  if (date < String(payment.date))
    throw new DomainError('Bağlama tarixi ödəniş tarixindən əvvəl ola bilməz.', 'date');
  const free = (payment.amount as bigint) - allocated(tx, 'payment_id', String(payment.id));
  if (sumMinor(links.map((l) => l.amount)) > free)
    throw new DomainError(
      `Bağlanan məbləğ ödənişin bağlanmamış qalığından (${formatMinor(free)}) çoxdur.`,
      'allocations',
    );
  links.forEach((l, i) => {
    const invoice = tx.db.get(
      'SELECT * FROM invoices WHERE company_id=? AND id=?',
      companyId,
      l.invoiceId,
    );
    const where = `allocations.${i}`;
    if (!invoice || invoice.status !== 'posted')
      throw new DomainError(
        `Bölgü sətri ${i + 1}: uçota alınmış qaimə tapılmadı.`,
        `${where}.invoiceId`,
        'not-found',
      );
    if (
      invoice.partner_id !== payment.partner_id ||
      invoice.direction !== (payment.direction === 'in' ? 'sale' : 'purchase')
    )
      throw new DomainError(
        `Bölgü sətri ${i + 1}: ${invoice.number} bu kontragentin ${payment.direction === 'in' ? 'satış' : 'alış'} qaiməsi deyil.`,
        `${where}.invoiceId`,
      );
    if (date < String(invoice.date))
      throw new DomainError(
        `Bölgü sətri ${i + 1}: ${invoice.number} qaiməsi ${invoice.date} tarixlidir; bağlama tarixi ondan əvvəl ola bilməz.`,
        `${where}.invoiceId`,
      );
    const remaining =
      (invoice.net as bigint) + (invoice.vat as bigint) - allocated(tx, 'invoice_id', l.invoiceId);
    if (l.amount > remaining)
      throw new DomainError(
        `Bölgü sətri ${i + 1}: ${invoice.number} qaiməsinin qalıq borcu ${formatMinor(remaining)}-dir.`,
        `${where}.amount`,
      );
    tx.db.run(
      "INSERT INTO allocations(id,company_id,payment_id,invoice_id,date,amount,status,created_at) VALUES(?,?,?,?,?,?,'active',?)",
      tx.id(),
      companyId,
      String(payment.id),
      l.invoiceId,
      date,
      l.amount,
      tx.clock.now(),
    );
    tx.audit(
      companyId,
      'Bağlandı',
      'Bank',
      String(payment.id),
      `${payment.reference} → ${invoice.number} · ${formatMinor(l.amount)} AZN`,
    );
  });
}

function releaseAll(tx: Tx, paymentId: string, reason: string) {
  tx.db.run(
    "UPDATE allocations SET status='cancelled',reason=? WHERE payment_id=? AND status='active'",
    reason,
    paymentId,
  );
}

function activeLinks(tx: Tx, paymentId: string): { invoiceId: string; amount: string }[] {
  return tx.db
    .all(
      "SELECT invoice_id,amount FROM allocations WHERE payment_id=? AND status='active' ORDER BY rowid",
      paymentId,
    )
    .map((r) => ({ invoiceId: String(r.invoice_id), amount: formatMinor(r.amount as bigint) }));
}

export function savePayment(tx: Tx, cmd: CommandOf<'payment.save'>): CommandResult {
  tx.company(cmd.companyId);
  const partner = tx.partner(cmd.companyId, cmd.partnerId);
  const date = parseDate(cmd.date);
  const reference = parseText(cmd.reference, 'Bank sənədinin nömrəsi', 80);
  const amount = parseMoney(cmd.amount);
  if (amount <= 0n) throw new DomainError('Məbləğ sıfırdan böyük olmalıdır.', 'amount');
  const note = parseText(cmd.note, 'Təyinat', 500, false);
  const links = parseLinks(cmd.allocations, 'allocations');
  const key = numberKey(reference);
  const existing = cmd.id
    ? tx.db.get('SELECT * FROM payments WHERE company_id=? AND id=?', cmd.companyId, cmd.id)
    : undefined;
  if (cmd.id && !existing) throw new DomainError('Ödəniş tapılmadı.', 'id', 'not-found');
  if (existing) {
    expectVersion(existing, cmd.version, 'Ödəniş');
    if (existing.status !== 'posted')
      throw new DomainError('Ləğv olunmuş ödəniş dəyişdirilmir.', undefined, 'conflict');
    if (existing.direction !== cmd.direction)
      throw new DomainError('Ödənişin istiqaməti dəyişdirilmir.', 'direction');
  }
  const duplicate = tx.db.get(
    'SELECT id FROM payments WHERE company_id=? AND direction=? AND bank_account=? AND reference_key=?',
    cmd.companyId,
    cmd.direction,
    cmd.bankAccount,
    key,
  );
  if (duplicate && duplicate.id !== cmd.id)
    throw new DomainError(
      'Bu bank hesabında bu nömrə ilə ödəniş artıq var.',
      'reference',
      'conflict',
    );
  const payload = {
    direction: cmd.direction,
    bankAccount: cmd.bankAccount,
    reference,
    date,
    partnerId: String(partner.id),
    amount: formatMinor(amount),
    note,
    allocations: links.map((l) => ({ invoiceId: l.invoiceId, amount: formatMinor(l.amount) })),
  };
  if (
    existing &&
    JSON.stringify({
      direction: existing.direction,
      bankAccount: existing.bank_account,
      reference: existing.reference,
      date: existing.date,
      partnerId: existing.partner_id,
      amount: formatMinor(existing.amount as bigint),
      note: existing.note,
      allocations: activeLinks(tx, String(existing.id)),
    }) === JSON.stringify(payload)
  )
    return { id: String(existing.id), version: Number(existing.version) };

  tx.open(cmd.companyId, date);
  const id = existing ? String(existing.id) : tx.id();
  const version = existing ? Number(existing.version) + 1 : 1;
  const chart = tx.chart(cmd.companyId);
  if (existing) {
    tx.open(cmd.companyId, String(existing.date));
    releaseAll(tx, id, 'Ödəniş düzəlişi');
    const original = tx.entryLines(cmd.companyId, 'payment', id, Number(existing.version));
    tx.post(
      cmd.companyId,
      {
        type: 'payment',
        id,
        number: String(existing.reference),
        version: Number(existing.version),
      },
      original.date,
      true,
      reverse(original.lines),
    );
  }
  const journal = postPayment(chart, {
    direction: cmd.direction,
    bankAccount: cmd.bankAccount,
    reference,
    partnerId: String(partner.id),
    partnerName: String(partner.name),
    amount,
    memo: note,
  });
  const now = tx.clock.now();
  if (existing)
    tx.db.run(
      'UPDATE payments SET bank_account=?,reference=?,reference_key=?,date=?,partner_id=?,amount=?,version=?,note=?,updated_at=? WHERE id=?',
      cmd.bankAccount,
      reference,
      key,
      date,
      String(partner.id),
      amount,
      version,
      note,
      now,
      id,
    );
  else
    tx.db.run(
      "INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?,'posted',?,?,?,?)",
      id,
      cmd.companyId,
      cmd.direction,
      cmd.bankAccount,
      reference,
      key,
      date,
      String(partner.id),
      amount,
      version,
      note,
      now,
      now,
    );
  tx.post(cmd.companyId, { type: 'payment', id, number: reference, version }, date, false, journal);
  if (links.length)
    link(tx, cmd.companyId, tx.db.get('SELECT * FROM payments WHERE id=?', id)!, links, date);
  tx.history(cmd.companyId, 'payment', id, version, 'posted', payload);
  tx.audit(
    cmd.companyId,
    existing ? 'Düzəliş edildi' : 'Uçota alındı',
    cmd.direction === 'in' ? 'Daxil olan ödəniş' : 'Çıxan ödəniş',
    id,
    `${reference} · ${formatMinor(amount)} AZN · ${partner.name}`,
  );
  return { id, version };
}

export function cancelPayment(tx: Tx, cmd: CommandOf<'payment.cancel'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = parseText(cmd.reason, 'Ləğv səbəbi');
  const row = tx.db.get(
    'SELECT * FROM payments WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('Ödəniş tapılmadı.', 'id', 'not-found');
  expectVersion(row, cmd.version, 'Ödəniş');
  if (row.status !== 'posted')
    throw new DomainError('Ödəniş artıq ləğv edilib.', undefined, 'conflict');
  tx.open(cmd.companyId, String(row.date));
  releaseAll(tx, cmd.id, `Ödəniş ləğv edildi: ${reason}`);
  const original = tx.entryLines(cmd.companyId, 'payment', cmd.id, Number(row.version));
  tx.post(
    cmd.companyId,
    { type: 'payment', id: cmd.id, number: String(row.reference), version: Number(row.version) },
    original.date,
    true,
    reverse(original.lines),
  );
  const version = Number(row.version) + 1;
  tx.db.run(
    "UPDATE payments SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  tx.history(cmd.companyId, 'payment', cmd.id, version, 'cancelled', { reason });
  tx.audit(
    cmd.companyId,
    'Ləğv edildi',
    row.direction === 'in' ? 'Daxil olan ödəniş' : 'Çıxan ödəniş',
    cmd.id,
    `${row.reference} · ${reason}`,
  );
  return { id: cmd.id, version };
}

export function createAllocations(tx: Tx, cmd: CommandOf<'allocation.create'>): CommandResult {
  tx.company(cmd.companyId);
  const payment = tx.db.get(
    'SELECT * FROM payments WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.paymentId,
  );
  if (!payment || payment.status !== 'posted')
    throw new DomainError('Uçota alınmış ödəniş tapılmadı.', 'paymentId', 'not-found');
  link(tx, cmd.companyId, payment, parseLinks(cmd.allocations, 'allocations'), parseDate(cmd.date));
  return { id: cmd.paymentId };
}

export function cancelAllocation(tx: Tx, cmd: CommandOf<'allocation.cancel'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = parseText(cmd.reason, 'Səbəb');
  const row = tx.db.get(
    'SELECT a.*,p.reference,i.number FROM allocations a JOIN payments p ON p.id=a.payment_id JOIN invoices i ON i.id=a.invoice_id WHERE a.company_id=? AND a.id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row || row.status !== 'active')
    throw new DomainError('Aktiv bağlantı tapılmadı.', 'id', 'not-found');
  tx.open(cmd.companyId, String(row.date));
  tx.db.run("UPDATE allocations SET status='cancelled',reason=? WHERE id=?", reason, cmd.id);
  tx.audit(
    cmd.companyId,
    'Bağlantı açıldı',
    'Bank',
    String(row.payment_id),
    `${row.reference} → ${row.number} · ${formatMinor(row.amount as bigint)} AZN · ${reason}`,
  );
  return { id: cmd.id };
}

export function closePeriod(tx: Tx, cmd: CommandOf<'period.close'>): CommandResult {
  const company = tx.company(cmd.companyId);
  const through = parseDate(cmd.through, 'Bağlanış tarixi');
  if (through <= String(company.closed_through))
    throw new DomainError('Dövr bu tarixə qədər artıq bağlıdır.', 'through', 'conflict');
  if (through >= tx.clock.today())
    throw new DomainError('Yalnız keçmiş tarixə qədər dövr bağlamaq olar.', 'through');
  const drafts = tx.db.get(
    "SELECT COUNT(*) AS n FROM invoices WHERE company_id=? AND status='draft' AND date<=?",
    cmd.companyId,
    through,
  )!.n as bigint;
  if (drafts > 0n)
    throw new DomainError(
      `Bu dövrdə ${drafts} qaralama qaimə var. Əvvəl onları uçota alın və ya ləğv edin.`,
      'through',
      'conflict',
    );
  tx.db.run('UPDATE companies SET closed_through=? WHERE id=?', through, cmd.companyId);
  tx.audit(cmd.companyId, 'Dövr bağlandı', 'Şirkət', cmd.companyId, `${through} daxil olmaqla`);
  return { id: cmd.companyId };
}
