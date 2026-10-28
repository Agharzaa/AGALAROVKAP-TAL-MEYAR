/**
 * Stage 9d — the profit tax of a year (docs/MERHELE-9-VERGI-BEYANNAMELERI.md §5.4, QERARLAR
 * 2026-10-28 mərhələ 9 §6–§8):
 *
 *   income (6xx, net of 602–604, as in M/Z)
 *   − deductible expenses: 7xx without the books' depreciation, the books' residual value of
 *     assets written off or sold, and the expense items marked "not deductible"
 *   − tax depreciation (9c) − the tax residual of the assets that left
 *   ± the accountant's adjustments
 *   = taxable profit; less the losses of the five years before (VM 121) → × the rate = the tax,
 *   less what was paid on 521.04 during the year = to pay.
 *
 * The December closing posts it (Dt 901 / Kt 521.04, then 901 → 341 before 341 → 343).
 */
import { inFamily } from '../domain/chart.js';
import { formatMinor, roundHalfAwayFromZero, type Minor } from '../domain/money.js';
import type { Posting } from '../domain/posting.js';
import type { DeclarationRow, DeclarationView } from '../contracts/queries.js';
import type { Db } from '../infrastructure/sqlite/db.js';
import { resultTurnovers } from './analytics.js';
import { checkYear, taxDepreciationYear, taxYear, taxYearView } from './tax.js';

const str = (v: unknown) => String(v ?? '');
const money = (m: Minor) => formatMinor(m);
const months = (year: number) =>
  Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

/** VM 121: a loss is carried to the next five years. */
const LOSS_YEARS = 5;

export interface ProfitTaxFigures {
  year: number;
  /** Income by family (601, 611, 631 …), net of 602–604. */
  income: { account: string; amount: Minor }[];
  totalIncome: Minor;
  expenses: Minor;
  booksDepreciation: Minor;
  booksDisposal: Minor;
  nonDeductible: { item: string; name: string; amount: Minor }[];
  deductible: Minor;
  taxDepreciation: Minor;
  taxRemoved: Minor;
  adjustments: { label: string; amount: Minor }[];
  /** Profit (positive) or loss (negative) for the tax, before past losses. */
  taxable: Minor;
  /** Past losses that could be used this year, and what was used. */
  lossesAvailable: Minor;
  lossesUsed: Minor;
  base: Minor;
  /** Hundredths of a percent. */
  rate: number;
  tax: Minor;
  /** Debit of 521.04 in the year (advances and payments). */
  paid: Minor;
}

function itemsWith(db: Db, companyId: string, where: string): Map<string, string> {
  return new Map(
    db
      .all(
        `SELECT id, name FROM items WHERE company_id=? AND kind='expenseItem' AND ${where}`,
        companyId,
      )
      .map((r) => [str(r.id), str(r.name)]),
  );
}

/** One year's figures before past losses. `extra`: postings not in the books yet (a closing's plan). */
function yearCore(db: Db, companyId: string, year: number, extra: readonly Posting[]) {
  const turnovers = resultTurnovers(db, companyId, months(year)).map((t) => ({
    account: t.account,
    s1: t.s1,
    s2: t.s2,
    amount: t.values.reduce((s, v) => s + v, 0n),
  }));
  for (const p of extra) {
    if (/^[67]/.test(p.dt.account))
      turnovers.push({
        account: p.dt.account,
        s1: p.dt.sk[0] ?? '',
        s2: p.dt.sk[1] ?? '',
        amount: p.amount,
      });
    if (/^[67]/.test(p.kt.account))
      turnovers.push({
        account: p.kt.account,
        s1: p.kt.sk[0] ?? '',
        s2: p.kt.sk[1] ?? '',
        amount: -p.amount,
      });
  }
  // The books' depreciation is what a 6xx / 7xx key got against 112 (the month closings, or by
  // hand), whatever expense item the asset posts it to (audit 0.9.9: not the item's role).
  const key = (account: string, s1: string, s2: string) => `${account}|${s1}|${s2}`;
  const booked = new Map<string, Minor>();
  const addBooked = (k: string, amount: Minor) => booked.set(k, (booked.get(k) ?? 0n) + amount);
  for (const r of db.all(
    `SELECT dt_account AS a, dt_s1 AS s1, dt_s2 AS s2, SUM(amount) AS x FROM postings
     WHERE company_id=? AND (kt_account='112' OR kt_account LIKE '112.%')
       AND substr(dt_account,1,1) IN ('6','7') AND date BETWEEN ? AND ?
     GROUP BY dt_account, dt_s1, dt_s2`,
    companyId,
    `${year}-01-01`,
    `${year}-12-31`,
  ))
    addBooked(key(str(r.a), str(r.s1), str(r.s2)), r.x as bigint);
  for (const p of extra)
    if (/^[67]/.test(p.dt.account) && inFamily(p.kt.account, '112'))
      addBooked(key(p.dt.account, p.dt.sk[0] ?? '', p.dt.sk[1] ?? ''), p.amount);
  const disposal = itemsWith(db, companyId, "role='assetDisposal'");
  const excluded = itemsWith(db, companyId, 'tax_deductible=0');
  const has = (map: Map<string, string>, t: { s1: string; s2: string }) =>
    map.has(t.s1) ? t.s1 : map.has(t.s2) ? t.s2 : '';
  const byKey = new Map<string, { account: string; s1: string; s2: string; amount: Minor }>();
  for (const t of turnovers) {
    const k = key(t.account, t.s1, t.s2);
    const x = byKey.get(k) ?? { ...t, amount: 0n };
    x.amount += t.amount;
    byKey.set(k, x);
  }
  const income = new Map<string, Minor>();
  let expenses = 0n;
  let booksDepreciation = 0n;
  let booksDisposal = 0n;
  const nonDeductible = new Map<string, Minor>();
  for (const [k, t] of byKey) {
    if (t.account.startsWith('6')) {
      const family = ['601', '602', '603', '604'].some((f) => inFamily(t.account, f))
        ? '601'
        : t.account.split('.')[0]!;
      income.set(family, (income.get(family) ?? 0n) - t.amount);
      continue;
    }
    expenses += t.amount;
    const dep = booked.get(k) ?? 0n;
    booksDepreciation += dep;
    const rest = t.amount - dep;
    if (has(disposal, t)) booksDisposal += rest;
    else {
      const item = has(excluded, t);
      if (item) nonDeductible.set(item, (nonDeductible.get(item) ?? 0n) + rest);
    }
  }
  const dep = taxDepreciationYear(db, companyId, year);
  const taxDepreciation = dep.rows.reduce((s, r) => s + r.depreciation + r.writtenOff, 0n);
  const taxRemoved = dep.rows.reduce((s, r) => s + r.removed, 0n);
  const params = taxYear(db, companyId, year);
  const totalIncome = [...income.values()].reduce((s, v) => s + v, 0n);
  const excludedSum = [...nonDeductible.values()].reduce((s, v) => s + v, 0n);
  const deductible = expenses - booksDepreciation - booksDisposal - excludedSum;
  const adjustments = params.adjustments.reduce((s, a) => s + a.amount, 0n);
  return {
    income: [...income]
      .filter(([, a]) => a !== 0n)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([account, amount]) => ({ account, amount })),
    totalIncome,
    expenses,
    booksDepreciation,
    booksDisposal,
    nonDeductible: [...nonDeductible]
      .filter(([, a]) => a !== 0n)
      .map(([item, amount]) => ({ item, name: excluded.get(item)!, amount })),
    deductible,
    taxDepreciation,
    taxRemoved,
    adjustments: params.adjustments,
    taxable: totalIncome - deductible - taxDepreciation - taxRemoved + adjustments,
    params,
  };
}

/** The first year with anything posted (losses are carried from there on). */
function firstYear(db: Db, companyId: string): number {
  const r = db.get('SELECT MIN(month) AS m FROM registers WHERE company_id=?', companyId)!.m;
  return r ? Number(str(r).slice(0, 4)) : 9999;
}

export function profitTaxFigures(
  db: Db,
  companyId: string,
  year: number,
  extra: readonly Posting[] = [],
): ProfitTaxFigures {
  // Losses of the years before, oldest first; each lives five years and is used oldest first.
  const pool: { year: number; amount: Minor }[] = [];
  for (let y = Math.max(firstYear(db, companyId), year - 30); y < year; y++) {
    const core = yearCore(db, companyId, y, []);
    let profit = core.taxable;
    for (const l of pool) {
      if (l.year < y - LOSS_YEARS || profit <= 0n) continue;
      const use = l.amount < profit ? l.amount : profit;
      l.amount -= use;
      profit -= use;
    }
    if (core.taxable < 0n) pool.push({ year: y, amount: -core.taxable });
  }
  const core = yearCore(db, companyId, year, extra);
  const meyarLosses = pool
    .filter((l) => l.year >= year - LOSS_YEARS)
    .reduce((s, l) => s + l.amount, 0n);
  const lossesAvailable = meyarLosses + core.params.losses;
  const lossesUsed =
    core.taxable <= 0n ? 0n : lossesAvailable < core.taxable ? lossesAvailable : core.taxable;
  const base = core.taxable > 0n ? core.taxable - lossesUsed : 0n;
  const tax = roundHalfAwayFromZero(base * BigInt(core.params.profitRate), 10_000n);
  // Paid: the year's debit of 521.04 for the tax itself (not interest or sanctions), not the
  // closing's own correction; what was owed at the year's start (last year's tax) is settled
  // first, an overpayment counts (audit 0.9.9).
  const kind = str(
    db.get("SELECT id FROM items WHERE company_id=? AND role='vatTax'", companyId)?.id,
  );
  const debit = db.get(
    `SELECT COALESCE(SUM(p.amount),0) AS d FROM postings p JOIN entries e ON e.id=p.entry_id
     WHERE p.company_id=? AND p.dt_account='521.04' AND p.dt_s1=? AND e.source_type<>'closing'
       AND p.date BETWEEN ? AND ?`,
    companyId,
    kind,
    `${year}-01-01`,
    `${year}-12-31`,
  )!.d as bigint;
  const opening = db.get(
    `SELECT COALESCE(SUM(debit-credit),0) AS b FROM registers
     WHERE company_id=? AND account='521.04' AND s1=? AND month<?`,
    companyId,
    kind,
    `${year}-01`,
  )!.b as bigint;
  const paid = debit + opening > 0n ? debit + opening : 0n;
  const { params, ...rest } = core;
  return {
    year,
    ...rest,
    lossesAvailable,
    lossesUsed,
    base,
    rate: params.profitRate,
    tax,
    paid,
  };
}

// ---------------------------------------------------------------------------------------------

/** What the December closing posts: the year's tax against what other documents put on 901. */
export function profitTaxStep(
  db: Db,
  companyId: string,
  month: string,
  extra: readonly Posting[],
  paymentKind: string,
): { postings: Posting[]; notes: string[]; tax: Minor } {
  const year = Number(month.slice(0, 4));
  const f = profitTaxFigures(db, companyId, year, extra);
  const r901 = { account: '901', sk: [] };
  const r341 = { account: '341', sk: [] };
  const r52104 = { account: '521.04', sk: [paymentKind] };
  // Booked on 901 by other documents this year (an operation by hand): only the difference.
  const booked = db.get(
    `SELECT COALESCE(SUM(p.amount),0) AS a FROM postings p JOIN entries e ON e.id=p.entry_id
     WHERE p.company_id=? AND p.dt_account='901' AND e.source_type<>'closing' AND p.date BETWEEN ? AND ?`,
    companyId,
    `${year}-01-01`,
    `${year}-12-31`,
  )!.a as bigint;
  const diff = f.tax - booked;
  const postings: Posting[] = [];
  const memo = `İl bağlanışı · mənfəət vergisi ${year}`;
  if (diff > 0n) postings.push({ dt: r901, kt: r52104, amount: diff, memo });
  if (diff < 0n) postings.push({ dt: r52104, kt: r901, amount: -diff, memo });
  const balance =
    (db.get(
      "SELECT COALESCE(SUM(debit-credit),0) AS b FROM registers WHERE company_id=? AND account='901' AND month<=?",
      companyId,
      month,
    )!.b as bigint) + diff;
  if (balance > 0n)
    postings.push({ dt: r341, kt: r901, amount: balance, memo: 'İl bağlanışı · 901 → 341' });
  if (balance < 0n)
    postings.push({ dt: r901, kt: r341, amount: -balance, memo: 'İl bağlanışı · 901 → 341' });
  const notes = [
    `Vergiyə cəlb olunan mənfəət ${money(f.base)} × ${(f.rate / 100).toString().replace('.', ',')}% = ${money(f.tax)}${f.lossesUsed ? ` (keçmiş illərin zərəri ${money(f.lossesUsed)} çıxılıb)` : ''}.`,
    ...(booked ? [`901-də başqa sənədlərlə ${money(booked)} yazılıb — fərq yazılır.`] : []),
  ];
  return { postings, notes, tax: f.tax };
}

// ---------------------------------------------------------------------------------------------

export function profitTaxReturn(db: Db, companyId: string, period: string): DeclarationView {
  const started = performance.now();
  const year = checkYear(period);
  const f = profitTaxFigures(db, companyId, year);
  const r = (
    key: string,
    label: string,
    amount: Minor | string,
    source = '',
    extra: Partial<DeclarationRow> = {},
  ): DeclarationRow => ({
    key,
    label,
    values: [typeof amount === 'bigint' ? money(amount) : amount],
    source,
    total: false,
    level: 0,
    account: '',
    ...extra,
  });
  const names: Record<string, string> = {
    '601': 'Satış (602–604 çıxılmaqla)',
    '611': 'Sair əməliyyat gəlirləri (əsas vəsaitin satışı daxil)',
    '631': 'Maliyyə gəlirləri',
  };
  const payable = f.tax - f.paid;
  const closed = !!db.get(
    "SELECT 1 FROM month_closings WHERE company_id=? AND month=? AND status='posted'",
    companyId,
    `${year}-12`,
  );
  const checks: DeclarationView['checks'] = [];
  if (!closed)
    checks.push({
      kind: 'info',
      text: `${year}-ci ilin dekabrı bağlanmayıb: rəqəmlər ilin indiki uçotudur; vergi dekabr bağlanışında yazılır (Dt 901 / Kt 521.04).`,
    });
  if (f.booksDepreciation && !f.taxDepreciation)
    checks.push({
      kind: 'warning',
      text: 'Uçotda amortizasiya var, vergi amortizasiyası yoxdur — əsas vəsaitlərin başlanğıc qalığını yoxlayın.',
    });
  if (closed) {
    // What the closings posted on 901 (without its close to 341), as the M/Z shows it.
    const posted = db.get(
      `SELECT COALESCE(SUM(CASE WHEN dt_account='901' THEN amount ELSE -amount END),0) AS a
       FROM postings WHERE company_id=? AND (dt_account='901' OR kt_account='901')
         AND dt_account<>'341' AND kt_account<>'341' AND date BETWEEN ? AND ?`,
      companyId,
      `${year}-01-01`,
      `${year}-12-31`,
    )!.a as bigint;
    if (posted !== f.tax)
      checks.push({
        kind: 'warning',
        text: `Uçotda ${year}-ci ilin mənfəət vergisi ${money(posted)} yazılıb, indiki hesablama ${money(f.tax)}: bağlanışdan sonra xərc maddəsinin bayrağı, vəsaitin qrupu və ya sənəd dəyişib. Dekabr bağlanışını ləğv edib yenidən bağlayın.`,
      });
  }
  const view = taxYearView(db, companyId, year);
  if (!view.saved)
    checks.push({
      kind: 'info',
      text: `${year} üçün parametrlər yazılmayıb: dərəcə 20%, keçmiş zərər yox, düzəliş yox. Mühasib təsdiq edir.`,
    });
  return {
    kind: 'profitTax',
    period: String(year),
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    title: `Mənfəət vergisi bəyannaməsi üçün rəqəmlər · ${year}`,
    sections: [
      {
        title: 'Gəlirlər',
        columns: ['Məbləğ'],
        rows: [
          ...f.income.map((i) =>
            r(
              `i:${i.account}`,
              `${i.account} · ${names[i.account] ?? 'Gəlir'}`,
              i.amount,
              `${i.account} · dövriyyə`,
              {
                level: 1,
                account: i.account,
              },
            ),
          ),
          r('i:total', 'Gəlirlər cəmi', f.totalIncome, 'Mənfəət və zərər', { total: true }),
        ],
      },
      {
        title: 'Gəlirdən çıxılan xərclər',
        columns: ['Məbləğ'],
        rows: [
          r('e:books', 'Xərclər (uçotda, 7xx)', f.expenses, 'Mənfəət və zərər'),
          r(
            'e:depreciation',
            'çıxılır: uçot amortizasiyası',
            -f.booksDepreciation,
            'xərc maddəsi "Amortizasiya"',
            { level: 1 },
          ),
          r(
            'e:disposal',
            'çıxılır: silinən / satılan vəsaitlərin uçot qalıq dəyəri',
            -f.booksDisposal,
            '"Əsas vəsaitlərin silinməsi"',
            { level: 1 },
          ),
          ...f.nonDeductible.map((n) =>
            r(
              `e:x:${n.item}`,
              `çıxılır: ${n.name}`,
              -n.amount,
              'gəlirdən çıxılmayan xərc maddəsi',
              { level: 1 },
            ),
          ),
          r('e:deductible', 'Gəlirdən çıxılan xərclər', f.deductible, '', { total: true }),
          r(
            'e:taxDepreciation',
            'Vergi amortizasiyası (VM 114)',
            f.taxDepreciation,
            'Vergi amortizasiyası',
          ),
          r(
            'e:taxRemoved',
            'Silinən / satılan vəsaitlərin vergi qalıq dəyəri',
            f.taxRemoved,
            'Vergi amortizasiyası',
          ),
        ],
      },
      {
        title: 'Mənfəət vergisi',
        columns: ['Məbləğ'],
        rows: [
          ...f.adjustments.map((a, i) =>
            r(`a:${i}`, `Düzəliş: ${a.label}`, a.amount, 'parametrlər', { level: 1 }),
          ),
          r(
            't:taxable',
            f.taxable >= 0n ? 'Vergi tutulan mənfəət' : 'Zərər (növbəti illərə keçir)',
            f.taxable >= 0n ? f.taxable : -f.taxable,
            'gəlirlər − çıxılanlar ± düzəlişlər',
            { total: true },
          ),
          r(
            't:losses',
            'Keçmiş illərin zərəri (çıxılan / mövcud)',
            `${money(f.lossesUsed)} / ${money(f.lossesAvailable)}`,
            'VM 121: 5 il',
            { level: 1 },
          ),
          r('t:base', 'Vergiyə cəlb olunan mənfəət', f.base, ''),
          r('t:rate', 'Dərəcə', `${(f.rate / 100).toString().replace('.', ',')}%`, 'VM 105'),
          r(
            't:tax',
            'Mənfəət vergisi',
            f.tax,
            closed ? `AB-${year}-12 · 901 / 521.04` : 'dekabr bağlanışında yazılır',
            { total: true, account: '521.04' },
          ),
          r(
            't:paid',
            'İl ərzində ödənilib (521.04, Dt)',
            f.paid,
            '521.04 · "Vergi (haqq)" Dt − ilin əvvəlinə borc',
            {
              account: '521.04',
            },
          ),
          r(
            't:payable',
            payable >= 0n ? 'Ödənilməli' : 'Artıq ödənilib',
            payable >= 0n ? payable : -payable,
            'vergi − ödənilən',
            { total: true },
          ),
        ],
      },
    ],
    checks,
    appendices: [],
    params: view,
    ms: Math.round(performance.now() - started),
  };
}
