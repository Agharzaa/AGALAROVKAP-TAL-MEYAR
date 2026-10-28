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
  'fixedAsset',
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
  /** Sale of a fixed asset (stage 7c): the asset sold (the product is of the "asset" kind). */
  assetId: id.optional(),
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

/** A line of a fixed-asset document (stage 7a): the asset and its depreciation terms. */
export const assetLineInput = z.object({
  assetId: id,
  /** Putting into service: the 113 nomenclature it comes from, and how many of it. */
  productId: z.string().max(80).default(''),
  quantity: decimal.default(''),
  /** Opening balance: the cost and the depreciation so far. */
  cost: decimal.default(''),
  accumulated: decimal.default('0'),
  salvage: decimal.default('0'),
  /** Putting into service / opening balance: the whole useful life (disposal: none). */
  lifeMonths: z.number().int().min(0).max(1200).default(0),
  /** Opening balance: months still to depreciate (putting into service: the whole life). */
  remainingMonths: z.number().int().min(0).max(1200).optional(),
  /** Where depreciation goes: 701 / 711 / 721 / 731 / 202 with its subkonto. */
  expenseAccount: code.default(''),
  expenseSk: z.array(z.string().max(120)).max(3).default([]),
  /** Opening balance: the counter account (e.g. 343) with its subkonto. */
  counterAccount: z.string().max(20).default(''),
  counterSk: z.array(z.string().max(120)).max(3).default([]),
  /** Opening balance (stage 9c): the tax residual value taken over ('' — cost less depreciation). */
  taxResidual: decimal.default(''),
});
export type AssetLineInput = z.infer<typeof assetLineInput>;

const bracketInput = z.object({ upTo: decimal, rate: z.string().max(8) });
const brackets = z.array(bracketInput).min(1).max(10);
export const payrollRatesInput = z.object({
  incomeTax: brackets,
  relief: z.object({ amount: decimal, ifUpTo: decimal }),
  dsmfEmployee: brackets,
  unemploymentEmployee: brackets,
  medicalEmployee: brackets,
  dsmfEmployer: brackets,
  unemploymentEmployer: brackets,
  medicalEmployer: brackets,
  pay: z
    .object({
      overtime: z.string().max(8),
      holidayWork: z.string().max(8),
      night: z.string().max(8),
    })
    .optional(),
});
/** A payroll line (stage 8a): the month's salary (prorated by the form) and a bonus. */
/** Stage 8b: what is withheld besides taxes (alimony, an advance back): Dt 533 / Kt the account. */
export const payrollDeductionInput = z.object({
  amount: decimal,
  account: code,
  sk: z.array(z.string().max(120)).max(3).default([]),
  memo: text(200).default(''),
});
export const payrollLineInput = z.object({
  employeeId: id,
  salary: decimal,
  bonus: decimal.default(''),
  deductions: z.array(payrollDeductionInput).max(5).default([]),
});
export type PayrollLineInput = z.infer<typeof payrollLineInput>;

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

/** A goods line of a DVX "Mallar üzrə" report, as printed. */
export const eqLineInput = z.object({
  code: text(80).default(''),
  name: text(500),
  unit: text(40).default(''),
  quantity: decimal.default(''),
  price: decimal.default(''),
  net: decimal,
  vat: decimal.default('0.00'),
  vatRate: text(20).default(''),
});
/** One e-qaimə read from a DVX report (domain/eqaime.ts → readEqTable). */
export const eqDocumentInput = z.object({
  row: z.number().int().nonnegative(),
  number: text(60),
  date,
  taxId: text(20).default(''),
  name: text(300).default(''),
  sellerTaxId: text(20).default(''),
  buyerTaxId: text(20).default(''),
  sellerName: text(300).default(''),
  buyerName: text(300).default(''),
  kind: text(120).default(''),
  status: text(120).default(''),
  refNumber: text(60).default(''),
  net: decimal,
  vat: decimal.default(''),
  total: decimal.default(''),
  base18: decimal.default(''),
  base0: decimal.default(''),
  baseExempt: decimal.default(''),
  baseNontaxable: decimal.default(''),
  excise: decimal.default(''),
  roadTax: decimal.default(''),
  note: text(1000).default(''),
  lines: z.array(eqLineInput).max(1000).optional(),
});
export type EqDocumentInputDto = z.infer<typeof eqDocumentInput>;

/** A line of a learned rule: like a bank line, with an amount only when it is fixed. */
export const ruleLineInput = z.object({
  account: code,
  sk: z.array(z.string().max(120)).max(3).default([]),
  /** Fixed amount; empty for the one line that takes the rest of the row. */
  amount: decimal.default(''),
  cashFlowItem: z.string().max(80).default(''),
  memo: text(300).default(''),
});
export type RuleLineInput = z.infer<typeof ruleLineInput>;

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
  /** Stage 7a: a fixed asset of the catalog (subkonto of 111 / 112); inventory number by itself. */
  z.object({
    type: z.literal('fixedAsset.save'),
    ...base,
    ...editable,
    name: text(240),
    inventoryNo: text(40).default(''),
    group: z.enum(['transport', 'machinery', 'computers', 'buildings', 'other']),
    plate: text(40).default(''),
    note: text(500).default(''),
  }),
  /**
   * Stage 7a: putting fixed assets into service (113 → 111) or their opening balances. Each line
   * keeps the asset's depreciation terms.
   */
  z.object({
    type: z.literal('asset.save'),
    ...base,
    id: id.optional(),
    version: version.optional(),
    kind: z.enum(['commission', 'opening', 'disposal']),
    number: text(40).default(''),
    date,
    memo: text(500).default(''),
    lines: z.array(assetLineInput).min(1).max(500),
  }),
  z.object({ type: z.literal('asset.cancel'), ...base, id, version, reason: text(240) }),
  z.object({
    type: z.literal('cashbox.save'),
    ...base,
    ...editable,
    name: text(160),
    currency: z.string().max(3).default('AZN'),
    account: code,
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
    /** Stage 8a: tabel number, employment, monthly salary and the account it is charged to. */
    tabNo: text(20).default(''),
    hired: z.string().max(10).default(''),
    left: z.string().max(10).default(''),
    salary: decimal.default(''),
    /** A changed salary is in force from this day ('' — the current month's first day). */
    salaryFrom: z.string().max(10).default(''),
    expenseAccount: code.default(''),
    expenseSk: z.array(z.string().max(120)).max(3).default([]),
    /** Stage 8c: income tax exemptions (VM 102) — only at the main workplace. */
    mainJob: z.boolean().default(true),
    exemption: z.enum(['0', '100', '200', '400']).default('0'),
    exemptionExtra: z.boolean().default(false),
    exemptionFrom: z.string().max(10).default(''),
    exemptionTo: z.string().max(10).default(''),
    /** Stage 8d: annual vacation (base days, extra days) and the start of the tenure. */
    vacationDays: z.number().int().min(0).max(90).default(21),
    vacationExtra: z.number().int().min(0).max(90).default(0),
    tenureFrom: z.string().max(10).default(''),
  }),
  /** Stage 8d: the production calendar of a year (its special days replace the year's). */
  z.object({
    type: z.literal('calendar.save'),
    ...base,
    year: z.number().int().min(2000).max(2100),
    days: z
      .array(
        z.object({
          date,
          kind: z.enum(['holiday', 'rest', 'work', 'short']),
          name: text(120).default(''),
        }),
      )
      .max(200),
  }),
  /** Stage 8d: a month's timesheet — one row per employee, a cell per day. */
  z.object({
    type: z.literal('timesheet.save'),
    ...base,
    id: id.optional(),
    version: version.optional(),
    month: z.string().max(7),
    number: text(40).default(''),
    memo: text(500).default(''),
    rows: z
      .array(
        z.object({
          employeeId: id,
          /** "8", "7,5", "E", "E8", "M", "Ö", "X", "Q", "B" or "" — a day each. */
          cells: z.array(z.string().max(8)).max(31),
          overtime: decimal.default(''),
          night: decimal.default(''),
        }),
      )
      .min(1)
      .max(300),
  }),
  z.object({ type: z.literal('timesheet.cancel'), ...base, id, version, reason: text(240) }),
  /** Stage 8c: a vacation (paid / unpaid) or a sick leave; its pay goes to the month's payroll. */
  z.object({
    type: z.literal('absence.save'),
    ...base,
    id: id.optional(),
    version: version.optional(),
    kind: z.enum(['vacation', 'unpaid', 'sick', 'compensation']),
    number: text(40).default(''),
    employeeId: id,
    /** Stage 8d: a vacation's length (its end follows, holidays not counted); a compensation's days. */
    days: z.number().int().min(1).max(366).optional(),
    from: date,
    to: date,
    /** Sick leave: the certificate's number, the service percentage, an accident at work. */
    sheetNo: text(40).default(''),
    percent: z.number().int().min(0).max(100).default(100),
    employerAll: z.boolean().default(false),
    /** The accountant's average (monthly for a vacation, daily for a sick leave); '' — computed. */
    manual: decimal.default(''),
    memo: text(500).default(''),
  }),
  z.object({ type: z.literal('absence.cancel'), ...base, id, version, reason: text(240) }),
  /**
   * Stage 9c / 9d: the tax parameters of a year — VM 114 rates per category (percent), the micro /
   * small business coefficient, the write-off threshold, the profit tax rate, losses carried from
   * years before Meyar, the accountant's adjustments (+ income, − deduction).
   */
  z.object({
    type: z.literal('taxYear.save'),
    ...base,
    year: z.string().max(4),
    rates: z.record(z.string().max(20), z.string().max(8)),
    coefficient: z.string().max(4).default('1'),
    writeOff: decimal.default('100'),
    profitRate: z.string().max(8).default('20'),
    losses: decimal.default('0'),
    adjustments: z
      .array(z.object({ label: text(160), amount: decimal }))
      .max(30)
      .default([]),
  }),
  /** Stage 8a: a set of payroll rates in force from a day (marginal brackets, percent). */
  z.object({
    type: z.literal('payrollRates.save'),
    ...base,
    validFrom: date,
    rates: payrollRatesInput,
  }),
  /** Stage 8a: a month's payroll — one line per employee, posted on the month's last day. */
  z.object({
    type: z.literal('payroll.save'),
    ...base,
    id: id.optional(),
    version: version.optional(),
    month: z.string().max(7),
    number: text(40).default(''),
    memo: text(500).default(''),
    lines: z.array(payrollLineInput).min(1).max(300),
  }),
  z.object({ type: z.literal('payroll.cancel'), ...base, id, version, reason: text(240) }),
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
      'productGroup',
      'cashFlowItem',
    ]),
    name: text(160),
    /**
     * Element used by posting rules (VAT payment kind, cost of sales, default product group,
     * default income types). Setting it moves the role from any other element; omitted keeps it.
     */
    role: z
      .enum([
        '',
        'vatTax',
        'cogs',
        'defaultProductGroup',
        'goodsIncome',
        'serviceIncome',
        'fxIncome',
        'fxExpense',
        'depreciation',
        'assetDisposal',
        'assetSale',
        'salary',
        'socialInsurance',
        'sickPay',
      ])
      .optional(),
    /** Stage 9d, an expense item: false — not deducted from income for the profit tax; omitted keeps. */
    taxDeductible: z.boolean().optional(),
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
    /** The DVX e-qaimə this invoice books (from the e-qaimə box); checked against it. */
    eqDocumentId: id.optional(),
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
  /** Books the waiting rows of a statement that an "auto" rule recognises. */
  z.object({ type: z.literal('statement.apply'), ...base, importId: id }),
  z.object({
    type: z.literal('rule.save'),
    ...base,
    ...editable,
    name: text(160),
    direction: z.enum(['in', 'out']),
    /** Only rows of this bank account; empty = any account. */
    bankAccountId: z.string().max(80).default(''),
    /** Only rows of this counterparty VÖEN; empty = any. */
    counterpartyTaxId: text(20).default(''),
    /** Words that must all appear in the purpose (or the counterparty name). */
    terms: z.array(text(60)).max(10).default([]),
    amountMin: decimal.default(''),
    amountMax: decimal.default(''),
    lines: z.array(ruleLineInput).min(1).max(20),
    /** suggest: a proposal for the accountant; auto: posted by itself. */
    mode: z.enum(['suggest', 'auto']).default('suggest'),
  }),
  z.object({
    type: z.literal('budgetCode.save'),
    ...base,
    ...editable,
    /** Büdcə təsnifat kodu, six digits. */
    code: text(10),
    name: text(160).default(''),
    /** 521.xx or 522.xx sub-account the code pays. */
    account: code,
    paymentKindId: z.string().max(80).default(''),
  }),
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
    type: z.literal('cash.save'),
    ...base,
    id: id.optional(),
    version: version.optional(),
    /** in: kassa mədaxil orderi (Dt 221); out: kassa məxaric orderi (Kt 221). */
    direction: z.enum(['in', 'out']),
    /** Generated when empty (KMO-000001 / KXO-000001). */
    number: text(40).default(''),
    date,
    cashboxId: id,
    /** AMB rate for a currency cashbox (4 decimals), empty for AZN. */
    rate: decimal.default(''),
    /** "Kimdən qəbul edilib" / "Kimə verilib", as printed on the order. */
    counterpartyName: text(240).default(''),
    /** "Əsas" of the order. */
    basis: text(500).default(''),
    /** "Əlavə": the papers attached to the order. */
    attachment: text(240).default(''),
    lines: z.array(bankLineInput).min(1).max(500),
  }),
  z.object({
    type: z.literal('rates.save'),
    ...base,
    date,
    /** amb: read from the AMB file; manual: typed by the accountant. */
    source: z.enum(['amb', 'manual']),
    rates: z
      .array(z.object({ currency: text(3), rate: decimal }))
      .min(1)
      .max(60),
  }),
  z.object({
    type: z.literal('revaluation.post'),
    ...base,
    /** "2026-10": posted on the month's last day; again = storno of the previous one first. */
    month: z.string().max(7),
    version: version.optional(),
  }),
  z.object({
    type: z.literal('revaluation.cancel'),
    ...base,
    id,
    version,
    reason: text(240),
  }),
  z.object({
    type: z.literal('closing.post'),
    ...base,
    /** "2026-09": every step in one transaction, then the period is closed through the month's end. */
    month: z.string().max(7),
    /** The accountant has read the warnings (they are kept with the closing). */
    acknowledged: z.boolean().default(false),
    /** Version of the cancelled closing of this month, when closing it again. */
    version: version.optional(),
  }),
  z.object({
    type: z.literal('closing.cancel'),
    ...base,
    id,
    version,
    reason: text(240),
  }),
  z.object({
    type: z.literal('cash.cancel'),
    ...base,
    id,
    version,
    reason: text(240),
  }),
  z.object({
    type: z.literal('bank.cancel'),
    ...base,
    id,
    version,
    reason: text(240),
  }),
  z.object({
    type: z.literal('eqaime.import'),
    ...base,
    /** purchase: Gələnlər; sale: Göndərilənlər — chosen by the user, checked against the file. */
    direction: z.enum(['sale', 'purchase']),
    /** The direction the file names in its title, when it names one. */
    fileDirection: z.enum(['sale', 'purchase']).optional(),
    /** VÖEN of the company the export belongs to, as printed above its table. */
    fileOwnerTaxId: text(20).optional(),
    /**
     * The user confirmed the direction of a file that proves none (no Gələnlər / Göndərilənlər
     * title, no seller and buyer VÖEN columns).
     */
    directionConfirmed: z.boolean().default(false),
    report: z.enum(['invoices', 'goods']),
    source: z.enum(['file', 'portal']).default('file'),
    fileName: text(240),
    fileHash: z.string().regex(/^[0-9a-f]{64}$/, 'Faylın həşi düzgün deyil.'),
    documents: z.array(eqDocumentInput).min(1).max(20000),
  }),
  /** Stage 6c-1: one "DVX-dən yenilə" attempt, as it ended (its pages were imported one by one). */
  z.object({
    type: z.literal('eqaime.synced'),
    ...base,
    direction: z.enum(['sale', 'purchase']),
    from: date,
    to: date,
    startedAt: text(40),
    result: z.enum(['ok', 'partial', 'failed', 'cancelled']),
    added: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    posted: z.number().int().nonnegative(),
    message: text(500),
  }),
  z.object({
    type: z.literal('eqaime.ignore'),
    ...base,
    documentId: id,
    reason: text(240),
  }),
  z.object({ type: z.literal('eqaime.restore'), ...base, documentId: id }),
  /**
   * The accountant takes note of a conflict the books cannot follow any more (a closed period:
   * the reversal was made by hand in the open one) or has reviewed (other amounts from DVX).
   */
  z.object({ type: z.literal('eqaime.resolve'), ...base, documentId: id, note: text(240) }),
  /** Books the waiting e-qaimələr of a direction that the confirmed (auto) map entries cover. */
  z.object({ type: z.literal('eqaime.apply'), ...base, direction: z.enum(['sale', 'purchase']) }),
  /**
   * Links an e-qaimə to an invoice typed by hand: the same e-qaimə number, or a numberless invoice
   * of the same partner and total (its number is then written in; the postings do not change).
   */
  z.object({ type: z.literal('eqaime.link'), ...base, documentId: id, invoiceId: id }),
  /**
   * The partners of the waiting e-qaimələr that are not in the catalog yet, created at once from
   * DVX's name and VÖEN (only on the accountant's request); with contracts: one "Əsas" contract
   * of the box's kind for each partner of the box that has no active one.
   */
  z.object({
    type: z.literal('eqaime.partners'),
    ...base,
    direction: z.enum(['sale', 'purchase']),
    contracts: z.boolean().default(true),
  }),
  /** Map entries (suggest) from how the accountant booked this e-qaimə. */
  z.object({ type: z.literal('eqaime.learn'), ...base, documentId: id }),
  /**
   * "The whole e-qaimə of these VÖENs → this service" at once (header entries). A VÖEN that has
   * one already keeps it; one with a contract-only entry gets the product added.
   */
  z.object({
    type: z.literal('eqMap.bulk'),
    ...base,
    direction: z.enum(['sale', 'purchase']),
    taxIds: z.array(text(20)).min(1).max(5000),
    productId: id,
    account: code.default(''),
    expenseItemId: z.string().max(80).default(''),
    incomeTypeId: z.string().max(80).default(''),
    vatTreatment: z.enum(['', 'offset', 'cost']).default(''),
    mode: z.enum(['suggest', 'auto']).default('suggest'),
  }),
  z.object({
    type: z.literal('eqMap.save'),
    ...base,
    ...editable,
    direction: z.enum(['sale', 'purchase']),
    /** Only e-qaimələr of this VÖEN; empty = any partner (then a DVX code is required). */
    taxId: text(20).default(''),
    /** DVX goods code and name; both empty = the whole e-qaimə of this VÖEN (header entry). */
    dvxCode: text(80).default(''),
    name: text(500).default(''),
    unit: text(40).default(''),
    productId: z.string().max(80).default(''),
    account: code.default(''),
    expenseItemId: z.string().max(80).default(''),
    incomeTypeId: z.string().max(80).default(''),
    vatTreatment: z.enum(['', 'offset', 'cost']).default(''),
    /** Header entry: the contract of this VÖEN's e-qaimələr when it has several. */
    contractId: z.string().max(80).default(''),
    mode: z.enum(['suggest', 'auto']).default('suggest'),
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
  /** Saved, but differs from its DVX e-qaimə: shown to the accountant at once (25.10.2026). */
  warning?: string;
  /** Statement import: new rows, rows already loaded before, rows refused with the reason. */
  added?: number;
  duplicates?: number;
  rejected?: { row: number; message: string }[];
  /** E-qaimə import: e-qaimələr whose DVX status or goods lines changed, unchanged ones, conflicts. */
  updated?: number;
  same?: number;
  conflicts?: number;
  /** eqaime.partners: partners and contracts created. */
  partners?: number;
  contracts?: number;
  /** E-qaimə map entries created by eqaime.learn. */
  learned?: number;
  /** Rows an "auto" rule posted, and rows it recognised but could not post (with the reason). */
  posted?: number;
  failed?: { row: number; message: string }[];
}

export interface ErrorPayload {
  message: string;
  field?: string;
  code: string;
}
