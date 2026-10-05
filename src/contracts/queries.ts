/** Read models. Amounts are canonical decimal strings ("1234.50"); dates are ISO strings. */
import { z } from 'zod';
import type { AccountNature, AnalyticKind } from '../domain/accounts.js';

const id = z.string().min(1).max(80);
const date = z.string().max(10);

export const querySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('companies') }),
  z.object({ type: z.literal('catalog'), companyId: id }),
  z.object({
    type: z.literal('invoices'),
    companyId: id,
    direction: z.enum(['purchase', 'sale']),
    from: date,
    to: date,
  }),
  z.object({ type: z.literal('invoice'), companyId: id, id }),
  z.object({
    type: z.literal('payments'),
    companyId: id,
    direction: z.enum(['in', 'out']),
    from: date,
    to: date,
  }),
  z.object({ type: z.literal('payment'), companyId: id, id }),
  z.object({
    type: z.literal('openInvoices'),
    companyId: id,
    partnerId: id,
    direction: z.enum(['in', 'out']),
  }),
  z.object({
    type: z.literal('journal'),
    companyId: id,
    from: date,
    to: date,
    account: z.string().max(20).default(''),
  }),
  z.object({
    type: z.literal('trialBalance'),
    companyId: id,
    from: date,
    to: date,
    rollup: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('accountCard'),
    companyId: id,
    account: z.string().max(20),
    from: date,
    to: date,
    partnerId: id.optional(),
  }),
  z.object({ type: z.literal('partnerBalances'), companyId: id, asOf: date }),
  z.object({ type: z.literal('stock'), companyId: id, asOf: date }),
  z.object({
    type: z.literal('audit'),
    companyId: id,
    limit: z.number().int().min(1).max(1000).default(300),
  }),
  z.object({ type: z.literal('dashboard'), companyId: id, asOf: date }),
]);
export type Query = z.infer<typeof querySchema>;

export interface CompanyView {
  id: string;
  name: string;
  taxId: string;
  currency: 'AZN';
  closedThrough: string;
}
export interface PartnerView {
  id: string;
  version: number;
  name: string;
  taxId: string;
}
export interface AccountView {
  code: string;
  name: string;
  parentCode: string | null;
  nature: AccountNature;
  analytics: AnalyticKind[];
  quantitative: boolean;
  system: boolean;
  archived: boolean;
  postable: boolean;
}
export interface NamedView {
  id: string;
  name: string;
}
export interface UnitView {
  code: string;
  name: string;
}
export interface ProductView {
  id: string;
  version: number;
  code: string;
  name: string;
  group: string;
  barcode: string;
  baseUnit: string;
  purchaseUnit: string;
  factor: string;
  account: string;
}
export interface Catalog {
  company: CompanyView;
  partners: PartnerView[];
  accounts: AccountView[];
  expenseItems: NamedView[];
  warehouses: NamedView[];
  units: UnitView[];
  products: ProductView[];
}
export type DocumentStatus = 'draft' | 'posted' | 'cancelled';
export interface InvoiceSummary {
  id: string;
  version: number;
  direction: 'purchase' | 'sale';
  number: string;
  date: string;
  partnerId: string;
  partnerName: string;
  partnerTaxId: string;
  status: DocumentStatus;
  net: string;
  vat: string;
  total: string;
  paid: string;
  remaining: string;
}
export interface InvoiceLineView {
  kind: 'service' | 'stock';
  description: string;
  account: string;
  stockAccount?: string;
  productId?: string;
  warehouseId?: string;
  quantity?: string;
  unit?: 'base' | 'purchase';
  unitPrice?: string;
  baseQuantity?: string;
  net: string;
  vat: string;
  expenseItemId?: string;
}
export interface InvoiceDetail extends InvoiceSummary {
  note: string;
  lines: InvoiceLineView[];
  postings: PostingView[];
  history: { version: number; status: DocumentStatus; at: string; actor: string }[];
}
export interface AllocationView {
  id: string;
  paymentId: string;
  paymentReference: string;
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  amount: string;
  status: 'active' | 'cancelled';
  reason: string;
}
export interface PaymentView {
  id: string;
  version: number;
  direction: 'in' | 'out';
  bankAccount: string;
  reference: string;
  date: string;
  partnerId: string;
  partnerName: string;
  amount: string;
  allocated: string;
  unallocated: string;
  status: DocumentStatus;
  note: string;
  allocations: AllocationView[];
}
export interface PaymentDetail extends PaymentView {
  postings: PostingView[];
}
export interface OpenInvoiceView {
  id: string;
  number: string;
  date: string;
  total: string;
  remaining: string;
}
export interface PostingView {
  entryId: string;
  date: string;
  sourceType: 'invoice' | 'payment';
  sourceDirection: 'purchase' | 'sale' | 'in' | 'out';
  sourceId: string;
  sourceNumber: string;
  version: number;
  reversal: boolean;
  lineNo: number;
  account: string;
  debit: string;
  credit: string;
  partnerName: string;
  analytics: string;
  quantity?: string;
  memo: string;
}
export interface TrialRow {
  account: string;
  name: string;
  depth: number;
  openingDebit: string;
  openingCredit: string;
  debit: string;
  credit: string;
  closingDebit: string;
  closingCredit: string;
}
export interface TrialBalance {
  rows: TrialRow[];
  totals: Omit<TrialRow, 'account' | 'name' | 'depth'>;
}
export interface AccountCard {
  account: string;
  name: string;
  opening: string;
  rows: (PostingView & { balance: string })[];
  debit: string;
  credit: string;
  closing: string;
}
export interface PartnerBalanceView {
  partnerId: string;
  name: string;
  taxId: string;
  receivable: string;
  payable: string;
}
export interface StockRowView {
  account: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: string;
  value: string;
}
export interface AuditView {
  id: number;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
}
export interface DashboardView {
  /** Sum of customers that owe us (debit balances on 211); advances are shown apart. */
  receivable: string;
  customerAdvances: string;
  /** Sum of suppliers we owe (credit balances on 531); our prepayments are shown apart. */
  payable: string;
  supplierAdvances: string;
  bank: string;
  purchases: number;
  sales: number;
  unallocatedPayments: number;
  recentPayments: PaymentView[];
  closedThrough: string;
}
