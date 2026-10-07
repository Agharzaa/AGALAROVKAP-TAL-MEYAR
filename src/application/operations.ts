/**
 * Manual operation (1C: "Əl ilə daxil edilən əməliyyat"): Dt/Kt lines typed by the accountant.
 * Opening balances are entered the same way (against 000-type helper is not used: Dt asset /
 * Kt 301 or the matching counter account, as the accountant decides).
 *
 * Saving posts immediately. A correction stornoes the previous entry and posts the new one;
 * cancelling stornoes it. Nothing in the journal is ever changed or deleted.
 */
import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney } from '../domain/money.js';
import { checkPostings, storno, type Posting, type Side } from '../domain/posting.js';
import { formatQty, parseQty } from '../domain/quantity.js';
import { numberKey, parseDate, parseText } from '../domain/values.js';
import type { Chart, CurrencyCode } from '../domain/chart.js';
import { currencies } from '../domain/chart.js';
import type { CommandOf, CommandResult, OperationLineInput } from '../contracts/commands.js';
import { checkSideValues } from './subkonto.js';
import { expectVersion, type Tx } from './tx.js';

const SOURCE = 'operation';

function nextNumber(tx: Tx, companyId: string): string {
  const n =
    Number(tx.db.get('SELECT COUNT(*) AS n FROM operations WHERE company_id=?', companyId)!.n) + 1;
  for (let i = n; ; i++) {
    const candidate = `ƏƏ-${String(i).padStart(6, '0')}`;
    if (
      !tx.db.get(
        'SELECT 1 AS x FROM operations WHERE company_id=? AND number_key=?',
        companyId,
        numberKey(candidate),
      )
    )
      return candidate;
  }
}

/**
 * Dt/Kt lines typed by the accountant, checked like every posting. `self` is the document the
 * lines belong to ("operation:<id>", "invoice:<id>"): an empty settlement-document slot means it.
 */
export function buildPostings(
  tx: Tx,
  companyId: string,
  chart: Chart,
  self: string,
  lines: readonly OperationLineInput[],
  field = 'lines',
): Posting[] {
  const postings = lines.map((l, i): Posting => {
    const f = `${field}.${i}`;
    const amount = parseMoney(l.amount, `Sətir ${i + 1}: məbləğ`);
    if (amount === 0n)
      throw new DomainError(`Sətir ${i + 1}: məbləğ sıfır ola bilməz.`, `${f}.amount`);
    const side = (which: 'dt' | 'kt'): Side => {
      const code = which === 'dt' ? l.dtAccount : l.ktAccount;
      const account = chart.require(code.trim(), `${f}.${which}.account`);
      // An empty settlement-document slot means "this document" (as in 1C).
      const sk = account.subkonto.map((kind, j) => {
        const v = ((which === 'dt' ? l.dtSk : l.ktSk)[j] ?? '').trim();
        return kind === 'document' && !v ? self : v;
      });
      const checked = checkSideValues(tx.db, companyId, account, sk, `${f}.${which}.sk`, self);
      const raw = which === 'dt' ? l.dtCurAmount : l.ktCurAmount;
      if (!account.currency) {
        if (raw && raw.trim())
          throw new DomainError(
            `Sətir ${i + 1}: ${account.code} valyuta hesabı deyil.`,
            `${f}.${which}.curAmount`,
          );
        return { account: account.code, sk };
      }
      const explicit = l.currency?.trim().toUpperCase();
      const currency = (checked.currency ?? explicit) as CurrencyCode | undefined;
      if (!currency || !(currencies as readonly string[]).includes(currency))
        throw new DomainError(
          `Sətir ${i + 1}: ${account.code} üçün valyutanı seçin.`,
          `${f}.currency`,
        );
      if (checked.currency && explicit && explicit !== checked.currency)
        throw new DomainError(
          `Sətir ${i + 1}: valyuta bank hesabına/müqaviləyə uyğun deyil.`,
          `${f}.currency`,
        );
      return {
        account: account.code,
        sk,
        currency,
        ...(raw?.trim() ? { curAmount: parseMoney(raw, `Sətir ${i + 1}: valyuta məbləği`) } : {}),
      };
    };
    const dt = side('dt');
    const kt = side('kt');
    const needsQty = chart.get(dt.account)!.quantitative || chart.get(kt.account)!.quantitative;
    const q = l.quantity?.trim();
    return {
      dt,
      kt,
      amount,
      ...(needsQty || q ? { quantity: parseQty(q ?? '', `Sətir ${i + 1}: miqdar`) } : {}),
      memo: parseText(l.memo, 'Məzmun', 300, false),
    };
  });
  checkPostings(chart, postings, field);
  return postings;
}

export const describe = (p: readonly Posting[]) =>
  p.map((x) => ({
    dt: x.dt.account,
    dtSk: x.dt.sk,
    kt: x.kt.account,
    ktSk: x.kt.sk,
    amount: formatMinor(x.amount),
    ...(x.quantity !== undefined ? { quantity: formatQty(x.quantity) } : {}),
    ...(x.dt.curAmount !== undefined
      ? { dtCur: `${formatMinor(x.dt.curAmount)} ${x.dt.currency}` }
      : {}),
    ...(x.kt.curAmount !== undefined
      ? { ktCur: `${formatMinor(x.kt.curAmount)} ${x.kt.currency}` }
      : {}),
    memo: x.memo,
  }));

export function saveOperation(tx: Tx, cmd: CommandOf<'operation.save'>): CommandResult {
  tx.company(cmd.companyId);
  const date = parseDate(cmd.date);
  const memo = parseText(cmd.memo, 'Məzmun', 500, false);
  const existing = cmd.id
    ? tx.db.get('SELECT * FROM operations WHERE company_id=? AND id=?', cmd.companyId, cmd.id)
    : undefined;
  if (cmd.id && !existing) throw new DomainError('Sənəd tapılmadı.', 'id', 'not-found');
  if (existing) {
    expectVersion(existing, cmd.version, 'Əməliyyat');
    if (existing.status !== 'posted')
      throw new DomainError('Ləğv edilmiş sənəd dəyişdirilmir.', undefined, 'conflict');
  }
  const number =
    parseText(cmd.number, 'Nömrə', 40, false) ||
    (existing ? String(existing.number) : nextNumber(tx, cmd.companyId));
  const key = numberKey(number);
  const same = tx.db.get(
    'SELECT id FROM operations WHERE company_id=? AND number_key=?',
    cmd.companyId,
    key,
  );
  if (same && same.id !== cmd.id)
    throw new DomainError('Bu nömrə ilə sənəd artıq var.', 'number', 'conflict');
  const id = existing ? String(existing.id) : tx.id();
  const chart = tx.chart(cmd.companyId);
  const postings = buildPostings(tx, cmd.companyId, chart, `${SOURCE}:${id}`, cmd.lines);
  const payload = { number, date, memo, lines: describe(postings) };

  if (existing) {
    const before = tx.entryPostings(cmd.companyId, SOURCE, id, Number(existing.version));
    const unchanged =
      JSON.stringify({
        number: existing.number,
        date: existing.date,
        memo: existing.memo,
        lines: describe(before.postings),
      }) === JSON.stringify(payload);
    if (unchanged) return { id, version: Number(existing.version), number };
    tx.open(cmd.companyId, before.date);
  }
  tx.open(cmd.companyId, date);
  const version = existing ? Number(existing.version) + 1 : 1;
  const now = tx.clock.now();
  if (existing) {
    const before = tx.entryPostings(cmd.companyId, SOURCE, id, Number(existing.version));
    tx.post(
      cmd.companyId,
      chart,
      { type: SOURCE, id, number: String(existing.number), version: Number(existing.version) },
      before.date,
      true,
      storno(before.postings),
    );
    tx.db.run(
      'UPDATE operations SET number=?,number_key=?,date=?,memo=?,version=?,updated_at=? WHERE id=?',
      number,
      key,
      date,
      memo,
      version,
      now,
      id,
    );
  } else
    tx.db.run(
      "INSERT INTO operations VALUES(?,?,?,?,?,?,'posted',?,?,?)",
      id,
      cmd.companyId,
      number,
      key,
      date,
      memo,
      version,
      now,
      now,
    );
  tx.post(cmd.companyId, chart, { type: SOURCE, id, number, version }, date, false, postings);
  tx.history(cmd.companyId, SOURCE, id, version, 'posted', payload);
  const total = postings.reduce((s, p) => s + p.amount, 0n);
  tx.audit(
    cmd.companyId,
    existing ? 'Düzəliş edildi (storno + yeni yazılış)' : 'Uçota alındı',
    'Əl ilə əməliyyat',
    id,
    `${number} · ${date} · ${postings.length} yazılış · ${formatMinor(total)} AZN`,
  );
  return { id, version, number };
}

export function cancelOperation(tx: Tx, cmd: CommandOf<'operation.cancel'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = parseText(cmd.reason, 'Ləğv səbəbi');
  const row = tx.db.get(
    'SELECT * FROM operations WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('Sənəd tapılmadı.', 'id', 'not-found');
  expectVersion(row, cmd.version, 'Əməliyyat');
  if (row.status !== 'posted')
    throw new DomainError('Sənəd artıq ləğv edilib.', undefined, 'conflict');
  const before = tx.entryPostings(cmd.companyId, SOURCE, cmd.id, Number(row.version));
  tx.open(cmd.companyId, before.date);
  tx.post(
    cmd.companyId,
    tx.chart(cmd.companyId),
    { type: SOURCE, id: cmd.id, number: String(row.number), version: Number(row.version) },
    before.date,
    true,
    storno(before.postings),
  );
  const version = Number(row.version) + 1;
  tx.db.run(
    "UPDATE operations SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  tx.history(cmd.companyId, SOURCE, cmd.id, version, 'cancelled', { reason });
  tx.audit(
    cmd.companyId,
    'Ləğv edildi (storno)',
    'Əl ilə əməliyyat',
    cmd.id,
    `${row.number} · ${reason}`,
  );
  return { id: cmd.id, version };
}
