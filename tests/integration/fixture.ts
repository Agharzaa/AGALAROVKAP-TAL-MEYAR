import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../../src/infrastructure/sqlite/db.js';
import { Ledger } from '../../src/application/ledger.js';
import type { Command, CommandResult, InvoiceLineInput } from '../../src/contracts/commands.js';
import type {
  Catalog,
  InvoiceDetail,
  InvoiceSummary,
  PaymentDetail,
  PartnerBalanceView,
  StockRowView,
  TrialBalance,
} from '../../src/contracts/queries.js';

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type Cmd = Without<Command, 'key'>;

let counter = 0;
export const newKey = () => `test-${String(++counter).padStart(8, '0')}`;

export function fixture(t: TestContext, path = ':memory:', today = '2026-12-31') {
  const db = new Db(path);
  t.after(() => {
    try {
      db.close();
    } catch {
      /* already closed by the test */
    }
  });
  const ledger = new Ledger(db, { now: () => '2026-10-05T12:00:00.000Z', today: () => today });
  const ctx = { actor: 'test', correlationId: 'test' };
  const exec = (cmd: Cmd, key = newKey()) => ledger.execute({ key, ...cmd }, ctx) as CommandResult;
  const query = <T>(q: object) => ledger.query(q) as T;
  const companyId = exec({
    type: 'company.create',
    name: 'Meyar Test MMC',
    taxId: '1234567890',
  }).id;
  const partner = (name = 'Alıcı MMC', taxId = '1700000001', company = companyId) =>
    exec({ type: 'partner.save', companyId: company, name, taxId }).id;
  const catalog = (company = companyId) => query<Catalog>({ type: 'catalog', companyId: company });
  const warehouse = () => catalog().warehouses[0]!.id;
  const expenseItem = (name = 'Rabitə') => catalog().expenseItems.find((e) => e.name === name)!.id;
  const product = (extra: Partial<Extract<Cmd, { type: 'product.save' }>> = {}) =>
    exec({
      type: 'product.save',
      companyId,
      code: `P-${newKey()}`,
      name: 'Kağız A4',
      group: '',
      barcode: '',
      baseUnit: 'pcs',
      purchaseUnit: 'pcs',
      factor: '1',
      account: '205',
      ...extra,
    }).id;
  const stockLine = (
    productId: string,
    quantity: string,
    unitPrice: string,
    extra: Partial<InvoiceLineInput> = {},
  ): InvoiceLineInput => ({
    kind: 'stock',
    description: '',
    account: '205',
    productId,
    warehouseId: warehouse(),
    quantity,
    unitPrice,
    vat: '0',
    ...extra,
  });
  const serviceLine = (
    net: string,
    vat = '0',
    extra: Partial<InvoiceLineInput> = {},
  ): InvoiceLineInput => ({
    kind: 'service',
    description: 'Xidmət',
    account: '601',
    net,
    vat,
    ...extra,
  });
  const invoice = (
    direction: 'purchase' | 'sale',
    partnerId: string,
    lines: InvoiceLineInput[],
    extra: Partial<Extract<Cmd, { type: 'invoice.save' }>> = {},
  ) =>
    exec({
      type: 'invoice.save',
      companyId,
      mode: 'post',
      direction,
      number: `N-${newKey()}`,
      date: '2026-01-10',
      partnerId,
      note: '',
      lines,
      ...extra,
    });
  const payment = (
    direction: 'in' | 'out',
    partnerId: string,
    amount: string,
    extra: Partial<Extract<Cmd, { type: 'payment.save' }>> = {},
  ) =>
    exec({
      type: 'payment.save',
      companyId,
      direction,
      bankAccount: '223',
      reference: `B-${newKey()}`,
      date: '2026-01-20',
      partnerId,
      amount,
      note: '',
      allocations: [],
      ...extra,
    });
  const trial = (from = '2026-01-01', to = '2026-12-31', rollup = false) =>
    query<TrialBalance>({ type: 'trialBalance', companyId, from, to, rollup });
  const invoiceDetail = (id: string) => query<InvoiceDetail>({ type: 'invoice', companyId, id });
  const invoices = (direction: 'purchase' | 'sale') =>
    query<InvoiceSummary[]>({
      type: 'invoices',
      companyId,
      direction,
      from: '2000-01-01',
      to: '2099-12-31',
    });
  const paymentDetail = (id: string) => query<PaymentDetail>({ type: 'payment', companyId, id });
  const balances = (asOf = '2026-12-31') =>
    query<PartnerBalanceView[]>({ type: 'partnerBalances', companyId, asOf });
  const stock = (asOf = '2026-12-31') => query<StockRowView[]>({ type: 'stock', companyId, asOf });
  const row = (tb: TrialBalance, account: string) => tb.rows.find((r) => r.account === account);
  /** Every journal entry balances and the trial balance totals agree. */
  const balanced = () => {
    const entries = db.all(
      'SELECT entry_id, SUM(debit) AS d, SUM(credit) AS c FROM journal_lines GROUP BY entry_id',
    );
    for (const e of entries) assert.equal(e.d, e.c, `entry ${e.entry_id} balances`);
    const tb = trial('2000-01-01', '2099-12-31');
    assert.equal(tb.totals.debit, tb.totals.credit);
    assert.equal(tb.totals.closingDebit, tb.totals.closingCredit);
    return tb;
  };
  return {
    db,
    ledger,
    exec,
    query,
    companyId,
    partner,
    catalog,
    warehouse,
    expenseItem,
    product,
    stockLine,
    serviceLine,
    invoice,
    payment,
    trial,
    invoiceDetail,
    invoices,
    paymentDetail,
    balances,
    stock,
    row,
    balanced,
  };
}
