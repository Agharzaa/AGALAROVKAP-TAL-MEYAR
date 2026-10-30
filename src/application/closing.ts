/**
 * Month closing (stage 5c; docs/MERHELE-5-AY-BAGLANISI.md §4.3–§4.5, §5; QERARLAR 2026-10-17
 * §6–§8). One document per company and month (AB-2026-09), dated the month's last day; its steps
 * run in one transaction — all of them are stored, or none:
 *
 *   1. checks: blocking (month not over, previous month open, a missing month-end rate, negative
 *      stock or cash on a day of the month, registers ≠ journal) and warnings, which the
 *      accountant acknowledges (kept with the closing);
 *   2. FIFO re-costing: what is left of every product at strict FIFO value; the difference to the
 *      books is adjusted where the month's goods went, by quantity (Dt 701 / 721 / 731 … / Kt 20x or
 *      back; a share to another stock account, or nothing out, goes to 701); sales are not posted again;
 *   3. currency revaluation: the month's YQ- document (5b) — posted, or posted again when stale;
 *   4. purchase VAT offset: Dt 521.01 / Kt 241 for the VAT paid on purchases whose e-qaimə DVX
 *      confirmed (through the VAT deposit; individuals, foreign partners and currency invoices
 *      pro rata of what was paid); the rest waits on 241;
 *   5. 6xx / 7xx → 801, per subkonto key;
 *   6. 801 → 341; in December the year's profit tax (Dt 901 / Kt 521.04, 901 → 341; stage 9d) and
 *      then 341 → 343;
 *   7. the period is closed through the month's end.
 *
 * Each step is its own entry of the closing (source type "closing"); after it 6xx / 7xx / 801
 * must be zero, or nothing is stored. Months close in order; only the last closed month is
 * cancelled: its entries are stornoed and the lock goes back to where it was. The revaluation is
 * a document of its own and stays posted: it is right for the month whether closed or not, and
 * the next closing checks it again. Closing again after a cancellation is a new version.
 */
import type { Account, Chart } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { fifoRemainder, type StockLayer } from '../domain/invoice.js';
import { displayMinor, formatMinor, roundHalfAwayFromZero, type Minor } from '../domain/money.js';
import { checkPostings, storno, type Posting } from '../domain/posting.js';
import { formatQty } from '../domain/quantity.js';
import { monthEnd } from '../domain/rates.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type {
  ClosingPosting,
  ClosingStep,
  ClosingStepKey,
  ClosingSummary,
  ClosingView,
  Signal,
} from '../contracts/queries.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import { depositPaid } from './money.js';
import { checkMonth, revaluationStep, type RevaluationStep } from './revaluation.js';
import { expectVersion, loadChart, rowToPosting, type Tx } from './tx.js';
import { termsOf } from './assets.js';
import { payrollSignals } from './payroll.js';
import { timesheetSignals } from './timesheets.js';
import { checkSideValues } from './subkonto.js';
import { depreciatedThrough, depreciationFor } from '../domain/assets.js';
import { profitTaxStep } from './profit-tax.js';

export const CLOSING = 'closing';

/** What the closing reads from the reports layer (passed in: reports.ts imports this module). */
export interface ClosingControls {
  name(kind: string, id: string): string;
  /** Signals of the month: advances not offset, transfers in transit, VAT deposit pairs, DVX. */
  warnings(month: string): Signal[];
  /** The month's registers against its journal: the problems found. */
  integrity(month: string): string[];
}

const dmy = (iso: string) => iso.split('-').reverse().join('.');
const money = (m: Minor) => formatMinor(m);
/** Amounts inside texts, as the accountant reads them ("1 234,05"). */
const show = (m: Minor) => displayMinor(m);
const number = (month: string) => `AB-${month}`;
const keyOf = (account: string, sk: readonly string[]) =>
  [account, sk[0] ?? '', sk[1] ?? '', sk[2] ?? ''].join('|');
const signal = (kind: Signal['kind'], text: string, account = '', sk: string[] = []): Signal => ({
  kind,
  text,
  account,
  sk,
});
/** Signals listed one by one before the rest is summed up in a single line. */
const LIMIT = 10;

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function role(db: Db, companyId: string, name: string, what: string): string {
  const r = db.get(
    'SELECT id FROM items WHERE company_id=? AND role=? AND archived=0',
    companyId,
    name,
  );
  if (!r)
    throw new DomainError(
      `Ay bağlanışı üçün standart "${what}" elementi təyin edilməyib. Siyahılar bölməsində elementi açıb "Yazılış qaydalarında" sahəsini seçin.`,
      undefined,
      'not-found',
    );
  return String(r.id);
}

/** Accounts closed to 801: every postable 6xx / 7xx account. */
const resultAccounts = (chart: Chart) =>
  chart.all().filter((a) => /^[67]/.test(a.code) && chart.postable(a.code));

// ---------------------------------------------------------------------------------------------
// Step 1 — checks

/**
 * Days of the month on which a stock (quantity) or a cashbox (AZN, currency) went below zero:
 * the opening balance from the registers, then the journal of the month day by day.
 */
function negativeDays(
  db: Db,
  companyId: string,
  account: string,
  month: string,
  measure: 'qty' | 'amount' | 'cur',
): { key: string; date: string; balance: bigint }[] {
  const [dt, kt, reg] = {
    qty: ['dt_qty', 'kt_qty', 'qty_dt-qty_kt'],
    amount: ['amount', 'amount', 'debit-credit'],
    cur: ['dt_cur', 'kt_cur', 'cur_dt-cur_kt'],
  }[measure];
  const start = `${month}-01`;
  const end = monthEnd(month);
  return db
    .all(
      `WITH opening AS (
         SELECT s1, SUM(${reg}) AS b FROM registers WHERE company_id=?1 AND account=?2 AND month<?3 GROUP BY s1
       ), moves AS (
         SELECT s1, date, SUM(m) AS m FROM (
           SELECT dt_s1 AS s1, date, ${dt} AS m FROM postings WHERE company_id=?1 AND dt_account=?2 AND date BETWEEN ?4 AND ?5
           UNION ALL
           SELECT kt_s1, date, -${kt} FROM postings WHERE company_id=?1 AND kt_account=?2 AND date BETWEEN ?4 AND ?5
         ) GROUP BY s1, date
       ), running AS (
         SELECT m.s1, m.date, COALESCE(o.b,0) + SUM(m.m) OVER (PARTITION BY m.s1 ORDER BY m.date) AS b
         FROM moves m LEFT JOIN opening o ON o.s1=m.s1
         UNION ALL
         SELECT s1, ?5, b FROM opening WHERE s1 NOT IN (SELECT s1 FROM moves)
       )
       SELECT s1, MIN(date) AS date, MIN(b) AS b FROM running WHERE b<0 GROUP BY s1 ORDER BY s1`,
      companyId,
      account,
      month,
      start,
      end,
    )
    .map((r) => ({ key: String(r.s1), date: String(r.date), balance: r.b as bigint }));
}

function negativeBalances(
  db: Db,
  companyId: string,
  chart: Chart,
  month: string,
  name: ClosingControls['name'],
): Signal[] {
  const out: Signal[] = [];
  const stock = chart
    .all()
    .filter((a) => a.quantitative && chart.postable(a.code) && a.subkonto[0] === 'product');
  for (const a of stock)
    for (const n of negativeDays(db, companyId, a.code, month, 'qty'))
      out.push(
        signal(
          'stock',
          `${a.code} · ${name('product', n.key)}: ${dmy(n.date)} tarixində mənfi qalıq.`,
          a.code,
          [n.key],
        ),
      );
  const cash = chart.all().filter((a) => a.code.startsWith('221') && chart.postable(a.code));
  for (const a of cash)
    for (const measure of a.currency ? (['amount', 'cur'] as const) : (['amount'] as const))
      for (const n of negativeDays(db, companyId, a.code, month, measure))
        out.push(
          signal(
            'cash',
            `${a.code} · ${name('cashbox', n.key)}: ${dmy(n.date)} tarixində mənfi kassa qalığı${measure === 'cur' ? ' (valyuta ilə)' : ''}.`,
            a.code,
            [n.key],
          ),
        );
  return out;
}

// ---------------------------------------------------------------------------------------------
// Step 2a — depreciation of fixed assets (stage 7b; docs/MERHELE-7-ESAS-VESAITLER.md §4.2, §5)

/**
 * Straight-line depreciation of every asset in service by the terms of its document: what the
 * schedule says is due through this month, less what 112 already holds above the opening
 * balance — so a month closed without it (the lock alone, or before 7b) is made up here, and
 * nothing goes beyond cost − salvage. Dt the asset's expense account / Kt 112, at month end.
 */
function depreciationStep(
  db: Db,
  companyId: string,
  chart: Chart,
  month: string,
  name: (kind: string, id: string) => string,
): Draft & { assets: number; blocking: Signal[]; warnings: Signal[] } {
  const end = monthEnd(month);
  const postings: Posting[] = [];
  const notes: string[] = [];
  const blocking: Signal[] = [];
  const warnings: Signal[] = [];
  const balances = new Map<string, { cost: bigint; dep: bigint }>();
  for (const r of db.all(
    `SELECT asset, SUM(cost) AS cost, SUM(dep) AS dep FROM (
       SELECT dt_s1 AS asset, amount AS cost, 0 AS dep FROM postings WHERE company_id=?1 AND dt_account='111' AND date<=?2
       UNION ALL SELECT kt_s1, -amount, 0 FROM postings WHERE company_id=?1 AND kt_account='111' AND date<=?2
       UNION ALL SELECT kt_s1, 0, amount FROM postings WHERE company_id=?1 AND kt_account='112' AND date<=?2
       UNION ALL SELECT dt_s1, 0, -amount FROM postings WHERE company_id=?1 AND dt_account='112' AND date<=?2)
     GROUP BY asset`,
    companyId,
    end,
  ))
    balances.set(String(r.asset), { cost: r.cost as bigint, dep: r.dep as bigint });
  const lines =
    chart.get('111')?.subkonto[0] === 'fixedAsset'
      ? db.all(
          `SELECT l.*, d.date AS doc_date, a.name, a.inventory_no FROM asset_lines l
             JOIN asset_documents d ON d.id=l.document_id JOIN fixed_assets a ON a.id=l.asset_id
           WHERE l.company_id=? AND d.status='posted' AND d.date<=? AND d.kind IN('commission','opening')
           ORDER BY a.inventory_no`,
          companyId,
          end,
        )
      : [];
  for (const l of lines) {
    const asset = String(l.asset_id);
    const label = `${String(l.inventory_no)} ${String(l.name)}`;
    const b = balances.get(asset) ?? { cost: 0n, dep: 0n };
    if (b.dep > b.cost)
      blocking.push(
        signal(
          'closing',
          `${label}: yığılmış amortizasiya (${show(b.dep)}) ilkin dəyərdən (${show(b.cost)}) böyükdür — 111 / 112 yazılışlarını yoxlayın.`,
          '112',
          [asset],
        ),
      );
    // Disposed (7c) or never on 111: nothing to depreciate.
    if (b.cost <= 0n) continue;
    const terms = termsOf(l, String(l.doc_date));
    const due = terms.accumulated + depreciatedThrough(terms, month);
    const room = b.cost - (l.salvage as bigint) - b.dep;
    let amount = due - b.dep;
    if (amount > room) amount = room;
    if (amount <= 0n) continue;
    const regular = depreciationFor(terms, month);
    if (amount > regular)
      notes.push(
        `${label}: əvvəlki aylardan qalan amortizasiya da bu ayda yazılır (${show(amount - regular)}; bu ayın payı ${show(regular)}).`,
      );
    const account = chart.get(String(l.expense_account));
    const sk = JSON.parse(String(l.expense_sk)) as string[];
    try {
      if (!account || !chart.postable(account.code))
        throw new DomainError(
          `${String(l.expense_account)} hesabı yoxdur və ya yazılış qəbul etmir.`,
        );
      checkSideValues(db, companyId, account, sk, 'expenseSk', '');
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      blocking.push(
        signal(
          'closing',
          `${label}: amortizasiyanın xərci yazıla bilmir — ${e.message} İstismara vermə sənədində xərc hesabını düzəldin.`,
        ),
      );
      continue;
    }
    postings.push({
      dt: { account: account.code, sk },
      kt: { account: '112', sk: [asset] },
      amount,
      memo: `Amortizasiya ${month}: ${label}`,
    });
  }
  // 113 waiting for months: an asset bought but not put into service?
  const since = monthEnd(previousMonth(previousMonth(previousMonth(month))));
  for (const r of db.all(
    `SELECT product, SUM(a) AS amount, MAX(d) AS last FROM (
       SELECT dt_s1 AS product, amount AS a, date AS d FROM postings WHERE company_id=?1 AND dt_account='113' AND date<=?2
       UNION ALL SELECT kt_s1, -amount, '' FROM postings WHERE company_id=?1 AND kt_account='113' AND date<=?2)
     GROUP BY product HAVING SUM(a)>0 AND MAX(d)<=?3`,
    companyId,
    end,
    since,
  ))
    warnings.push(
      signal(
        'closing',
        `113-də "${name('product', String(r.product))}" ${dmy(String(r.last))} tarixindən qalır (${show(r.amount as bigint)}) — istismara verilməyib? Əsas vəsaitdirsə, "İstismara vermə" sənədi ilə 111-ə keçirin.`,
        '113',
        [String(r.product)],
      ),
    );
  return { postings, notes, assets: postings.length, blocking, warnings };
}

// ---------------------------------------------------------------------------------------------
// Step 2 — FIFO re-costing

interface Draft {
  postings: Posting[];
  notes: string[];
}

interface Outflow {
  target: { account: string; sk: string[] };
  /** The goods went to another quantitative (stock) account. */
  stock: boolean;
  quantity: bigint;
}

function fifoStep(
  db: Db,
  companyId: string,
  chart: Chart,
  month: string,
): Draft & { products: number } {
  const end = monthEnd(month);
  const postings: Posting[] = [];
  const notes: string[] = [];
  const products = new Set<string>();
  const stock = chart
    .all()
    .filter(
      (a) =>
        a.code.startsWith('20') &&
        a.quantitative &&
        chart.postable(a.code) &&
        a.subkonto.length === 1 &&
        a.subkonto[0] === 'product',
    );
  let cogs = '';
  let defaultGroup = '';
  const groups = new Map(
    db
      .all('SELECT id, group_id FROM products WHERE company_id=?', companyId)
      .map((r) => [String(r.id), String(r.group_id ?? '')]),
  );
  for (const account of stock) {
    const layers = new Map<string, StockLayer[]>();
    for (const r of db.all(
      `SELECT p.dt_s1 AS product, e.source_type||':'||e.source_id AS s, MIN(e.rowid) AS seq,
         SUM(p.dt_qty) AS q, SUM(p.amount) AS a
       FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE p.company_id=? AND p.dt_account=? AND p.dt_qty<>0 AND p.date<=?
       GROUP BY p.dt_s1, e.source_type, e.source_id, p.date
       HAVING SUM(p.dt_qty)>0
       ORDER BY p.dt_s1, p.date, seq`,
      companyId,
      account.code,
      end,
    )) {
      const list = layers.get(String(r.product)) ?? [];
      list.push({ source: String(r.s), quantity: r.q as bigint, value: r.a as bigint });
      layers.set(String(r.product), list);
    }
    // Where the month's goods went (storno nets a cancelled outflow out); not the closing's own.
    const outflows = new Map<string, Outflow[]>();
    for (const r of db.all(
      `SELECT p.kt_s1 AS product, p.dt_account, p.dt_s1, p.dt_s2, p.dt_s3, SUM(p.kt_qty) AS q
       FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE p.company_id=? AND p.kt_account=? AND p.kt_qty<>0 AND p.date BETWEEN ? AND ?
         AND e.source_type<>'${CLOSING}'
       GROUP BY p.kt_s1, p.dt_account, p.dt_s1, p.dt_s2, p.dt_s3
       HAVING SUM(p.kt_qty)>0`,
      companyId,
      account.code,
      `${month}-01`,
      end,
    )) {
      const sk = [String(r.dt_s1), String(r.dt_s2), String(r.dt_s3)];
      while (sk.length && !sk[sk.length - 1]) sk.pop();
      const list = outflows.get(String(r.product)) ?? [];
      list.push({
        target: { account: String(r.dt_account), sk },
        stock: !!chart.get(String(r.dt_account))?.quantitative,
        quantity: r.q as bigint,
      });
      outflows.set(String(r.product), list);
    }
    for (const b of db.all(
      `SELECT s1, SUM(debit-credit) AS v, SUM(qty_dt-qty_kt) AS q FROM registers
       WHERE company_id=? AND account=? AND month<=? GROUP BY s1`,
      companyId,
      account.code,
      month,
    )) {
      const product = String(b.s1);
      const quantity = b.q as bigint;
      const booked = b.v as bigint;
      // A negative stock is refused by the checks; nothing is re-costed under it.
      if (quantity < 0n) continue;
      const value = fifoRemainder(layers.get(product) ?? [], quantity);
      if (value === null) {
        notes.push(
          `${account.code}: malın qalığı (${formatQty(quantity)}) daxilolmalardan çoxdur — maya dəyəri dəqiqləşdirilmədi.`,
        );
        continue;
      }
      const diff = booked - value;
      if (!diff) continue;
      cogs ||= role(db, companyId, 'cogs', 'Satılmış malların maya dəyəri');
      const group =
        groups.get(product) ||
        (defaultGroup ||= role(db, companyId, 'defaultProductGroup', 'Əsas nomenklatura qrupu'));
      const goods = { account: account.code, sk: [product] };
      for (const [target, amount] of shares(diff, outflows.get(product) ?? [], {
        account: '701',
        sk: [group, cogs],
      }))
        postings.push({
          dt: amount > 0n ? target : goods,
          kt: amount > 0n ? goods : target,
          amount: amount > 0n ? amount : -amount,
          memo: 'Maya dəyərinin dəqiqləşdirilməsi (FIFO)',
        });
      products.add(product);
    }
  }
  return { postings, notes, products: products.size };
}

/**
 * The difference split over where the goods went this month, by quantity (cumulative rounding,
 * so the parts sum to it exactly). A share that went to another stock account goes to 701: an
 * adjustment there, without quantity, would not be a FIFO layer of that account. Nothing out
 * this month — all of it to 701.
 */
function shares(
  diff: Minor,
  out: readonly Outflow[],
  cogs: { account: string; sk: string[] },
): [{ account: string; sk: string[] }, Minor][] {
  const total = out.reduce((s, o) => s + o.quantity, 0n);
  if (total <= 0n) return [[cogs, diff]];
  const targets = new Map<
    string,
    { target: { account: string; sk: string[] }; quantity: bigint }
  >();
  for (const o of out) {
    const target = o.stock ? cogs : o.target;
    const key = `${target.account}|${target.sk.join('|')}`;
    const t = targets.get(key) ?? { target, quantity: 0n };
    t.quantity += o.quantity;
    targets.set(key, t);
  }
  const list = [...targets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const result: [{ account: string; sk: string[] }, Minor][] = [];
  let seen = 0n;
  let given = 0n;
  for (const [, t] of list) {
    seen += t.quantity;
    const upTo = roundHalfAwayFromZero(diff * seen, total);
    if (upTo !== given) result.push([t.target, upTo - given]);
    given = upTo;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Step 4 — purchase VAT offset

/**
 * What the month's closing would offset (Dt 521.01 / Kt 241) if it ran now: the ƏDV return of an
 * open month (plan §5.1, audit 0.9.9); null when the plan cannot be computed.
 */
export function plannedVatOffset(db: Db, companyId: string, month: string): Minor | null {
  return plannedVatPostings(db, companyId, month)?.reduce((s, p) => s + p.amount, 0n) ?? null;
}

/** The same plan line by line (Kt 241 by invoice): the return's list of offset e-qaimələr. */
export function plannedVatPostings(db: Db, companyId: string, month: string): Posting[] | null {
  try {
    return vatStep(db, companyId, loadChart(db, companyId), month).postings.filter(
      (p) => p.dt.account === '521.01',
    );
  } catch (e) {
    if (e instanceof DomainError) return null;
    throw e;
  }
}

function vatStep(
  db: Db,
  companyId: string,
  chart: Chart,
  month: string,
): Draft & { waiting: Signal[] } {
  const end = monthEnd(month);
  const postings: Posting[] = [];
  const notes: string[] = [];
  const waiting: Signal[] = [];
  if (!chart.get('241') || !chart.get('521.01')) return { postings, notes, waiting };
  const docs = new Map<
    string,
    { partner: string; keys: { rate: string; d: bigint; c: bigint }[] }
  >();
  for (const r of db.all(
    `SELECT s1, s2, s3, SUM(debit) AS d, SUM(credit) AS c FROM registers
     WHERE company_id=? AND account='241' AND month<=? AND s2 LIKE 'invoice:%'
     GROUP BY s1, s2, s3 ORDER BY s2, s3`,
    companyId,
    month,
  )) {
    const doc = docs.get(String(r.s2)) ?? { partner: String(r.s1), keys: [] };
    doc.keys.push({ rate: String(r.s3), d: r.d as bigint, c: r.c as bigint });
    docs.set(String(r.s2), doc);
  }
  const payables = chart
    .all()
    .filter((a) => a.code.startsWith('531') && chart.postable(a.code))
    .map((a) => a.code);
  let vatTax = '';
  let unconfirmed = 0;
  let unpaid = 0;
  let unpaidVat = 0n;
  for (const [document, doc] of docs) {
    const debit = doc.keys.reduce((s, k) => s + k.d, 0n);
    const credit = doc.keys.reduce((s, k) => s + k.c, 0n);
    const open = debit - credit;
    if (open <= 0n) continue;
    const inv = db.get(
      `SELECT i.*, p.kind AS partner_kind, p.name AS partner_name FROM invoices i
         JOIN partners p ON p.company_id=i.company_id AND p.id=i.partner_id
       WHERE i.company_id=? AND i.id=? AND i.direction='purchase' AND i.status='posted'`,
      companyId,
      document.slice('invoice:'.length),
    );
    if (!inv) continue;
    const label = `${String(inv.number)} · ${dmy(String(inv.date))} · ${String(inv.partner_name)}`;
    const confirmed = db.get(
      `SELECT SUM(vat) AS vat FROM eq_documents WHERE company_id=? AND direction='purchase'
         AND invoice_id=? AND status='accepted' HAVING COUNT(*) > 0`,
      companyId,
      String(inv.id),
    );
    if (!confirmed) {
      if (++unconfirmed <= LIMIT)
        waiting.push({
          ...signal(
            'vatUnconfirmed',
            `${label}: ƏDV ${show(open)} — e-qaiməsi DVX-də təsdiqlənməyib, əvəzləşdirilmir (241-də qalır).`,
            '241',
            [doc.partner, document],
          ),
          invoice: { id: String(inv.id), direction: 'purchase' },
        });
      continue;
    }
    // What reached the invoice by the month's end: through the VAT deposit, or — for individuals,
    // foreign partners and currency invoices, which pay VAT with the rest — pro rata.
    let paid = 0n;
    const key = db.get(
      `SELECT account, SUM(debit) AS d, SUM(credit) AS c, SUM(cur_dt) AS cd, SUM(cur_kt) AS ck
       FROM registers WHERE company_id=? AND account IN (${payables.map(() => '?').join(',') || "''"})
         AND s1=? AND s2=? AND s3=? AND month<=? GROUP BY account ORDER BY SUM(credit) DESC LIMIT 1`,
      companyId,
      ...payables,
      String(inv.partner_id),
      String(inv.contract_id),
      document,
      month,
    );
    if (key) {
      const whole =
        inv.currency !== 'AZN' ||
        inv.partner_kind === 'individual' ||
        inv.partner_kind === 'foreign';
      if (!whole)
        paid = depositPaid(
          db,
          companyId,
          'out',
          String(key.account),
          String(inv.partner_id),
          String(inv.contract_id),
          document,
          end,
        );
      else {
        const [settled, owed] =
          inv.currency !== 'AZN'
            ? [key.cd as bigint, key.ck as bigint]
            : [key.d as bigint, key.c as bigint];
        const share = settled < owed ? settled : owed;
        paid = owed > 0n && share > 0n ? roundHalfAwayFromZero(debit * share, owed) : 0n;
      }
    }
    if (paid > debit) paid = debit;
    // Never more than DVX confirmed: an invoice saved with other VAT than its e-qaimə (a warning
    // since 25.10.2026) offsets only the e-qaimə's VAT; the rest waits on 241 for the accountant.
    const dvxVat = confirmed.vat as bigint;
    if (paid > dvxVat) {
      paid = dvxVat;
      notes.push(
        `${label}: qaimədə ƏDV ${show(debit)}, DVX-də ƏDV ${show(dvxVat)} — yalnız DVX-dəki əvəzləşdirilir, fərq 241-də qalır.`,
      );
    }
    const due = paid - credit;
    let offset = due < open ? due : open;
    if (offset < open) {
      unpaid++;
      unpaidVat += open - (offset > 0n ? offset : 0n);
    }
    if (offset <= 0n) continue;
    vatTax ||= role(db, companyId, 'vatTax', 'Vergi (haqq)');
    for (const k of doc.keys) {
      const left = k.d - k.c;
      if (left <= 0n || offset <= 0n) continue;
      const amount = left < offset ? left : offset;
      offset -= amount;
      postings.push({
        dt: { account: '521.01', sk: [vatTax] },
        kt: { account: '241', sk: [doc.partner, document, k.rate] },
        amount,
        memo: `ƏDV əvəzləşdirilməsi · ${String(inv.number)}`,
      });
    }
  }
  if (unconfirmed > LIMIT)
    waiting.push(
      signal(
        'vatUnconfirmed',
        `Daha ${unconfirmed - LIMIT} alış qaiməsinin e-qaiməsi DVX-də təsdiqlənməyib.`,
        '241',
      ),
    );
  if (unpaid)
    notes.push(
      `${unpaid} qaimənin ƏDV-si (${show(unpaidVat)}) hələ ödənilməyib — 241-də qalır, sonrakı bağlanışda yoxlanır.`,
    );
  return { postings, notes, waiting };
}

// ---------------------------------------------------------------------------------------------
// Steps 5–6 — 6xx / 7xx → 801 → 341 (→ 343 in December)

interface Balance {
  account: Account;
  sk: string[];
  amount: bigint;
}

/** Signed (debit − credit) balances of the result accounts, 801, 341 and 343 at the month end. */
function resultBalances(
  db: Db,
  companyId: string,
  chart: Chart,
  month: string,
  extra: readonly Posting[],
): Map<string, Balance> {
  const accounts = [...resultAccounts(chart).map((a) => a.code), '801', '341', '343', '901'].filter(
    (c) => chart.get(c),
  );
  const out = new Map<string, Balance>();
  const add = (account: string, sk: readonly string[], amount: bigint) => {
    const a = chart.get(account);
    if (!a || !accounts.includes(account)) return;
    const k = keyOf(account, sk);
    const b = out.get(k) ?? { account: a, sk: sk.slice(0, a.subkonto.length), amount: 0n };
    b.amount += amount;
    out.set(k, b);
  };
  for (const r of db.all(
    `SELECT account, s1, s2, s3, SUM(debit-credit) AS b FROM registers
     WHERE company_id=? AND month<=? AND account IN (${accounts.map(() => '?').join(',')})
     GROUP BY account, s1, s2, s3`,
    companyId,
    month,
    ...accounts,
  ))
    add(String(r.account), [String(r.s1), String(r.s2), String(r.s3)], r.b as bigint);
  for (const p of extra) {
    add(p.dt.account, p.dt.sk, p.amount);
    add(p.kt.account, p.kt.sk, -p.amount);
  }
  return out;
}

interface CloseOut {
  income: Posting[];
  totals: ClosingStep['totals'];
  result: Posting[];
  year: Posting[];
  /** 801 result: profit positive, loss negative. */
  profit: bigint;
}

function closeOut(
  db: Db,
  companyId: string,
  chart: Chart,
  month: string,
  extra: readonly Posting[],
): CloseOut {
  const balances = resultBalances(db, companyId, chart, month, extra);
  const income: Posting[] = [];
  const perAccount = new Map<string, { debit: bigint; credit: bigint }>();
  const keys = [...balances.values()]
    .filter((b) => /^[67]/.test(b.account.code) && b.amount !== 0n)
    .sort(
      (x, y) =>
        x.account.code.localeCompare(y.account.code) || x.sk.join().localeCompare(y.sk.join()),
    );
  let to801 = 0n;
  for (const b of keys) {
    const side = { account: b.account.code, sk: b.sk };
    const r = { account: '801', sk: [] };
    // A credit balance (income) is debited away to 801, a debit balance (expense) credited.
    income.push({
      dt: b.amount < 0n ? side : r,
      kt: b.amount < 0n ? r : side,
      amount: b.amount < 0n ? -b.amount : b.amount,
      memo: `Ay bağlanışı · ${b.account.code} → 801`,
    });
    to801 += b.amount;
    const t = perAccount.get(b.account.code) ?? { debit: 0n, credit: 0n };
    if (b.amount > 0n) t.debit += b.amount;
    else t.credit -= b.amount;
    perAccount.set(b.account.code, t);
  }
  const totals = [...perAccount].map(([account, t]) => ({
    account,
    name: chart.get(account)!.name,
    debit: money(t.debit),
    credit: money(t.credit),
  }));
  const b801 = (balances.get(keyOf('801', []))?.amount ?? 0n) + to801;
  const result: Posting[] = [];
  const r801 = { account: '801', sk: [] };
  const r341 = { account: '341', sk: [] };
  const r343 = { account: '343', sk: [] };
  if (b801 < 0n)
    result.push({ dt: r801, kt: r341, amount: -b801, memo: 'Ay bağlanışı · mənfəət 801 → 341' });
  if (b801 > 0n)
    result.push({ dt: r341, kt: r801, amount: b801, memo: 'Ay bağlanışı · zərər 801 → 341' });
  const year: Posting[] = [];
  if (month.endsWith('-12')) {
    const b341 = (balances.get(keyOf('341', []))?.amount ?? 0n) + b801;
    if (b341 < 0n)
      year.push({ dt: r341, kt: r343, amount: -b341, memo: 'İl bağlanışı · mənfəət 341 → 343' });
    if (b341 > 0n)
      year.push({ dt: r343, kt: r341, amount: b341, memo: 'İl bağlanışı · zərər 341 → 343' });
  }
  return { income, totals, result, year, profit: -b801 };
}

// ---------------------------------------------------------------------------------------------
// The plan: what closing the month does now

interface Plan {
  month: string;
  date: string;
  blocking: Signal[];
  warnings: Signal[];
  fifo: Draft & { products: number };
  depreciation: Draft & { assets: number };
  revaluation: RevaluationStep | null;
  vat: Draft;
  /** December (stage 9d): the year's profit tax. */
  profitTax: (Draft & { tax: bigint }) | null;
  out: CloseOut;
}

const closingRow = (db: Db, companyId: string, month: string) =>
  db.get('SELECT * FROM month_closings WHERE company_id=? AND month=?', companyId, month);

/** Why the month cannot be closed now, before any step: its turn, its date, the lock. */
function order(db: Db, companyId: string, month: string, today: string): Signal[] {
  const date = monthEnd(month);
  const closed = String(
    db.get('SELECT closed_through FROM companies WHERE id=?', companyId)!.closed_through,
  );
  const out: Signal[] = [];
  if (date >= today)
    out.push(
      signal('closing', `Ay hələ bitməyib: ${month} ${dmy(nextDay(date))} tarixindən bağlanır.`),
    );
  if (closed >= date)
    out.push(
      signal(
        'closing',
        `Dövr ${dmy(closed)} tarixinədək ay bağlanışı olmadan bağlanıb (Dövrün bağlanması). Ayı bağlamaq üçün dövrü əvvəlcə ${dmy(monthEnd(previousMonth(month)))} tarixinədək açın.`,
      ),
    );
  const previous = previousMonth(month);
  const prevEnd = monthEnd(previous);
  if (
    closed < prevEnd &&
    db.get(
      'SELECT 1 FROM postings WHERE company_id=? AND date>? AND date<=? LIMIT 1',
      companyId,
      closed,
      prevEnd,
    )
  )
    out.push(
      signal(
        'closing',
        `${previous} ayı bağlanmayıb: aylar ardıcıl bağlanır, əvvəlcə onu bağlayın.`,
      ),
    );
  return out;
}

function buildPlan(
  db: Db,
  companyId: string,
  month: string,
  today: string,
  controls: ClosingControls,
): Plan {
  const chart = loadChart(db, companyId);
  const blocking = order(db, companyId, month, today);
  const attempt = <T>(kind: Signal['kind'], fallback: T, fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      blocking.push(signal(kind, e.message));
      return fallback;
    }
  };
  blocking.push(...negativeBalances(db, companyId, chart, month, controls.name));
  for (const problem of controls.integrity(month)) blocking.push(signal('integrity', problem));
  const fifo = attempt<Plan['fifo']>('closing', { postings: [], notes: [], products: 0 }, () =>
    fifoStep(db, companyId, chart, month),
  );
  const depreciation = attempt<ReturnType<typeof depreciationStep>>(
    'closing',
    { postings: [], notes: [], assets: 0, blocking: [], warnings: [] },
    () => depreciationStep(db, companyId, chart, month, controls.name),
  );
  blocking.push(...depreciation.blocking);
  // Stage 8b / 8c: the month's payroll.
  const payroll = payrollSignals(db, companyId, month);
  blocking.push(...payroll.blocking.map((t) => signal('closing', t, '533')));
  blocking.push(...timesheetSignals(db, companyId, month).map((t) => signal('closing', t, '533')));
  // A missing month-end rate or two currencies on one key: the revaluation cannot be computed.
  const revaluation = attempt<RevaluationStep | null>('rate', null, () =>
    revaluationStep(db, companyId, month),
  );
  const vat = attempt('closing', { postings: [], notes: [], waiting: [] as Signal[] }, () =>
    vatStep(db, companyId, chart, month),
  );
  const before = [
    ...fifo.postings,
    ...depreciation.postings,
    ...(revaluation?.delta ?? []),
    ...vat.postings,
  ];
  const profitTax = month.endsWith('-12')
    ? attempt<Plan['profitTax']>('closing', null, () =>
        profitTaxStep(db, companyId, month, before, role(db, companyId, 'vatTax', 'Vergi (haqq)')),
      )
    : null;
  const out = closeOut(db, companyId, chart, month, [...before, ...(profitTax?.postings ?? [])]);
  return {
    month,
    date: monthEnd(month),
    blocking,
    warnings: [
      ...controls.warnings(month),
      ...depreciation.warnings,
      ...payroll.warnings.map((t) => signal('closing', t, '533')),
      ...vat.waiting,
    ],
    fifo,
    depreciation,
    revaluation,
    vat,
    profitTax,
    out,
  };
}

// ---------------------------------------------------------------------------------------------
// Steps as shown and stored

const toView = (p: Posting): ClosingPosting => ({
  dt: p.dt.account,
  dtSk: p.dt.sk,
  dtNames: [],
  kt: p.kt.account,
  ktSk: p.kt.sk,
  ktNames: [],
  amount: money(p.amount),
  memo: p.memo,
});

const sum = (postings: readonly Posting[]) => postings.reduce((s, p) => s + p.amount, 0n);

function steps(plan: Plan, posted: boolean): ClosingStep[] {
  const step = (
    key: ClosingStepKey,
    title: string,
    postings: readonly Posting[],
    summary: string,
    notes: string[] = [],
    totals: ClosingStep['totals'] = [],
  ): ClosingStep => ({
    key,
    title,
    state: plan.blocking.length && !posted ? 'blocked' : postings.length ? 'done' : 'empty',
    summary,
    postings: postings.map(toView),
    notes,
    totals,
  });
  const r = plan.revaluation;
  const { out } = plan;
  const december = plan.month.endsWith('-12');
  const list: ClosingStep[] = [
    {
      key: 'checks',
      title: 'Yoxlamalar',
      state: plan.blocking.length ? 'blocked' : 'done',
      summary: plan.blocking.length
        ? `${plan.blocking.length} bloklayan yoxlama`
        : `Bloklayan yoxlama yoxdur${plan.warnings.length ? ` · ${plan.warnings.length} xəbərdarlıq` : ''}`,
      postings: [],
      notes: [],
      totals: [],
    },
    step(
      'fifo',
      'Maya dəyərinin dəqiqləşdirilməsi (FIFO)',
      plan.fifo.postings,
      plan.fifo.postings.length
        ? `${plan.fifo.products} mal üzrə düzəliş · ${show(sum(plan.fifo.postings))}`
        : 'Maya dəyəri FIFO ilə uyğundur',
      plan.fifo.notes,
    ),
    step(
      'depreciation',
      'Əsas vəsaitlərin amortizasiyası',
      plan.depreciation.postings,
      plan.depreciation.postings.length
        ? `${plan.depreciation.assets} əsas vəsait · ${show(sum(plan.depreciation.postings))}`
        : 'Amortizasiya olunacaq əsas vəsait yoxdur',
      plan.depreciation.notes,
    ),
    step(
      'revaluation',
      'Valyuta qalıqlarının yenidən qiymətləndirilməsi',
      r?.lines ?? [],
      !r
        ? 'Hesablanmadı (yuxarıdakı yoxlamaya baxın)'
        : r.action === 'none'
          ? 'Yenidən qiymətləndiriləcək valyuta qalığı yoxdur'
          : r.action === 'takeBack'
            ? `${r.number}: fərq qalmayıb — storno ${posted ? 'edildi' : 'ediləcək'}`
            : `${r.number}${r.action === 'keep' ? ' (uçotdadır)' : posted ? '' : ' (uçota alınacaq)'} · gəlir 611: ${show(r.income)} · xərc 731: ${show(r.expense)}`,
      r && r.action !== 'none'
        ? [
            `Məzənnələr: ${
              Object.entries(r.rates)
                .map(([c, x]) => `${c} ${x.rate} (${dmy(x.date)})`)
                .join(', ') || '—'
            }.`,
          ]
        : [],
    ),
    step(
      'vat',
      'Alış ƏDV-sinin əvəzləşdirilməsi (241 → 521.01)',
      plan.vat.postings,
      plan.vat.postings.length
        ? `${new Set(plan.vat.postings.map((p) => p.kt.sk[1])).size} qaimə · ${show(sum(plan.vat.postings))}`
        : 'Əvəzləşdiriləcək ƏDV yoxdur',
      plan.vat.notes,
    ),
    step(
      'income',
      'Gəlir və xərclərin 801-ə bağlanması',
      out.income,
      out.income.length
        ? `${out.income.length} subkonto üzrə`
        : '6xx / 7xx hesablarında qalıq yoxdur',
      [],
      out.totals,
    ),
    step(
      'result',
      'Nəticənin 341-ə keçirilməsi',
      out.result,
      out.profit > 0n
        ? `Mənfəət ${show(out.profit)}`
        : out.profit < 0n
          ? `Zərər ${show(-out.profit)}`
          : 'Nəticə sıfırdır',
    ),
  ];
  if (december)
    list.push(
      step(
        'profitTax',
        'Mənfəət vergisi (901 → 521.04, 901 → 341)',
        plan.profitTax?.postings ?? [],
        !plan.profitTax
          ? 'Hesablanmadı (yuxarıdakı yoxlamaya baxın)'
          : plan.profitTax.tax
            ? `İlin mənfəət vergisi ${show(plan.profitTax.tax)}`
            : 'Mənfəət vergisi yoxdur',
        plan.profitTax?.notes ?? [],
      ),
      step(
        'year',
        'İl bağlanışı (341 → 343)',
        out.year,
        out.year.length ? `İlin nəticəsi ${show(sum(out.year))}` : '341-də qalıq yoxdur',
      ),
    );
  list.push({
    key: 'lock',
    title: 'Dövrün bağlanması',
    state: plan.blocking.length && !posted ? 'blocked' : 'done',
    summary: `${dmy(plan.date)} daxil olmaqla ${posted ? 'bağlandı' : 'bağlanacaq'}`,
    postings: [],
    notes: [],
    totals: [],
  });
  return list;
}

// ---------------------------------------------------------------------------------------------
// Commands

export function postClosing(
  tx: Tx,
  cmd: CommandOf<'closing.post'>,
  controls: ClosingControls,
): CommandResult {
  const company = tx.company(cmd.companyId);
  const month = checkMonth(cmd.month);
  const date = monthEnd(month);
  const no = number(month);
  const row = closingRow(tx.db, cmd.companyId, month);
  if (row?.status === 'posted')
    throw new DomainError(`${no} uçotdadır: ay artıq bağlanıb.`, 'month', 'conflict');
  if (row && cmd.version !== undefined) expectVersion(row, cmd.version, 'Ay bağlanışı');
  const plan = buildPlan(tx.db, cmd.companyId, month, tx.clock.today(), controls);
  if (plan.blocking.length)
    throw new DomainError(
      `Ay bağlanmadı: ${plan.blocking
        .slice(0, 3)
        .map((s) => s.text)
        .join(
          ' ',
        )}${plan.blocking.length > 3 ? ` (daha ${plan.blocking.length - 3} yoxlama)` : ''}`,
      'month',
      'conflict',
    );
  if (plan.warnings.length && !cmd.acknowledged)
    throw new DomainError(
      `${plan.warnings.length} xəbərdarlıq var: oxuyub "Oxudum" təsdiqini verin.`,
      'acknowledged',
    );
  const id = row ? String(row.id) : tx.id();
  const version = row ? Number(row.version) + 1 : 1;
  const source = { type: CLOSING, id, number: no, version };
  const chart = tx.chart(cmd.companyId);
  const post = (postings: readonly Posting[], options = {}) => {
    // An entry holds at most 2000 lines; a long step (many products, keys) takes several.
    for (let i = 0; i < postings.length; i += 2000) {
      const entry = postings.slice(i, i + 2000);
      checkPostings(chart, entry, 'steps', options);
      tx.post(cmd.companyId, chart, source, date, false, entry);
    }
  };
  post(plan.fifo.postings, { costAdjustment: true });
  post(plan.depreciation.postings);
  const revaluation = plan.revaluation!.write(tx)?.id ?? plan.revaluation!.id;
  post(plan.vat.postings);
  // December: the profit tax from the books after steps 2–4 (the same figures the plan showed).
  const profitTax = month.endsWith('-12')
    ? profitTaxStep(
        tx.db,
        cmd.companyId,
        month,
        [],
        role(tx.db, cmd.companyId, 'vatTax', 'Vergi (haqq)'),
      )
    : null;
  if (profitTax) post(profitTax.postings);
  // Steps 5–7 read the books after steps 2–4 (the same figures the plan showed).
  const out = closeOut(tx.db, cmd.companyId, chart, month, []);
  post(out.income);
  post(out.result);
  post(out.year);
  const left = resultBalances(tx.db, cmd.companyId, chart, month, []);
  const open = [...left.values()].filter(
    (b) =>
      b.amount !== 0n &&
      (/^[67]/.test(b.account.code) ||
        b.account.code === '801' ||
        (month.endsWith('-12') && ['341', '901'].includes(b.account.code))),
  );
  if (open.length)
    throw new DomainError(
      `Bağlanışdan sonra ${[...new Set(open.map((b) => b.account.code))].join(', ')} hesablarında qalıq qalır; ay bağlanışı saxlanmadı.`,
      undefined,
      'conflict',
    );
  const done: Plan = { ...plan, profitTax, out };
  const stored = steps(done, true);
  const warnings = plan.warnings.map((w) => w.text);
  const now = tx.clock.now();
  const values = [
    String(company.closed_through),
    JSON.stringify(stored),
    JSON.stringify(plan.revaluation!.rates),
    JSON.stringify(warnings),
    revaluation,
    out.profit,
    version,
    now,
  ] as const;
  if (row)
    tx.db.run(
      `UPDATE month_closings SET closed_before=?,steps=?,rates=?,warnings=?,revaluation_id=?,profit=?,version=?,updated_at=?,
         status='posted' WHERE id=?`,
      ...values,
      id,
    );
  else
    tx.db.run(
      `INSERT INTO month_closings(closed_before,steps,rates,warnings,revaluation_id,profit,version,updated_at,
         id,company_id,month,date,number,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'posted',?)`,
      ...values,
      id,
      cmd.companyId,
      month,
      date,
      no,
      now,
    );
  tx.history(cmd.companyId, CLOSING, id, version, 'posted', { month, steps: stored, warnings });
  tx.audit(
    cmd.companyId,
    row ? 'Yenidən bağlandı' : 'Uçota alındı',
    'Ay bağlanışı',
    id,
    `${no} · ${out.profit >= 0n ? 'mənfəət' : 'zərər'} ${money(out.profit >= 0n ? out.profit : -out.profit)} AZN${warnings.length ? ` · ${warnings.length} xəbərdarlıq oxundu` : ''}`,
  );
  // The lock moves last: the closing's own row and entries are dated inside the month.
  tx.db.run('UPDATE companies SET closed_through=? WHERE id=?', date, cmd.companyId);
  tx.audit(
    cmd.companyId,
    'Dövr bağlandı',
    'Şirkət',
    cmd.companyId,
    `${date} daxil olmaqla · ${no}`,
  );
  return { id, version, number: no };
}

export function cancelClosing(tx: Tx, cmd: CommandOf<'closing.cancel'>): CommandResult {
  const company = tx.company(cmd.companyId);
  const reason = cmd.reason.trim();
  if (!reason) throw new DomainError('Ləğv səbəbini yazın.', 'reason');
  const row = tx.db.get(
    'SELECT * FROM month_closings WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('Ay bağlanışı tapılmadı.', 'id', 'not-found');
  expectVersion(row, cmd.version, 'Ay bağlanışı');
  if (row.status !== 'posted')
    throw new DomainError('Ay bağlanışı artıq ləğv edilib.', undefined, 'conflict');
  const blocked = cancelBlocked(String(company.closed_through), row);
  if (blocked) throw new DomainError(blocked, undefined, 'conflict');
  const date = String(row.date);
  const before = String(row.closed_before);
  tx.db.run('UPDATE companies SET closed_through=? WHERE id=?', before, cmd.companyId);
  tx.audit(
    cmd.companyId,
    'Dövr yenidən açıldı',
    'Şirkət',
    cmd.companyId,
    `${before ? `${before} daxil olmaqla bağlı qaldı` : 'bütün dövr açıldı'} · ${String(row.number)} ləğv edildi · ${reason}`,
  );
  const chart = tx.chart(cmd.companyId);
  const source = {
    type: CLOSING,
    id: cmd.id,
    number: String(row.number),
    version: Number(row.version),
  };
  const entries = tx.db.all(
    `SELECT id FROM entries WHERE company_id=? AND source_type=? AND source_id=? AND source_version=? AND storno=0
     ORDER BY rowid DESC`,
    cmd.companyId,
    CLOSING,
    cmd.id,
    Number(row.version),
  );
  for (const e of entries) {
    const postings = tx.db
      .all('SELECT * FROM postings WHERE entry_id=? ORDER BY line_no', String(e.id))
      .map(rowToPosting);
    tx.post(cmd.companyId, chart, source, date, true, storno(postings));
  }
  const version = Number(row.version) + 1;
  tx.db.run(
    "UPDATE month_closings SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  tx.history(cmd.companyId, CLOSING, cmd.id, version, 'cancelled', { reason });
  tx.audit(
    cmd.companyId,
    'Ləğv edildi (storno)',
    'Ay bağlanışı',
    cmd.id,
    `${String(row.number)} · ${reason}`,
  );
  return { id: cmd.id, version };
}

/** Only the last closed month is cancelled: the lock must stand at its end. */
function cancelBlocked(closed: string, row: Row): string {
  if (row.status !== 'posted') return '';
  if (closed === String(row.date)) return '';
  return `Dövr ${dmy(closed)} tarixinədək bağlanıb: yalnız sonuncu bağlanmış ay ləğv olunur. Əvvəlcə sonrakı ayın bağlanışını ləğv edin və ya dövrü ${dmy(String(row.date))} tarixinədək açın.`;
}

// ---------------------------------------------------------------------------------------------
// Queries

const summary = (r: Row): ClosingSummary => ({
  id: String(r.id),
  version: Number(r.version),
  month: String(r.month),
  number: String(r.number),
  date: String(r.date),
  status: r.status as ClosingSummary['status'],
  profit: money(r.profit as bigint),
  updatedAt: String(r.updated_at),
});

export function closingList(db: Db, companyId: string): ClosingSummary[] {
  return db
    .all('SELECT * FROM month_closings WHERE company_id=? ORDER BY month DESC', companyId)
    .map(summary);
}

/**
 * The first month not closed: the month of the first posting after the lock; with none, the
 * month after the lock; '' when nothing is posted nor locked.
 */
export function nextClosingMonth(db: Db, companyId: string): string {
  const closed = String(
    db.get('SELECT closed_through FROM companies WHERE id=?', companyId)!.closed_through,
  );
  const first = db.get(
    'SELECT MIN(date) AS d FROM postings WHERE company_id=? AND date>?',
    companyId,
    closed,
  )!.d;
  if (first) return String(first).slice(0, 7);
  return closed ? nextDay(closed).slice(0, 7) : '';
}

export function closingView(
  db: Db,
  companyId: string,
  monthInput: string,
  today: string,
  controls: ClosingControls,
): ClosingView {
  const month = checkMonth(monthInput);
  const chart = loadChart(db, companyId);
  const closed = String(
    db.get('SELECT closed_through FROM companies WHERE id=?', companyId)!.closed_through,
  );
  const row = closingRow(db, companyId, month);
  const names = (s: ClosingStep): ClosingStep => ({
    ...s,
    postings: s.postings.map((p) => {
      const of = (account: string, sk: string[]) =>
        (chart.get(account)?.subkonto ?? []).map((k, i) => (sk[i] ? controls.name(k, sk[i]!) : ''));
      return { ...p, dtNames: of(p.dt, p.dtSk), ktNames: of(p.kt, p.ktSk) };
    }),
  });
  const base = { month, date: monthEnd(month), number: number(month), closedThrough: closed };
  if (row?.status === 'posted')
    return {
      ...base,
      blocking: [],
      warnings: [],
      steps: (JSON.parse(String(row.steps)) as ClosingStep[]).map(names),
      profit: money(row.profit as bigint),
      posted: { ...summary(row), warnings: JSON.parse(String(row.warnings)) as string[] },
      cancelled: null,
      cancelBlocked: cancelBlocked(closed, row),
    };
  const plan = buildPlan(db, companyId, month, today, controls);
  return {
    ...base,
    blocking: plan.blocking,
    warnings: plan.warnings,
    steps: steps(plan, false).map(names),
    profit: money(plan.out.profit),
    posted: null,
    cancelled: row ? summary(row) : null,
    cancelBlocked: '',
  };
}
