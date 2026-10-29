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
  // One row per account and first subkonto; an active-passive account opens by partner / employee
  // when that is its first subkonto, by sub-account otherwise.
  const rows = db.all(
    `SELECT account, s1, SUM(debit-credit) AS b FROM registers WHERE company_id=? AND month<=?
     GROUP BY account, s1`,
    companyId,
    month,
  );
  const opened = new Map<string, bigint>();
  for (const r of rows) {
    any = true;
    const code = String(r.account);
    const b = r.b as bigint;
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
    const k = split ? `${code}|${String(r.s1)}` : code;
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
  const chart = loadChart(db, companyId);
  const now = positionAt(db, companyId, chart, `${year}-12`);
  const before = positionAt(db, companyId, chart, `${previous}-12`);
  const both = [now, before];
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
    ],
  };
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
