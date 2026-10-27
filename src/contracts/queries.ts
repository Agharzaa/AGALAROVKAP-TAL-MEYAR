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
  /** Stage 7a: the fixed assets with their cost, depreciation and terms on a day. */
  z.object({ type: z.literal('fixedAssets'), companyId: id, date }),
  z.object({
    type: z.literal('assetDocuments'),
    companyId: id,
    kind: z.enum(['commission', 'opening', 'disposal']),
  }),
  z.object({ type: z.literal('assetDocument'), companyId: id, id }),
  /** Stage 7b: depreciation by asset and month of a year — posted, then forecast. */
  z.object({
    type: z.literal('depreciationSchedule'),
    companyId: id,
    year: z.number().int().min(2000).max(2100),
  }),
  /** Stage 8a: payroll — the dated rates, the month documents and a new month's lines. */
  z.object({ type: z.literal('payrollRates'), companyId: id }),
  z.object({ type: z.literal('payrollDocuments'), companyId: id }),
  z.object({ type: z.literal('payrollDocument'), companyId: id, id }),
  z.object({ type: z.literal('payrollFill'), companyId: id, month: z.string().max(7) }),
  /** Stage 8b / 8c: absences, the employee's month, settlements on 533, taxes and funds. */
  z.object({
    type: z.literal('absences'),
    companyId: id,
    kind: z.enum(['vacation', 'unpaid', 'sick']).optional(),
  }),
  z.object({ type: z.literal('absence'), companyId: id, id }),
  z.object({ type: z.literal('payslip'), companyId: id, employeeId: id, month: z.string().max(7) }),
  z.object({ type: z.literal('payrollSettlements'), companyId: id, from: date, to: date }),
  z.object({ type: z.literal('payrollTaxes'), companyId: id, month: z.string().max(7) }),
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
  /** Currency rates catalog (shared by all companies). */
  z.object({
    type: z.literal('rates'),
    companyId: id,
    from: date,
    to: date,
    currency: z.string().max(3).optional(),
  }),
  /** The rate a document of that date takes: that day's, else the latest within 6 days; or null. */
  z.object({ type: z.literal('rate'), companyId: id, currency: z.string().max(3), date }),
  /** Revaluation of the month: the posted one and what posting now would write. */
  z.object({ type: z.literal('revaluation'), companyId: id, month: z.string().max(7) }),
  /** Month closing (stage 5c): the posted one, or what closing now would do. */
  z.object({ type: z.literal('closing'), companyId: id, month: z.string().max(7) }),
  z.object({ type: z.literal('closings'), companyId: id }),
  /** The month the closing form opens on: the first one not closed ({ month: '' } — none yet). */
  z.object({ type: z.literal('closingNext'), companyId: id }),
  /** Mənfəət və zərər (stage 5d): the year by months, closing entries left out. */
  z.object({ type: z.literal('profitLoss'), companyId: id, year: z.string().max(4) }),
  /** Pul vəsaitlərinin hərəkəti: bank and cash document lines by cash-flow item. */
  z.object({ type: z.literal('cashFlow'), companyId: id, from: date, to: date }),
  /** ƏDV icmalı of a month: sales by rate, purchase VAT, VAT payable, DVX side. */
  z.object({ type: z.literal('vatSummary'), companyId: id, month: z.string().max(7) }),
  /** İdarə paneli: the month's figures and the 12 months up to it. */
  z.object({ type: z.literal('dashboard'), companyId: id, month: z.string().max(7) }),
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
/** Stage 7a: a fixed asset of the catalog. */
export interface FixedAssetView {
  id: string;
  version: number;
  name: string;
  inventoryNo: string;
  group: 'transport' | 'machinery' | 'computers' | 'buildings' | 'other';
  plate: string;
  note: string;
  archived: boolean;
}
/** A fixed asset on a day: cost (111), depreciation (112) and the terms it depreciates by. */
export interface FixedAssetRow extends FixedAssetView {
  /** The day it was put into service (or its opening balance); '' when not yet. */
  inService: string;
  /** The document that did it. */
  documentId: string;
  documentKind: 'commission' | 'opening' | '';
  /** Stage 7c: the day it was written off or sold ('' while in service). */
  disposed: string;
  cost: string;
  depreciated: string;
  net: string;
  /** The regular monthly amount; '0.00' when nothing is left to depreciate. */
  monthly: string;
  monthsLeft: number;
  lifeMonths: number;
  salvage: string;
  expenseAccount: string;
  expenseSk: string[];
  expenseNames: string[];
}
/**
 * Stage 7b: depreciation of a year by asset and month. Months up to the closed period show what
 * the month closings posted; open months the forecast by the terms (the regular amount).
 */
export interface DepreciationSchedule {
  year: number;
  /** "YYYY-MM", January to December. */
  months: string[];
  /** The last closed day: months after it are forecast. */
  closedThrough: string;
  rows: {
    assetId: string;
    inventoryNo: string;
    name: string;
    expenseAccount: string;
    cells: { amount: string; forecast: boolean }[];
    total: string;
  }[];
  /** Per month, all assets. */
  totals: string[];
  total: string;
}
export interface AssetLineView {
  assetId: string;
  assetName: string;
  productId: string;
  productName: string;
  quantity: string;
  cost: string;
  accumulated: string;
  salvage: string;
  lifeMonths: number;
  remainingMonths: number;
  monthly: string;
  expenseAccount: string;
  expenseSk: string[];
  counterAccount: string;
  counterSk: string[];
}
export interface AssetDocumentView {
  id: string;
  version: number;
  kind: 'commission' | 'opening' | 'disposal';
  number: string;
  date: string;
  memo: string;
  status: 'posted' | 'cancelled';
  total: string;
  lines: AssetLineView[];
}
export interface AssetDocumentDetail extends AssetDocumentView {
  postings: PostingView[];
}
export interface EmployeeView {
  id: string;
  version: number;
  name: string;
  position: string;
  fin: string;
  archived: boolean;
  /** Stage 8a. */
  tabNo: string;
  hired: string;
  left: string;
  salary: string;
  expenseAccount: string;
  expenseSk: string[];
  /** Stage 8c. */
  mainJob: boolean;
  exemption: '0' | '100' | '200' | '400';
  exemptionExtra: boolean;
  exemptionFrom: string;
  exemptionTo: string;
}
/** Stage 8a: a set of payroll rates; `used` — a posted month was computed with it. */
export interface PayrollRatesView {
  validFrom: string;
  rates: import('../domain/payroll.js').RatesInput;
  used: boolean;
}
export interface PayrollLineView {
  employeeId: string;
  name: string;
  tabNo: string;
  position: string;
  salary: string;
  bonus: string;
  gross: string;
  incomeTax: string;
  dsmfEmployee: string;
  unemploymentEmployee: string;
  medicalEmployee: string;
  net: string;
  dsmfEmployer: string;
  unemploymentEmployer: string;
  medicalEmployer: string;
  expenseAccount: string;
  /** Stage 8b / 8c. */
  vacation: string;
  sick: string;
  exemption: string;
  deducted: string;
  deductions: { amount: string; account: string; sk: string[]; memo: string }[];
}
export interface PayrollDocumentView {
  id: string;
  version: number;
  month: string;
  number: string;
  date: string;
  memo: string;
  status: 'posted' | 'cancelled';
  employees: number;
  gross: string;
  net: string;
  lines: PayrollLineView[];
  /** Employees whose vacation or sick leave changed after the document was posted (8c). */
  stale: string[];
}
export interface PayrollDocumentDetail extends PayrollDocumentView {
  postings: PostingView[];
}
export interface PayrollFillLine {
  employeeId: string;
  name: string;
  salary: string;
  /** Pay of the vacations and sick leaves that start in the month (8c). */
  vacation: string;
  sick: string;
}
/** Stage 8c: a vacation or a sick leave. */
export interface AbsenceView {
  id: string;
  version: number;
  kind: 'vacation' | 'unpaid' | 'sick';
  number: string;
  employeeId: string;
  employeeName: string;
  from: string;
  to: string;
  days: number;
  sheetNo: string;
  percent: number;
  employerAll: boolean;
  manual: string;
  /** Vacation: the average monthly earnings; sick leave: the average daily earnings. */
  average: string;
  daily: string;
  employerDays: number;
  fundDays: number;
  amount: string;
  basis: string;
  memo: string;
  status: 'posted' | 'cancelled';
}
/** Stage 8b: the employee's month — owed at the start, accrued, withheld, paid, owed at the end. */
export interface PayslipView {
  employeeId: string;
  name: string;
  tabNo: string;
  position: string;
  month: string;
  opening: string;
  accrued: { label: string; amount: string }[];
  withheld: { label: string; amount: string }[];
  paid: { date: string; number: string; amount: string }[];
  closing: string;
}
export interface PayrollSettlementRow {
  employeeId: string;
  name: string;
  opening: string;
  accrued: string;
  withheld: string;
  paid: string;
  closing: string;
}
export interface PayrollTaxRow {
  account: string;
  label: string;
  opening: string;
  accrued: string;
  paid: string;
  closing: string;
}
export interface PayrollTaxesView {
  month: string;
  employees: number;
  base: string;
  rows: PayrollTaxRow[];
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
  fixedAssets: FixedAssetView[];
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
  /** Sale of a fixed asset (stage 7c). */
  assetId?: string;
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
  /** Net and VAT in manats (the list sums them across currencies). */
  netAzn: string;
  vatAzn: string;
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
export interface RateView {
  date: string;
  currency: string;
  /** Per one unit, 4 decimals ("1.7000"). */
  rate: string;
  source: 'amb' | 'manual';
  loadedAt: string;
  actor: string;
}
export interface RevaluationLine {
  account: string;
  sk: string[];
  skNames: string[];
  currency: string;
  curBalance: string;
  rate: string;
  rateDate: string;
  /** AZN balance in the books before, the value at the rate, and their difference (signed). */
  booked: string;
  value: string;
  difference: string;
}
export interface RevaluationView {
  month: string;
  date: string;
  /** The month is in a closed period: nothing can be posted or cancelled. */
  closed: boolean;
  /** Why it cannot be computed (mixed currencies on a key, a missing role element…). */
  error: string;
  missingRates: string[];
  rates: { currency: string; date: string; rate: string }[];
  /** What posting now would write (the posted one taken out). */
  proposal: RevaluationLine[];
  income: string;
  expense: string;
  posted: {
    id: string;
    version: number;
    number: string;
    income: string;
    expense: string;
    lines: RevaluationLine[];
    /** Balances changed since it was posted: post again. */
    stale: boolean;
  } | null;
}
/** One Dt/Kt pair of a closing step, with the subkonto names. */
export interface ClosingPosting {
  dt: string;
  dtSk: string[];
  dtNames: string[];
  kt: string;
  ktSk: string[];
  ktNames: string[];
  amount: string;
  memo: string;
}
export type ClosingStepKey =
  | 'checks'
  | 'fifo'
  | 'depreciation'
  | 'revaluation'
  | 'vat'
  | 'income'
  | 'result'
  | 'year'
  | 'lock';
export interface ClosingStep {
  key: ClosingStepKey;
  title: string;
  /** done: posted (or would post) entries; empty: nothing to do; blocked: refused by a check. */
  state: 'done' | 'empty' | 'blocked';
  summary: string;
  postings: ClosingPosting[];
  /** What the step leaves for the accountant (unpaid VAT, an invoice without its e-qaimə…). */
  notes: string[];
  /** Step 5: the balances closed to 801 per account — the month's figures before closing. */
  totals: { account: string; name: string; debit: string; credit: string }[];
}
export interface ClosingSummary {
  id: string;
  version: number;
  month: string;
  number: string;
  date: string;
  status: 'posted' | 'cancelled';
  /** 801 result: profit positive, loss negative. */
  profit: string;
  updatedAt: string;
}
export interface ClosingView {
  month: string;
  date: string;
  number: string;
  closedThrough: string;
  /** Refusals: month not over, previous month open, a blocking check. Nothing can be posted. */
  blocking: Signal[];
  /** Warnings the accountant reads and acknowledges before closing (kept with the closing). */
  warnings: Signal[];
  steps: ClosingStep[];
  profit: string;
  /** The posted closing of the month; its steps are the ones posted. */
  posted: (ClosingSummary & { warnings: string[] }) | null;
  /** The last cancelled one, when the month is open again (closing again makes a new version). */
  cancelled: ClosingSummary | null;
  /** Why the posted closing cannot be cancelled now (a later month is closed…); '' when it can. */
  cancelBlocked: string;
}
/** One row of a period report (M/Z): an account, one of its subkonto values, or a total. */
export interface ReportRow {
  key: string;
  label: string;
  /** 0: account or total, 1: subkonto value under its account. */
  level: 0 | 1;
  total: boolean;
  /** Drill-down: the account card of this account (and subkonto), '' for totals. */
  account: string;
  sk: string[];
  /** One amount per month of the report, then their sum. */
  values: string[];
  sum: string;
}
export interface ProfitLossView {
  year: string;
  months: string[];
  rows: ReportRow[];
  ms: number;
}
export interface CashFlowRow {
  key: string;
  label: string;
  /** in / out: bank and cash document lines; other: the money accounts moved without them. */
  kind: 'in' | 'out' | 'other';
  /** The cash-flow item ('' — lines without one). */
  item: string;
  amount: string;
}
export interface CashFlowView {
  from: string;
  to: string;
  /** 221 + 223 + 224 at the start (the day before `from`) and at the end of `to`. */
  opening: string;
  closing: string;
  rows: CashFlowRow[];
  inflow: string;
  outflow: string;
  other: string;
  /** opening + inflow − outflow + other = closing, to the qəpik. */
  reconciled: boolean;
}
export interface VatSummaryView {
  month: string;
  /** Sales by VAT rate: the taxable amount (601 − 602 − 603 without VAT) and the VAT (604). */
  sales: { rate: string; label: string; base: string; vat: string }[];
  salesVat: string;
  /** Purchase VAT recorded on 241 in the month, offset by the month closing, and waiting on 241. */
  purchaseVat: string;
  offset: string;
  waiting: string;
  /** Sales VAT − offset purchase VAT. */
  payable: string;
  /** DVX ↔ books for the month (the same figures as the reconciliation). */
  dvx: {
    direction: 'sale' | 'purchase';
    covered: boolean;
    dvxVat: string;
    bookedVat: string;
    difference: string;
  }[];
}
export interface DashboardTile {
  key: 'income' | 'profit' | 'money' | 'receivables' | 'payables' | 'vat';
  label: string;
  value: string;
  hint: string;
}
export interface DashboardView {
  month: string;
  tiles: DashboardTile[];
  /** 12 months up to `month`: income, expense, profit (M/Z) and money at the month's end. */
  series: { month: string; income: string; expense: string; profit: string; money: string }[];
  ms: number;
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
  /** The line's own (leaf) account: 223.01 on the card of 223. */
  account: string;
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
      | 'eqMissing'
      // DVX not updated for more than 7 days / after the closed month (stage 6c-1).
      | 'dvxStale'
      // Month closing (stage 5c): missing month-end rate, register ≠ journal, steps refused, a
      // purchase whose VAT waits for its e-qaimə.
      | 'rate'
      | 'integrity'
      | 'closing'
      | 'vatUnconfirmed';
    text: string;
    account: string;
    sk: string[];
    /** The bank document the signal is about, when there is one. */
    document?: { id: string; direction: 'in' | 'out' };
    /** The e-qaimə box the signal is about (stage 4c). */
    eq?: 'sale' | 'purchase';
    /** The invoice the signal is about (month closing: VAT waiting for its e-qaimə). */
    invoice?: { id: string; direction: 'sale' | 'purchase' };
  }[];
  postings: number;
  closedThrough: string;
}

/** A control signal (İş masası, month closing checks). */
export type Signal = HomeView['warnings'][number];

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
  /** DVX took the VAT out of the gross amount: the invoice's prices include VAT. */
  pricesIncludeVat?: boolean;
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

/** One "DVX-dən yenilə" attempt (stage 6c-1). */
export interface DvxSyncView {
  from: string;
  to: string;
  startedAt: string;
  finishedAt: string;
  result: 'ok' | 'partial' | 'failed' | 'cancelled';
  added: number;
  updated: number;
  conflicts: number;
  rejected: number;
  posted: number;
  message: string;
}

export interface EqInboxView {
  documents: EqDocumentView[];
  counts: Record<EqBucket, number>;
  /** The last "DVX-dən yenilə" attempt of the box, whatever its result. */
  lastSync: DvxSyncView | null;
  /** When the box last got DVX's word: a successful (or partial) update or an Excel file; '' never. */
  refreshedAt: string;
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
