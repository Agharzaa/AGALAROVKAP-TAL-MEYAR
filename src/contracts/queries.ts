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
    type: z.literal('bankDocuments'),
    companyId: id,
    from: date,
    to: date,
    /** Only documents of this bank account; all when omitted. */
    bankAccountId: id.optional(),
  }),
  z.object({ type: z.literal('bankDocument'), companyId: id, id }),
  z.object({ type: z.literal('statementImports'), companyId: id, bankAccountId: id.optional() }),
  z.object({ type: z.literal('statement'), companyId: id, id }),
  z.object({ type: z.literal('statementLine'), companyId: id, id }),
  z.object({ type: z.literal('rules'), companyId: id }),
  /** A rule prefilled from a bank document the accountant posted. */
  z.object({ type: z.literal('ruleDraft'), companyId: id, documentId: id }),
  z.object({ type: z.literal('budgetCodes'), companyId: id }),
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
  | 'productGroup'
  | 'cashFlowItem';
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

export interface BankLineView {
  account: string;
  sk: string[];
  skNames: string[];
  amount: string;
  curAmount: string;
  cashFlowItem: string;
  cashFlowItemName: string;
  memo: string;
}
export interface BankDocumentSummary {
  id: string;
  version: number;
  direction: 'in' | 'out';
  number: string;
  date: string;
  bankAccountId: string;
  bankAccount: string;
  /** Ledger account of the bank account (223.01 / 223.02 / 224.04). */
  account: string;
  currency: string;
  amount: string;
  amountAzn: string;
  bankReference: string;
  counterpartyName: string;
  counterpartyTaxId: string;
  purpose: string;
  /** Counter accounts of the lines, e.g. "211.01, 543.01". */
  accounts: string;
  status: 'posted' | 'cancelled';
}
/** The other half of a VAT deposit pair and the 18/118 check of the whole payment. */
export interface BankPairView {
  id: string;
  number: string;
  date: string;
  account: string;
  amount: string;
  total: string;
  deposit: string;
  expected: string;
  difference: string;
  ok: boolean;
}
export interface BankDocumentDetail extends BankDocumentSummary {
  /** manual: typed by hand; statement: booked from a statement row. */
  origin: 'manual' | 'statement';
  /** The rule that posted it by itself, if any. */
  ruleName: string;
  /** The document can take part in a VAT deposit pair (AZN, 223 / 224). */
  pairable: boolean;
  pair: BankPairView | null;
  /** Unpaired documents that could complete this one (same payer, ±3 days). */
  pairCandidates: BankDocumentSummary[];
  rate: string;
  lines: BankLineView[];
  postings: PostingView[];
  history: { version: number; status: string; at: string; actor: string }[];
}

/** How a waiting statement row could be booked (never posted without the accountant). */
export interface StatementProposal {
  /** proposal: something was recognised; unknown: the accountant fills the document. */
  state: 'proposal' | 'unknown';
  reason: string;
  /** Counter account and its subkonto for the bank document's line (may be empty). */
  account: string;
  sk: string[];
  /** A VÖEN the partner list does not know yet: the accountant creates the partner. */
  newPartner?: { name: string; taxId: string };
  /** Bank documents typed by hand for the same payment: link instead of a new document. */
  matches: { id: string; number: string; date: string }[];
  /** All lines of the booking when a rule proposes it (amounts already split). */
  lines?: { account: string; sk: string[]; amount: string; cashFlowItem: string; memo: string }[];
  /** The rule behind the proposal. */
  rule?: { id: string; name: string; mode: 'suggest' | 'auto' };
  /** Budget classification code found in the purpose of a tax payment. */
  budgetCode?: string;
}
export interface RuleLineView {
  account: string;
  sk: string[];
  skNames: string[];
  amount: string;
  cashFlowItem: string;
  memo: string;
}
export interface RuleView {
  id: string;
  version: number;
  name: string;
  direction: 'in' | 'out';
  bankAccountId: string;
  counterpartyTaxId: string;
  terms: string[];
  amountMin: string;
  amountMax: string;
  lines: RuleLineView[];
  mode: 'suggest' | 'auto';
  archived: boolean;
  uses: number;
  lastUsedAt: string;
}
/** Fields of rule.save prefilled from a posted bank document. */
export interface RuleDraft {
  name: string;
  direction: 'in' | 'out';
  bankAccountId: string;
  counterpartyTaxId: string;
  terms: string[];
  lines: { account: string; sk: string[]; amount: string; cashFlowItem: string; memo: string }[];
  /** A rule that already books rows like this one (edit it rather than add another). */
  existing?: { id: string; name: string };
}
export interface BudgetCodeView {
  id: string;
  version: number;
  code: string;
  name: string;
  account: string;
  paymentKindId: string;
  archived: boolean;
}
export interface StatementLineView {
  id: string;
  importId: string;
  bankAccountId: string;
  row: number;
  date: string;
  direction: 'in' | 'out';
  amount: string;
  reference: string;
  counterparty: string;
  counterpartyTaxId: string;
  counterpartyIban: string;
  purpose: string;
  state: 'new' | 'posted' | 'ignored';
  documentId: string;
  documentNumber: string;
  /** Rule that posted the row by itself, if any ("Avtomatik uçota alındı"). */
  documentRule: string;
  reason: string;
  /** The automatic booking was undone: rules only propose this row from now on. */
  manualOnly: boolean;
  /** Why an "auto" rule could not post the row. */
  autoNote: string;
  proposal: StatementProposal | null;
}
export interface StatementImportView {
  id: string;
  bankAccountId: string;
  fileName: string;
  from: string;
  to: string;
  importedAt: string;
  rowsRead: number;
  rowsAdded: number;
  waiting: number;
  posted: number;
  ignored: number;
}
export interface StatementView extends StatementImportView {
  bankAccount: string;
  iban: string;
  currency: string;
  /** Statement ↔ ledger, in the account's currency; empty where the file prints no balance. */
  balances: {
    fileOpening: string;
    fileClosing: string;
    ledgerOpening: string;
    ledgerClosing: string;
    openingDifference: string;
    closingDifference: string;
  };
  lines: StatementLineView[];
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
  /** Invoices: sale or purchase; bank documents: in or out; empty for other documents. */
  direction: 'sale' | 'purchase' | 'in' | 'out' | '';
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

/** A document of any kind on the start page ("Son sənədlər"). */
export interface RecentDocument {
  kind: 'operation' | 'sale' | 'purchase' | 'bankIn' | 'bankOut';
  id: string;
  number: string;
  date: string;
  /** Partner of an invoice, content of an operation. */
  title: string;
  total: string;
  currency: string;
  status: 'posted' | 'cancelled';
}
export interface HomeView {
  balances: { account: string; name: string; dt: string; kt: string }[];
  recent: OperationSummary[];
  /** The latest documents of every kind, newest first. */
  documents: RecentDocument[];
  warnings: {
    kind: 'advance' | 'stock' | 'cash' | 'transit' | 'vatPair' | 'vatUnpaired';
    text: string;
    account: string;
    sk: string[];
    /** The bank document the signal is about, when there is one. */
    document?: { id: string; direction: 'in' | 'out' };
  }[];
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
