/**
 * Runtime contracts between the UI and the application layer. Every value crossing the IPC
 * boundary is checked here for shape; the domain then checks meaning (amount formats, dates,
 * accounts, subkonto). Money and quantities travel as decimal strings, never as JS numbers.
 */
import { z } from 'zod';

const id = z.string().min(1).max(80);
const key = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, 'Sorğu açarı düzgün deyil.');
const text = (max: number) => z.string().max(max);
const decimal = z.string().max(32);
const version = z.number().int().nonnegative();
const code = z.string().max(20);
const date = z.string().max(10);
const subkontoKind = z.enum([
  'partner',
  'contract',
  'document',
  'bankAccount',
  'cashbox',
  'product',
  'productGroup',
  'expenseItem',
  'incomeType',
  'vatRate',
  'taxType',
  'paymentKind',
  'fund',
  'capitalChange',
  'employee',
]);
const nature = z.enum(['active', 'passive', 'active-passive']);

const base = { key, companyId: id };
const editable = {
  id: id.optional(),
  version: version.optional(),
  archived: z.boolean().default(false),
};

export const operationLineInput = z.object({
  dtAccount: code,
  dtSk: z.array(z.string().max(120)).max(3).default([]),
  ktAccount: code,
  ktSk: z.array(z.string().max(120)).max(3).default([]),
  amount: decimal,
  quantity: decimal.optional(),
  /** Currency amounts for currency accounts; the currency comes from the bank account or contract. */
  dtCurAmount: decimal.optional(),
  ktCurAmount: decimal.optional(),
  currency: z.string().max(3).optional(),
  memo: text(300).default(''),
});
export type OperationLineInput = z.infer<typeof operationLineInput>;

const vatRate = z.enum(['18', '0', 'exempt', 'nontaxable']);
const vatTreatment = z.enum(['offset', 'cost']);
export const invoiceLineInput = z.object({
  productId: id,
  quantity: decimal,
  price: decimal,
  vatRate,
  /** Sale: income type (601); defaults to the goods / services income type of the product. */
  incomeTypeId: id.optional(),
  /**
   * Sale: stock account the goods leave (default by product kind). Purchase: the debit account
   * (default: service 721, material 201, goods 205, fixed asset 113).
   */
  account: code.optional(),
  /** Expense item when the account keeps one (721, 711, 731…). */
  expenseItemId: id.optional(),
  /** Purchase: overrides the invoice's VAT treatment for this line. */
  vatTreatment: vatTreatment.optional(),
  memo: text(300).default(''),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineInput>;

export const bankLineInput = z.object({
  /** Counter account: any postable account of the chart. */
  account: code,
  /**
   * Subkonto values of the counter account, in its order. An empty settlement document on 211 / 531
   * (receipt / payment) means "match the open invoices"; elsewhere it means this bank document.
   */
  sk: z.array(z.string().max(120)).max(3).default([]),
  /** In the bank account's currency. */
  amount: decimal,
  /**
   * Currency amount of a currency counter account when the bank account is in AZN (currency
   * exchange); otherwise it follows from the line amount.
   */
  curAmount: decimal.optional(),
  /** "Pul vəsaitlərinin hərəkəti maddəsi" — an attribute of the line, not a subkonto. */
  cashFlowItem: z.string().max(80).default(''),
  memo: text(300).default(''),
});
export type BankLineInput = z.infer<typeof bankLineInput>;

/** One operation of a bank statement as the reader found it (docs/MERHELE-3-BANK.md §6). */
export const statementLineInput = z.object({
  row: z.number().int().nonnegative(),
  date,
  direction: z.enum(['in', 'out']),
  amount: decimal,
  reference: text(80).default(''),
  counterparty: text(240).default(''),
  counterpartyTaxId: text(20).default(''),
  counterpartyIban: text(40).default(''),
  purpose: text(500).default(''),
});
export type StatementLineInput = z.infer<typeof statementLineInput>;

export const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('company.create'),
    key,
    name: text(200),
    taxId: text(20),
    vatPayer: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('company.update'),
    ...base,
    version,
    name: text(200),
    vatPayer: z.boolean(),
    purchaseVat: z.enum(['offset', 'cost']),
  }),
  z.object({
    type: z.literal('account.create'),
    ...base,
    code,
    name: text(200),
    nature: nature.optional(),
    subkonto: z.array(subkontoKind).max(3).optional(),
    quantitative: z.boolean().optional(),
    currency: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('account.update'),
    ...base,
    code,
    name: text(200),
    nature,
    subkonto: z.array(subkontoKind).max(3),
    quantitative: z.boolean(),
    currency: z.boolean(),
    archived: z.boolean(),
  }),
  z.object({
    type: z.literal('partner.save'),
    ...base,
    ...editable,
    name: text(240),
    taxId: text(20).default(''),
    kind: z.enum(['legal', 'individual', 'foreign', 'state']).default('legal'),
    note: text(500).default(''),
  }),
  z.object({
    type: z.literal('contract.save'),
    ...base,
    ...editable,
    partnerId: id,
    number: text(80),
    date,
    kind: z.enum(['sale', 'purchase', 'loan', 'other']),
    currency: z.string().max(3).default('AZN'),
    note: text(500).default(''),
  }),
  z.object({
    type: z.literal('bankAccount.save'),
    ...base,
    ...editable,
    bankId: id,
    iban: text(40),
    currency: z.string().max(3),
    account: code,
    name: text(160).default(''),
  }),
  z.object({
    type: z.literal('product.save'),
    ...base,
    ...editable,
    code: text(40).default(''),
    name: text(240),
    unit: text(20),
    kind: z.enum(['goods', 'material', 'asset', 'service']),
    /** Product group (701); empty means the default group. */
    groupId: z.string().max(80).default(''),
  }),
  z.object({
    type: z.literal('employee.save'),
    ...base,
    ...editable,
    name: text(160),
    position: text(120).default(''),
    fin: text(10).default(''),
  }),
  z.object({
    type: z.literal('item.save'),
    ...base,
    ...editable,
    kind: z.enum([
      'expenseItem',
      'incomeType',
      'taxType',
      'paymentKind',
      'fund',
      'capitalChange',
      'cashbox',
      'productGroup',
      'cashFlowItem',
    ]),
    name: text(160),
    /**
     * Element used by posting rules (VAT payment kind, cost of sales, default product group,
     * default income types). Setting it moves the role from any other element; omitted keeps it.
     */
    role: z
      .enum(['', 'vatTax', 'cogs', 'defaultProductGroup', 'goodsIncome', 'serviceIncome'])
      .optional(),
  }),
  z.object({
    type: z.literal('operation.save'),
    ...base,
    id: id.optional(),
    version: version.optional(),
    number: text(40).default(''),
    date,
    memo: text(500).default(''),
    lines: z.array(operationLineInput).min(1).max(2000),
  }),
  z.object({
    type: z.literal('operation.cancel'),
    ...base,
    id,
    version,
    reason: text(240),
  }),
  z.object({
    type: z.literal('invoice.save'),
    ...base,
    id: id.optional(),
    version: version.optional(),
    direction: z.enum(['sale', 'purchase']),
    /** Internal number; generated when empty (SQ-000001 / AQ-000001). */
    number: text(40).default(''),
    date,
    partnerId: id,
    contractId: id,
    /** AMB rate for a currency contract (4 decimals), empty for AZN. */
    rate: decimal.default(''),
    pricesIncludeVat: z.boolean().default(false),
    /** Purchase: "offset" puts VAT on 241, "cost" adds it to the cost; default from the company. */
    vatTreatment: vatTreatment.optional(),
    /** Kept for older callers: joined in front of the number. */
    eqSeries: text(20).default(''),
    /** E-qaimə number as printed, e.g. "MT2610007". */
    eqNumber: text(60).default(''),
    memo: text(500).default(''),
    lines: z.array(invoiceLineInput).min(1).max(500),
    /**
     * Manual postings (1C "Əl ilə düzəliş"): when given, they replace the generated entry; the
     * invoice lines stay as the document's content. Omitted = postings by the rules.
     */
    postings: z.array(operationLineInput).min(1).max(2000).optional(),
  }),
  z.object({
    type: z.literal('invoice.cancel'),
    ...base,
    id,
    version,
    reason: text(240),
  }),
  z.object({
    type: z.literal('bank.save'),
    ...base,
    id: id.optional(),
    version: version.optional(),
    /** in: money received (Dt bank); out: money paid (Kt bank). */
    direction: z.enum(['in', 'out']),
    /** Internal number; generated when empty (BD-000001 / BX-000001). */
    number: text(40).default(''),
    date,
    bankAccountId: id,
    /** AMB rate for a currency bank account (4 decimals), empty for AZN. */
    rate: decimal.default(''),
    /** Payment order number, as printed by the bank. */
    bankReference: text(80).default(''),
    counterpartyName: text(240).default(''),
    counterpartyTaxId: text(20).default(''),
    purpose: text(500).default(''),
    lines: z.array(bankLineInput).min(1).max(500),
    /** The statement row this document books; date, amount and account must match it. */
    statementLineId: id.optional(),
  }),
  z.object({
    type: z.literal('statement.import'),
    ...base,
    /** Chosen by the user when the file does not print the account's IBAN. */
    bankAccountId: id.optional(),
    /** IBAN printed in the file's title block, if any. */
    iban: text(40).default(''),
    fileName: text(240),
    fileHash: z.string().regex(/^[0-9a-f]{64}$/, 'Faylın həşi düzgün deyil.'),
    /** Balances printed by the bank (may be negative). */
    opening: decimal.optional(),
    closing: decimal.optional(),
    lines: z.array(statementLineInput).min(1).max(20000),
  }),
  z.object({
    type: z.literal('statement.ignore'),
    ...base,
    lineId: id,
    reason: text(240),
  }),
  z.object({ type: z.literal('statement.restore'), ...base, lineId: id }),
  z.object({
    type: z.literal('statement.link'),
    ...base,
    lineId: id,
    /** A bank document entered by hand for the same payment. */
    documentId: id,
  }),
  z.object({
    type: z.literal('bank.pair'),
    ...base,
    id,
    /** The other half of the VAT deposit pair; empty undoes the pair. */
    pairId: z.string().max(80),
  }),
  z.object({
    type: z.literal('bank.cancel'),
    ...base,
    id,
    version,
    reason: text(240),
  }),
  z.object({
    type: z.literal('period.close'),
    ...base,
    /** Closing date; an earlier date than the current one reopens the period (with a reason). */
    through: date,
    reason: text(240).default(''),
  }),
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandType = Command['type'];
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;

export interface CommandResult {
  id: string;
  version?: number;
  number?: string;
  /** True when the same request was already applied; nothing changed. */
  replayed?: boolean;
  /** Statement import: new rows, rows already loaded before, rows refused with the reason. */
  added?: number;
  duplicates?: number;
  rejected?: { row: number; message: string }[];
}

export interface ErrorPayload {
  message: string;
  field?: string;
  code: string;
}
