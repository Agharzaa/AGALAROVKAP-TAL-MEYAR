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
  z.object({
    type: z.literal('cashDocuments'),
    companyId: id,
    from: date,
    to: date,
    /** Only orders of this cashbox; all when omitted. */
    cashboxId: id.optional(),
  }),
  z.object({ type: z.literal('cashDocument'), companyId: id, id }),
  /** Kassa kitabı: one cashbox, day by day. */
  z.object({ type: z.literal('cashBook'), companyId: id, cashboxId: id, from: date, to: date }),
  z.object({ type: z.literal('statementImports'), companyId: id, bankAccountId: id.optional() }),
  z.object({ type: z.literal('statement'), companyId: id, id }),
  z.object({ type: z.literal('statementLine'), companyId: id, id }),
  z.object({
    type: z.literal('eqImports'),
    companyId: id,
    direction: z.enum(['sale', 'purchase']),
  }),
  /** The e-qaimə box of one direction; from/to filter by the e-qaimə date when given. */
  z.object({
    type: z.literal('eqInbox'),
    companyId: id,
    direction: z.enum(['sale', 'purchase']),
    from: date.default(''),
    to: date.default(''),
  }),
  z.object({ type: z.literal('eqDocument'), companyId: id, id }),
  z.object({ type: z.literal('eqMaps'), companyId: id }),
  /** DVX ↔ books for a period: VAT by month, e-qaimələr not booked, invoices DVX does not show. */
  z.object({
    type: z.literal('eqReconcile'),
    companyId: id,
    direction: z.enum(['sale', 'purchase']),
    from: date,
    to: date,
  }),
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
export interface CashboxView {
  id: string;
  version: number;
  name: string;
  /** 221.01 / 221.02 / 221.04 */
  account: string;
  currency: string;
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
  cashboxes: CashboxView[];
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
  /** The DVX e-qaimə booked by this invoice, if any. */
  eqDocumentId: string;
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
export interface CashDocumentSummary {
  id: string;
  version: number;
  direction: 'in' | 'out';
  number: string;
  date: string;
  cashboxId: string;
  cashbox: string;
  /** Ledger account of the cashbox (221.01 / 221.02 / 221.04). */
  account: string;
  currency: string;
  amount: string;
  amountAzn: string;
  counterpartyName: string;
  basis: string;
  attachment: string;
  /** Counter accounts of the lines, e.g. "211.01, 543.01". */
  accounts: string;
  status: 'posted' | 'cancelled';
}
export interface CashDocumentDetail extends CashDocumentSummary {
  rate: string;
  lines: BankLineView[];
  /** The sum in words for the printed order ("Yüz iyirmi manat 50 qəpik"). */
  amountWords: string;
  postings: PostingView[];
  history: { version: number; status: string; at: string; actor: string }[];
}
/** One movement of a cashbox in the cash book. */
export interface CashBookLine {
  date: string;
  number: string;
  /** cash: an order (opens it); other journal sources are shown as they are. */
  sourceType: string;
  sourceId: string;
  direction: 'in' | 'out' | '';
  counterparty: string;
  /** Counter account(s) of the movement. */
  account: string;
  memo: string;
  income: string;
  expense: string;
  /** In the cashbox currency for a currency cashbox, else empty. */
  incomeCur: string;
  expenseCur: string;
}
export interface CashBookDay {
  date: string;
  opening: string;
  lines: CashBookLine[];
  income: string;
  expense: string;
  closing: string;
  openingCur: string;
  closingCur: string;
}
export interface CashBookView {
  cashboxId: string;
  cashbox: string;
  account: string;
  currency: string;
  opening: string;
  openingCur: string;
  income: string;
  expense: string;
  closing: string;
  closingCur: string;
  days: CashBookDay[];
  /** More than the book shows: narrow the period. */
  truncated: boolean;
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
  /** Saved, but worth a look: an invoice chosen by hand that is already paid. */
  warnings: string[];
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
  kind: 'operation' | 'sale' | 'purchase' | 'bankIn' | 'bankOut' | 'cashIn' | 'cashOut';
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
    kind:
      | 'advance'
      | 'stock'
      | 'cash'
      | 'transit'
      | 'vatPair'
      | 'vatUnpaired'
      | 'eqConflict'
      | 'eqWaiting'
      | 'eqVat'
      | 'eqMissing';
    text: string;
    account: string;
    sk: string[];
    /** The bank document the signal is about, when there is one. */
    document?: { id: string; direction: 'in' | 'out' };
    /** The e-qaimə box the signal is about (stage 4c). */
    eq?: 'sale' | 'purchase';
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

/** An e-qaimə import (one DVX file). */
export interface EqImportView {
  id: string;
  source: 'file' | 'portal';
  direction: 'sale' | 'purchase';
  report: 'invoices' | 'goods';
  fileName: string;
  from: string;
  to: string;
  importedAt: string;
  rowsRead: number;
  added: number;
  updated: number;
  same: number;
  conflicts: number;
}

/**
 * Where an e-qaimə stands in the box. proposal / unknown: accepted in DVX, waiting for the
 * accountant (something is known / nothing is); dvx: DVX has not accepted it (pending,
 * corrected, unknown status); conflict: DVX and the books disagree (cancelled in DVX but booked,
 * or the same e-qaimə came again with other amounts); auto: booked by confirmed map entries;
 * posted: booked or linked by the accountant.
 */
export type EqBucket = 'proposal' | 'unknown' | 'dvx' | 'conflict' | 'auto' | 'posted' | 'ignored';

/** One invoice line as the e-qaimə proposes it (InvoiceLineInput fields + where they came from). */
export interface EqProposalLine {
  /** The DVX goods line; null when built from the e-qaimə's VAT bases (header entry). */
  dvx: EqLineView | null;
  productId: string;
  quantity: string;
  price: string;
  vatRate: VatRate | '';
  account: string;
  expenseItemId: string;
  incomeTypeId: string;
  vatTreatment: 'offset' | 'cost' | '';
  mapId: string;
  mapMode: 'suggest' | 'auto' | '';
  /** Why this line needs the accountant; empty when it is fully known. */
  problem: string;
}

/** How a waiting e-qaimə would be booked (never posted without confirmed map entries). */
export interface EqProposal {
  /** auto: every part is known by confirmed (auto) entries and checks out. */
  state: 'auto' | 'proposal' | 'unknown';
  reasons: string[];
  partnerId: string;
  contractId: string;
  newPartner?: { name: string; taxId: string; kind: 'legal' | 'individual' };
  lines: EqProposalLine[];
  /** A posted invoice with this very e-qaimə number: the e-qaimə is linked to it, not booked again. */
  sameNumber?: { id: string; number: string; total: string };
  /** Numberless invoices of the same partner and total (±5 days): link by hand. */
  candidates: { id: string; number: string; date: string; total: string }[];
  /**
   * A correction e-qaimə: the e-qaimə it corrects and, when that one is booked, its invoice —
   * the correction is applied to that invoice (never booked as a second one).
   */
  corrects?: {
    documentId: string;
    number: string;
    invoiceId: string;
    invoiceNumber: string;
    invoiceDate: string;
    /** The corrected e-qaimə's date: the VAT period the correction belongs to. */
    date: string;
  };
}

export interface EqDocumentView {
  id: string;
  direction: 'sale' | 'purchase';
  number: string;
  date: string;
  taxId: string;
  name: string;
  kind: 'main' | 'correction' | 'return' | 'advance' | 'other';
  kindText: string;
  refNumber: string;
  status: 'accepted' | 'pending' | 'cancelled' | 'corrected' | 'rejected' | 'unknown';
  dvxStatus: string;
  net: string;
  vat: string;
  total: string;
  lineCount: number;
  bucket: EqBucket;
  state: 'waiting' | 'posted' | 'ignored';
  invoiceId: string;
  invoiceNumber: string;
  conflict: string;
  /** How the accountant settled a conflict (date · who: note); empty while open. */
  resolved: string;
  reason: string;
  autoNote: string;
  /** Waiting e-qaimələr only. */
  proposal: EqProposal | null;
}

export interface EqInboxView {
  documents: EqDocumentView[];
  counts: Record<EqBucket, number>;
}

export interface EqLineView {
  code: string;
  name: string;
  unit: string;
  quantity: string;
  price: string;
  net: string;
  vat: string;
  vatRate: string;
}

export interface EqDocumentDetail extends EqDocumentView {
  base18: string;
  base0: string;
  baseExempt: string;
  baseNontaxable: string;
  excise: string;
  roadTax: string;
  note: string;
  lines: EqLineView[];
  history: { at: string; fileName: string; from: string; to: string; dvxStatus: string }[];
  version: number;
}

/** A learned e-qaimə map entry (DVX goods line or a VÖEN's whole e-qaimə → booking). */
export interface EqMapView {
  id: string;
  version: number;
  direction: 'sale' | 'purchase';
  taxId: string;
  partner: string;
  dvxCode: string;
  name: string;
  unit: string;
  productId: string;
  product: string;
  account: string;
  expenseItemId: string;
  incomeTypeId: string;
  vatTreatment: '' | 'offset' | 'cost';
  contractId: string;
  mode: 'suggest' | 'auto';
  archived: boolean;
  uses: number;
  lastUsedAt: string;
}

/** DVX ↔ books for a period (stage 4c; docs/MERHELE-4-EQAIME.md §8.5). */
export interface EqReconcileView {
  /** Periods covered by loaded DVX files: only there can "not in DVX" be told. */
  covered: { from: string; to: string }[];
  months: {
    month: string;
    dvxCount: number;
    dvxNet: string;
    dvxVat: string;
    bookedCount: number;
    bookedVat: string;
    /** DVX VAT minus the books' VAT. */
    difference: string;
  }[];
  /** Accepted in DVX, not booked (nor set aside). */
  notBooked: {
    id: string;
    number: string;
    date: string;
    name: string;
    taxId: string;
    vat: string;
    total: string;
  }[];
  /** Invoices with an e-qaimə number that the loaded DVX files of their period do not hold. */
  notInDvx: {
    id: string;
    number: string;
    eqNumber: string;
    date: string;
    partner: string;
    vat: string;
    total: string;
  }[];
  /** Invoices without an e-qaimə number (a purchase's VAT is offset only on an e-qaimə). */
  withoutEq: {
    id: string;
    number: string;
    date: string;
    partner: string;
    vat: string;
    total: string;
  }[];
}
