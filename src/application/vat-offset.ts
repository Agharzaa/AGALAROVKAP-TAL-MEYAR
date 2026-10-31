/**
 * The month's purchase VAT offset document (ƏƏ-2026-10; QERARLAR 2026-10-30). "Doldur" fills it
 * with the VAT the closing's rule offsets — purchase invoices whose e-qaimə DVX confirmed and
 * whose VAT was paid through the deposit by the month's end, less what was offset before, and
 * what is taken back (minus) when the payment went down or DVX no longer confirms the e-qaimə.
 * The accountant adds, deletes and changes lines (an invoice and an amount). One posted document
 * per company and month, dated the month's last day: Dt 521.01 ("Vergi (haqq)") / Kt 241 by the
 * invoice's rate keys; saved again — storno of the previous postings and the new ones.
 *
 * The month closing's VAT step uses the posted document as it is; when there is none, the closing
 * fills and posts it (as with the revaluation, it stays when the closing is cancelled).
 */
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type { VatOffsetLineView, VatOffsetView } from '../contracts/queries.js';
import type { Chart } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney, type Minor } from '../domain/money.js';
import { checkPostings, storno, type Posting } from '../domain/posting.js';
import { monthEnd } from '../domain/rates.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import { vatStep, type VatInvoice } from './closing.js';
import { checkMonth } from './revaluation.js';
import { expectVersion, loadChart, rowToPosting, type Tx } from './tx.js';

export const VAT_OFFSET = 'vatOffset';
const MAX_LINES = 2000;

const money = (m: Minor) => formatMinor(m);
export const vatOffsetNumber = (month: string) => `ƏƏ-${month}`;

/**
 * A stored line: the invoice and the amount offset (minus — taken back); auto — what "Doldur"
 * gave (false — set by hand: the rule never takes it back by itself).
 */
export interface VatOffsetLine {
  invoiceId: string;
  amount: Minor;
  auto?: boolean;
}

export const postedVatOffset = (db: Db, companyId: string, month: string) =>
  db.get(
    "SELECT * FROM vat_offsets WHERE company_id=? AND month=? AND status='posted'",
    companyId,
    month,
  );

/**
 * A posted ƏƏ- document of a later month (audit D1): "Doldur" and the room of a line see only
 * offsets up to their own month, so an earlier month's offset after it would offset its VAT again.
 */
export const laterVatOffset = (db: Db, companyId: string, month: string) =>
  db.get(
    "SELECT number FROM vat_offsets WHERE company_id=? AND month>? AND status='posted' ORDER BY month LIMIT 1",
    companyId,
    month,
  );

const storedLines = (row: Row): VatOffsetLine[] =>
  (JSON.parse(String(row.lines)) as { invoiceId: string; amount: string; auto?: boolean }[]).map(
    (l) => ({ invoiceId: l.invoiceId, amount: signedMoney(l.amount), auto: l.auto !== false }),
  );

/** A money amount that may be negative ("-300.00": taken back). */
function signedMoney(value: string, field = 'Məbləğ'): Minor {
  const text = value.trim();
  return text.startsWith('-') ? -parseMoney(text.slice(1), field) : parseMoney(text, field);
}

/** The postings of a document version (one or more entries of 2000 lines). */
export function vatOffsetPostings(db: Db, companyId: string, id: string, version: number) {
  return db
    .all(
      `SELECT p.* FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE e.company_id=? AND e.source_type=? AND e.source_id=? AND e.source_version=? AND e.storno=0
       ORDER BY e.rowid, p.line_no`,
      companyId,
      VAT_OFFSET,
      id,
      version,
    )
    .map(rowToPosting);
}

function vatTaxItem(db: Db, companyId: string): string {
  const r = db.get(
    "SELECT id FROM items WHERE company_id=? AND role='vatTax' AND archived=0",
    companyId,
  );
  if (!r)
    throw new DomainError(
      'Standart "Vergi (haqq)" ödəniş növü təyin edilməyib. Siyahılar bölməsində elementi açıb "Yazılış qaydalarında" sahəsini seçin.',
      undefined,
      'not-found',
    );
  return String(r.id);
}

/**
 * An invoice's 241 keys (by rate) at the month's end, without the document `exclude`: what is
 * left on 241 and what was offset so far — the room for a line of plus or minus.
 */
function invoiceKeys(db: Db, companyId: string, month: string, invoiceId: string, exclude: string) {
  const document = `invoice:${invoiceId}`;
  const keys = new Map<string, { partner: string; open: bigint; offset: bigint }>();
  const key = (rate: string, partner = '') => {
    let k = keys.get(rate);
    if (!k) keys.set(rate, (k = { partner, open: 0n, offset: 0n }));
    if (partner && !k.partner) k.partner = partner;
    return k;
  };
  for (const r of db.all(
    `SELECT s1, s3, SUM(debit-credit) AS b FROM registers
     WHERE company_id=? AND account='241' AND s2=? AND month<=? GROUP BY s1, s3 ORDER BY s3`,
    companyId,
    document,
    month,
  ))
    key(String(r.s3), String(r.s1)).open += r.b as bigint;
  for (const r of db.all(
    `SELECT p.kt_s1 AS s1, p.kt_s3 AS r, SUM(p.amount) AS a FROM postings p JOIN entries e ON e.id=p.entry_id
     WHERE p.company_id=? AND p.dt_account='521.01' AND p.kt_account='241' AND p.kt_s2=? AND p.date<=?
       AND NOT (e.source_type=? AND e.source_id=?) GROUP BY p.kt_s1, p.kt_s3`,
    companyId,
    document,
    monthEnd(month),
    VAT_OFFSET,
    exclude,
  ))
    key(String(r.r), String(r.s1)).offset += r.a as bigint;
  for (const r of db.all(
    `SELECT dt_s3 AS r, SUM(amount) AS a FROM postings
     WHERE company_id=? AND dt_account='241' AND kt_account='521.01' AND dt_s2=? AND date<=? GROUP BY dt_s3`,
    companyId,
    document,
    monthEnd(month),
  ))
    key(String(r.r)).offset -= r.a as bigint;
  // The document's own postings come back to 241 (it is being saved again).
  if (exclude)
    for (const r of db.all(
      `SELECT p.kt_s3 AS r, SUM(p.amount) AS a FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE p.company_id=? AND e.source_type=? AND e.source_id=? AND p.kt_account='241' AND p.kt_s2=?
       GROUP BY p.kt_s3`,
      companyId,
      VAT_OFFSET,
      exclude,
      document,
    ))
      key(String(r.r)).open += r.a as bigint;
  return [...keys].map(([rate, k]) => ({ rate, ...k }));
}

/** The lines as postings, checked against what each invoice has on 241 and offset so far. */
function linePostings(
  db: Db,
  companyId: string,
  month: string,
  lines: readonly VatOffsetLine[],
  exclude: string,
): Posting[] {
  const out: Posting[] = [];
  let vatTax = '';
  lines.forEach((line, i) => {
    const field = `lines.${i}`;
    const inv = db.get(
      `SELECT i.number, i.status FROM invoices i WHERE i.company_id=? AND i.id=? AND i.direction='purchase'`,
      companyId,
      line.invoiceId,
    );
    if (!inv) throw new DomainError(`Sətir ${i + 1}: alış qaiməsi tapılmadı.`, field, 'not-found');
    const what = `Sətir ${i + 1} (${String(inv.number)})`;
    if (line.amount === 0n)
      throw new DomainError(`${what}: məbləğ sıfır ola bilməz.`, `${field}.amount`);
    const keys = invoiceKeys(db, companyId, month, line.invoiceId, exclude);
    const plus = line.amount > 0n;
    if (plus && inv.status !== 'posted')
      throw new DomainError(`${what}: qaimə ləğv edilib — ƏDV-si əvəzləşdirilmir.`, field);
    const room = keys.reduce((s, k) => s + (plus ? k.open : k.offset > 0n ? k.offset : 0n), 0n);
    const want = plus ? line.amount : -line.amount;
    if (want > room)
      throw new DomainError(
        plus
          ? `${what}: 241-də bu qaimənin əvəzləşdirilməmiş ƏDV-si ${money(room)} AZN-dir, ${money(want)} əvəzləşdirilə bilməz.`
          : `${what}: bu qaimə üzrə əvvəl əvəzləşdirilmiş ƏDV ${money(room)} AZN-dir, ${money(want)} geri alına bilməz.`,
        `${field}.amount`,
      );
    vatTax ||= vatTaxItem(db, companyId);
    let left = want;
    for (const k of keys) {
      const can = plus ? k.open : k.offset;
      if (can <= 0n || left <= 0n) continue;
      const amount = can < left ? can : left;
      left -= amount;
      out.push({
        dt: { account: '521.01', sk: [vatTax] },
        kt: { account: '241', sk: [k.partner, `invoice:${line.invoiceId}`, k.rate] },
        amount: plus ? amount : -amount,
        memo: `${plus ? 'ƏDV əvəzləşdirilməsi' : 'ƏDV əvəzləşdirilməsinin geri alınması'} · ${String(inv.number)}`,
      });
    }
  });
  return out;
}

function parseLines(input: readonly { invoiceId: string; amount: string }[]): VatOffsetLine[] {
  if (input.length > MAX_LINES)
    throw new DomainError(`Sənəddə ən çox ${MAX_LINES} sətir ola bilər.`, 'lines');
  const seen = new Set<string>();
  return input.map((l, i) => {
    if (seen.has(l.invoiceId))
      throw new DomainError(`Sətir ${i + 1}: bu qaimə sənəddə artıq var.`, `lines.${i}`);
    seen.add(l.invoiceId);
    return {
      invoiceId: l.invoiceId,
      amount: signedMoney(l.amount, `Sətir ${i + 1}: məbləğ`),
    };
  });
}

/** Writes the month's document: the previous postings stornoed, the lines posted. */
export function writeVatOffset(
  tx: Tx,
  companyId: string,
  month: string,
  existing: Row | undefined,
  lines: readonly VatOffsetLine[],
  how: string,
): CommandResult {
  const date = monthEnd(month);
  const chart: Chart = tx.chart(companyId);
  const id = existing ? String(existing.id) : tx.id();
  const postings = linePostings(tx.db, companyId, month, lines, id);
  const version = existing ? Number(existing.version) + 1 : 1;
  const number = vatOffsetNumber(month);
  const now = tx.clock.now();
  if (existing) {
    const prev = vatOffsetPostings(tx.db, companyId, id, Number(existing.version));
    for (let i = 0; i < prev.length; i += 2000)
      tx.post(
        companyId,
        chart,
        { type: VAT_OFFSET, id, number, version: Number(existing.version) },
        date,
        true,
        storno(prev.slice(i, i + 2000)),
      );
  }
  const total = lines.reduce((s, l) => s + l.amount, 0n);
  const stored = JSON.stringify(
    lines.map((l) => ({ invoiceId: l.invoiceId, amount: money(l.amount), auto: l.auto !== false })),
  );
  if (existing)
    tx.db.run(
      "UPDATE vat_offsets SET lines=?,total=?,status='posted',version=?,updated_at=? WHERE id=?",
      stored,
      total,
      version,
      now,
      id,
    );
  else
    tx.db.run(
      `INSERT INTO vat_offsets(id,company_id,month,date,number,lines,total,status,version,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,'posted',?,?,?)`,
      id,
      companyId,
      month,
      date,
      number,
      stored,
      total,
      version,
      now,
      now,
    );
  for (let i = 0; i < postings.length; i += 2000) {
    const entry = postings.slice(i, i + 2000);
    checkPostings(chart, entry, 'lines');
    tx.post(companyId, chart, { type: VAT_OFFSET, id, number, version }, date, false, entry);
  }
  tx.history(companyId, VAT_OFFSET, id, version, 'posted', { month, lines: JSON.parse(stored) });
  tx.audit(
    companyId,
    existing ? 'Düzəliş edildi (storno + yeni yazılış)' : 'Uçota alındı',
    'ƏDV əvəzləşdirilməsi',
    id,
    `${number} · ${lines.length} qaimə · ${money(total)} AZN${how ? ` · ${how}` : ''}`,
  );
  return { id, version, number };
}

export function saveVatOffset(tx: Tx, cmd: CommandOf<'vatOffset.save'>): CommandResult {
  tx.company(cmd.companyId);
  const month = checkMonth(cmd.month);
  tx.open(cmd.companyId, monthEnd(month), 'month');
  const existing = postedVatOffset(tx.db, cmd.companyId, month);
  if (existing && cmd.version === undefined)
    throw new DomainError(
      `${vatOffsetNumber(month)} artıq uçotdadır: sənədi açıb dəyişin.`,
      'month',
      'conflict',
    );
  if (existing) expectVersion(existing, cmd.version!, 'ƏDV əvəzləşdirilməsi');
  const later = laterVatOffset(tx.db, cmd.companyId, month);
  if (later)
    throw new DomainError(
      `${String(later.number)} artıq uçotdadır: ${vatOffsetNumber(month)} ondan sonra dəyişdirilmir — eyni ƏDV iki dəfə əvəzləşə bilər. Əvvəlcə ${String(later.number)}-i ləğv edin, sonra hər ikisini ardıcıl doldurun.`,
      'month',
      'conflict',
    );
  // A line is "Doldur"'s when it has the amount Doldur gives now; otherwise it is the accountant's.
  const filled = new Map(
    fillVatOffset(tx.db, cmd.companyId, month, existing ? String(existing.id) : '').lines.map(
      (l) => [l.invoiceId, l.amount],
    ),
  );
  const lines = parseLines(cmd.lines).map((l) => ({
    ...l,
    auto: filled.get(l.invoiceId) === l.amount,
  }));
  const manual = lines.filter((l) => !l.auto).length;
  return writeVatOffset(
    tx,
    cmd.companyId,
    month,
    existing,
    lines,
    manual ? `${manual} sətir əl ilə` : 'Doldur ilə',
  );
}

export function cancelVatOffset(tx: Tx, cmd: CommandOf<'vatOffset.cancel'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = cmd.reason.trim();
  if (!reason) throw new DomainError('Ləğv səbəbini yazın.', 'reason');
  const row = tx.db.get(
    'SELECT * FROM vat_offsets WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('ƏDV əvəzləşdirilməsi tapılmadı.', 'id', 'not-found');
  expectVersion(row, cmd.version, 'ƏDV əvəzləşdirilməsi');
  if (row.status !== 'posted')
    throw new DomainError('Sənəd artıq ləğv edilib.', undefined, 'conflict');
  tx.open(cmd.companyId, String(row.date));
  const prev = vatOffsetPostings(tx.db, cmd.companyId, cmd.id, Number(row.version));
  const chart = tx.chart(cmd.companyId);
  const source = {
    type: VAT_OFFSET,
    id: cmd.id,
    number: String(row.number),
    version: Number(row.version),
  };
  for (let i = 0; i < prev.length; i += 2000)
    tx.post(cmd.companyId, chart, source, String(row.date), true, storno(prev.slice(i, i + 2000)));
  const version = Number(row.version) + 1;
  tx.db.run(
    "UPDATE vat_offsets SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  tx.history(cmd.companyId, VAT_OFFSET, cmd.id, version, 'cancelled', { reason });
  tx.audit(
    cmd.companyId,
    'Ləğv edildi (storno)',
    'ƏDV əvəzləşdirilməsi',
    cmd.id,
    `${String(row.number)} · ${reason}`,
  );
  return { id: cmd.id, version };
}

/** "Doldur" for the month: the closing's rule, the posted document's own postings left out. */
export function fillVatOffset(db: Db, companyId: string, month: string, exclude = '') {
  const step = vatStep(db, companyId, loadChart(db, companyId), month, exclude);
  return {
    ...step,
    lines: step.invoices
      .filter((i) => i.amount !== 0n)
      .map((i): VatOffsetLine => ({ invoiceId: i.invoiceId, amount: i.amount })),
  };
}

export function vatOffsetView(db: Db, companyId: string, monthInput: string): VatOffsetView {
  const month = checkMonth(monthInput);
  const row = postedVatOffset(db, companyId, month);
  const closed =
    monthEnd(month) <=
    String(db.get('SELECT closed_through FROM companies WHERE id=?', companyId)!.closed_through);
  let error = '';
  let fill: ReturnType<typeof fillVatOffset> | undefined;
  try {
    fill = fillVatOffset(db, companyId, month, row ? String(row.id) : '');
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    error = e.message;
  }
  const posted = row ? storedLines(row) : [];
  const facts = new Map<string, VatInvoice>((fill?.invoices ?? []).map((i) => [i.invoiceId, i]));
  const ids = [...new Set([...posted.map((l) => l.invoiceId), ...facts.keys()])];
  const info = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of db.all(
      `SELECT i.id, i.number, i.date, i.vat, i.eq_series, i.eq_number, p.name, p.tax_id
       FROM invoices i JOIN partners p ON p.company_id=i.company_id AND p.id=i.partner_id
       WHERE i.company_id=? AND i.id IN (${chunk.map(() => '?').join(',')})`,
      companyId,
      ...chunk,
    ))
      info.set(String(r.id), r);
  }
  const lineView = (invoiceId: string, amount: Minor): VatOffsetLineView => {
    const r = info.get(invoiceId);
    const f = facts.get(invoiceId);
    return {
      invoiceId,
      number: r ? String(r.number) : '',
      date: r ? String(r.date) : '',
      partner: r ? String(r.name) : '',
      taxId: r ? String(r.tax_id) : '',
      eq: r ? `${String(r.eq_series)}${String(r.eq_number)}` : '',
      invoiceVat: money(f?.invoiceVat ?? (r?.vat as bigint | undefined) ?? 0n),
      open: money(f?.open ?? 0n),
      offset: money(f?.offset ?? 0n),
      paid: money(f?.paid ?? 0n),
      confirmed: f ? f.dvxVat !== null : false,
      proposal: money(f?.amount ?? 0n),
      amount: money(amount),
    };
  };
  const byDate = (a: VatOffsetLineView, b: VatOffsetLineView) =>
    a.date.localeCompare(b.date) || a.number.localeCompare(b.number);
  const proposal = (fill?.lines ?? []).map((l) => lineView(l.invoiceId, l.amount)).sort(byDate);
  const same = !!row && sameVatLines(posted, fill?.lines ?? []);
  return {
    month,
    date: monthEnd(month),
    number: vatOffsetNumber(month),
    closed,
    error,
    notes: fill?.notes ?? [],
    waiting: (fill?.waiting ?? []).map((w) => w.text),
    proposal,
    proposalTotal: money((fill?.lines ?? []).reduce((s, l) => s + l.amount, 0n)),
    candidates: [...facts.values()].map((f) => lineView(f.invoiceId, f.amount)).sort(byDate),
    posted: row
      ? {
          id: String(row.id),
          version: Number(row.version),
          number: String(row.number),
          total: money(row.total as Minor),
          lines: posted.map((l) => lineView(l.invoiceId, l.amount)),
          differs: !same,
          updatedAt: String(row.updated_at),
        }
      : null,
  };
}

/** The same lines, whatever their order. */
export function sameVatLines(a: readonly VatOffsetLine[], b: readonly VatOffsetLine[]) {
  const key = (l: readonly VatOffsetLine[]) =>
    JSON.stringify(
      [...l]
        .sort((x, y) => x.invoiceId.localeCompare(y.invoiceId))
        .map((x) => [x.invoiceId, String(x.amount)]),
    );
  return key(a) === key(b);
}

export { storedLines as vatOffsetLines };
