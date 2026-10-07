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
    ]),
    name: text(160),
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
}

export interface ErrorPayload {
  message: string;
  field?: string;
  code: string;
}
