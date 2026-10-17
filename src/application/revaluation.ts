/**
 * Revaluation of currency balances on the month's last day (stage 5b; docs/MERHELE-5-AY-BAGLANISI
 * .md §4.2, QERARLAR 2026-10-17 §5). For every currency account and subkonto key:
 *
 *   new AZN balance = currency balance × AMB rate of the month's last day
 *   difference      = new AZN balance − AZN balance in the books
 *
 * A positive difference raises the balance (Dt account / Kt 611 "Məzənnə fərqi"), a negative one
 * lowers it (Dt 731 "Məzənnə fərqi" / Kt account) — on active and passive accounts alike, since
 * the balance is read signed (debit − credit). The currency amount does not move (it is 0 in
 * these postings). A key with no currency left but AZN left over is closed to zero the same way.
 *
 * One posted revaluation per company and month; posting again stornoes the previous one first,
 * cancelling stornoes it. The month closing (5c) takes it as one of its steps.
 */
import type { Account, Chart } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { toAzn } from '../domain/invoice.js';
import { formatMinor, type Minor } from '../domain/money.js';
import { checkPostings, storno, type Posting } from '../domain/posting.js';
import { formatPrice } from '../domain/quantity.js';
import { monthEnd } from '../domain/rates.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type { RevaluationLine, RevaluationView } from '../contracts/queries.js';
import type { Db } from '../infrastructure/sqlite/db.js';
import { catalogRate } from './rates.js';
import { loadChart, rowToPosting, expectVersion, type Tx } from './tx.js';

export const REVALUATION = 'revaluation';

const dmy = (iso: string) => iso.split('-').reverse().join('.');
const money = (m: Minor) => formatMinor(m);
const keyOf = (account: string, sk: readonly string[]) =>
  [account, sk[0] ?? '', sk[1] ?? '', sk[2] ?? ''].join('|');

interface Key {
  account: Account;
  sk: string[];
  currency: string;
  amount: Minor;
  cur: Minor;
}

export function checkMonth(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new DomainError('Ay düzgün deyil (İİİİ-AA).', 'month');
  return month;
}

/** Currency balances at the end of the month, per key, without the excluded revaluation. */
function balances(db: Db, companyId: string, chart: Chart, month: string, exclude?: string): Key[] {
  const end = monthEnd(month);
  const out = new Map<string, Key>();
  const mixed: string[] = [];
  const accounts = chart.all().filter((a) => a.currency && chart.postable(a.code));
  for (const account of accounts) {
    const regs = db.all(
      `SELECT s1,s2,s3,SUM(debit-credit) AS a,SUM(cur_dt-cur_kt) AS c FROM registers
       WHERE company_id=? AND account=? AND month<=? GROUP BY s1,s2,s3`,
      companyId,
      account.code,
      month,
    );
    if (!regs.length) continue;
    const currencies = new Map<string, Set<string>>();
    for (const side of ['dt', 'kt'] as const)
      for (const r of db.all(
        `SELECT ${side}_s1 AS s1, ${side}_s2 AS s2, ${side}_s3 AS s3, ${side}_currency AS c FROM postings
         WHERE company_id=? AND ${side}_account=? AND date<=? AND ${side}_currency<>''
         GROUP BY 1,2,3,4`,
        companyId,
        account.code,
        end,
      )) {
        const k = keyOf(account.code, [String(r.s1), String(r.s2), String(r.s3)]);
        if (!currencies.has(k)) currencies.set(k, new Set());
        currencies.get(k)!.add(String(r.c));
      }
    for (const r of regs) {
      const sk = [String(r.s1), String(r.s2), String(r.s3)].slice(0, account.subkonto.length);
      const k = keyOf(account.code, sk);
      const set = currencies.get(k);
      if (!set?.size) continue;
      if (set.size > 1) {
        mixed.push(`${account.code} (${[...set].join(', ')})`);
        continue;
      }
      out.set(k, {
        account,
        sk,
        currency: [...set][0]!,
        amount: r.a as Minor,
        cur: r.c as Minor,
      });
    }
  }
  if (mixed.length)
    throw new DomainError(
      `Bir subkonto açarında bir neçə valyuta var: ${mixed.join('; ')}. Yenidən qiymətləndirmə üçün hər valyuta ayrıca subkontoda olmalıdır.`,
      'month',
    );
  // The revaluation being replaced is taken out (its postings move AZN only).
  if (exclude)
    for (const p of excludedPostings(db, companyId, exclude))
      for (const [side, sign] of [
        [p.dt, 1n],
        [p.kt, -1n],
      ] as const) {
        const k = out.get(keyOf(side.account, side.sk));
        if (k) k.amount -= p.amount * sign;
      }
  return [...out.values()];
}

function excludedPostings(db: Db, companyId: string, id: string): Posting[] {
  const row = db.get('SELECT version FROM revaluations WHERE company_id=? AND id=?', companyId, id);
  if (!row) return [];
  const entry = db.get(
    'SELECT id FROM entries WHERE company_id=? AND source_type=? AND source_id=? AND source_version=? AND storno=0',
    companyId,
    REVALUATION,
    id,
    row.version as bigint,
  );
  return entry
    ? db.all('SELECT * FROM postings WHERE entry_id=?', String(entry.id)).map(rowToPosting)
    : [];
}

/** The AMB rate for the month's last day: that day's, or the latest within the days before. */
function monthRates(db: Db, currencies: string[], end: string) {
  const rates = new Map<string, { date: string; rate: bigint }>();
  const missing: string[] = [];
  for (const c of currencies) {
    const r = catalogRate(db, c, end);
    if (r) rates.set(c, r);
    else missing.push(c);
  }
  return { rates, missing };
}

interface Computed {
  month: string;
  date: string;
  lines: (RevaluationLine & { posting: Posting | null })[];
  rates: Map<string, { date: string; rate: bigint }>;
  missing: string[];
  income: Minor;
  expense: Minor;
}

function fxItem(db: Db, companyId: string, role: 'fxIncome' | 'fxExpense') {
  const r = db.get(
    'SELECT id FROM items WHERE company_id=? AND role=? AND archived=0',
    companyId,
    role,
  );
  if (!r)
    throw new DomainError(
      `"Məzənnə fərqi" ${role === 'fxIncome' ? 'gəlir növü (611)' : 'xərc maddəsi (731)'} təyin edilməyib. Siyahılar bölməsində elementi açıb "Yazılış qaydalarında" sahəsini seçin.`,
      undefined,
      'not-found',
    );
  return String(r.id);
}

function compute(db: Db, companyId: string, month: string, exclude?: string): Computed {
  const chart = loadChart(db, companyId);
  const date = monthEnd(month);
  const keys = balances(db, companyId, chart, month, exclude);
  const { rates, missing } = monthRates(db, [...new Set(keys.map((k) => k.currency))], date);
  const lines: Computed['lines'] = [];
  let income = 0n;
  let expense = 0n;
  let fxIncome = '';
  let fxExpense = '';
  for (const k of keys) {
    const r = rates.get(k.currency);
    if (!r) continue;
    const value = k.cur >= 0n ? toAzn(k.cur, r.rate) : -toAzn(-k.cur, r.rate);
    const diff = value - k.amount;
    if (!diff) continue;
    const side = {
      account: k.account.code,
      sk: k.sk,
      currency: k.currency as never,
      curAmount: 0n,
    };
    let posting: Posting;
    if (diff > 0n) {
      fxIncome ||= fxItem(db, companyId, 'fxIncome');
      posting = {
        dt: side,
        kt: { account: '611', sk: [fxIncome] },
        amount: diff,
        memo: `Məzənnə fərqi · ${k.currency} ${formatPrice(r.rate)}`,
      };
      income += diff;
    } else {
      fxExpense ||= fxItem(db, companyId, 'fxExpense');
      posting = {
        dt: { account: '731', sk: [fxExpense] },
        kt: side,
        amount: -diff,
        memo: `Məzənnə fərqi · ${k.currency} ${formatPrice(r.rate)}`,
      };
      expense += -diff;
    }
    lines.push({
      account: k.account.code,
      sk: k.sk,
      skNames: [],
      currency: k.currency,
      curBalance: money(k.cur),
      rate: formatPrice(r.rate),
      rateDate: r.date,
      booked: money(k.amount),
      value: money(value),
      difference: money(diff),
      posting,
    });
  }
  lines.sort(
    (a, b) => a.account.localeCompare(b.account) || a.sk.join().localeCompare(b.sk.join()),
  );
  return { month, date, lines, rates, missing, income, expense };
}

const ratesJson = (c: Computed) =>
  Object.fromEntries(
    [...c.rates].map(([cur, r]) => [cur, { date: r.date, rate: formatPrice(r.rate) }]),
  );
const storedLines = (c: Computed) => c.lines.map(({ posting: _p, ...l }) => l);

export function postRevaluation(tx: Tx, cmd: CommandOf<'revaluation.post'>): CommandResult {
  tx.company(cmd.companyId);
  const month = checkMonth(cmd.month);
  const date = monthEnd(month);
  tx.open(cmd.companyId, date, 'month');
  const chart = tx.chart(cmd.companyId);
  const existing = tx.db.get(
    "SELECT * FROM revaluations WHERE company_id=? AND month=? AND status='posted'",
    cmd.companyId,
    month,
  );
  if (existing && cmd.version !== undefined)
    expectVersion(existing, cmd.version, 'Yenidən qiymətləndirmə');
  const c = compute(tx.db, cmd.companyId, month, existing ? String(existing.id) : undefined);
  if (c.missing.length)
    throw new DomainError(
      `${dmy(date)} üçün AMB məzənnəsi yoxdur: ${c.missing.join(', ')}. Valyuta məzənnələri kitabçasında AMB-dən yükləyin və ya əl ilə yazın.`,
      'month',
      'not-found',
    );
  if (!c.lines.length && !existing)
    throw new DomainError(
      `${dmy(date)} tarixinə yenidən qiymətləndiriləcək fərq yoxdur: valyuta qalıqları məzənnə ilə uyğundur.`,
      'month',
    );
  const postings = c.lines.map((l) => l.posting!);
  if (postings.length) checkPostings(chart, postings, 'lines', { exchangeDifference: true });
  const id = existing ? String(existing.id) : tx.id();
  const version = existing ? Number(existing.version) + 1 : 1;
  const number = `YQ-${month}`;
  const now = tx.clock.now();
  if (existing) {
    const prev = tx.entryPostings(cmd.companyId, REVALUATION, id, Number(existing.version));
    tx.post(
      cmd.companyId,
      chart,
      { type: REVALUATION, id, number, version: Number(existing.version) },
      prev.date,
      true,
      storno(prev.postings),
    );
  }
  // Nothing left to revalue after a re-post: the previous one is simply taken back.
  if (!postings.length) {
    tx.db.run(
      "UPDATE revaluations SET status='cancelled',version=?,updated_at=? WHERE id=?",
      version,
      now,
      id,
    );
    tx.history(cmd.companyId, REVALUATION, id, version, 'cancelled', { reason: 'fərq qalmadı' });
    tx.audit(
      cmd.companyId,
      'Ləğv edildi (storno)',
      'Yenidən qiymətləndirmə',
      id,
      `${number} · fərq qalmadı`,
    );
    return { id, version, number };
  }
  const values = [
    JSON.stringify(ratesJson(c)),
    JSON.stringify(storedLines(c)),
    c.income,
    c.expense,
    version,
    now,
  ] as const;
  if (existing)
    tx.db.run(
      'UPDATE revaluations SET rates=?,lines=?,income=?,expense=?,version=?,updated_at=? WHERE id=?',
      ...values,
      id,
    );
  else
    tx.db.run(
      `INSERT INTO revaluations(rates,lines,income,expense,version,updated_at,id,company_id,month,date,number,status,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,'posted',?)`,
      ...values,
      id,
      cmd.companyId,
      month,
      date,
      number,
      now,
    );
  tx.post(cmd.companyId, chart, { type: REVALUATION, id, number, version }, date, false, postings);
  tx.history(cmd.companyId, REVALUATION, id, version, 'posted', {
    month,
    rates: ratesJson(c),
    lines: storedLines(c),
  });
  tx.audit(
    cmd.companyId,
    existing ? 'Düzəliş edildi (storno + yeni yazılış)' : 'Uçota alındı',
    'Yenidən qiymətləndirmə',
    id,
    `${number} · gəlir ${money(c.income)} · xərc ${money(c.expense)} AZN`,
  );
  return { id, version, number };
}

export function cancelRevaluation(tx: Tx, cmd: CommandOf<'revaluation.cancel'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = cmd.reason.trim();
  if (!reason) throw new DomainError('Ləğv səbəbini yazın.', 'reason');
  const row = tx.db.get(
    'SELECT * FROM revaluations WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('Yenidən qiymətləndirmə tapılmadı.', 'id', 'not-found');
  expectVersion(row, cmd.version, 'Yenidən qiymətləndirmə');
  if (row.status !== 'posted')
    throw new DomainError('Sənəd artıq ləğv edilib.', undefined, 'conflict');
  const prev = tx.entryPostings(cmd.companyId, REVALUATION, cmd.id, Number(row.version));
  tx.open(cmd.companyId, prev.date);
  tx.post(
    cmd.companyId,
    tx.chart(cmd.companyId),
    { type: REVALUATION, id: cmd.id, number: String(row.number), version: Number(row.version) },
    prev.date,
    true,
    storno(prev.postings),
  );
  const version = Number(row.version) + 1;
  tx.db.run(
    "UPDATE revaluations SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  tx.history(cmd.companyId, REVALUATION, cmd.id, version, 'cancelled', { reason });
  tx.audit(
    cmd.companyId,
    'Ləğv edildi (storno)',
    'Yenidən qiymətləndirmə',
    cmd.id,
    `${row.number} · ${reason}`,
  );
  return { id: cmd.id, version };
}

/**
 * The month as it stands: the posted revaluation (if any) and what posting now would write —
 * after posting, a difference left over means documents changed the balances since.
 */
export function revaluationView(
  db: Db,
  companyId: string,
  monthInput: string,
  name: (kind: string, id: string) => string,
): RevaluationView {
  const month = checkMonth(monthInput);
  const row = db.get(
    "SELECT * FROM revaluations WHERE company_id=? AND month=? AND status='posted'",
    companyId,
    month,
  );
  const chart = loadChart(db, companyId);
  const names = (l: RevaluationLine): RevaluationLine => ({
    ...l,
    skNames: (chart.get(l.account)?.subkonto ?? []).map((k, i) =>
      l.sk[i] ? name(k, l.sk[i]!) : '',
    ),
  });
  let error = '';
  let fresh: Computed | undefined;
  try {
    fresh = compute(db, companyId, month, row ? String(row.id) : undefined);
  } catch (e) {
    error = (e as Error).message;
  }
  const proposal = fresh ? storedLines(fresh).map(names) : [];
  const posted = row ? (JSON.parse(String(row.lines)) as RevaluationLine[]).map(names) : [];
  const same =
    !!row &&
    JSON.stringify(posted.map((l) => [l.account, l.sk, l.difference])) ===
      JSON.stringify(proposal.map((l) => [l.account, l.sk, l.difference]));
  return {
    month,
    date: monthEnd(month),
    closed:
      monthEnd(month) <=
      String(db.get('SELECT closed_through FROM companies WHERE id=?', companyId)!.closed_through),
    error,
    missingRates: fresh?.missing ?? [],
    rates: fresh
      ? [...fresh.rates].map(([currency, r]) => ({
          currency,
          date: r.date,
          rate: formatPrice(r.rate),
        }))
      : [],
    proposal,
    income: fresh ? money(fresh.income) : '0.00',
    expense: fresh ? money(fresh.expense) : '0.00',
    posted: row
      ? {
          id: String(row.id),
          version: Number(row.version),
          number: String(row.number),
          income: money(row.income as Minor),
          expense: money(row.expense as Minor),
          lines: posted,
          stale: !same,
        }
      : null,
  };
}
