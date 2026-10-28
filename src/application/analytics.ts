/**
 * Reports and the dashboard of stage 5d (docs/MERHELE-5-AY-BAGLANISI.md §6): Mənfəət və zərər,
 * Pul vəsaitlərinin hərəkəti, ƏDV icmalı and İdarə paneli. Everything is read from the monthly
 * registers (the journal is read only for the closing's own entries and for one partial month),
 * so a year answers in well under a second on a large base.
 *
 * The month closing moves 6xx / 7xx to 801 on the month's last day; those entries (6xx / 7xx ↔
 * 801) are left out of every figure here, otherwise a closed month would show no income at all.
 * Its other steps (FIFO re-costing to 701, the VAT offset) are real figures and stay in.
 */
import { inFamily, vatRates, type Chart } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney, type Minor } from '../domain/money.js';
import { monthEnd } from '../domain/rates.js';
import type {
  CashFlowRow,
  CashFlowView,
  DashboardView,
  ProfitLossView,
  ReportRow,
  VatSummaryView,
} from '../contracts/queries.js';
import type { Db } from '../infrastructure/sqlite/db.js';
import { checkMonth } from './revaluation.js';
import { eqReconcile } from './eqaime.js';
import { loadChart } from './tx.js';

export type NameOf = (kind: string, id: string) => string;

const money = (m: Minor) => formatMinor(m);
const sumOf = (values: readonly bigint[]) => values.reduce((s, v) => s + v, 0n);

function monthsUpTo(month: string, count: number): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - count + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function previousDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function checkDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError('Tarix düzgün deyil.', field);
  return value;
}

const leafCodes = (chart: Chart, fam: string) =>
  chart
    .all()
    .filter((a) => inFamily(a.code, fam) && chart.postable(a.code))
    .map((a) => a.code);
const MONEY = ['221', '223', '224'];
const moneyAccounts = (chart: Chart) => MONEY.flatMap((f) => leafCodes(chart, f));
const inList = (codes: readonly string[]) =>
  codes.map((c) => `'${c.replace(/'/g, "''")}'`).join(',') || "''";

// ---------------------------------------------------------------------------------------------
// 6xx / 7xx turnovers by month

export interface Turnover {
  account: string;
  s1: string;
  s2: string;
  /** debit − credit per month of the report. */
  values: bigint[];
}

/**
 * Debit − credit of every 6xx / 7xx key per month, from the registers, without the closing's
 * own entries to 801.
 */
export function resultTurnovers(db: Db, companyId: string, months: readonly string[]): Turnover[] {
  const index = new Map(months.map((m, i) => [m, i]));
  const out = new Map<string, Turnover>();
  const add = (account: string, s1: string, s2: string, month: string, amount: bigint) => {
    const i = index.get(month);
    if (i === undefined || !/^[67]/.test(account)) return;
    const k = `${account}|${s1}|${s2}`;
    const t = out.get(k) ?? { account, s1, s2, values: months.map(() => 0n) };
    t.values[i]! += amount;
    out.set(k, t);
  };
  for (const r of db.all(
    `SELECT account, s1, s2, month, SUM(debit-credit) AS b FROM registers
     WHERE company_id=? AND month BETWEEN ? AND ? AND substr(account,1,1) IN ('6','7')
     GROUP BY account, s1, s2, month`,
    companyId,
    months[0]!,
    months[months.length - 1]!,
  ))
    add(String(r.account), String(r.s1), String(r.s2), String(r.month), r.b as bigint);
  for (const r of db.all(
    `SELECT p.dt_account AS da, p.dt_s1 AS d1, p.dt_s2 AS d2, p.kt_account AS ka, p.kt_s1 AS k1,
       p.kt_s2 AS k2, substr(p.date,1,7) AS month, p.amount AS a
     FROM entries e JOIN postings p ON p.entry_id=e.id
     WHERE e.company_id=? AND e.source_type='closing' AND e.date BETWEEN ? AND ?
       AND (p.dt_account='801' OR p.kt_account='801')`,
    companyId,
    `${months[0]}-01`,
    monthEnd(months[months.length - 1]!),
  )) {
    const month = String(r.month);
    add(String(r.da), String(r.d1), String(r.d2), month, -(r.a as bigint));
    add(String(r.ka), String(r.k1), String(r.k2), month, r.a as bigint);
  }
  return [...out.values()];
}

/** The M/Z layout: accounts in their order, each adds (income) or takes away (expense). */
const LAYOUT: (
  { code: string; income: boolean; split?: { sk: 0 | 1; kind: string } } | { total: string }
)[] = [
  { code: '601', income: true, split: { sk: 0, kind: 'incomeType' } },
  { code: '602', income: false },
  { code: '603', income: false },
  { code: '604', income: false },
  { total: 'Xalis satış' },
  { code: '701', income: false, split: { sk: 1, kind: 'expenseItem' } },
  { total: 'Ümumi mənfəət (zərər)' },
  { code: '711', income: false, split: { sk: 0, kind: 'expenseItem' } },
  { code: '721', income: false, split: { sk: 0, kind: 'expenseItem' } },
  { code: '611', income: true, split: { sk: 0, kind: 'incomeType' } },
  { code: '731', income: false, split: { sk: 0, kind: 'expenseItem' } },
  { total: 'Əməliyyat mənfəəti (zərəri)' },
  { code: '631', income: true },
  { code: '751', income: false },
];
const RESULT = 'Vergiqoyulmadan əvvəl mənfəət (zərər)';

interface Built {
  rows: ReportRow[];
  /** Per month: all income (net of 602–604), all expense and their difference. */
  income: bigint[];
  expense: bigint[];
  result: bigint[];
}

function buildProfitLoss(chart: Chart, turnovers: Turnover[], n: number, name: NameOf): Built {
  const zero = () => Array.from({ length: n }, () => 0n);
  const rows: ReportRow[] = [];
  const running = zero();
  const income = zero();
  const expense = zero();
  const row = (
    key: string,
    label: string,
    values: bigint[],
    extra: Partial<ReportRow> = {},
  ): ReportRow => ({
    key,
    label,
    level: 0,
    total: false,
    account: '',
    sk: [],
    values: values.map(money),
    sum: money(sumOf(values)),
    ...extra,
  });
  const used = new Set<string>();
  const family = (code: string, isIncome: boolean, split?: { sk: 0 | 1; kind: string }) => {
    const mine = turnovers.filter((t) => inFamily(t.account, code));
    mine.forEach((t) => used.add(t.account));
    const sign = isIncome ? -1n : 1n;
    const values = zero();
    const parts = new Map<string, bigint[]>();
    for (const t of mine)
      t.values.forEach((v, i) => {
        values[i]! += v * sign;
        if (split) {
          const id = split.sk === 0 ? t.s1 : t.s2;
          const p = parts.get(id) ?? zero();
          p[i]! += v * sign;
          parts.set(id, p);
        }
      });
    if (!values.some((v) => v !== 0n) && ![...parts.values()].some((p) => p.some((v) => v))) return;
    const account = chart.get(code);
    rows.push(row(`a:${code}`, `${code} · ${account?.name ?? code}`, values, { account: code }));
    if (split)
      for (const [id, p] of [...parts].sort((a, b) =>
        name(split.kind, a[0]).localeCompare(name(split.kind, b[0]), 'az'),
      ))
        if (p.some((v) => v !== 0n))
          rows.push(
            row(`a:${code}|${id}`, name(split.kind, id), p, {
              level: 1,
              account: code,
              sk: split.sk === 0 ? [id] : [],
            }),
          );
    // 602–604 reduce the sales: they count against income, not as expenses.
    const deduction = ['602', '603', '604'].includes(code);
    values.forEach((v, i) => {
      running[i]! += isIncome ? v : -v;
      if (isIncome) income[i]! += v;
      else if (deduction) income[i]! -= v;
      else expense[i]! += v;
    });
  };
  for (const item of LAYOUT) {
    if ('total' in item)
      rows.push(row(`t:${item.total}`, item.total, [...running], { total: true }));
    else family(item.code, item.income, item.split);
  }
  // Accounts the chart gained under other codes: income (6xx) or expense (7xx) by themselves.
  const extra = [...new Set(turnovers.map((t) => t.account).filter((a) => !used.has(a)))].sort();
  for (const code of extra) family(code, code.startsWith('6'));
  rows.push(row('t:result', RESULT, [...running], { total: true }));
  return { rows, income, expense, result: running };
}

export function profitLoss(db: Db, companyId: string, year: string, name: NameOf): ProfitLossView {
  if (!/^\d{4}$/.test(year)) throw new DomainError('İl düzgün deyil.', 'year');
  const started = performance.now();
  const months = monthsUpTo(`${year}-12`, 12);
  const chart = loadChart(db, companyId);
  const built = buildProfitLoss(chart, resultTurnovers(db, companyId, months), 12, name);
  // Stage 9d: the profit tax (901, without its close to 341) and the net result, when there is one.
  const tax = months.map(() => 0n);
  for (const r of db.all(
    `SELECT substr(date,1,7) AS m, SUM(CASE WHEN dt_account='901' THEN amount ELSE -amount END) AS a
     FROM postings WHERE company_id=? AND (dt_account='901' OR kt_account='901')
       AND dt_account<>'341' AND kt_account<>'341' AND date BETWEEN ? AND ? GROUP BY m`,
    companyId,
    `${year}-01-01`,
    `${year}-12-31`,
  ))
    tax[months.indexOf(String(r.m))]! += r.a as bigint;
  if (tax.some((v) => v !== 0n)) {
    const row = (key: string, label: string, values: bigint[], total: boolean): ReportRow => ({
      key,
      label,
      level: 0,
      total,
      account: total ? '' : '901',
      sk: [],
      values: values.map(money),
      sum: money(sumOf(values)),
    });
    built.rows.push(
      row('a:901', `901 · ${chart.get('901')?.name ?? 'Mənfəət vergisi'}`, tax, false),
      row(
        't:net',
        'Xalis mənfəət (zərər)',
        built.result.map((v, i) => v - tax[i]!),
        true,
      ),
    );
  }
  return { year, months, rows: built.rows, ms: Math.round(performance.now() - started) };
}

// ---------------------------------------------------------------------------------------------
// Money: 221 + 223 + 224

/** Balance of the money accounts at the end of `date`: full months from registers, then days. */
function moneyAt(db: Db, companyId: string, accounts: readonly string[], date: string): bigint {
  const month = date.slice(0, 7);
  const list = inList(accounts);
  const months = db.get(
    `SELECT COALESCE(SUM(debit-credit),0) AS b FROM registers
     WHERE company_id=? AND account IN (${list}) AND month<?`,
    companyId,
    month,
  )!.b as bigint;
  const days = db.get(
    `SELECT COALESCE(SUM(a),0) AS b FROM (
       SELECT amount AS a FROM postings WHERE company_id=?1 AND dt_account IN (${list}) AND date BETWEEN ?2 AND ?3
       UNION ALL
       SELECT -amount FROM postings WHERE company_id=?1 AND kt_account IN (${list}) AND date BETWEEN ?2 AND ?3)`,
    companyId,
    `${month}-01`,
    date,
  )!.b as bigint;
  return months + days;
}

interface StoredLine {
  account: string;
  amountAzn: string;
  cashFlowItem?: string;
}

const minor = (s: string) => {
  const negative = s.startsWith('-');
  const [w, f = '0'] = (negative ? s.slice(1) : s).split('.');
  const v = BigInt(w!) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2));
  return negative ? -v : v;
};

export function cashFlow(
  db: Db,
  companyId: string,
  fromInput: string,
  toInput: string,
  name: NameOf,
): CashFlowView {
  const from = checkDate(fromInput, 'from');
  const to = checkDate(toInput, 'to');
  if (from > to) throw new DomainError('Başlanğıc tarix son tarixdən sonra ola bilməz.', 'from');
  const chart = loadChart(db, companyId);
  const accounts = moneyAccounts(chart);
  const isMoney = (code: string) => MONEY.some((f) => inFamily(code, f));
  const opening = moneyAt(db, companyId, accounts, previousDay(from));
  const closing = moneyAt(db, companyId, accounts, to);
  const items = new Map<string, bigint>();
  for (const table of ['bank_documents', 'cash_documents'] as const)
    for (const d of db.all(
      `SELECT direction, lines FROM ${table} WHERE company_id=? AND status='posted' AND date BETWEEN ? AND ?`,
      companyId,
      from,
      to,
    ))
      for (const l of JSON.parse(String(d.lines)) as StoredLine[]) {
        // A line whose other side is a money account moves money between own accounts.
        if (isMoney(l.account)) continue;
        const k = `${String(d.direction)}|${l.cashFlowItem ?? ''}`;
        items.set(k, (items.get(k) ?? 0n) + minor(l.amountAzn));
      }
  const rows: CashFlowRow[] = [];
  let inflow = 0n;
  let outflow = 0n;
  for (const kind of ['in', 'out'] as const) {
    const mine = [...items]
      .filter(([k]) => k.startsWith(`${kind}|`))
      .map(([k, amount]) => ({ item: k.slice(kind.length + 1), amount }))
      .sort((a, b) =>
        !a.item
          ? 1
          : !b.item
            ? -1
            : name('cashFlowItem', a.item).localeCompare(name('cashFlowItem', b.item), 'az'),
      );
    for (const m of mine) {
      rows.push({
        key: `${kind}:${m.item}`,
        label: m.item ? name('cashFlowItem', m.item) : 'Maddəsiz',
        kind,
        item: m.item,
        amount: money(m.amount),
      });
      if (kind === 'in') inflow += m.amount;
      else outflow += m.amount;
    }
  }
  // Money accounts moved by anything but bank and cash documents (manual operations, revaluation).
  const list = inList(accounts);
  let other = 0n;
  for (const r of db.all(
    `SELECT t, SUM(a) AS a FROM (
       SELECT e.source_type AS t, p.amount AS a FROM postings p JOIN entries e ON e.id=p.entry_id
         WHERE p.company_id=?1 AND p.dt_account IN (${list}) AND p.date BETWEEN ?2 AND ?3
           AND e.source_type NOT IN ('bank','cash')
       UNION ALL
       SELECT e.source_type, -p.amount FROM postings p JOIN entries e ON e.id=p.entry_id
         WHERE p.company_id=?1 AND p.kt_account IN (${list}) AND p.date BETWEEN ?2 AND ?3
           AND e.source_type NOT IN ('bank','cash')
     ) GROUP BY t ORDER BY t`,
    companyId,
    from,
    to,
  )) {
    const a = r.a as bigint;
    if (!a) continue;
    other += a;
    const t = String(r.t);
    rows.push({
      key: `other:${t}`,
      label:
        t === 'revaluation'
          ? 'Məzənnə fərqi (yenidən qiymətləndirmə)'
          : t === 'operation'
            ? 'Əl ilə əməliyyatlar'
            : 'Digər sənədlər',
      kind: 'other',
      item: '',
      amount: money(a),
    });
  }
  return {
    from,
    to,
    opening: money(opening),
    closing: money(closing),
    rows,
    inflow: money(inflow),
    outflow: money(outflow),
    other: money(other),
    reconciled: opening + inflow - outflow + other === closing,
  };
}

// ---------------------------------------------------------------------------------------------
// VAT

export interface Vat {
  sales: VatSummaryView['sales'];
  salesVat: bigint;
  purchaseVat: bigint;
  offset: bigint;
  waiting: bigint;
}

export function vatOf(db: Db, companyId: string, month: string): Vat {
  const chart = loadChart(db, companyId);
  const byRate = new Map<string, { base: bigint; vat: bigint }>();
  const at = (rate: string) => {
    const x = byRate.get(rate) ?? { base: 0n, vat: 0n };
    byRate.set(rate, x);
    return x;
  };
  for (const t of resultTurnovers(db, companyId, [month])) {
    const v = t.values[0]!;
    if (inFamily(t.account, '601')) at(t.s2).base -= v;
    else if (inFamily(t.account, '602') || inFamily(t.account, '603')) at(t.s2).base -= v;
    else if (inFamily(t.account, '604')) {
      at(t.s1).vat += v;
      at(t.s1).base -= v;
    }
  }
  // A fixed asset is sold to 611 with its VAT taken from 611 (stage 7c, QERARLAR 2026-10-26 §9):
  // no 601 / 604 turnover shows it, so its sale invoice lines do.
  for (const i of db.all(
    `SELECT lines FROM invoices WHERE company_id=? AND direction='sale' AND status='posted'
       AND date BETWEEN ? AND ? AND lines LIKE '%"assetId"%'`,
    companyId,
    `${month}-01`,
    monthEnd(month),
  ))
    for (const l of JSON.parse(String(i.lines)) as {
      assetId?: string;
      vatRate: string;
      netAzn: string;
      vatAzn: string;
    }[])
      if (l.assetId) {
        at(l.vatRate).base += parseMoney(l.netAzn);
        at(l.vatRate).vat += parseMoney(l.vatAzn);
      }
  const sales = vatRates
    .map((r) => {
      const x = byRate.get(r.id) ?? { base: 0n, vat: 0n };
      return { rate: r.id, label: r.name, base: money(x.base), vat: money(x.vat) };
    })
    .filter((r) => r.base !== '0.00' || r.vat !== '0.00');
  const salesVat = [...byRate.values()].reduce((s, x) => s + x.vat, 0n);
  const vatIn = leafCodes(chart, '241');
  const list = inList(vatIn);
  const purchaseVat = db.get(
    `SELECT COALESCE(SUM(debit),0) AS d FROM registers WHERE company_id=? AND account IN (${list}) AND month=?`,
    companyId,
    month,
  )!.d as bigint;
  const offset = db.get(
    `SELECT COALESCE(SUM(p.amount),0) AS a FROM entries e JOIN postings p ON p.entry_id=e.id
     WHERE e.company_id=? AND e.source_type='closing' AND e.date BETWEEN ? AND ?
       AND p.kt_account IN (${list}) AND p.dt_account='521.01'`,
    companyId,
    `${month}-01`,
    monthEnd(month),
  )!.a as bigint;
  const waiting = db.get(
    `SELECT COALESCE(SUM(debit-credit),0) AS b FROM registers WHERE company_id=? AND account IN (${list}) AND month<=?`,
    companyId,
    month,
  )!.b as bigint;
  return { sales, salesVat, purchaseVat, offset, waiting };
}

export function vatSummary(db: Db, companyId: string, monthInput: string): VatSummaryView {
  const month = checkMonth(monthInput);
  const v = vatOf(db, companyId, month);
  const from = `${month}-01`;
  const to = monthEnd(month);
  const dvx = (['sale', 'purchase'] as const).map((direction) => {
    const r = eqReconcile(db, companyId, direction, from, to);
    const m = r.months.find((x) => x.month === month);
    return {
      direction,
      covered: r.covered.some((c) => c.from <= to && c.to >= from),
      dvxVat: m?.dvxVat ?? '0.00',
      bookedVat: m?.bookedVat ?? '0.00',
      difference: m?.difference ?? '0.00',
    };
  });
  return {
    month,
    sales: v.sales,
    salesVat: money(v.salesVat),
    purchaseVat: money(v.purchaseVat),
    offset: money(v.offset),
    waiting: money(v.waiting),
    payable: money(v.salesVat - v.offset),
    dvx,
  };
}

// ---------------------------------------------------------------------------------------------
// Dashboard

/** Positive balances per partner of a settlement family at the month's end (debtors, creditors). */
function partnerBalances(
  db: Db,
  companyId: string,
  chart: Chart,
  family: string,
  month: string,
  sign: 1n | -1n,
): bigint {
  const list = inList(leafCodes(chart, family));
  let total = 0n;
  for (const r of db.all(
    `SELECT SUM(debit-credit) AS b FROM registers WHERE company_id=? AND account IN (${list}) AND month<=?
     GROUP BY s1`,
    companyId,
    month,
  )) {
    const b = (r.b as bigint) * sign;
    if (b > 0n) total += b;
  }
  return total;
}

export function dashboard(
  db: Db,
  companyId: string,
  monthInput: string,
  name: NameOf,
): DashboardView {
  const month = checkMonth(monthInput);
  const started = performance.now();
  const chart = loadChart(db, companyId);
  const months = monthsUpTo(month, 12);
  const pl = buildProfitLoss(chart, resultTurnovers(db, companyId, months), 12, name);
  // Money at each month's end: the registers summed up month by month.
  const list = inList(moneyAccounts(chart));
  const before = db.get(
    `SELECT COALESCE(SUM(debit-credit),0) AS b FROM registers WHERE company_id=? AND account IN (${list}) AND month<?`,
    companyId,
    months[0]!,
  )!.b as bigint;
  const moved = new Map(
    db
      .all(
        `SELECT month, SUM(debit-credit) AS b FROM registers WHERE company_id=? AND account IN (${list})
         AND month BETWEEN ? AND ? GROUP BY month`,
        companyId,
        months[0]!,
        month,
      )
      .map((r) => [String(r.month), r.b as bigint]),
  );
  let cash = before;
  const series = months.map((m, i) => {
    cash += moved.get(m) ?? 0n;
    return {
      month: m,
      income: money(pl.income[i]!),
      expense: money(pl.expense[i]!),
      profit: money(pl.result[i]!),
      money: money(cash),
    };
  });
  const last = series[series.length - 1]!;
  const vat = vatOf(db, companyId, month);
  return {
    month,
    tiles: [
      {
        key: 'income',
        label: 'Gəlir',
        value: last.income,
        hint: 'Xalis satış və sair gəlirlər (M/Z)',
      },
      { key: 'profit', label: 'Mənfəət', value: last.profit, hint: 'Vergiqoyulmadan əvvəl (M/Z)' },
      {
        key: 'money',
        label: 'Pul',
        value: last.money,
        hint: 'Bank və kassa: 221 + 223 + 224, ay sonu',
      },
      {
        key: 'receivables',
        label: 'Debitor borcu',
        value: money(partnerBalances(db, companyId, chart, '211', month, 1n)),
        hint: 'Alıcıların borcu (211), ay sonu',
      },
      {
        key: 'payables',
        label: 'Kreditor borcu',
        value: money(partnerBalances(db, companyId, chart, '531', month, -1n)),
        hint: 'Malsatanlara borc (531), ay sonu',
      },
      {
        key: 'vat',
        label: 'Ödənilməli ƏDV',
        value: money(vat.salesVat - vat.offset),
        hint: 'Satışın ƏDV-si − əvəzləşdirilən ƏDV',
      },
    ],
    series,
    ms: Math.round(performance.now() - started),
  };
}
