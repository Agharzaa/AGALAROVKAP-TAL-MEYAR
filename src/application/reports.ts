/**
 * Read side. Every figure is computed from the journal and the settlement register inside one
 * read transaction — reports never keep their own copies of numbers.
 */
import { Chart } from '../domain/accounts.js';
import { DomainError } from '../domain/errors.js';
import { formatMinor } from '../domain/money.js';
import { formatQty } from '../domain/quantity.js';
import { parseDate } from '../domain/values.js';
import type {
  AccountCard,
  AuditView,
  Catalog,
  CompanyView,
  DashboardView,
  InvoiceDetail,
  InvoiceLineView,
  InvoiceSummary,
  OpenInvoiceView,
  PartnerBalanceView,
  PaymentDetail,
  PaymentView,
  PostingView,
  Query,
  StockRowView,
  TrialBalance,
  TrialRow,
} from '../contracts/queries.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import { toAccount } from './tx.js';

const money = (v: unknown) => formatMinor(v as bigint);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function company(db: Db, id: string): CompanyView {
  const r = db.get('SELECT * FROM companies WHERE id=?', id);
  if (!r) throw new DomainError('Şirkət tapılmadı.', 'companyId', 'not-found');
  return {
    id: str(r.id),
    name: str(r.name),
    taxId: str(r.tax_id),
    currency: 'AZN',
    closedThrough: str(r.closed_through),
  };
}
function range(from: string, to: string) {
  const f = parseDate(from, 'Başlanğıc tarix');
  const t = parseDate(to, 'Son tarix');
  if (f > t) throw new DomainError('Başlanğıc tarix son tarixdən sonra ola bilməz.', 'from');
  return [f, t] as const;
}
function chart(db: Db, companyId: string) {
  return new Chart(db.all('SELECT * FROM accounts WHERE company_id=?', companyId).map(toAccount));
}

const POSTINGS = `
SELECT e.id AS entry_id, e.date, e.source_type, e.source_id, e.source_number, e.source_version, e.reversal,
  l.line_no, l.account, l.debit, l.credit, l.quantity, l.memo,
  COALESCE(p.name,'') AS partner_name, COALESCE(pr.name,'') AS product_name,
  COALESCE(w.name,'') AS warehouse_name, COALESCE(x.name,'') AS expense_name,
  CASE e.source_type WHEN 'invoice' THEN (SELECT direction FROM invoices WHERE id=e.source_id)
    ELSE (SELECT direction FROM payments WHERE id=e.source_id) END AS source_direction
FROM journal_lines l
JOIN journal_entries e ON e.id=l.entry_id
LEFT JOIN partners p ON p.id=l.partner_id
LEFT JOIN products pr ON pr.id=l.product_id
LEFT JOIN warehouses w ON w.id=l.warehouse_id
LEFT JOIN expense_items x ON x.id=l.expense_item_id`;
function posting(r: Row): PostingView {
  const analytics = [r.partner_name, r.product_name, r.warehouse_name, r.expense_name]
    .map(str)
    .filter(Boolean)
    .join(' · ');
  return {
    entryId: str(r.entry_id),
    date: str(r.date),
    sourceType: r.source_type as PostingView['sourceType'],
    sourceDirection: r.source_direction as PostingView['sourceDirection'],
    sourceId: str(r.source_id),
    sourceNumber: str(r.source_number),
    version: Number(r.source_version),
    reversal: r.reversal === 1n,
    lineNo: Number(r.line_no),
    account: str(r.account),
    debit: money(r.debit),
    credit: money(r.credit),
    partnerName: str(r.partner_name),
    analytics,
    ...(r.quantity !== null ? { quantity: formatQty(r.quantity as bigint) } : {}),
    memo: str(r.memo),
  };
}
function documentPostings(db: Db, companyId: string, type: string, id: string): PostingView[] {
  return db
    .all(
      `${POSTINGS} WHERE e.company_id=? AND e.source_type=? AND e.source_id=? ORDER BY e.source_version, e.reversal, e.rowid, l.line_no`,
      companyId,
      type,
      id,
    )
    .map(posting);
}

function invoiceSummary(r: Row): InvoiceSummary {
  const total = (r.net as bigint) + (r.vat as bigint);
  const paid = r.paid as bigint;
  return {
    id: str(r.id),
    version: Number(r.version),
    direction: r.direction as InvoiceSummary['direction'],
    number: str(r.number),
    date: str(r.date),
    partnerId: str(r.partner_id),
    partnerName: str(r.partner_name),
    partnerTaxId: str(r.partner_tax_id),
    status: r.status as InvoiceSummary['status'],
    net: money(r.net),
    vat: money(r.vat),
    total: formatMinor(total),
    paid: formatMinor(paid),
    remaining: formatMinor(r.status === 'posted' ? total - paid : 0n),
  };
}
const INVOICES = `
SELECT i.*, p.name AS partner_name, p.tax_id AS partner_tax_id,
  COALESCE((SELECT SUM(a.amount) FROM allocations a WHERE a.invoice_id=i.id AND a.status='active'),0) AS paid
FROM invoices i JOIN partners p ON p.id=i.partner_id`;

function payments(
  db: Db,
  companyId: string,
  where: string,
  ...params: (string | bigint)[]
): PaymentView[] {
  const rows = db.all(
    `SELECT pay.*, p.name AS partner_name FROM payments pay JOIN partners p ON p.id=pay.partner_id WHERE pay.company_id=? ${where} ORDER BY pay.date DESC, pay.rowid DESC`,
    companyId,
    ...params,
  );
  if (!rows.length) return [];
  const links = db.all(
    `SELECT a.*, i.number AS invoice_number, pay.reference FROM allocations a JOIN invoices i ON i.id=a.invoice_id JOIN payments pay ON pay.id=a.payment_id WHERE a.company_id=? ORDER BY a.date, a.rowid`,
    companyId,
  );
  return rows.map((r) => {
    const own = links.filter((a) => a.payment_id === r.id);
    const allocated = own
      .filter((a) => a.status === 'active')
      .reduce((s, a) => s + (a.amount as bigint), 0n);
    return {
      id: str(r.id),
      version: Number(r.version),
      direction: r.direction as PaymentView['direction'],
      bankAccount: str(r.bank_account),
      reference: str(r.reference),
      date: str(r.date),
      partnerId: str(r.partner_id),
      partnerName: str(r.partner_name),
      amount: money(r.amount),
      allocated: formatMinor(r.status === 'posted' ? allocated : 0n),
      unallocated: formatMinor(r.status === 'posted' ? (r.amount as bigint) - allocated : 0n),
      status: r.status as PaymentView['status'],
      note: str(r.note),
      allocations: own.map((a) => ({
        id: str(a.id),
        paymentId: str(a.payment_id),
        paymentReference: str(a.reference),
        invoiceId: str(a.invoice_id),
        invoiceNumber: str(a.invoice_number),
        date: str(a.date),
        amount: money(a.amount),
        status: a.status as 'active' | 'cancelled',
        reason: str(a.reason),
      })),
    };
  });
}

/** Balance of each account as Σ(debit − credit), optionally by partner for settlement accounts. */
function trialBalance(
  db: Db,
  companyId: string,
  from: string,
  to: string,
  rollup: boolean,
): TrialBalance {
  const c = chart(db, companyId);
  const rows = db.all(
    `SELECT l.account, COALESCE(l.partner_id,'') AS partner,
       SUM(CASE WHEN e.date<? THEN l.debit-l.credit ELSE 0 END) AS opening,
       SUM(CASE WHEN e.date>=? THEN l.debit ELSE 0 END) AS debit,
       SUM(CASE WHEN e.date>=? THEN l.credit ELSE 0 END) AS credit
     FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
     WHERE l.company_id=? AND e.date<=?
     GROUP BY l.account, partner`,
    from,
    from,
    from,
    companyId,
    to,
  );
  type Sums = { od: bigint; oc: bigint; d: bigint; c: bigint; cd: bigint; cc: bigint };
  const zero = (): Sums => ({ od: 0n, oc: 0n, d: 0n, c: 0n, cd: 0n, cc: 0n });
  const byAccount = new Map<string, Sums>();
  for (const r of rows) {
    // Settlement accounts show both sides: debtors and creditors are not netted against each other.
    const s = byAccount.get(str(r.account)) ?? zero();
    const opening = r.opening as bigint;
    const closing = opening + (r.debit as bigint) - (r.credit as bigint);
    s.od += opening > 0n ? opening : 0n;
    s.oc += opening < 0n ? -opening : 0n;
    s.d += r.debit as bigint;
    s.c += r.credit as bigint;
    s.cd += closing > 0n ? closing : 0n;
    s.cc += closing < 0n ? -closing : 0n;
    byAccount.set(str(r.account), s);
  }
  for (const [code, s] of byAccount) {
    const account = c.get(code);
    if (account?.analytics.includes('partner')) continue;
    // Non-settlement accounts are collapsed to a single net balance.
    const open = s.od - s.oc;
    const close = s.cd - s.cc;
    s.od = open > 0n ? open : 0n;
    s.oc = open < 0n ? -open : 0n;
    s.cd = close > 0n ? close : 0n;
    s.cc = close < 0n ? -close : 0n;
  }
  // Aggregate leaves into every ancestor.
  const tree = new Map<string, Sums>();
  const add = (code: string, s: Sums) => {
    const t = tree.get(code) ?? zero();
    for (const k of Object.keys(t) as (keyof Sums)[]) t[k] += s[k];
    tree.set(code, t);
  };
  for (const [code, s] of byAccount) {
    let current: string | null | undefined = code;
    while (current) {
      add(current, s);
      current = c.get(current)?.parentCode;
    }
  }
  const depth = (code: string) => {
    let d = 0;
    let p = c.get(code)?.parentCode;
    while (p) {
      d++;
      p = c.get(p)?.parentCode;
    }
    return d;
  };
  const view = (code: string, s: Sums): TrialRow => ({
    account: code,
    name: c.get(code)?.name ?? '',
    depth: depth(code),
    openingDebit: formatMinor(s.od),
    openingCredit: formatMinor(s.oc),
    debit: formatMinor(s.d),
    credit: formatMinor(s.c),
    closingDebit: formatMinor(s.cd),
    closingCredit: formatMinor(s.cc),
  });
  const ordered = [...tree.keys()]
    .filter((code) => !rollup || depth(code) === 0)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const totals = zero();
  for (const code of ordered)
    if (depth(code) === 0)
      for (const k of Object.keys(totals) as (keyof Sums)[]) totals[k] += tree.get(code)![k];
  const { account: _a, name: _n, depth: _d, ...sum } = view('', totals);
  return { rows: ordered.map((code) => view(code, tree.get(code)!)), totals: sum };
}

function accountCard(
  db: Db,
  companyId: string,
  account: string,
  from: string,
  to: string,
  partnerId?: string,
): AccountCard {
  const c = chart(db, companyId);
  const a = c.get(account);
  if (!a) throw new DomainError('Hesab tapılmadı.', 'account', 'not-found');
  const scope = `(l.account=? OR l.account LIKE ?) ${partnerId ? 'AND l.partner_id=?' : ''}`;
  const params = [account, `${account}.%`, ...(partnerId ? [partnerId] : [])];
  const opening = db.get(
    `SELECT COALESCE(SUM(l.debit-l.credit),0) AS b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.company_id=? AND e.date<? AND ${scope}`,
    companyId,
    from,
    ...params,
  )!.b as bigint;
  let balance = opening;
  let debit = 0n;
  let credit = 0n;
  const rows = db
    .all(
      `${POSTINGS} WHERE l.company_id=? AND e.date>=? AND e.date<=? AND ${scope} ORDER BY e.date, e.rowid, l.line_no`,
      companyId,
      from,
      to,
      ...params,
    )
    .map((r) => {
      balance += (r.debit as bigint) - (r.credit as bigint);
      debit += r.debit as bigint;
      credit += r.credit as bigint;
      return { ...posting(r), balance: formatMinor(balance) };
    });
  return {
    account,
    name: a.name,
    opening: formatMinor(opening),
    rows,
    debit: formatMinor(debit),
    credit: formatMinor(credit),
    closing: formatMinor(balance),
  };
}

export function runQuery(db: Db, q: Query): unknown {
  switch (q.type) {
    case 'companies':
      return db.all('SELECT id FROM companies ORDER BY name').map((r) => company(db, str(r.id)));
    case 'catalog': {
      const co = company(db, q.companyId);
      const c = chart(db, q.companyId);
      const result: Catalog = {
        company: co,
        partners: db
          .all('SELECT * FROM partners WHERE company_id=? ORDER BY name', q.companyId)
          .map((r) => ({
            id: str(r.id),
            version: Number(r.version),
            name: str(r.name),
            taxId: str(r.tax_id),
          })),
        accounts: c.all().map((a) => ({ ...a, postable: c.postable(a.code) })),
        expenseItems: db
          .all(
            'SELECT id,name FROM expense_items WHERE company_id=? AND archived=0 ORDER BY name',
            q.companyId,
          )
          .map((r) => ({ id: str(r.id), name: str(r.name) })),
        warehouses: db
          .all('SELECT id,name FROM warehouses WHERE company_id=? ORDER BY name', q.companyId)
          .map((r) => ({ id: str(r.id), name: str(r.name) })),
        units: db
          .all('SELECT code,name FROM units WHERE company_id=? ORDER BY name', q.companyId)
          .map((r) => ({ code: str(r.code), name: str(r.name) })),
        products: db
          .all('SELECT * FROM products WHERE company_id=? ORDER BY name', q.companyId)
          .map((r) => ({
            id: str(r.id),
            version: Number(r.version),
            code: str(r.code),
            name: str(r.name),
            group: str(r.group_name),
            barcode: str(r.barcode),
            baseUnit: str(r.base_unit),
            purchaseUnit: str(r.purchase_unit),
            factor: formatQty(r.factor as bigint),
            account: str(r.account),
          })),
      };
      return result;
    }
    case 'invoices': {
      company(db, q.companyId);
      const [from, to] = range(q.from, q.to);
      return db
        .all(
          `${INVOICES} WHERE i.company_id=? AND i.direction=? AND i.date>=? AND i.date<=? ORDER BY i.date DESC, i.rowid DESC`,
          q.companyId,
          q.direction,
          from,
          to,
        )
        .map(invoiceSummary);
    }
    case 'invoice': {
      const r = db.get(`${INVOICES} WHERE i.company_id=? AND i.id=?`, q.companyId, q.id);
      if (!r) throw new DomainError('Qaimə tapılmadı.', 'id', 'not-found');
      const detail: InvoiceDetail = {
        ...invoiceSummary(r),
        note: str(r.note),
        lines: JSON.parse(str(r.lines)) as InvoiceLineView[],
        postings: documentPostings(db, q.companyId, 'invoice', q.id),
        history: db
          .all(
            "SELECT version,status,at,actor FROM document_history WHERE source_type='invoice' AND source_id=? ORDER BY version",
            q.id,
          )
          .map((h) => ({
            version: Number(h.version),
            status: h.status as InvoiceSummary['status'],
            at: str(h.at),
            actor: str(h.actor),
          })),
      };
      return detail;
    }
    case 'payments': {
      company(db, q.companyId);
      const [from, to] = range(q.from, q.to);
      return payments(
        db,
        q.companyId,
        'AND pay.direction=? AND pay.date>=? AND pay.date<=?',
        q.direction,
        from,
        to,
      );
    }
    case 'payment': {
      const [p] = payments(db, q.companyId, 'AND pay.id=?', q.id);
      if (!p) throw new DomainError('Ödəniş tapılmadı.', 'id', 'not-found');
      const detail: PaymentDetail = {
        ...p,
        postings: documentPostings(db, q.companyId, 'payment', q.id),
      };
      return detail;
    }
    case 'openInvoices':
      return db
        .all(
          `${INVOICES} WHERE i.company_id=? AND i.partner_id=? AND i.direction=? AND i.status='posted' ORDER BY i.date, i.number`,
          q.companyId,
          q.partnerId,
          q.direction === 'in' ? 'sale' : 'purchase',
        )
        .map(invoiceSummary)
        .filter((i) => i.remaining !== '0.00')
        .map((i): OpenInvoiceView => ({
          id: i.id,
          number: i.number,
          date: i.date,
          total: i.total,
          remaining: i.remaining,
        }));
    case 'journal': {
      company(db, q.companyId);
      const [from, to] = range(q.from, q.to);
      return db
        .all(
          `${POSTINGS} WHERE l.company_id=? AND e.date>=? AND e.date<=? AND (?='' OR l.account=? OR l.account LIKE ?) ORDER BY e.date DESC, e.rowid DESC, l.line_no`,
          q.companyId,
          from,
          to,
          q.account,
          q.account,
          `${q.account}.%`,
        )
        .map(posting);
    }
    case 'trialBalance': {
      company(db, q.companyId);
      const [from, to] = range(q.from, q.to);
      return trialBalance(db, q.companyId, from, to, q.rollup);
    }
    case 'accountCard': {
      company(db, q.companyId);
      const [from, to] = range(q.from, q.to);
      return accountCard(db, q.companyId, q.account, from, to, q.partnerId);
    }
    case 'partnerBalances': {
      company(db, q.companyId);
      const asOf = parseDate(q.asOf);
      return db
        .all(
          `SELECT p.id, p.name, p.tax_id,
             COALESCE(SUM(CASE WHEN (l.account='211' OR l.account LIKE '211.%') THEN l.debit-l.credit ELSE 0 END),0) AS receivable,
             COALESCE(SUM(CASE WHEN (l.account='531' OR l.account LIKE '531.%') THEN l.credit-l.debit ELSE 0 END),0) AS payable
           FROM partners p
           LEFT JOIN journal_lines l ON l.partner_id=p.id AND l.entry_id IN (SELECT id FROM journal_entries WHERE company_id=? AND date<=?)
           WHERE p.company_id=? GROUP BY p.id ORDER BY p.name`,
          q.companyId,
          asOf,
          q.companyId,
        )
        .map((r): PartnerBalanceView => ({
          partnerId: str(r.id),
          name: str(r.name),
          taxId: str(r.tax_id),
          receivable: money(r.receivable),
          payable: money(r.payable),
        }));
    }
    case 'stock': {
      company(db, q.companyId);
      const asOf = parseDate(q.asOf);
      return db
        .all(
          `SELECT l.account, l.warehouse_id, w.name AS warehouse_name, l.product_id, pr.code, pr.name AS product_name, u.name AS unit,
             SUM(l.quantity) AS quantity, SUM(l.debit-l.credit) AS value
           FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
           JOIN products pr ON pr.id=l.product_id JOIN warehouses w ON w.id=l.warehouse_id
           JOIN units u ON u.company_id=pr.company_id AND u.code=pr.base_unit
           WHERE l.company_id=? AND l.quantity IS NOT NULL AND e.date<=?
           GROUP BY l.account, l.warehouse_id, l.product_id
           HAVING SUM(l.quantity)!=0 OR SUM(l.debit-l.credit)!=0
           ORDER BY pr.name, w.name, l.account`,
          q.companyId,
          asOf,
        )
        .map((r): StockRowView => ({
          account: str(r.account),
          warehouseId: str(r.warehouse_id),
          warehouseName: str(r.warehouse_name),
          productId: str(r.product_id),
          productCode: str(r.code),
          productName: str(r.product_name),
          unit: str(r.unit),
          quantity: formatQty(r.quantity as bigint),
          value: money(r.value),
        }));
    }
    case 'audit':
      company(db, q.companyId);
      return db
        .all(
          'SELECT * FROM audit WHERE company_id=? ORDER BY id DESC LIMIT ?',
          q.companyId,
          q.limit,
        )
        .map((r): AuditView => ({
          id: Number(r.id),
          at: str(r.at),
          actor: str(r.actor),
          action: str(r.action),
          entity: str(r.entity),
          detail: str(r.detail),
        }));
    case 'dashboard': {
      const co = company(db, q.companyId);
      const asOf = parseDate(q.asOf);
      const sum = (sql: string) => db.get(sql, q.companyId, asOf)!.v as bigint;
      const balance = (pattern: string, sign: 1 | -1) =>
        sum(
          `SELECT COALESCE(SUM(${sign === 1 ? 'l.debit-l.credit' : 'l.credit-l.debit'}),0) AS v FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.company_id=? AND e.date<=? AND (${pattern})`,
        );
      const all = payments(db, q.companyId, "AND pay.status='posted'");
      const perPartner = db.all(
        `SELECT
           COALESCE(SUM(CASE WHEN (l.account='211' OR l.account LIKE '211.%') THEN l.debit-l.credit ELSE 0 END),0) AS r,
           COALESCE(SUM(CASE WHEN (l.account='531' OR l.account LIKE '531.%') THEN l.credit-l.debit ELSE 0 END),0) AS p
         FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
         WHERE l.company_id=? AND e.date<=? AND l.partner_id IS NOT NULL GROUP BY l.partner_id`,
        q.companyId,
        asOf,
      );
      const side = (key: 'r' | 'p', positive: boolean) =>
        formatMinor(
          perPartner.reduce((s, row) => {
            const v = row[key] as bigint;
            return positive ? (v > 0n ? s + v : s) : v < 0n ? s - v : s;
          }, 0n),
        );
      const view: DashboardView = {
        receivable: side('r', true),
        customerAdvances: side('r', false),
        payable: side('p', true),
        supplierAdvances: side('p', false),
        bank: formatMinor(
          balance("l.account='223' OR l.account LIKE '223.%' OR l.account='224.04'", 1),
        ),
        purchases: Number(
          db.get(
            "SELECT COUNT(*) AS n FROM invoices WHERE company_id=? AND direction='purchase' AND status='posted'",
            q.companyId,
          )!.n,
        ),
        sales: Number(
          db.get(
            "SELECT COUNT(*) AS n FROM invoices WHERE company_id=? AND direction='sale' AND status='posted'",
            q.companyId,
          )!.n,
        ),
        unallocatedPayments: all.filter((p) => p.unallocated !== '0.00').length,
        recentPayments: all.slice(0, 5),
        closedThrough: co.closedThrough,
      };
      return view;
    }
  }
}
