/**
 * Stage 10 — the annual financial statements (docs/MERHELE-10-MALIYYE-HESABATLARI.md, QERARLAR
 * 2026-10-29 mərhələ 10) on the forms of the Ministry of Finance's Q-01 of 30.01.2017 (annexes
 * 1–4). The forms number their lines by the two-digit groups of the chart of accounts (10 — 101…,
 * 22 — 221–224, 34 — 341–344, 52 — 521–522), so a balance goes to the line of its code's first two
 * digits. Nothing is stored: every figure is read from the registers each time, for the year's end
 * and the year before, and shown on the declarations' page (stage 9) with its source and checks.
 */
import type { Chart } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { formatMinor, type Minor } from '../domain/money.js';
import type { DeclarationRow, DeclarationSection, DeclarationView } from '../contracts/queries.js';
import type { Db } from '../infrastructure/sqlite/db.js';
import { bookedProfitTax, resultTurnovers } from './analytics.js';
import { monthClosed, row } from './declarations.js';
import { loadChart } from './tx.js';

const money = (m: Minor) => formatMinor(m);
const MONTHS = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avqust',
  'sentyabr',
  'oktyabr',
  'noyabr',
  'dekabr',
];

/** "2026-cı", "2025-ci", "2029-cu", "2023-cü": the suffix follows the last spoken numeral. */
export function ordinal(year: string): string {
  const n = Number(year);
  const unit = n % 10;
  const tens = Math.floor(n / 10) % 10;
  const byUnit = ['', 'ci', 'ci', 'cü', 'cü', 'ci', 'cı', 'ci', 'ci', 'cu'];
  const byTens = ['', 'cu', 'ci', 'cu', 'cı', 'ci', 'cı', 'ci', 'ci', 'cı'];
  const suffix = unit ? byUnit[unit] : tens ? byTens[tens] : Math.floor(n / 100) % 10 ? 'cü' : 'ci';
  return `${year}-${suffix}`;
}

function checkYear(value: string): string {
  if (!/^\d{4}$/.test(value)) throw new DomainError('İl düzgün deyil.', 'period');
  return value;
}

function header(db: Db, companyId: string, title: string, year: string): string {
  const c = db.get('SELECT name, tax_id FROM companies WHERE id=?', companyId)!;
  return `${String(c.name)} · VÖEN ${String(c.tax_id)} · ${title} · 31 ${MONTHS[11]} ${year}`;
}

// ---------------------------------------------------------------------------------------------
// Maliyyə vəziyyəti haqqında hesabat (annex 1, plan §5.1)

type Line = { line: string; label: string };
interface Part {
  key: string;
  title: string;
  total: string;
  lines: Line[];
}

/** The form's sections and lines, in its order. */
const ASSETS: Part[] = [
  {
    key: '1',
    title: '1 · Uzunmüddətli aktivlər',
    total: 'CƏMİ UZUNMÜDDƏTLİ AKTİVLƏR',
    lines: [
      { line: '10', label: 'Qeyri-maddi aktivlər' },
      { line: '11', label: 'Torpaq, tikili və avadanlıqlar' },
      { line: '12', label: 'İnvestisiya mülkiyyəti' },
      { line: '13', label: 'Bioloji aktivlər' },
      { line: '14', label: 'Təbii sərvətlər' },
      { line: '15', label: 'İştirak payı metodu ilə uçota alınmış investisiyalar' },
      { line: '16', label: 'Təxirə salınmış vergi aktivləri' },
      { line: '17', label: 'Uzunmüddətli debitor borcları' },
      { line: '18', label: 'Sair uzunmüddətli maliyyə aktivləri' },
      { line: '19', label: 'Sair uzunmüddətli aktivlər' },
    ],
  },
  {
    key: '2',
    title: '2 · Qısamüddətli aktivlər',
    total: 'CƏMİ QISAMÜDDƏTLİ AKTİVLƏR',
    lines: [
      { line: '20', label: 'Ehtiyatlar' },
      { line: '21', label: 'Qısamüddətli debitor borcları' },
      { line: '22', label: 'Pul vəsaitləri və onların ekvivalentləri' },
      { line: '23', label: 'Sair qısamüddətli maliyyə aktivləri' },
      { line: '24', label: 'Sair qısamüddətli aktivlər' },
    ],
  },
];
const EQUITY: Part = {
  key: '3',
  title: '3 · Kapital',
  total: 'CƏMİ KAPİTAL',
  lines: [
    { line: '30', label: 'Ödənilmiş nominal (nizamnamə) kapital' },
    { line: '31', label: 'Emissiya gəliri' },
    { line: '32', label: 'Geri alınmış kapital (səhmlər)' },
    { line: '33', label: 'Kapital ehtiyatları' },
    { line: '34', label: 'Bölüşdürülməmiş mənfəət (ödənilməmiş zərər)' },
  ],
};
const LIABILITIES: Part[] = [
  {
    key: '4',
    title: '4 · Uzunmüddətli öhdəliklər',
    total: 'CƏMİ UZUNMÜDDƏTLİ ÖHDƏLİKLƏR',
    lines: [
      { line: '40', label: 'Uzunmüddətli faiz xərcləri yaradan öhdəliklər' },
      { line: '41', label: 'Uzunmüddətli qiymətləndirilmiş öhdəliklər' },
      { line: '42', label: 'Təxirə salınmış vergi öhdəlikləri' },
      { line: '43', label: 'Uzunmüddətli kreditor borcları' },
      { line: '44', label: 'Sair uzunmüddətli öhdəliklər' },
    ],
  },
  {
    key: '5',
    title: '5 · Qısamüddətli öhdəliklər',
    total: 'CƏMİ QISAMÜDDƏTLİ ÖHDƏLİKLƏR',
    lines: [
      { line: '50', label: 'Qısamüddətli faiz xərcləri yaradan öhdəliklər' },
      { line: '51', label: 'Qısamüddətli qiymətləndirilmiş öhdəliklər' },
      { line: '52', label: 'Vergi və sair məcburi ödənişlər üzrə öhdəliklər' },
      { line: '53', label: 'Qısamüddətli kreditor borcları' },
      { line: '54', label: 'Sair qısamüddətli öhdəliklər' },
    ],
  },
];
const KNOWN = new Set(
  [...ASSETS, EQUITY, ...LIABILITIES].flatMap((p) => p.lines.map((l) => l.line)),
);
/** A group the form has no line for goes to its class's "other" line. */
const OTHER: Record<string, string> = { '1': '19', '2': '24', '3': '33', '4': '44', '5': '54' };

/**
 * The line a balance of the account goes to. An active-passive account's balance on the side
 * opposite to its class goes to the other side of the form (QERARLAR 2026-10-29 mərhələ 10 §3):
 * a liability's debit to 24 (19 for 4xx), an asset's credit to 54 (22 — an overdraft — to 50,
 * 1xx to 44).
 */
function lineOf(code: string, opposite: boolean): string {
  const cls = code[0]!;
  if (opposite) {
    if (cls === '1') return '44';
    if (cls === '2') return code.startsWith('22') ? '50' : '54';
    if (cls === '4') return '19';
    return '24';
  }
  const group = code.slice(0, 2);
  return KNOWN.has(group) ? group : OTHER[cls]!;
}

export interface Position {
  /** Per line: debit-positive for assets (1, 2), credit-positive for equity and liabilities. */
  lines: Map<string, bigint>;
  /** Per line, the accounts behind it ("531 (Dt qalığı)" for an opposite balance). */
  sources: Map<string, Set<string>>;
  /** Credit − debit left on 6xx / 7xx / 801 / 901 (in line 34). */
  unclosed: bigint;
  /** Debit − credit at the end, by top-level account (the checks' 341 / 801 / 901). */
  byTop: Map<string, bigint>;
  /** Sum of all balances (zero when the registers balance). */
  residue: bigint;
  /** Anything booked up to the date. */
  any: boolean;
}

/** The balance at the end of a month (YYYY-MM), from the registers. */
export function positionAt(db: Db, companyId: string, chart: Chart, month: string): Position {
  return positionsAt(db, companyId, chart, [month])[0]!;
}

/**
 * The balances at the ends of several months in one pass over the registers: one row per account
 * and first subkonto, a sum per month end. An active-passive account opens by partner / employee
 * when that is its first subkonto, by sub-account otherwise.
 */
export function positionsAt(
  db: Db,
  companyId: string,
  chart: Chart,
  months: readonly string[],
): Position[] {
  const cols = months
    .map(
      (_, i) =>
        `SUM(CASE WHEN month<=?${i + 3} THEN debit-credit ELSE 0 END) AS b${i},
         MAX(month<=?${i + 3}) AS n${i}`,
    )
    .join(', ');
  const rows = db.all(
    `SELECT account, s1, ${cols} FROM registers WHERE company_id=?1 AND month<=?2
     GROUP BY account, s1`,
    companyId,
    [...months].sort().at(-1)!,
    ...months,
  );
  return months.map((_, i) =>
    build(
      chart,
      rows.map((r) => ({
        account: String(r.account),
        s1: String(r.s1),
        b: r[`b${i}`] as bigint,
        booked: Number(r[`n${i}`]) === 1,
      })),
    ),
  );
}

function build(
  chart: Chart,
  rows: { account: string; s1: string; b: bigint; booked: boolean }[],
): Position {
  const lines = new Map<string, bigint>();
  const sources = new Map<string, Set<string>>();
  const byTop = new Map<string, bigint>();
  const add = (line: string, value: bigint, source: string) => {
    lines.set(line, (lines.get(line) ?? 0n) + value);
    const s = sources.get(line) ?? new Set<string>();
    s.add(source);
    sources.set(line, s);
  };
  let unclosed = 0n;
  let residue = 0n;
  let any = false;
  const opened = new Map<string, bigint>();
  for (const r of rows) {
    if (r.booked) any = true;
    const code = r.account;
    const b = r.b;
    if (!b) continue;
    residue += b;
    const top = code.slice(0, 3);
    byTop.set(top, (byTop.get(top) ?? 0n) + b);
    const cls = code[0]!;
    if (cls >= '6' && cls <= '9') {
      unclosed -= b;
      continue;
    }
    if (cls < '1' || cls > '5') continue;
    const a = chart.get(code);
    const split =
      a?.nature === 'active-passive' &&
      cls !== '3' &&
      (a.subkonto[0] === 'partner' || a.subkonto[0] === 'employee');
    const k = split ? `${code}|${r.s1}` : code;
    opened.set(k, (opened.get(k) ?? 0n) + b);
  }
  for (const [k, b] of opened) {
    if (!b) continue;
    const code = k.split('|')[0]!;
    const top = code.slice(0, 3);
    const cls = code[0]!;
    const assetSide = cls === '1' || cls === '2';
    const ap = chart.get(code)?.nature === 'active-passive' && cls !== '3';
    const opposite = ap && (assetSide ? b < 0n : b > 0n);
    if (opposite)
      add(lineOf(code, true), b < 0n ? -b : b, `${top} (${b > 0n ? 'Dt' : 'Kt'} qalığı)`);
    else add(lineOf(code, false), assetSide ? b : -b, top);
  }
  if (unclosed) add('34', unclosed, 'bağlanmamış nəticə (6xx–9xx)');
  return { lines, sources, unclosed, byTop, residue, any };
}

/** The ends of the year and of the two before it: two years of statements and their openings. */
const yearEnds = (year: string) => [0, 1, 2].map((d) => `${Number(year) - d}-12`);

/**
 * Balances by month, each read once within one statement (a year's end opens the next); the
 * month ends it will read are taken in one pass over the registers.
 */
function positions(
  db: Db,
  companyId: string,
  chart: Chart,
  prefetch: readonly string[],
): (month: string) => Position {
  const read = positionsAt(db, companyId, chart, prefetch);
  const seen = new Map(prefetch.map((m, i) => [m, read[i]!]));
  return (month) => {
    let p = seen.get(month);
    if (!p) seen.set(month, (p = positionAt(db, companyId, chart, month)));
    return p;
  };
}

/**
 * The statements against each other (plan §5.5), per year: the cash flow's end against line 22,
 * the changes in equity (opening + changes − closing), the M/Z's net profit against equity's.
 */
function crossChecks(
  db: Db,
  companyId: string,
  years: string[],
  at: (month: string) => Position,
): { cash: bigint[]; equity: bigint[]; profit: bigint[] } {
  const investing = investmentInvoices(db, companyId);
  const cash: bigint[] = [];
  const equity: bigint[] = [];
  const profit: bigint[] = [];
  const flows = cashYears(db, companyId, years, investing, at);
  const results = resultsOf(db, companyId, years);
  for (const [i, y] of years.entries()) {
    const c = flows[i]!;
    cash.push(c.opening + [...c.flows.values()].reduce((s, v) => s + v, 0n) - c.closing);
    const e = equityYear(db, companyId, y, at);
    let off = 0n;
    for (const col of COLUMNS) {
      let v = (e.open.get(col) ?? 0n) - (e.close.get(col) ?? 0n);
      for (const m of e.moves.values()) v += m.get(col) ?? 0n;
      off += v < 0n ? -v : v;
    }
    equity.push(off);
    profit.push(netOf(results[i]!) - (e.moves.get('profit')?.get('34') ?? 0n));
  }
  return { cash, equity, profit };
}

const sumLines = (p: Position, part: Part) =>
  part.lines.reduce((s, l) => s + (p.lines.get(l.line) ?? 0n), 0n);
const totals = (p: Position) => {
  const assets = ASSETS.reduce((s, x) => s + sumLines(p, x), 0n);
  const equity = sumLines(p, EQUITY);
  const liabilities = LIABILITIES.reduce((s, x) => s + sumLines(p, x), 0n);
  return { assets, equity, liabilities };
};

/** Sources of a line, sorted, over both dates; the account to open when only one is behind it. */
function sourceOf(positions: Position[], line: string): { source: string; account: string } {
  const all = new Set<string>();
  for (const p of positions) for (const s of p.sources.get(line) ?? []) all.add(s);
  const list = [...all].sort();
  return {
    source: list.join(', '),
    account: list.length === 1 && /^\d{3}$/.test(list[0]!) ? list[0]! : '',
  };
}

export function balanceSheet(db: Db, companyId: string, period: string): DeclarationView {
  const started = performance.now();
  const year = checkYear(period);
  const previous = String(Number(year) - 1);
  const at = positions(db, companyId, loadChart(db, companyId), yearEnds(year));
  const now = at(`${year}-12`);
  const before = at(`${previous}-12`);
  const both = [now, before];
  const cross = crossChecks(db, companyId, [year, previous], at);
  const columns = [`Hesabat dövrü (31.12.${year})`, `Əvvəlki dövr (31.12.${previous})`];
  const blank = ['', ''];

  const part = (p: Part): DeclarationRow[] => [
    row(`b:h${p.key}`, p.title, blank),
    ...p.lines.map((l) => {
      const s = sourceOf(both, l.line);
      return row(
        `b:${l.line}`,
        `${l.line} · ${l.label}`,
        both.map((x) => x.lines.get(l.line) ?? 0n),
        s.source,
        { level: 1, account: s.account },
      );
    }),
    row(
      `b:t${p.key}`,
      p.total,
      both.map((x) => sumLines(x, p)),
      '',
      { total: true },
    ),
  ];
  const t = both.map(totals);
  const assets: DeclarationSection = {
    title: 'Aktivlər',
    columns,
    rows: [
      ...ASSETS.flatMap(part),
      row(
        'b:assets',
        'CƏMİ AKTİVLƏR',
        t.map((x) => x.assets),
        '',
        { total: true },
      ),
    ],
  };
  const liabilities: DeclarationSection = {
    title: 'Kapital və öhdəliklər',
    columns,
    rows: [
      ...part(EQUITY),
      ...LIABILITIES.flatMap(part),
      row(
        'b:liabilities',
        'CƏMİ ÖHDƏLİKLƏR',
        t.map((x) => x.liabilities),
        '',
        { total: true },
      ),
      row(
        'b:total',
        'CƏMİ KAPİTAL VƏ ÖHDƏLİKLƏR',
        t.map((x) => x.equity + x.liabilities),
        '',
        { total: true },
      ),
    ],
  };

  // Checks (plan §5.5): they never block, they say what to look at before signing.
  const checks: DeclarationView['checks'] = [];
  const top = (p: Position, code: string) => p.byTop.get(code) ?? 0n;
  const result = (p: Position) =>
    [...p.byTop].filter(([c]) => /^[67]/.test(c)).reduce((s, [, b]) => s + b, 0n);
  const closed = [year, previous].map((y) => monthClosed(db, companyId, `${y}-12`));
  const ok = (v: bigint) => (v === 0n ? '✓' : 'fərq');
  const control: DeclarationSection = {
    title: 'Yoxlamalar',
    columns,
    rows: [
      row(
        'c:balance',
        'Aktivlər − (kapital + öhdəliklər)',
        t.map((x) => x.assets - x.equity - x.liabilities),
        t.map((x) => ok(x.assets - x.equity - x.liabilities)).join(' / '),
      ),
      row(
        'c:unclosed',
        'Bağlanmamış nəticə (34-də)',
        both.map((p) => p.unclosed),
        '6xx / 7xx / 801 / 901-in qalığı',
      ),
      row(
        'c:341',
        '341 qalığı (bağlanışdan sonra 0)',
        both.map((p) => -top(p, '341')),
        'dekabrda 341 → 343',
        { account: '341' },
      ),
      row(
        'c:801',
        '801 qalığı',
        both.map((p) => -top(p, '801')),
        '',
        { account: '801' },
      ),
      row(
        'c:901',
        '901 qalığı',
        both.map((p) => top(p, '901')),
        '',
        { account: '901' },
      ),
      row(
        'c:67',
        '6xx / 7xx qalığı',
        both.map((p) => -result(p)),
        '',
      ),
      row(
        'c:closed',
        'Dekabr bağlanıb',
        closed.map((c, i) => (both[i]!.any ? (c ? 'bəli' : 'xeyr') : '—')),
        'ay bağlanışı',
      ),
      row(
        'c:cash',
        'Pul hərəkətinin sonu − 22-ci maddə',
        cross.cash,
        'pul vəsaitlərinin hərəkəti (birbaşa)',
      ),
      row(
        'c:equity',
        'Kapital: əvvələ qalıq + dəyişikliklər − sona qalıq',
        cross.equity,
        'kapitalda dəyişikliklər',
      ),
      row(
        'c:profit',
        'M/Z xalis mənfəət − kapitalın xalis mənfəəti',
        cross.profit,
        'mənfəət və ya zərər, kapitalda dəyişikliklər',
      ),
    ],
  };
  const statements: [bigint[], string][] = [
    [cross.cash, 'pul hərəkətinin sonu balansın 22-ci maddəsindən fərqlənir'],
    [cross.equity, 'kapitalda dəyişikliklər balansın kapitalı ilə tutuşmur'],
    [
      cross.profit,
      'M/Z-nin xalis mənfəəti kapitaldakı xalis mənfəətdən fərqlənir (801 / 341-ə əl ilə yazılış)',
    ],
  ];
  for (const [values, text] of statements)
    values.forEach((v, i) => {
      if (v)
        checks.push({ kind: 'warning', text: `${[year, previous][i]}: ${text} — ${money(v)}.` });
    });
  t.forEach((x, i) => {
    const d = x.assets - x.equity - x.liabilities;
    if (d)
      checks.push({
        kind: 'warning',
        text: `31.12.${[year, previous][i]}: aktivlər kapital və öhdəliklərdən ${money(d)} fərqlənir — Parametrlərdə bütövlük yoxlamasını işlədin.`,
      });
  });
  both.forEach((p, i) => {
    const y = [year, previous][i]!;
    if (!p.any) return;
    if (!closed[i]) {
      if (p.unclosed || top(p, '341'))
        checks.push({
          kind: 'warning',
          text: `${ordinal(y)} ilin dekabrı bağlanmayıb: nəticə${p.unclosed ? ` (${money(p.unclosed)})` : ''} 34-cü maddədə bağlanmamış kimi göstərilir, mənfəət vergisi və 341 → 343 hələ yazılmayıb.`,
        });
      return;
    }
    const left = [
      ['341', -top(p, '341')],
      ['801', -top(p, '801')],
      ['901', top(p, '901')],
      ['6xx / 7xx', -result(p)],
    ].filter(([, v]) => v !== 0n) as [string, bigint][];
    if (left.length)
      checks.push({
        kind: 'warning',
        text: `31.12.${y}: dekabr bağlanışından sonra qalıq var — ${left.map(([c, v]) => `${c} ${money(v)}`).join(', ')}.`,
      });
  });
  if (!before.any && now.any)
    checks.push({
      kind: 'info',
      text: `${ordinal(previous)} il üçün uçot yoxdur — əvvəlki dövr sıfırdır.`,
    });
  return {
    kind: 'balanceSheet',
    period: year,
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    title: header(db, companyId, 'Maliyyə vəziyyəti haqqında hesabat', year),
    sections: [assets, liabilities, control],
    checks,
    appendices: [],
    ms: Math.round(performance.now() - started),
  };
}

// ---------------------------------------------------------------------------------------------
// Mənfəət və ya zərər haqqında hesabat (annex 2, by the functions of expenses; plan §5.2)

const MONTHS_OF = (year: string) =>
  Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

interface Result {
  /** Credit − debit of the year by two-digit group of 6xx / 7xx (income positive). */
  groups: Map<string, bigint>;
  /** The accounts behind each group. */
  sources: Map<string, Set<string>>;
  /** The profit tax booked on 901 (positive — an expense). */
  tax: bigint;
}

/** The result of each year, from one read of the turnovers of all their months. */
function resultsOf(db: Db, companyId: string, years: readonly string[]): Result[] {
  // The turnovers read a range of months: the years go in their order.
  const ordered = [...years].sort();
  const turnovers = resultTurnovers(db, companyId, ordered.flatMap(MONTHS_OF));
  return years.map((year) => {
    const y = ordered.indexOf(year);
    const groups = new Map<string, bigint>();
    const sources = new Map<string, Set<string>>();
    for (const t of turnovers) {
      const v = -t.values.slice(y * 12, y * 12 + 12).reduce((s, x) => s + x, 0n);
      if (!v) continue;
      const group = t.account.slice(0, 2);
      groups.set(group, (groups.get(group) ?? 0n) + v);
      const s = sources.get(group) ?? new Set<string>();
      s.add(t.account.slice(0, 3));
      sources.set(group, s);
    }
    const tax = bookedProfitTax(db, companyId, year).reduce((s, x) => s + x, 0n);
    return { groups, sources, tax };
  });
}
const netOf = (r: Result) => [...r.groups.values()].reduce((s, v) => s + v, 0n) - r.tax;

/** The form's lines; each takes the groups listed (a group the form has no line for — 61 / 73). */
const INCOME: (
  { key: string; label: string; groups: string[] } | { total: string; label: string }
)[] = [
  { key: '60', label: '60 · Əsas əməliyyat gəlirləri', groups: ['60'] },
  { key: '70', label: '70 · Satışın maya dəyəri üzrə xərclər', groups: ['70'] },
  { total: 'gross', label: 'Ümumi mənfəət (zərər)' },
  {
    key: '61',
    label: '61 · Sair əməliyyat gəlirləri',
    groups: ['61', '65', '66', '67', '68', '69'],
  },
  { key: '71', label: '71 · Kommersiya xərcləri', groups: ['71'] },
  { key: '72', label: '72 · İnzibati xərclər', groups: ['72'] },
  { key: '73', label: '73 · Sair əməliyyat xərcləri', groups: ['73', '77', '78', '79'] },
  {
    key: '62',
    label: '62 və 74 · Fəaliyyətin dayandırılmasından yaranan mənfəətlər (zərərlər)',
    groups: ['62', '74'],
  },
  { total: 'operating', label: 'Əməliyyat mənfəəti (zərəri)' },
  { key: '63', label: '63 və 75 · Maliyyə mənfəəti (zərəri)', groups: ['63', '75'] },
  { key: '64', label: '64 və 76 · Fövqəladə mənfəət (zərər)', groups: ['64', '76'] },
  {
    key: '81',
    label: '81 · Asılı və birgə müəssisələrin mənfəətlərində (zərərlərində) pay',
    groups: [],
  },
  { total: 'before', label: 'Vergiqoymadan əvvəl mənfəət (zərər)' },
];

export function incomeStatement(db: Db, companyId: string, period: string): DeclarationView {
  const started = performance.now();
  const year = checkYear(period);
  const previous = String(Number(year) - 1);
  const both = resultsOf(db, companyId, [year, previous]);
  const columns = [`Hesabat dövrü (${year})`, `Əvvəlki dövr (${previous})`];
  const rows: DeclarationRow[] = [];
  const running = [0n, 0n];
  const of = (r: Result, groups: string[]) =>
    groups.reduce((s, g) => s + (r.groups.get(g) ?? 0n), 0n);
  const sourceOfGroups = (groups: string[]) => {
    const all = new Set<string>();
    for (const r of both)
      for (const g of groups) for (const a of r.sources.get(g) ?? []) all.add(a);
    const list = [...all].sort();
    return { source: list.join(', '), account: list.length === 1 ? list[0]! : '' };
  };
  for (const item of INCOME) {
    if ('total' in item) {
      rows.push(row(`i:${item.total}`, item.label, [...running], '', { total: true }));
      continue;
    }
    const values = both.map((r) => of(r, item.groups));
    values.forEach((v, i) => (running[i]! += v));
    const s = sourceOfGroups(item.groups);
    rows.push(row(`i:${item.key}`, item.label, values, s.source, { account: s.account }));
    // Finance: its income and its expense below the net line, as the M/Z (5d) shows them.
    if (item.key === '63')
      for (const g of item.groups) {
        const part = sourceOfGroups([g]);
        if (both.some((r) => r.groups.get(g)))
          rows.push(
            row(
              `i:${g}`,
              g === '63' ? 'maliyyə gəlirləri' : 'maliyyə xərcləri',
              both.map((r) => r.groups.get(g) ?? 0n),
              part.source,
              {
                level: 1,
                account: part.account,
              },
            ),
          );
      }
  }
  const tax = both.map((r) => -r.tax);
  rows.push(
    row('i:90', '90 · Mənfəət vergisi', tax, '901 (901 → 341 bağlanışı çıxılır)', {
      account: '901',
    }),
  );
  const net = running.map((v, i) => v + tax[i]!);
  rows.push(
    row('i:net', '341 · Hesabat dövründə xalis mənfəət (zərər)', net, '', { total: true }),
    row('i:oci', 'Digər məcmu gəlir', [0n, 0n]),
    row('i:total', 'Məcmu gəlir (xalis mənfəət və digər məcmu gəlirin cəmi)', net, '', {
      total: true,
    }),
  );
  const checks: DeclarationView['checks'] = [];
  if (both[0]!.groups.size && !monthClosed(db, companyId, `${year}-12`))
    checks.push({
      kind: 'warning',
      text: `${ordinal(year)} ilin dekabrı bağlanmayıb: mənfəət vergisi (90) hələ hesablanmayıb — xalis mənfəət vergiqoymadan əvvəlki mənfəətdir.`,
    });
  return {
    kind: 'incomeStatement',
    period: year,
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    title: header(
      db,
      companyId,
      'Mənfəət və ya zərər haqqında hesabat (xərclərin funksiyaları üzrə)',
      year,
    ),
    sections: [{ title: 'Mənfəət və ya zərər və digər məcmu gəlir', columns, rows }],
    checks,
    appendices: [],
    ms: Math.round(performance.now() - started),
  };
}

// ---------------------------------------------------------------------------------------------
// Kapitalda dəyişikliklər haqqında hesabat (annex 3, plan §5.4)

const COLUMNS = ['30', '31', '32', '33', '34'] as const;
type Movement = 'profit' | 'contrib' | 'dividends' | 'buyback' | 'transfers' | 'oci' | 'other';

/** The equity line of an account in "extended equity": 3xx by its group, 6xx–9xx (the result) 34. */
function equityLine(code: string): string | null {
  const cls = code[0]!;
  if (cls >= '6' && cls <= '9') return '34';
  if (cls !== '3') return null;
  const g = code.slice(0, 2);
  return (COLUMNS as readonly string[]).includes(g) ? g : '33';
}

interface EquityYear {
  open: Map<string, bigint>;
  close: Map<string, bigint>;
  moves: Map<Movement, Map<string, bigint>>;
  /** Accounts behind the unclassified movements. */
  otherSources: Set<string>;
}

function equityYear(
  db: Db,
  companyId: string,
  year: string,
  at: (month: string) => Position,
): EquityYear {
  const pick = (p: Position) => new Map(COLUMNS.map((c) => [c, p.lines.get(c) ?? 0n]));
  const before = at(`${Number(year) - 1}-12`);
  const after = at(`${year}-12`);
  const open = pick(before);
  const close = pick(after);
  const moves = new Map<Movement, Map<string, bigint>>();
  const move = (kind: Movement, line: string, amount: bigint) => {
    const m = moves.get(kind) ?? new Map<string, bigint>();
    m.set(line, (m.get(line) ?? 0n) + amount);
    moves.set(kind, m);
  };
  const otherSources = new Set<string>();
  // The result: credit − debit of 6xx–9xx over the year (the change of what stands unclosed),
  // less what moved between them and 3xx (the closing's 801 → 341, 341 → 901): that stays in 34.
  let profit = after.unclosed - before.unclosed;
  for (const p of db.all(
    `SELECT dt_account AS d, kt_account AS k, amount AS a FROM postings
     WHERE company_id=?1 AND date BETWEEN ?2 AND ?3 AND dt_account>='3' AND dt_account<'4'
     UNION ALL
     SELECT dt_account, kt_account, amount FROM postings
     WHERE company_id=?1 AND date BETWEEN ?2 AND ?3 AND kt_account>='3' AND kt_account<'4'
       AND NOT (dt_account>='3' AND dt_account<'4')`,
    companyId,
    `${year}-01-01`,
    `${year}-12-31`,
  )) {
    const d = String(p.d);
    const k = String(p.k);
    const a = p.a as bigint;
    const ld = equityLine(d);
    const lk = equityLine(k);
    const result = (code: string) => code[0]! >= '6' && code[0]! <= '9';
    // Between 3xx and the result: the result side leaves the year's profit.
    if (result(d)) profit += a;
    if (result(k)) profit -= a;
    if (ld && lk) {
      if (ld !== lk) {
        move('transfers', ld, -a);
        move('transfers', lk, a);
      }
      continue;
    }
    const line = (ld ?? lk)!;
    const sign = lk ? a : -a;
    const own = ld ? d : k;
    const other = ld ? k : d;
    const kind: Movement =
      line === '30' || line === '31'
        ? 'contrib'
        : line === '32'
          ? 'buyback'
          : line === '33'
            ? 'oci'
            : other.startsWith('534')
              ? 'dividends'
              : 'other';
    if (kind === 'other') otherSources.add(`${own.slice(0, 3)} ↔ ${other.slice(0, 3)}`);
    move(kind, line, sign);
  }
  move('profit', '34', profit);
  return { open, close, moves, otherSources };
}

const MOVES: { kind: Movement; label: string }[] = [
  { kind: 'profit', label: 'Xalis mənfəət (zərər)' },
  { kind: 'contrib', label: 'Mülkiyyətçilərin kapital qoyuluşları' },
  { kind: 'dividends', label: 'Mülkiyyətçilər arasında kapitalın bölüşdürülməsi (dividendlər)' },
  { kind: 'buyback', label: 'Geri alınmış kapital (səhmlər) üzrə əməliyyatlar' },
  { kind: 'transfers', label: 'Kapitalın maddələri arasında köçürmələr' },
  { kind: 'oci', label: 'Sair məcmu gəlir' },
  { kind: 'other', label: 'Digər dəyişikliklər (təsnif olunmayıb)' },
];

export function equityStatement(db: Db, companyId: string, period: string): DeclarationView {
  const started = performance.now();
  const year = checkYear(period);
  const previous = String(Number(year) - 1);
  const chart = loadChart(db, companyId);
  const columns = [
    'Ödənilmiş nizamnamə kapitalı',
    'Emissiya gəliri',
    'Geri alınmış kapital (səhmlər)',
    'Kapital ehtiyatları',
    'Bölüşdürülməmiş mənfəət (ödənilməmiş zərər)',
    'Cəmi',
  ];
  const checks: DeclarationView['checks'] = [];
  const at = positions(db, companyId, chart, yearEnds(year));
  const withTotal = (m: Map<string, bigint> | undefined) => {
    const v = COLUMNS.map((c) => m?.get(c) ?? 0n);
    return [...v, v.reduce((s, x) => s + x, 0n)];
  };
  const results = resultsOf(db, companyId, [year, previous]);
  const section = (y: string, title: string): DeclarationSection => {
    const e = equityYear(db, companyId, y, at);
    const rows: DeclarationRow[] = [
      row(`e:${y}:open`, 'İlin əvvəlinə qalıq', withTotal(e.open), `balans 31.12.${Number(y) - 1}`),
      row(
        `e:${y}:policy`,
        'Uçot siyasətində dəyişikliklər və ya əhəmiyyətli səhvlərlə bağlı düzəlişlər',
        withTotal(undefined),
        'mühasib (Meyar təxmin etmir)',
      ),
      row(
        `e:${y}:restated`,
        'Səhvlərin düzəldilməsindən sonra ilin əvvəlinə qalıq',
        withTotal(e.open),
      ),
    ];
    const change = new Map<string, bigint>();
    for (const m of MOVES) {
      const values = e.moves.get(m.kind);
      for (const [c, v] of values ?? []) change.set(c, (change.get(c) ?? 0n) + v);
      if (m.kind === 'other' && ![...(values?.values() ?? [])].some((v) => v)) continue;
      rows.push(
        row(
          `e:${y}:${m.kind}`,
          m.label,
          withTotal(values),
          m.kind === 'profit'
            ? '6xx–9xx'
            : m.kind === 'other'
              ? [...e.otherSources].sort().join(', ')
              : {
                  contrib: '30x / 31x',
                  dividends: '34x ↔ 534',
                  buyback: '32x',
                  transfers: '3xx ↔ 3xx',
                  oci: '33x',
                }[m.kind],
        ),
      );
    }
    rows.push(
      row(`e:${y}:change`, 'Kapitalda dəyişikliklərin cəmi', withTotal(change), '', {
        total: true,
      }),
      row(`e:${y}:close`, 'İlin sonuna qalıq', withTotal(e.close), `balans 31.12.${y}`, {
        total: true,
      }),
    );
    // Opening + changes = closing, column by column (it holds unless the registers do not).
    const off = COLUMNS.filter(
      (c) => (e.open.get(c) ?? 0n) + (change.get(c) ?? 0n) !== (e.close.get(c) ?? 0n),
    );
    if (off.length)
      checks.push({
        kind: 'warning',
        text: `${ordinal(y)} il: kapitalın ${off.join(', ')} sütununda əvvələ qalıq + dəyişikliklər sona qalığa bərabər deyil.`,
      });
    const other = e.moves.get('other');
    if (other && [...other.values()].some((v) => v))
      checks.push({
        kind: 'warning',
        text: `${ordinal(y)} il: kapitalda təsnif olunmamış dəyişiklik var (${[...e.otherSources].sort().join(', ')}) — mühasib onu "uçot siyasətində dəyişikliklər / səhvlər" və ya başqa sətrə köçürür.`,
      });
    const pl = netOf(results[y === year ? 0 : 1]!);
    const profit = e.moves.get('profit')?.get('34') ?? 0n;
    if (profit !== pl)
      checks.push({
        kind: 'warning',
        text: `${ordinal(y)} il: kapitalın xalis mənfəəti (${money(profit)}) M/Z-nin xalis mənfəətindən (${money(pl)}) fərqlənir — 801 / 341-ə əl ilə yazılış.`,
      });
    return { title, columns, rows };
  };
  return {
    kind: 'equityStatement',
    period: year,
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    title: header(db, companyId, 'Kapitalda dəyişikliklər haqqında hesabat', year),
    sections: [
      section(previous, `Əvvəlki hesabat dövrü (${previous})`),
      section(year, `Hesabat dövrü (${year})`),
    ],
    checks,
    appendices: [],
    ms: Math.round(performance.now() - started),
  };
}

// ---------------------------------------------------------------------------------------------
// Pul vəsaitlərinin hərəkəti haqqında hesabat (annex 4, the direct method; plan §5.3)

type Flow =
  | 'o:sales'
  | 'o:royalty'
  | 'o:otherIn'
  | 'o:goods'
  | 'o:staff'
  | 'o:profitTax'
  | 'o:taxes'
  | 'o:interest'
  | 'o:otherOut'
  | 'i:sell'
  | 'i:buy'
  | 'i:loanIn'
  | 'i:loanOut'
  | 'f:shares'
  | 'f:buyback'
  | 'f:borrow'
  | 'f:repay'
  | 'f:dividends'
  | 'fx';

const under = (code: string, families: readonly string[]) =>
  families.some((f) => code === f || code.startsWith(f.length === 2 ? f : `${f}.`));
/** Settlement accounts whose document subkonto names the invoice paid (plan §5.3). */
const SETTLEMENT = ['211', '531', '243', '543'];

/**
 * The line of the form a money posting goes to, by the account on its other side and its
 * direction (QERARLAR 2026-10-29 mərhələ 10 §6). `investment`: the other side is a settlement
 * account whose invoice books a long-term asset (113 / 111 bought, a fixed asset sold).
 */
function flowOf(other: string, inflow: boolean, investment: boolean, source: string): Flow {
  if (source === 'revaluation') return 'fx';
  if (investment) return inflow ? 'i:sell' : 'i:buy';
  const cls = other[0]!;
  if (under(other, ['17', '18', '23'])) return inflow ? 'i:loanIn' : 'i:loanOut';
  if (cls === '1') return inflow ? 'i:sell' : 'i:buy';
  if (under(other, ['30', '31', '32'])) return inflow ? 'f:shares' : 'f:buyback';
  if (under(other, ['534', '344', '343', '341'])) return inflow ? 'o:otherIn' : 'f:dividends';
  if (cls === '4' || under(other, ['50'])) return inflow ? 'f:borrow' : 'f:repay';
  if (inflow) return under(other, ['211', '543', '60']) ? 'o:sales' : 'o:otherIn';
  if (under(other, ['531', '243', '241', '242', '20'])) return 'o:goods';
  if (under(other, ['533', '522', '521.03'])) return 'o:staff';
  if (under(other, ['521.04'])) return 'o:profitTax';
  if (under(other, ['521'])) return 'o:taxes';
  if (under(other, ['751'])) return 'o:interest';
  if (cls === '7') return 'o:goods';
  return 'o:otherOut';
}

interface CashYear {
  flows: Map<Flow, bigint>;
  sources: Map<Flow, Set<string>>;
  opening: bigint;
  closing: bigint;
}

/** The invoices whose entries book a long-term asset (1xx), as the document subkonto names them. */
function investmentInvoices(db: Db, companyId: string): Set<string> {
  return new Set(
    db
      .all(
        `SELECT DISTINCT e.source_id AS id FROM postings p JOIN entries e ON e.id=p.entry_id
         WHERE p.company_id=? AND p.dt_account>='1' AND p.dt_account<'2' AND e.source_type='invoice'`,
        companyId,
      )
      .map((r) => `invoice:${String(r.id)}`),
  );
}

/** The cash flow of each year (consecutive years), from one query. */
function cashYears(
  db: Db,
  companyId: string,
  years: readonly string[],
  investing: Set<string>,
  at: (month: string) => Position,
): CashYear[] {
  const out = years.map(() => ({
    flows: new Map<Flow, bigint>(),
    sources: new Map<Flow, Set<string>>(),
  }));
  // Money is the whole group 22 (221–224, 222 too) — the balance sheet's line 22; a posting
  // between two of its accounts moves nothing. Summed in SQL by the other side's account (and
  // the invoice, for a settlement account), the direction and whether the entry is a revaluation.
  const side = (other: 'dt' | 'kt') =>
    `SELECT substr(p.date,1,4) AS y, p.${other}_account AS other,
       CASE WHEN substr(p.${other}_account,1,3) IN (${SETTLEMENT.map((c) => `'${c}'`).join(',')}) THEN p.${other}_s3 ELSE '' END AS doc,
       p.entry_id IN (SELECT id FROM entries WHERE company_id=?1 AND source_type='revaluation') AS fx,
       SUM(p.amount) AS a
     FROM postings p
     WHERE p.company_id=?1 AND p.${other === 'kt' ? 'dt' : 'kt'}_account>='22'
       AND p.${other === 'kt' ? 'dt' : 'kt'}_account<'23' AND p.date BETWEEN ?2 AND ?3
       AND NOT (p.${other}_account>='22' AND p.${other}_account<'23')
     GROUP BY 1, 2, 3, 4`;
  for (const p of db.all(
    `SELECT 1 AS inflow, * FROM (${side('kt')}) UNION ALL SELECT 0, * FROM (${side('dt')})`,
    companyId,
    `${[...years].sort()[0]}-01-01`,
    `${[...years].sort().at(-1)}-12-31`,
  )) {
    const { flows, sources } = out[years.indexOf(String(p.y))]!;
    const inflow = Number(p.inflow) === 1;
    const other = String(p.other);
    const doc = String(p.doc);
    const investment = !!doc && investing.has(doc);
    const flow = flowOf(other, inflow, investment, Number(p.fx) === 1 ? 'revaluation' : '');
    const a = p.a as bigint;
    flows.set(flow, (flows.get(flow) ?? 0n) + (inflow ? a : -a));
    const s = sources.get(flow) ?? new Set<string>();
    s.add(investment ? `${other.slice(0, 3)} (əsas vəsait qaiməsi)` : other.slice(0, 3));
    sources.set(flow, s);
  }
  const money22 = (month: string) => at(month).lines.get('22') ?? 0n;
  return years.map((year, i) => ({
    ...out[i]!,
    opening: money22(`${Number(year) - 1}-12`),
    closing: money22(`${year}-12`),
  }));
}

const CASH: {
  title: string;
  key: string;
  net: string;
  lines: { flow: Flow; label: string }[];
  /** Operating: the inflows and the outflows have their own totals. */
  split?: { in: string; out: string };
}[] = [
  {
    title: 'Əməliyyat fəaliyyətindən pul vəsaitlərinin hərəkəti',
    key: 'o',
    net: 'Əməliyyat fəaliyyətindən yaranan pul vəsaitlərinin xalis hərəkəti',
    split: {
      in: 'Əməliyyat fəaliyyətindən cəmi daxilolmalar',
      out: 'Əməliyyat fəaliyyətindən cəmi xaricolmalar',
    },
    lines: [
      {
        flow: 'o:sales',
        label: 'Malların satışından və xidmətlərin göstərilməsindən daxilolmalar',
      },
      { flow: 'o:royalty', label: 'Royaltilər, yığımlar və komisyon haqları üzrə daxilolmalar' },
      { flow: 'o:otherIn', label: 'Digər gəlirlərdən daxilolmalar' },
      { flow: 'o:goods', label: 'Mallar və xidmətlərə görə xaricolmalar' },
      { flow: 'o:staff', label: 'İşçilərin mükafatlandırılması ilə əlaqədar ödənişlər' },
      { flow: 'o:profitTax', label: 'Mənfəət vergisi ödənişi üzrə xaricolmalar' },
      { flow: 'o:taxes', label: 'Digər vergilərə görə xaricolmalar' },
      {
        flow: 'o:interest',
        label: 'Əməliyyat fəaliyyətindən yaranan faiz ödənişləri üzrə xaricolmalar',
      },
      { flow: 'o:otherOut', label: 'Digər ödənişlərə görə xaricolmalar' },
    ],
  },
  {
    title: 'İnvestisiya fəaliyyətindən yaranan pul vəsaitlərinin hərəkəti',
    key: 'i',
    net: 'İnvestisiya fəaliyyətindən yaranan pul vəsaitlərinin xalis hərəkəti',
    lines: [
      {
        flow: 'i:sell',
        label:
          'Torpaq, tikili və avadanlıqların, qeyri-maddi və digər uzunmüddətli aktivlərin satışından daxilolmalar',
      },
      {
        flow: 'i:buy',
        label:
          'Torpaq, tikili və avadanlıqların, qeyri-maddi və digər uzunmüddətli aktivlərin əldə edilməsi üçün xaricolmalar',
      },
      {
        flow: 'i:loanIn',
        label: 'Digər tərəflərə verilmiş borcların qaytarılmasından daxilolmalar',
      },
      { flow: 'i:loanOut', label: 'Digər tərəflərə verilmiş borclara görə xaricolmalar' },
    ],
  },
  {
    title: 'Maliyyələşdirmə üzrə fəaliyyətdən pul vəsaitlərinin hərəkəti',
    key: 'f',
    net: 'Maliyyələşdirmə üzrə fəaliyyətdən yaranan pul vəsaitlərinin xalis hərəkəti',
    lines: [
      {
        flow: 'f:shares',
        label: 'Səhmlərin və digər kapital alətlərinin buraxılmasından daxilolmalar',
      },
      {
        flow: 'f:buyback',
        label: 'Müəssisənin öz səhmlərinin əldə edilməsi və ya geri alınması üzrə xaricolmalar',
      },
      { flow: 'f:borrow', label: 'Borcların alınmasından daxilolmalar' },
      {
        flow: 'f:repay',
        label: 'Borc şəklində alınmış məbləğlərin qaytarılması üzrə xaricolmalar',
      },
      { flow: 'f:dividends', label: 'Dividendlər və oxşar ödəmələr şəklində xaricolmalar' },
    ],
  },
];
const INFLOWS: readonly Flow[] = ['o:sales', 'o:royalty', 'o:otherIn'];

export function cashFlowStatement(db: Db, companyId: string, period: string): DeclarationView {
  const started = performance.now();
  const year = checkYear(period);
  const previous = String(Number(year) - 1);
  const at = positions(db, companyId, loadChart(db, companyId), yearEnds(year));
  const investing = investmentInvoices(db, companyId);
  const both = cashYears(db, companyId, [year, previous], investing, at);
  const columns = [`Hesabat dövrü (${year})`, `Əvvəlki dövr (${previous})`];
  const value = (c: CashYear, f: Flow) => c.flows.get(f) ?? 0n;
  const net = both.map(() => 0n);
  const sections: DeclarationSection[] = CASH.map((part) => {
    const rows: DeclarationRow[] = [];
    const total = both.map(() => 0n);
    const line = (flow: Flow, label: string) => {
      const all = new Set<string>();
      for (const c of both) for (const s of c.sources.get(flow) ?? []) all.add(s);
      const values = both.map((c) => value(c, flow));
      values.forEach((v, i) => (total[i]! += v));
      rows.push(row(`f:${flow}`, label, values, [...all].sort().join(', ')));
    };
    if (part.split) {
      for (const l of part.lines.filter((x) => INFLOWS.includes(x.flow))) line(l.flow, l.label);
      rows.push(row(`f:${part.key}:in`, part.split.in, [...total], '', { total: true }));
      const inflow = [...total];
      for (const l of part.lines.filter((x) => !INFLOWS.includes(x.flow))) line(l.flow, l.label);
      rows.push(
        row(
          `f:${part.key}:out`,
          part.split.out,
          total.map((v, i) => v - inflow[i]!),
          '',
          {
            total: true,
          },
        ),
      );
    } else for (const l of part.lines) line(l.flow, l.label);
    rows.push(row(`f:${part.key}:net`, part.net, total, '', { total: true }));
    total.forEach((v, i) => (net[i]! += v));
    return { title: part.title, columns, rows };
  });
  const fx = both.map((c) => value(c, 'fx'));
  const closing = both.map((c, i) => c.opening + net[i]! + fx[i]!);
  sections.push({
    title: 'Pul vəsaitlərinin və onların ekvivalentlərinin hərəkəti',
    columns,
    rows: [
      row('f:increase', 'Pul vəsaitləri və onların ekvivalentlərinin artması (azalması)', net, '', {
        total: true,
      }),
      row(
        'f:opening',
        'İlin əvvəlinə pul vəsaitləri və onların ekvivalentləri',
        both.map((c) => c.opening),
        '22 · balans',
      ),
      row(
        'f:fx',
        'Xarici valyutaların məzənnələrinin dəyişməsinin təsiri',
        fx,
        'yenidən qiymətləndirmə (YQ)',
      ),
      row('f:closing', 'İlin sonuna pul vəsaitləri və onların ekvivalentləri', closing, '', {
        total: true,
      }),
      row(
        'f:balance',
        'Balansın 22-ci maddəsi (yoxlama)',
        both.map((c) => c.closing),
        '221–224',
      ),
    ],
  });
  const checks: DeclarationView['checks'] = [];
  both.forEach((c, i) => {
    if (closing[i] !== c.closing)
      checks.push({
        kind: 'warning',
        text: `${[year, previous][i]}: pul hərəkətinin sonu (${money(closing[i]!)}) balansın 22-ci maddəsindən (${money(c.closing)}) fərqlənir.`,
      });
  });
  return {
    kind: 'cashFlowStatement',
    period: year,
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    title: header(
      db,
      companyId,
      'Pul vəsaitlərinin hərəkəti haqqında hesabat (birbaşa metod)',
      year,
    ),
    sections,
    checks,
    appendices: [],
    ms: Math.round(performance.now() - started),
  };
}
