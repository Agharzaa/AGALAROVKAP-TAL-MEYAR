/**
 * Runtime contracts between the UI and the application layer. Every value crossing the IPC
 * boundary is checked here for shape; the domain then checks meaning (amount formats, dates,
 * accounts). Money, quantities and prices travel as decimal strings, never as JS numbers.
 */
import { z } from 'zod';

const id = z.string().min(1).max(80);
const key = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, 'Sorğu açarı düzgün deyil.');
const text = (max: number) => z.string().max(max);
const decimal = z.string().max(32);
const version = z.number().int().nonnegative();

const base = { key, companyId: id };

export const invoiceLineInput = z.object({
  kind: z.enum(['service', 'stock']),
  description: text(240).default(''),
  account: z.string().max(20),
  stockAccount: z.string().max(20).optional(),
  productId: id.optional(),
  warehouseId: id.optional(),
  quantity: decimal.optional(),
  /** Which unit `quantity` and `unitPrice` refer to. */
  unit: z.enum(['base', 'purchase']).optional(),
  unitPrice: decimal.optional(),
  /** Net amount for service lines; stock lines derive it from quantity × price. */
  net: decimal.optional(),
  vat: decimal,
  expenseItemId: id.optional(),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineInput>;

export const allocationInput = z.object({ invoiceId: id, amount: decimal });
export type AllocationInput = z.infer<typeof allocationInput>;

export const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('company.create'),
    key,
    name: text(200),
    taxId: text(20),
  }),
  z.object({
    type: z.literal('partner.save'),
    ...base,
    id: id.optional(),
    version: version.optional(),
    name: text(240),
    taxId: text(20),
  }),
  z.object({
    type: z.literal('account.create'),
    ...base,
    parentCode: z.string().max(20),
    code: z.string().max(20),
    name: text(160),
  }),
  z.object({
    type: z.literal('expenseItem.save'),
    ...base,
    id: id.optional(),
    name: text(160),
  }),
  z.object({
    type: z.literal('warehouse.save'),
    ...base,
    id: id.optional(),
    name: text(160),
  }),
  z.object({
    type: z.literal('unit.save'),
    ...base,
    code: z.string().max(20),
    name: text(40),
  }),
  z.object({
    type: z.literal('product.save'),
    ...base,
    id: id.optional(),
    version: version.optional(),
    code: text(40),
    name: text(240),
    group: text(120).default(''),
    barcode: text(64).default(''),
    baseUnit: z.string().max(20),
    purchaseUnit: z.string().max(20),
    factor: decimal,
    account: z.string().max(20),
  }),
  z.object({
    type: z.literal('invoice.save'),
    ...base,
    id: id.optional(),
    version: version.optional(),
    mode: z.enum(['post', 'draft']),
    direction: z.enum(['purchase', 'sale']),
    number: text(80),
    date: z.string().max(10),
    partnerId: id,
    note: text(500).default(''),
    lines: z.array(invoiceLineInput).max(500),
  }),
  z.object({
    type: z.literal('invoice.cancel'),
    ...base,
    id,
    version,
    reason: text(240),
  }),
  z.object({
    type: z.literal('payment.save'),
    ...base,
    id: id.optional(),
    version: version.optional(),
    direction: z.enum(['in', 'out']),
    bankAccount: z.string().max(20),
    reference: text(80),
    date: z.string().max(10),
    partnerId: id,
    amount: decimal,
    note: text(500).default(''),
    allocations: z.array(allocationInput).max(200).default([]),
  }),
  z.object({
    type: z.literal('payment.cancel'),
    ...base,
    id,
    version,
    reason: text(240),
  }),
  z.object({
    type: z.literal('allocation.create'),
    ...base,
    paymentId: id,
    date: z.string().max(10),
    allocations: z.array(allocationInput).min(1).max(200),
  }),
  z.object({
    type: z.literal('allocation.cancel'),
    ...base,
    id,
    reason: text(240),
  }),
  z.object({
    type: z.literal('period.close'),
    ...base,
    through: z.string().max(10),
  }),
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandType = Command['type'];
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;

export interface CommandResult {
  id: string;
  version?: number;
  /** True when the same request was already applied; nothing changed. */
  replayed?: boolean;
}

export interface ErrorPayload {
  message: string;
  field?: string;
  code: string;
}
