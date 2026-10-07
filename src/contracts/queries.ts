/** Read models. Amounts are canonical decimal strings ("1234.50"); dates are ISO strings. */
import { z } from 'zod';
import type { AccountNature, SubkontoKind, VatRate } from '../domain/chart.js';

const id = z.string().min(1).max(80);
const date = z.string().max(10);

export const querySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('companies') }),
  z.object({ type: z.literal('catalog'), companyId: id }),
  z.object({ type: z.literal('operations'), companyId: id, from: date, to: date }),
  z.object({ type: z.literal('operation'), companyId: id, id }),
  z.object({
    type: z.literal('invoices'),
    companyId: id,
    direction: z.enum(['sale', 'purchase']),
    from: date,
    to: date,
  }),
  z.object({ type: z.literal('invoice'), companyId: id, id }),
  z.object({
    type: z.literal('trialBalance'),
    companyId: id,
    from: date,
    to: date,
    /** Row keys the user opened ("a:211", "a:211|<partner>", …). */
    expand: z.array(z.string().max(400)).max(5000).default([]),
    onlyMoved: z.boolean().default(false),
    onlyArising: z.boolean().default(false),
    accounts: z.array(z.string().max(20)).max(200).default([]),
    partnerId: id.optional(),
  }),
  z.object({
    type: z.literal('accountCard'),
    companyId: id,
    account: z.string().max(20),
    sk: z.array(z.string().max(120)).max(3).default([]),
    from: date,
    to: date,
  }),
  z.object({ type: z.literal('home'), companyId: id }),
  z.object({ type: z.literal('documents'), companyId: id, search: z.string().max(80).default('') }),
  z.object({
    type: z.literal('audit'),
    companyId: id,
    limit: z.number().int().min(1).max(2000).default(500),
  }),
  z.object({ type: z.literal('integrity'), companyId: id }),
]);
export type Query = z.infer<typeof querySchema>;

export interface CompanyView {
  id: string;
  name: string;
  taxId: string;
  vatPayer: boolean;
  purchaseVat: 'offset' | 'cost';
  closedThrough: string;
  version: number;
}
export interface AccountView {
  code: string;
  name: string;
  parentCode: string | null;
  nature: AccountNature;
  subkonto: SubkontoKind[];
  quantitative: boolean;
  currency: boolean;
  system: boolean;
  archived: boolean;
  postable: boolean;
  used: boolean;
}
export interface PartnerView {
  id: string;
  version: number;
  name: string;
  taxId: string;
  kind: 'legal' | 'individual' | 'foreign' | 'state';
  note: string;
  archived: boolean;
}
export interface ContractView {
  id: string;
  version: number;
  partnerId: string;
  number: string;
  date: string;
  kind: 'sale' | 'purchase' | 'loan' | 'other';
  currency: string;
  note: string;
  archived: boolean;
  /** "№7 · satış · 01.02.2026" */
  label: string;
}
export interface BankAccountView {
  id: string;
  version: number;
  bankId: string;
  bankName: string;
  iban: string;
  currency: string;
  account: string;
  name: string;
  archived: boolean;
}
export interface ProductView {
  id: string;
  version: number;
  code: string;
  name: string;
  unit: string;
  kind: 'goods' | 'material' | 'asset' | 'service';
  groupId: string;
  archived: boolean;
}
export interface EmployeeView {
  id: string;
  version: number;
  name: string;
  position: string;
  fin: string;
  archived: boolean;
}
export type ItemKind =
  | 'expenseItem'
  | 'incomeType'
  | 'taxType'
  | 'paymentKind'
  | 'fund'
  | 'capitalChange'
  | 'cashbox'
  | 'productGroup';
export interface ItemView {
  id: string;
  version: number;
  kind: ItemKind;
  name: string;
  /** Role in posting rules ("vatTax", "cogs"…), empty for ordinary elements. */
  role: string;
  archived: boolean;
}
export interface Catalog {
  company: CompanyView;
  accounts: AccountView[];
  partners: PartnerView[];
  contracts: ContractView[];
  bankAccounts: BankAccountView[];
  products: ProductView[];
  employees: EmployeeView[];
  items: ItemView[];
}

export interface SideView {
  account: string;
  sk: string[];
  /** Display names of the subkonto values, same order. */
  skNames: string[];
  currency: string;
  curAmount: string;
}
export interface PostingView {
  lineNo: number;
  dt: SideView;
  kt: SideView;
  amount: string;
  quantity: string;
  memo: string;
}
export interface OperationSummary {
  id: string;
  version: number;
  number: string;
  date: string;
  memo: string;
  status: 'posted' | 'cancelled';
  total: string;
  lines: number;
}
export interface OperationDetail extends OperationSummary {
  postings: PostingView[];
  history: { version: number; status: string; at: string; actor: string }[];
}

export interface InvoiceLineView {
  productId: string;
  product: string;
  unit: string;
  quantity: string;
  price: string;
  vatRate: VatRate;
  incomeTypeId: string;
  account: string;
  expenseItemId: string;
  vatTreatment: 'offset' | 'cost' | '';
  memo: string;
  /** Document currency. */
  net: string;
  vat: string;
  gross: string;
  /** AZN. */
  netAzn: string;
  vatAzn: string;
  grossAzn: string;
}
export interface InvoiceSummary {
  id: string;
  version: number;
  direction: 'sale' | 'purchase';
  number: string;
  date: string;
  partnerId: string;
  partner: string;
  contractId: string;
  contract: string;
  currency: string;
  eqSeries: string;
  eqNumber: string;
  memo: string;
  status: 'posted' | 'cancelled';
  net: string;
  vat: string;
  total: string;
  totalAzn: string;
}
export interface InvoiceDetail extends InvoiceSummary {
  rate: string;
  pricesIncludeVat: boolean;
  /** Postings were entered by hand (1C "Əl ilə düzəliş"). */
  manual: boolean;
  vatTreatment: 'offset' | 'cost';
  lines: InvoiceLineView[];
  postings: PostingView[];
  history: { version: number; status: string; at: string; actor: string }[];
}

export interface TrialRow {
  key: string;
  level: number;
  /** account | subkonto */
  kind: 'account' | 'subkonto';
  account: string;
  label: string;
  /** Code shown for account rows, or the subkonto kind label for subkonto rows. */
  hint: string;
  expandable: boolean;
  expanded: boolean;
  sk: string[];
  openDt: string;
  openKt: string;
  turnDt: string;
  turnKt: string;
  closeDt: string;
  closeKt: string;
  /** Quantity on quantitative accounts (net), empty otherwise. */
  openQty: string;
  turnQtyDt: string;
  turnQtyKt: string;
  closeQty: string;
  /** Currency amounts on currency accounts (net), empty otherwise. */
  currency: string;
  openCur: string;
  closeCur: string;
}
export interface TrialBalance {
  from: string;
  to: string;
  rows: TrialRow[];
  totals: {
    openDt: string;
    openKt: string;
    turnDt: string;
    turnKt: string;
    closeDt: string;
    closeKt: string;
  };
  ms: number;
}

export interface CardLine {
  date: string;
  sourceType: string;
  sourceId: string;
  /** Invoices: sale or purchase; empty for other documents. */
  direction: 'sale' | 'purchase' | '';
  number: string;
  storno: boolean;
  memo: string;
  /** This account's subkonto names on this line. */
  sk: string;
  corrAccount: string;
  corrSk: string;
  debit: string;
  credit: string;
  qty: string;
  balance: string;
}
export interface AccountCard {
  account: string;
  name: string;
  filter: string;
  opening: string;
  lines: CardLine[];
  turnDt: string;
  turnKt: string;
  closing: string;
  truncated: boolean;
}

export interface HomeView {
  balances: { account: string; name: string; dt: string; kt: string }[];
  recent: OperationSummary[];
  warnings: { kind: string; text: string; account: string; sk: string[] }[];
  postings: number;
  closedThrough: string;
}

export interface DocumentRef {
  value: string;
  label: string;
}
export interface AuditView {
  seq: number;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  detail: string;
}
export interface IntegrityView {
  ok: boolean;
  checkedAt: string;
  postings: number;
  registers: number;
  problems: string[];
  ms: number;
}
