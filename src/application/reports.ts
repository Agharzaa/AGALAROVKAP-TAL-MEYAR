/**
 * Read side. Balances come from the monthly registers plus, at most, one partial month of
 * postings, so a trial balance never scans the journal however large it grows.
 */
import {
  compareCodes,
  inFamily,
  subkontoLabel,
  vatRates,
  type Chart,
  type SubkontoKind,
} from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { formatMinor } from '../domain/money.js';
import { formatPrice, formatQty } from '../domain/quantity.js';
import { parseDate } from '../domain/values.js';
import type {
  AccountCard,
  AuditView,
  BankAccountView,
  Catalog,
  CardLine,
  CompanyView,
  ContractView,
  DocumentRef,
  EmployeeView,
  HomeView,
  IntegrityView,
  InvoiceDetail,
  InvoiceLineView,
  InvoiceSummary,
  ItemView,
  OperationDetail,
  OperationSummary,
  RecentDocument,
  PartnerView,
  PostingView,
  ProductView,
  Query,
  SideView,
  TrialBalance,
  TrialRow,
} from '../contracts/queries.js';
import type { Db, Param, Row } from '../infrastructure/sqlite/db.js';
import { loadChart, toAccount } from './tx.js';

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const money = (v: bigint) => formatMinor(v);
const flag = (v: unknown) => v === 1n;
const contractKind = { sale: 'satış', purchase: 'alış', loan: 'kredit', other: 'digər' } as const;
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function company(db: Db, companyId: string): CompanyView {
  const r = db.get('SELECT * FROM companies WHERE id=?', companyId);
  if (!r) throw new DomainError('Şirkət tapılmadı.', 'companyId', 'not-found');
  return toCompany(r);
}
const toCompany = (r: Row): CompanyView => ({
  id: str(r.id),
  name: str(r.name),
  taxId: str(r.tax_id),
  vatPayer: flag(r.vat_payer),
  purchaseVat: r.purchase_vat as CompanyView['purchaseVat'],
  closedThrough: str(r.closed_through),
  version: Number(r.version),
});

// ---------------------------------------------------------------------------------------------
// Names of subkonto values

export class Names {
  private readonly maps = new Map<string, Map<string, { name: string; currency?: string }>>();
  constructor(
    private readonly db: Db,
    private readonly companyId: string,
  ) {}
  private load(kind: SubkontoKind): Map<string, { name: string; currency?: string }> {
    let m = this.maps.get(kind);
    if (m) return m;
    m = new Map();
    const c = this.companyId;
    const put = (rows: Row[], name: (r: Row) => string, cur?: (r: Row) => string) =>
      rows.forEach((r) =>
        m!.set(str(r.id), { name: name(r), ...(cur ? { currency: cur(r) } : {}) }),
      );
    switch (kind) {
      case 'partner':
        put(this.db.all('SELECT id,name,tax_id FROM partners WHERE company_id=?', c), (r) =>
          str(r.name),
        );
        break;
      case 'contract':
        put(
          this.db.all('SELECT id,number,kind,date,currency FROM contracts WHERE company_id=?', c),
          (r) => `Müqavilə №${r.number} · ${contractKind[r.kind as keyof typeof contractKind]}`,
          (r) => str(r.currency),
        );
        break;
      case 'bankAccount':
        put(
          this.db.all('SELECT id,name,iban,currency FROM bank_accounts WHERE company_id=?', c),
          (r) => `${r.name} · …${str(r.iban).slice(-4)}`,
          (r) => str(r.currency),
        );
        break;
      case 'product':
        put(
          this.db.all('SELECT id,name,unit FROM products WHERE company_id=?', c),
          (r) => `${r.name}`,
        );
        break;
      case 'employee':
        put(this.db.all('SELECT id,name FROM employees WHERE company_id=?', c), (r) => str(r.name));
        break;
      case 'vatRate':
        vatRates.forEach((v) => m!.set(v.id, { name: v.name }));
        break;
      case 'document':
        put(
          this.db.all('SELECT id,number,date FROM operations WHERE company_id=?', c).map((r) => ({
            ...r,
            id: `operation:${r.id}`,
          })),
          (r) => `${r.number} · ${dmy(str(r.date))}`,
        );
        put(
          this.db
            .all('SELECT id,number,date,eq_number FROM invoices WHERE company_id=?', c)
            .map((r) => ({ ...r, id: `invoice:${r.id}` })),
          (r) => `${r.number}${r.eq_number ? ` (${str(r.eq_number)})` : ''} · ${dmy(str(r.date))}`,
        );
        break;
      default:
        put(this.db.all('SELECT id,name FROM items WHERE company_id=? AND kind=?', c, kind), (r) =>
          str(r.name),
        );
    }
    this.maps.set(kind, m);
    return m;
  }
  name(kind: SubkontoKind, id: string): string {
    if (!id) return '—';
    return this.load(kind).get(id)?.name ?? `(${subkontoLabel[kind]} tapılmadı)`;
  }
  currency(kind: SubkontoKind, id: string): string {
    const c = this.load(kind).get(id)?.currency;
    return c && c !== 'AZN' ? c : '';
  }
}

// ---------------------------------------------------------------------------------------------
// Balances
//
// One SQL statement computes, per account × subkonto key, the cumulative debit/credit before
// the period (o*) and before the day after it (c*), from monthly registers plus the postings of
// at most two partial months. Expanded balances (açıq saldo: debtors never net creditors) are
// split per key inside SQLite, so a report touches each key once and never loads the journal.

interface KeyFilter {
  /** Leaf account codes. */
  accounts?: readonly string[];
  /** Exact subkonto prefix (s1, s2, …). */
  sk?: readonly string[];
  /** Partner id and, per account, the subkonto slot (1-based) holding the partner. */
  partner?: { id: string; slots: ReadonlyMap<string, number> };
}

function filterSql(f: KeyFilter, prefix: '' | 'dt_' | 'kt_'): { sql: string; params: Param[] } {
  const col = (c: string) => (prefix ? `${prefix}${c === 'account' ? 'account' : c}` : c);
  let sql = '';
  const params: Param[] = [];
  if (f.accounts) {
    if (!f.accounts.length) return { sql: ' AND 0', params };
    sql += ` AND ${col('account')} IN (${f.accounts.map(() => '?').join(',')})`;
    params.push(...f.accounts);
  }
  f.sk?.forEach((v, i) => {
    sql += ` AND ${col(`s${i + 1}`)}=?`;
    params.push(v);
  });
  if (f.partner) {
    const bySlot = new Map<number, string[]>();
    for (const [acc, slot] of f.partner.slots) bySlot.set(slot, [...(bySlot.get(slot) ?? []), acc]);
    if (!bySlot.size) return { sql: ' AND 0', params };
    const parts: string[] = [];
    for (const [slot, accs] of bySlot) {
      parts.push(
        `(${col('account')} IN (${accs.map(() => '?').join(',')}) AND ${col(`s${slot}`)}=?)`,
      );
      params.push(...accs, f.partner.id);
    }
    sql += ` AND (${parts.join(' OR ')})`;
  }
  return { sql, params };
}

const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

const REG_COLS = (mF: string) => [
  `CASE WHEN month<'${mF}' THEN debit ELSE 0 END`,
  `CASE WHEN month<'${mF}' THEN credit ELSE 0 END`,
  'debit',
  'credit',
  `CASE WHEN month<'${mF}' THEN qty_dt-qty_kt ELSE 0 END`,
  'qty_dt-qty_kt',
  `CASE WHEN month>='${mF}' THEN qty_dt ELSE 0 END`,
  `CASE WHEN month>='${mF}' THEN qty_kt ELSE 0 END`,
  `CASE WHEN month<'${mF}' THEN cur_dt-cur_kt ELSE 0 END`,
  'cur_dt-cur_kt',
];
const OUT = ['od', 'oc', 'cd', 'cc', 'oq', 'cq', 'tqd', 'tqk', 'ocur', 'ccur'];
const sumCols = (exprs: readonly string[]) =>
  exprs.map((e, i) => `SUM(${e}) AS ${OUT[i]}`).join(',');

/**
 * Per-key cumulative sums before `from` (o*) and before `to`+1 (c*). Whole months come from the
 * registers in primary-key order (no sort); keys touched by the postings of a partial first or
 * last month are set aside in a temporary table and computed separately, so the large part of
 * the work never goes through a temporary sort.
 */
function keySql(
  db: Db,
  companyId: string,
  from: string,
  to: string,
  f: KeyFilter,
): { sql: string; params: Param[] } {
  const t1 = nextDay(to);
  const mF = from.slice(0, 7);
  const mT1 = t1.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mF) || !/^\d{4}-\d{2}$/.test(mT1))
    throw new DomainError('Tarix düzgün deyil.');
  const reg = filterSql(f, '');
  const dt = filterSql(f, 'dt_');
  const kt = filterSql(f, 'kt_');
  const regSql = (extra: string) =>
    `SELECT account,s1,s2,s3,${sumCols(REG_COLS(mF))} FROM registers r WHERE company_id=? AND month<'${mT1}'${reg.sql}${extra} GROUP BY account,s1,s2,s3`;
  const edges: { lo: string; hi: string; open: boolean }[] = [];
  if (from > monthStart(from)) edges.push({ lo: monthStart(from), hi: from, open: true });
  if (t1 > monthStart(t1)) edges.push({ lo: monthStart(t1), hi: t1, open: false });
  if (!edges.length) return { sql: regSql(''), params: [companyId, ...reg.params] };

  db.raw.exec(
    'CREATE TEMP TABLE IF NOT EXISTS edge_keys(account TEXT, s1 TEXT, s2 TEXT, s3 TEXT, PRIMARY KEY(account,s1,s2,s3)) WITHOUT ROWID',
  );
  db.raw.exec('DELETE FROM temp.edge_keys');
  for (const e of edges)
    for (const [side, flt] of [
      ['dt', dt],
      ['kt', kt],
    ] as const)
      db.run(
        `INSERT OR IGNORE INTO temp.edge_keys SELECT ${side}_account,${side}_s1,${side}_s2,${side}_s3 FROM postings
         WHERE company_id=? AND date>=? AND date<?${flt.sql}`,
        companyId,
        e.lo,
        e.hi,
        ...flt.params,
      );
  // Edge postings: open edge adds to o* and moves its quantity out of the period turnover;
  // close edge adds to c* and to the period turnover.
  const edgeRows: string[] = [];
  const edgeParams: Param[] = [];
  for (const e of edges) {
    const dtCols = e.open
      ? ['amount', '0', '0', '0', 'dt_qty', '0', '-dt_qty', '0', 'dt_cur', '0']
      : ['0', '0', 'amount', '0', '0', 'dt_qty', 'dt_qty', '0', '0', 'dt_cur'];
    const ktCols = e.open
      ? ['0', 'amount', '0', '0', '-kt_qty', '0', '0', '-kt_qty', '-kt_cur', '0']
      : ['0', '0', '0', 'amount', '0', '-kt_qty', '0', 'kt_qty', '0', '-kt_cur'];
    edgeRows.push(
      `SELECT dt_account,dt_s1,dt_s2,dt_s3,${dtCols.join(',')} FROM postings WHERE company_id=? AND date>=? AND date<?${dt.sql}`,
      `SELECT kt_account,kt_s1,kt_s2,kt_s3,${ktCols.join(',')} FROM postings WHERE company_id=? AND date>=? AND date<?${kt.sql}`,
    );
    edgeParams.push(companyId, e.lo, e.hi, ...dt.params, companyId, e.lo, e.hi, ...kt.params);
  }
  const touched =
    'EXISTS(SELECT 1 FROM temp.edge_keys x WHERE x.account=r.account AND x.s1=r.s1 AND x.s2=r.s2 AND x.s3=r.s3)';
  const sql = `${regSql(` AND NOT ${touched}`)}
    UNION ALL
    SELECT account,s1,s2,s3,${OUT.map((c) => `SUM(${c})`).join(',')} FROM (
      ${regSql(` AND ${touched}`)}
      UNION ALL ${edgeRows.join(' UNION ALL ')}
    ) GROUP BY account,s1,s2,s3`;
  return { sql, params: [companyId, ...reg.params, companyId, ...reg.params, ...edgeParams] };
}

interface Agg {
  openDt: bigint;
  openKt: bigint;
  turnDt: bigint;
  turnKt: bigint;
  closeDt: bigint;
  closeKt: bigint;
  openQ: bigint;
  tqd: bigint;
  tqk: bigint;
  closeQ: bigint;
  openCur: bigint;
  closeCur: bigint;
}
const emptyAgg = (): Agg => ({
  openDt: 0n,
  openKt: 0n,
  turnDt: 0n,
  turnKt: 0n,
  closeDt: 0n,
  closeKt: 0n,
  openQ: 0n,
  tqd: 0n,
  tqk: 0n,
  closeQ: 0n,
  openCur: 0n,
  closeCur: 0n,
});
const addAgg = (a: Agg, b: Agg): Agg => {
  for (const k of Object.keys(a) as (keyof Agg)[]) a[k] += b[k];
  return a;
};

interface AggOptions extends KeyFilter {
  onlyMoved?: boolean;
  onlyArising?: boolean;
}

/** Expanded aggregates grouped by `group` columns (e.g. ['account'] or ['account','s1']). */
function aggregate(
  db: Db,
  companyId: string,
  from: string,
  to: string,
  group: readonly string[],
  o: AggOptions,
): { key: string[]; agg: Agg }[] {
  const k = keySql(db, companyId, from, to, o);
  const where = [
    'NOT (od=oc AND cd=cc AND od=cd AND oq=0 AND cq=0)',
    ...(o.onlyMoved ? ['(cd<>od OR cc<>oc)'] : []),
    ...(o.onlyArising ? ['od=oc AND cd<>cc'] : []),
  ].join(' AND ');
  const cols = group.length ? `${group.join(',')},` : '';
  const rows = db.all(
    `WITH k AS (${k.sql}) SELECT ${cols}
       SUM(MAX(od-oc,0)) AS a1, SUM(MAX(oc-od,0)) AS a2, SUM(cd-od) AS a3, SUM(cc-oc) AS a4,
       SUM(MAX(cd-cc,0)) AS a5, SUM(MAX(cc-cd,0)) AS a6, SUM(oq) AS a7, SUM(tqd) AS a8, SUM(tqk) AS a9,
       SUM(cq) AS a10, SUM(ocur) AS a11, SUM(ccur) AS a12
     FROM k WHERE ${where}${group.length ? ` GROUP BY ${group.join(',')}` : ''}`,
    ...k.params,
  );
  const n = (v: unknown) => (typeof v === 'bigint' ? v : 0n);
  return rows
    .filter((r) => r.a1 !== null)
    .map((r) => ({
      key: group.map((g) => str(r[g])),
      agg: {
        openDt: n(r.a1),
        openKt: n(r.a2),
        turnDt: n(r.a3),
        turnKt: n(r.a4),
        closeDt: n(r.a5),
        closeKt: n(r.a6),
        openQ: n(r.a7),
        tqd: n(r.a8),
        tqk: n(r.a9),
        closeQ: n(r.a10),
        openCur: n(r.a11),
        closeCur: n(r.a12),
      },
    }));
}

/** Net balance (debit − credit) strictly before `date` for the given filter. */
function netBefore(db: Db, companyId: string, date: string, f: KeyFilter): bigint {
  const prev = new Date(`${date}T00:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const to = prev.toISOString().slice(0, 10);
  const k = keySql(db, companyId, date, to, f);
  const r = db.get(`WITH k AS (${k.sql}) SELECT COALESCE(SUM(od-oc),0) AS v FROM k`, ...k.params)!;
  return r.v as bigint;
}

const amt = (v: bigint) => (v ? money(v) : '');
const qtyStr = (v: bigint) => (v ? formatQty(v) : '');

function partnerSlots(chart: Chart): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of chart.all()) {
    const i = a.subkonto.indexOf('partner');
    if (i >= 0 && chart.postable(a.code)) m.set(a.code, i + 1);
  }
  return m;
}

function trialBalance(db: Db, q: Extract<Query, { type: 'trialBalance' }>): TrialBalance {
  const started = performance.now();
  const from = parseDate(q.from, 'Başlanğıc');
  const to = parseDate(q.to, 'Son');
  if (to < from) throw new DomainError('Son tarix başlanğıcdan əvvəl ola bilməz.', 'to');
  const chart = loadChart(db, q.companyId);
  const names = new Names(db, q.companyId);
  const leafCodes = chart
    .all()
    .filter((a) => !chart.children(a.code, true).length)
    .map((a) => a.code);
  const base: AggOptions = {
    onlyMoved: q.onlyMoved,
    onlyArising: q.onlyArising,
    ...(q.accounts.length
      ? { accounts: leafCodes.filter((c) => q.accounts.some((a) => inFamily(c, a))) }
      : {}),
    ...(q.partnerId ? { partner: { id: q.partnerId, slots: partnerSlots(chart) } } : {}),
  };
  const expanded = new Set(q.expand);
  // Account level, then roll leaf accounts up into their groups.
  const byAccount = new Map<string, Agg>();
  for (const { key, agg } of aggregate(db, q.companyId, from, to, ['account'], base)) {
    for (let code: string | null = key[0]!; code; code = chart.get(code)?.parentCode ?? null)
      byAccount.set(code, addAgg(byAccount.get(code) ?? emptyAgg(), agg));
  }
  const rows: TrialRow[] = [];
  const push = (
    key: string,
    level: number,
    kind: TrialRow['kind'],
    account: string,
    label: string,
    hint: string,
    expandable: boolean,
    sk: string[],
    g: Agg,
    showQty: boolean,
    currency: string,
  ) => {
    rows.push({
      key,
      level,
      kind,
      account,
      label,
      hint,
      expandable,
      expanded: expandable && expanded.has(key),
      sk,
      openDt: amt(g.openDt),
      openKt: amt(g.openKt),
      turnDt: amt(g.turnDt),
      turnKt: amt(g.turnKt),
      closeDt: amt(g.closeDt),
      closeKt: amt(g.closeKt),
      openQty: showQty ? qtyStr(g.openQ) : '',
      turnQtyDt: showQty ? qtyStr(g.tqd) : '',
      turnQtyKt: showQty ? qtyStr(g.tqk) : '',
      closeQty: showQty ? qtyStr(g.closeQ) : '',
      currency,
      openCur: currency ? amt(g.openCur) : '',
      closeCur: currency ? amt(g.closeCur) : '',
    });
  };
  const subkontoRows = (code: string, prefix: string[], level: number) => {
    const account = chart.get(code)!;
    const depth = prefix.length;
    const kind = account.subkonto[depth]!;
    const col = `s${depth + 1}`;
    const groups = aggregate(db, q.companyId, from, to, [col], {
      ...base,
      accounts: [code],
      sk: prefix,
    });
    groups.sort((x, y) =>
      names.name(kind, x.key[0]!).localeCompare(names.name(kind, y.key[0]!), 'az'),
    );
    for (const {
      key: [value],
      agg,
    } of groups) {
      const sk = [...prefix, value!];
      const rowKey = `a:${code}|${sk.join('|')}`;
      const more = depth + 1 < account.subkonto.length;
      const currency =
        account.currency && (kind === 'bankAccount' || kind === 'contract')
          ? names.currency(kind, value!)
          : '';
      push(
        rowKey,
        level,
        'subkonto',
        code,
        names.name(kind, value!),
        subkontoLabel[kind],
        more,
        sk,
        agg,
        account.quantitative && kind === 'product',
        currency,
      );
      if (more && expanded.has(rowKey)) subkontoRows(code, sk, level + 1);
    }
  };
  const accountRows = (codes: string[], level: number) => {
    for (const code of codes.sort(compareCodes)) {
      const g = byAccount.get(code);
      if (!g) continue;
      const account = chart.get(code)!;
      const kids = chart
        .children(code, true)
        .map((a) => a.code)
        .filter((c) => byAccount.has(c));
      const key = `a:${code}`;
      const expandable = kids.length > 0 || account.subkonto.length > 0;
      push(key, level, 'account', code, account.name, code, expandable, [], g, false, '');
      if (!expanded.has(key)) continue;
      if (kids.length) accountRows(kids, level + 1);
      else if (account.subkonto.length) subkontoRows(code, [], level + 1);
    }
  };
  const tops = [...byAccount.keys()].filter((c) => !chart.get(c)?.parentCode);
  accountRows(tops, 0);
  const total = tops.reduce((s, c) => addAgg(s, byAccount.get(c)!), emptyAgg());
  return {
    from,
    to,
    rows,
    totals: {
      openDt: money(total.openDt),
      openKt: money(total.openKt),
      turnDt: money(total.turnDt),
      turnKt: money(total.turnKt),
      closeDt: money(total.closeDt),
      closeKt: money(total.closeKt),
    },
    ms: Math.round(performance.now() - started),
  };
}

// ---------------------------------------------------------------------------------------------
// Account card

const familyCodes = (chart: Chart, code: string) =>
  chart
    .all()
    .filter((a) => inFamily(a.code, code))
    .map((a) => a.code);

function accountCard(db: Db, q: Extract<Query, { type: 'accountCard' }>): AccountCard {
  const from = parseDate(q.from, 'Başlanğıc');
  const to = parseDate(q.to, 'Son');
  const chart = loadChart(db, q.companyId);
  const account = chart.get(q.account);
  if (!account) throw new DomainError('Hesab tapılmadı.', 'account', 'not-found');
  const names = new Names(db, q.companyId);
  const codes = familyCodes(chart, account.code);
  const sk = q.sk.filter(Boolean);
  // Archived accounts keep their history: they count for past balances.
  const leafs = codes.filter((c) => !chart.children(c, true).length);
  const opening = netBefore(db, q.companyId, from, { accounts: leafs, sk });
  const LIMIT = 20000;
  const skNames = (code: string, values: string[]) => {
    const a = chart.get(code);
    return a ? a.subkonto.map((kind, i) => names.name(kind, values[i] ?? '')).join(' · ') : '';
  };
  type Raw = { r: Row; side: 'dt' | 'kt' };
  const raws: Raw[] = [];
  for (const side of ['dt', 'kt'] as const) {
    const conds = sk.map((_, i) => ` AND p.${side}_s${i + 1}=?`).join('');
    db.all(
      `SELECT p.*, e.source_type, e.source_id, e.source_number, e.storno, e.rowid AS seq,
         COALESCE(o.memo, i.memo) AS doc_memo, i.direction AS doc_direction
       FROM postings p JOIN entries e ON e.id=p.entry_id
       LEFT JOIN operations o ON e.source_type='operation' AND o.id=e.source_id
       LEFT JOIN invoices i ON e.source_type='invoice' AND i.id=e.source_id
       WHERE p.company_id=? AND p.${side}_account IN (${codes.map(() => '?').join(',')}) AND p.date>=? AND p.date<=?${conds}
       ORDER BY p.date, e.rowid, p.line_no LIMIT ${LIMIT + 1}`,
      q.companyId,
      ...codes,
      from,
      to,
      ...sk,
    ).forEach((r) => raws.push({ r, side }));
  }
  raws.sort(
    (x, y) =>
      str(x.r.date).localeCompare(str(y.r.date)) ||
      Number((x.r.seq as bigint) - (y.r.seq as bigint)) ||
      Number((x.r.line_no as bigint) - (y.r.line_no as bigint)) ||
      (x.side === 'dt' ? -1 : 1),
  );
  const truncated = raws.length > LIMIT;
  let balance = opening;
  let td = 0n;
  let tk = 0n;
  const lines: CardLine[] = raws.slice(0, LIMIT).map(({ r, side }) => {
    const other = side === 'dt' ? 'kt' : 'dt';
    const a = r.amount as bigint;
    if (side === 'dt') {
      balance += a;
      td += a;
    } else {
      balance -= a;
      tk += a;
    }
    const own = [r[`${side}_s1`], r[`${side}_s2`], r[`${side}_s3`]].map(str);
    const corr = [r[`${other}_s1`], r[`${other}_s2`], r[`${other}_s3`]].map(str);
    const qty = (r[`${side}_qty`] as bigint) || 0n;
    return {
      date: str(r.date),
      sourceType: str(r.source_type),
      sourceId: str(r.source_id),
      direction: str(r.doc_direction) as CardLine['direction'],
      number: str(r.source_number),
      storno: flag(r.storno),
      memo: str(r.memo) || str(r.doc_memo),
      sk: skNames(str(r[`${side}_account`]), own),
      corrAccount: str(r[`${other}_account`]),
      corrSk: skNames(str(r[`${other}_account`]), corr),
      debit: side === 'dt' ? money(a) : '',
      credit: side === 'kt' ? money(a) : '',
      qty: qty ? formatQty(qty) : '',
      balance: money(balance),
    };
  });
  const filter = sk.map((v, i) => names.name(account.subkonto[i]!, v)).join(' · ');
  if (truncated) {
    // Totals must stay exact even when the list is cut: take them from the registers.
    balance = netBefore(db, q.companyId, nextDay(to), { accounts: leafs, sk });
    td = 0n;
    tk = 0n;
    for (const r of aggregate(db, q.companyId, from, to, [], { accounts: leafs, sk })) {
      td = r.agg.turnDt;
      tk = r.agg.turnKt;
    }
  }
  return {
    account: account.code,
    name: account.name,
    filter,
    opening: money(opening),
    lines,
    turnDt: money(td),
    turnKt: money(tk),
    closing: money(balance),
    truncated,
  };
}

// ---------------------------------------------------------------------------------------------
// Documents

function operationSummary(db: Db, r: Row): OperationSummary {
  const totals = db.get(
    `SELECT COALESCE(SUM(p.amount),0) AS t, COUNT(*) AS n FROM postings p JOIN entries e ON e.id=p.entry_id
     WHERE e.company_id=? AND e.source_type='operation' AND e.source_id=? AND e.source_version=? AND e.storno=0`,
    str(r.company_id),
    str(r.id),
    // A cancelled document shows the totals of its last posted version.
    r.status === 'cancelled' ? (r.version as bigint) - 1n : (r.version as bigint),
  )!;
  return {
    id: str(r.id),
    version: Number(r.version),
    number: str(r.number),
    date: str(r.date),
    memo: str(r.memo),
    status: r.status as OperationSummary['status'],
    total: money(totals.t as bigint),
    lines: Number(totals.n),
  };
}

function sideView(chart: Chart, names: Names, r: Row, s: 'dt' | 'kt'): SideView {
  const code = str(r[`${s}_account`]);
  const kinds = chart.get(code)?.subkonto ?? [];
  const sk = kinds.map((_, i) => str(r[`${s}_s${i + 1}`]));
  return {
    account: code,
    sk,
    skNames: kinds.map((k, i) => names.name(k, sk[i]!)),
    currency: str(r[`${s}_currency`]),
    curAmount: r[`${s}_currency`] ? money(r[`${s}_cur`] as bigint) : '',
  };
}

function invoiceSummary(names: Names, r: Row): InvoiceSummary {
  return {
    id: str(r.id),
    version: Number(r.version),
    direction: r.direction as InvoiceSummary['direction'],
    number: str(r.number),
    date: str(r.date),
    partnerId: str(r.partner_id),
    partner: names.name('partner', str(r.partner_id)),
    contractId: str(r.contract_id),
    contract: names.name('contract', str(r.contract_id)),
    currency: str(r.currency),
    eqSeries: str(r.eq_series),
    eqNumber: str(r.eq_number),
    memo: str(r.memo),
    status: r.status as InvoiceSummary['status'],
    net: money(r.net as bigint),
    vat: money(r.vat as bigint),
    total: money(r.total as bigint),
    totalAzn: money(r.total_azn as bigint),
  };
}

/** Postings and history of a document's last posted version (shared by all document kinds). */
function documentEntry(db: Db, companyId: string, type: string, id: string) {
  const chart = loadChart(db, companyId);
  const names = new Names(db, companyId);
  const lastPosted = db.get(
    "SELECT MAX(version) AS v FROM document_history WHERE company_id=? AND doc_type=? AND doc_id=? AND status='posted'",
    companyId,
    type,
    id,
  )!.v as bigint;
  const entry = db.get(
    'SELECT id FROM entries WHERE company_id=? AND source_type=? AND source_id=? AND source_version=? AND storno=0',
    companyId,
    type,
    id,
    lastPosted,
  );
  const postings: PostingView[] = entry
    ? db
        .all('SELECT * FROM postings WHERE entry_id=? ORDER BY line_no', str(entry.id))
        .map((p) => ({
          lineNo: Number(p.line_no),
          dt: sideView(chart, names, p, 'dt'),
          kt: sideView(chart, names, p, 'kt'),
          amount: money(p.amount as bigint),
          quantity:
            (p.dt_qty as bigint) || (p.kt_qty as bigint)
              ? formatQty((p.dt_qty as bigint) || (p.kt_qty as bigint))
              : '',
          memo: str(p.memo),
        }))
    : [];
  const history = db
    .all(
      'SELECT version,status,at,actor FROM document_history WHERE company_id=? AND doc_type=? AND doc_id=? ORDER BY version,at',
      companyId,
      type,
      id,
    )
    .map((h) => ({
      version: Number(h.version),
      status: str(h.status),
      at: str(h.at),
      actor: str(h.actor),
    }));
  return { postings, history, names };
}

function invoiceDetail(db: Db, companyId: string, id: string): InvoiceDetail {
  const r = db.get('SELECT * FROM invoices WHERE company_id=? AND id=?', companyId, id);
  if (!r) throw new DomainError('Qaimə tapılmadı.', 'id', 'not-found');
  const { postings, history, names } = documentEntry(db, companyId, 'invoice', id);
  const last = db.get(
    "SELECT payload FROM document_history WHERE company_id=? AND doc_type='invoice' AND doc_id=? AND status='posted' ORDER BY version DESC LIMIT 1",
    companyId,
    id,
  );
  const payload = JSON.parse(str(last?.payload) || '{}') as { vatTreatment?: 'offset' | 'cost' };
  const products = new Map(
    db
      .all('SELECT id,name,unit FROM products WHERE company_id=?', companyId)
      .map((p) => [str(p.id), { name: str(p.name), unit: str(p.unit) }]),
  );
  const lines = (JSON.parse(str(r.lines)) as Omit<InvoiceLineView, 'product' | 'unit'>[]).map(
    (l): InvoiceLineView => ({
      ...l,
      product: products.get(l.productId)?.name ?? '(nomenklatura tapılmadı)',
      unit: products.get(l.productId)?.unit ?? '',
    }),
  );
  return {
    ...invoiceSummary(names, r),
    rate: formatPrice(r.rate as bigint),
    pricesIncludeVat: r.prices_include_vat === 1n,
    manual: r.manual === 1n,
    vatTreatment: payload.vatTreatment ?? 'offset',
    lines,
    postings,
    history,
  };
}

function operationDetail(db: Db, companyId: string, id: string): OperationDetail {
  const r = db.get('SELECT * FROM operations WHERE company_id=? AND id=?', companyId, id);
  if (!r) throw new DomainError('Sənəd tapılmadı.', 'id', 'not-found');
  const { postings, history } = documentEntry(db, companyId, 'operation', id);
  return { ...operationSummary(db, r), postings, history };
}

// ---------------------------------------------------------------------------------------------
// Home

const homeAccounts = ['223', '224', '221', '211', '243', '531', '543', '521', '533'];

function home(db: Db, companyId: string, today: string): HomeView {
  const co = company(db, companyId);
  const chart = loadChart(db, companyId);
  const names = new Names(db, companyId);
  const leafs = (fam: string) =>
    chart
      .all()
      .filter((a) => inFamily(a.code, fam) && !chart.children(a.code, true).length)
      .map((a) => a.code);
  const famOf = (code: string, fams: readonly string[]) => fams.find((f) => inFamily(code, f));
  const present = homeAccounts.filter((c) => chart.get(c));
  const settle = ['211', '543', '531', '243'].filter((c) => chart.get(c));
  const perFamily = new Map<string, Agg>();
  const addFamily = (code: string, agg: Agg) => {
    const fam = famOf(code, present);
    if (fam) perFamily.set(fam, addAgg(perFamily.get(fam) ?? emptyAgg(), agg));
  };
  // Settlement accounts in one pass: per partner × contract nets (for the advance check) and,
  // summed, their expanded balances.
  const nets = new Map<string, Map<string, bigint>>();
  for (const r of aggregate(db, companyId, today, today, ['account', 's1', 's2'], {
    accounts: settle.flatMap(leafs),
  })) {
    addFamily(r.key[0]!, r.agg);
    const fam = famOf(r.key[0]!, settle)!;
    const m = nets.get(fam) ?? new Map<string, bigint>();
    const k = `${r.key[1]}|${r.key[2]}`;
    m.set(k, (m.get(k) ?? 0n) + r.agg.closeDt - r.agg.closeKt);
    nets.set(fam, m);
  }
  const others = present.filter((c) => !settle.includes(c));
  for (const r of aggregate(db, companyId, today, today, ['account'], {
    accounts: others.flatMap(leafs),
  }))
    addFamily(r.key[0]!, r.agg);
  const balances = present.map((c) => {
    const g = perFamily.get(c) ?? emptyAgg();
    return { account: c, name: chart.get(c)!.name, dt: money(g.closeDt), kt: money(g.closeKt) };
  });
  const warnings: HomeView['warnings'] = [];
  const pair = (debtAcc: string, advAcc: string, debtSign: 1n | -1n, text: string) => {
    const debts = nets.get(debtAcc) ?? new Map<string, bigint>();
    for (const [k, adv] of nets.get(advAcc) ?? []) {
      const debt = debts.get(k) ?? 0n;
      if (debt * debtSign > 0n && adv * -debtSign > 0n) {
        const [p, c] = k.split('|') as [string, string];
        warnings.push({
          kind: 'advance',
          account: advAcc,
          sk: [p, c],
          text: `${names.name('partner', p)} · ${names.name('contract', c)}: ${debtAcc}-də ${money(debt * debtSign)} borc, ${advAcc}-də ${money(adv * -debtSign)} avans — ${text}`,
        });
      }
    }
  };
  pair('211', '543', 1n, 'avans əvəzləşdirilməyib.');
  pair('531', '243', -1n, 'verilmiş avans əvəzləşdirilməyib.');
  const qtyAccounts = chart
    .all()
    .filter((a) => a.quantitative && chart.postable(a.code))
    .map((a) => a.code);
  const cash = [...leafs('221'), ...leafs('223'), ...leafs('224')];
  for (const r of aggregate(db, companyId, today, today, ['account', 's1'], {
    accounts: [...qtyAccounts, ...cash],
  })) {
    const a = chart.get(r.key[0]!)!;
    if (a.quantitative && (r.agg.closeQ < 0n || r.agg.closeKt > 0n))
      warnings.push({
        kind: 'stock',
        account: a.code,
        sk: [r.key[1]!],
        text: `${a.code} · ${names.name('product', r.key[1]!)}: mənfi qalıq.`,
      });
    else if (!a.quantitative && r.agg.closeKt > 0n)
      warnings.push({
        kind: 'cash',
        account: a.code,
        sk: [r.key[1]!],
        text: `${a.code} · ${names.name(a.subkonto[0] ?? 'bankAccount', r.key[1]!)}: mənfi pul qalığı (−${money(r.agg.closeKt)}).`,
      });
  }
  const recent = db
    .all(
      'SELECT * FROM operations WHERE company_id=? ORDER BY date DESC, rowid DESC LIMIT 12',
      companyId,
    )
    .map((r) => operationSummary(db, r));
  const documents: RecentDocument[] = [
    ...recent.map((o) => ({
      kind: 'operation' as const,
      id: o.id,
      number: o.number,
      date: o.date,
      title: o.memo,
      total: o.total,
      currency: 'AZN',
      status: o.status,
    })),
    ...db
      .all(
        'SELECT * FROM invoices WHERE company_id=? ORDER BY date DESC, rowid DESC LIMIT 12',
        companyId,
      )
      .map((r) => invoiceSummary(names, r))
      .map((i) => ({
        kind: i.direction,
        id: i.id,
        number: i.number,
        date: i.date,
        title: i.partner,
        total: i.total,
        currency: i.currency,
        status: i.status,
      })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))
    .slice(0, 12);
  return {
    balances,
    recent,
    documents,
    warnings,
    postings: Number(db.get('SELECT COUNT(*) AS n FROM postings WHERE company_id=?', companyId)!.n),
    closedThrough: co.closedThrough,
  };
}

// ---------------------------------------------------------------------------------------------
// Integrity

export function integrity(db: Db, companyId: string, now: string): IntegrityView {
  const started = performance.now();
  const problems: string[] = [];
  // Registers rebuilt from the journal must equal the stored registers, row for row (in SQLite).
  const expected = `SELECT account,s1,s2,s3,month,SUM(d) AS d,SUM(c) AS c,SUM(qd) AS qd,SUM(qk) AS qk,SUM(cd) AS cd,SUM(ck) AS ck FROM (
       SELECT dt_account AS account,dt_s1 AS s1,dt_s2 AS s2,dt_s3 AS s3,substr(date,1,7) AS month,amount AS d,0 AS c,dt_qty AS qd,0 AS qk,dt_cur AS cd,0 AS ck FROM postings WHERE company_id=?1
       UNION ALL
       SELECT kt_account,kt_s1,kt_s2,kt_s3,substr(date,1,7),0,amount,0,kt_qty,0,kt_cur FROM postings WHERE company_id=?1)
     GROUP BY account,s1,s2,s3,month`;
  const stored = `SELECT account,s1,s2,s3,month,debit,credit,qty_dt,qty_kt,cur_dt,cur_kt FROM registers WHERE company_id=?1
     AND NOT (debit=0 AND credit=0 AND qty_dt=0 AND qty_kt=0 AND cur_dt=0 AND cur_kt=0)`;
  const nonzero = `SELECT * FROM (${expected}) WHERE NOT (d=0 AND c=0 AND qd=0 AND qk=0 AND cd=0 AND ck=0)`;
  const r = db.raw
    .prepare(
      `SELECT (SELECT COUNT(*) FROM (${nonzero} EXCEPT ${stored})) + (SELECT COUNT(*) FROM (${stored} EXCEPT ${nonzero})) AS bad`,
    )
    .get(companyId) as { bad: number };
  if (r.bad) problems.push(`${r.bad} qalıq registri jurnalla üst-üstə düşmür.`);
  const totals = db.get(
    'SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c, COUNT(*) AS n FROM registers WHERE company_id=?',
    companyId,
  )!;
  if (totals.d !== totals.c)
    problems.push(
      `Registrlərdə debet (${money(totals.d as bigint)}) kreditə (${money(totals.c as bigint)}) bərabər deyil.`,
    );
  const postings = Number(
    db.get('SELECT COUNT(*) AS n FROM postings WHERE company_id=?', companyId)!.n,
  );
  return {
    ok: !problems.length,
    checkedAt: now,
    postings,
    registers: Number(totals.n),
    problems,
    ms: Math.round(performance.now() - started),
  };
}

// ---------------------------------------------------------------------------------------------

export function runQuery(db: Db, q: Query, today: string, now: string): unknown {
  switch (q.type) {
    case 'companies':
      return db.all('SELECT * FROM companies ORDER BY name').map(toCompany);
    case 'catalog': {
      const co = company(db, q.companyId);
      const c = q.companyId;
      const chart = loadChart(db, c);
      const used = new Set(
        db
          .all('SELECT DISTINCT account FROM registers WHERE company_id=?', c)
          .map((r) => str(r.account)),
      );
      const view: Catalog = {
        company: co,
        accounts: db
          .all('SELECT * FROM accounts WHERE company_id=?', c)
          .map(toAccount)
          .sort((a, b) => compareCodes(a.code, b.code))
          .map((a) => ({ ...a, postable: chart.postable(a.code), used: used.has(a.code) })),
        partners: db
          .all('SELECT * FROM partners WHERE company_id=? ORDER BY name', c)
          .map((r): PartnerView => ({
            id: str(r.id),
            version: Number(r.version),
            name: str(r.name),
            taxId: str(r.tax_id),
            kind: r.kind as PartnerView['kind'],
            note: str(r.note),
            archived: flag(r.archived),
          })),
        contracts: db
          .all('SELECT * FROM contracts WHERE company_id=? ORDER BY date DESC, number', c)
          .map((r): ContractView => ({
            id: str(r.id),
            version: Number(r.version),
            partnerId: str(r.partner_id),
            number: str(r.number),
            date: str(r.date),
            kind: r.kind as ContractView['kind'],
            currency: str(r.currency),
            note: str(r.note),
            archived: flag(r.archived),
            label: `№${r.number} · ${contractKind[r.kind as keyof typeof contractKind]} · ${dmy(str(r.date))}${r.currency !== 'AZN' ? ` · ${r.currency}` : ''}`,
          })),
        bankAccounts: db
          .all(
            'SELECT b.*, p.name AS bank_name FROM bank_accounts b JOIN partners p ON p.id=b.bank_id WHERE b.company_id=? ORDER BY b.account, b.name',
            c,
          )
          .map((r): BankAccountView => ({
            id: str(r.id),
            version: Number(r.version),
            bankId: str(r.bank_id),
            bankName: str(r.bank_name),
            iban: str(r.iban),
            currency: str(r.currency),
            account: str(r.account),
            name: str(r.name),
            archived: flag(r.archived),
          })),
        products: db
          .all('SELECT * FROM products WHERE company_id=? ORDER BY name', c)
          .map((r): ProductView => ({
            id: str(r.id),
            version: Number(r.version),
            code: str(r.code),
            name: str(r.name),
            unit: str(r.unit),
            kind: r.kind as ProductView['kind'],
            groupId: str(r.group_id),
            archived: flag(r.archived),
          })),
        employees: db
          .all('SELECT * FROM employees WHERE company_id=? ORDER BY name', c)
          .map((r): EmployeeView => ({
            id: str(r.id),
            version: Number(r.version),
            name: str(r.name),
            position: str(r.position),
            fin: str(r.fin),
            archived: flag(r.archived),
          })),
        items: db
          .all('SELECT * FROM items WHERE company_id=? ORDER BY kind, name', c)
          .map((r): ItemView => ({
            id: str(r.id),
            version: Number(r.version),
            kind: r.kind as ItemView['kind'],
            name: str(r.name),
            role: str(r.role),
            archived: flag(r.archived),
          })),
      };
      return view;
    }
    case 'operations': {
      company(db, q.companyId);
      return db
        .all(
          'SELECT * FROM operations WHERE company_id=? AND date>=? AND date<=? ORDER BY date DESC, rowid DESC',
          q.companyId,
          parseDate(q.from),
          parseDate(q.to),
        )
        .map((r) => operationSummary(db, r));
    }
    case 'operation':
      return operationDetail(db, q.companyId, q.id);
    case 'invoices': {
      company(db, q.companyId);
      const names = new Names(db, q.companyId);
      return db
        .all(
          'SELECT * FROM invoices WHERE company_id=? AND direction=? AND date>=? AND date<=? ORDER BY date DESC, rowid DESC',
          q.companyId,
          q.direction,
          parseDate(q.from),
          parseDate(q.to),
        )
        .map((r) => invoiceSummary(names, r));
    }
    case 'invoice':
      return invoiceDetail(db, q.companyId, q.id);
    case 'trialBalance':
      company(db, q.companyId);
      return trialBalance(db, q);
    case 'accountCard':
      company(db, q.companyId);
      return accountCard(db, q);
    case 'home':
      return home(db, q.companyId, today);
    case 'documents': {
      company(db, q.companyId);
      const like = `%${q.search.trim()}%`;
      return db
        .all(
          `SELECT 'operation' AS t, id, number, date, memo, '' AS eq FROM operations
             WHERE company_id=? AND (number LIKE ? OR memo LIKE ?)
           UNION ALL
           SELECT 'invoice', id, number, date, memo, eq_series||eq_number FROM invoices
             WHERE company_id=? AND (number LIKE ? OR memo LIKE ? OR eq_series||eq_number LIKE ?)
           ORDER BY date DESC LIMIT 50`,
          q.companyId,
          like,
          like,
          q.companyId,
          like,
          like,
          like,
        )
        .map((r): DocumentRef => ({
          value: `${str(r.t)}:${r.id}`,
          label: `${r.number}${r.eq ? ` (${str(r.eq)})` : ''} · ${dmy(str(r.date))}${r.memo ? ` · ${r.memo}` : ''}`,
        }));
    }
    case 'audit':
      company(db, q.companyId);
      return db
        .all(
          'SELECT * FROM audit WHERE company_id=? ORDER BY seq DESC LIMIT ?',
          q.companyId,
          q.limit,
        )
        .map((r): AuditView => ({
          seq: Number(r.seq),
          at: str(r.at),
          actor: str(r.actor),
          action: str(r.action),
          entity: str(r.entity),
          entityId: str(r.entity_id),
          detail: str(r.detail),
        }));
    case 'integrity':
      company(db, q.companyId);
      return integrity(db, q.companyId, now);
  }
}
