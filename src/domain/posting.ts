/**
 * Deterministic posting rules: a document in, balanced journal lines out. No I/O, no clock,
 * no guessing — every account comes from the chart, the document or an explicit role.
 */
import { Chart, inFamily, roles, type Account, type AnalyticKind } from './accounts.js';
import { DomainError } from './errors.js';
import { sumMinor, type Minor } from './money.js';
import type { Qty } from './quantity.js';

export interface Analytics {
  partnerId?: string;
  warehouseId?: string;
  productId?: string;
  expenseItemId?: string;
}
export interface JournalLine extends Analytics {
  account: string;
  debit: Minor;
  credit: Minor;
  /** Signed base-unit quantity for quantitative accounts (+ receipt, − issue). */
  quantity?: Qty;
  memo: string;
}

export type Direction = 'purchase' | 'sale';
export type LineKind = 'service' | 'stock';
export interface InvoiceLine {
  kind: LineKind;
  description: string;
  /** Purchase: the debited account. Sale: the revenue account credited. */
  account: string;
  /** Sale of stock only: inventory account credited at cost. */
  stockAccount?: string;
  productId?: string;
  warehouseId?: string;
  /** Base-unit quantity for stock lines. */
  quantity?: Qty;
  expenseItemId?: string;
  net: Minor;
  vat: Minor;
}
export interface InvoiceDoc {
  direction: Direction;
  number: string;
  partnerId: string;
  partnerName: string;
  lines: InvoiceLine[];
}

/** Account families a line may use, per direction and kind. */
export const lineFamilies = {
  purchase: {
    service: [roles.adminExpenses],
    stock: [roles.goods, roles.materials, roles.assetCapex],
  },
  sale: { service: [roles.revenue], stock: [roles.revenue] },
  saleStock: [roles.goods, roles.materials],
} as const;

function familyOf(code: string, families: readonly string[]): string | undefined {
  return families.find((f) => inFamily(code, f));
}

/** Checks a line against the chart and returns the resolved accounts. */
export function checkLine(chart: Chart, direction: Direction, line: InvoiceLine, index: number) {
  const where = `lines.${index}`;
  const families = lineFamilies[direction][line.kind];
  const family = familyOf(line.account, families);
  if (!family)
    throw new DomainError(
      `Sətir ${index + 1}: hesab ${families.join(', ')} qrupundan olmalıdır.`,
      `${where}.account`,
    );
  const account = chart.requirePostable(line.account, family, `${where}.account`);
  if (line.net <= 0n)
    throw new DomainError(`Sətir ${index + 1}: məbləğ sıfırdan böyük olmalıdır.`, `${where}.net`);
  if (line.vat < 0n)
    throw new DomainError(`Sətir ${index + 1}: ƏDV mənfi ola bilməz.`, `${where}.vat`);
  let stock: Account | undefined;
  if (line.kind === 'stock') {
    if (!line.productId || !line.warehouseId || !line.quantity || line.quantity <= 0n)
      throw new DomainError(
        `Sətir ${index + 1}: nomenklatura, anbar və miqdar tələb olunur.`,
        `${where}.productId`,
      );
    if (direction === 'sale') {
      const stockFamily = familyOf(line.stockAccount ?? '', lineFamilies.saleStock);
      if (!stockFamily)
        throw new DomainError(
          `Sətir ${index + 1}: silinən ehtiyat hesabı 205 və ya 201 qrupundan olmalıdır.`,
          `${where}.stockAccount`,
        );
      stock = chart.requirePostable(line.stockAccount!, stockFamily, `${where}.stockAccount`);
    }
  } else if (line.productId || line.warehouseId || line.quantity) {
    throw new DomainError(
      `Sətir ${index + 1}: xidmət sətrində anbar məlumatı olmur.`,
      `${where}.kind`,
    );
  }
  if (account.analytics.includes('expenseItem') && !line.expenseItemId)
    throw new DomainError(
      `Sətir ${index + 1}: ${account.code} üçün xərc maddəsi seçin.`,
      `${where}.expenseItemId`,
    );
  return { account, stock };
}

export function invoiceTotals(lines: readonly InvoiceLine[]) {
  const net = sumMinor(lines.map((l) => l.net));
  const vat = sumMinor(lines.map((l) => l.vat));
  return { net, vat, total: net + vat };
}

/**
 * @param costs cost of each sale stock line at the document date (weighted average), by index.
 */
export function postInvoice(
  chart: Chart,
  doc: InvoiceDoc,
  costs: ReadonlyMap<number, Minor> = new Map(),
): JournalLine[] {
  if (!doc.lines.length) throw new DomainError('Qaimədə ən azı bir sətir olmalıdır.', 'lines');
  doc.lines.forEach((line, i) => checkLine(chart, doc.direction, line, i));
  const { vat, total } = invoiceTotals(doc.lines);
  const lines: JournalLine[] = [];
  const label = (l: InvoiceLine) => l.description || doc.partnerName;
  const lineAnalytics = (l: InvoiceLine): Analytics => ({
    ...(l.productId ? { productId: l.productId } : {}),
    ...(l.warehouseId ? { warehouseId: l.warehouseId } : {}),
    ...(l.expenseItemId ? { expenseItemId: l.expenseItemId } : {}),
  });
  if (doc.direction === 'purchase') {
    for (const l of doc.lines)
      lines.push({
        account: l.account,
        debit: l.net,
        credit: 0n,
        ...lineAnalytics(l),
        ...(l.kind === 'stock' ? { quantity: l.quantity! } : {}),
        memo: label(l),
      });
    if (vat > 0n)
      lines.push({
        account: chart.role('vatInput').code,
        debit: vat,
        credit: 0n,
        memo: `ƏDV · ${doc.number}`,
      });
    lines.push({
      account: chart.role('payables').code,
      debit: 0n,
      credit: total,
      partnerId: doc.partnerId,
      memo: `Qaimə ${doc.number}`,
    });
  } else {
    lines.push({
      account: chart.role('receivables').code,
      debit: total,
      credit: 0n,
      partnerId: doc.partnerId,
      memo: `Qaimə ${doc.number}`,
    });
    doc.lines.forEach((l, i) => {
      lines.push({ account: l.account, debit: 0n, credit: l.net, memo: label(l) });
      if (l.kind === 'stock') {
        const cost = costs.get(i);
        if (cost === undefined || cost < 0n)
          throw new DomainError(`Sətir ${i + 1}: maya dəyəri hesablanmayıb.`, `lines.${i}`);
        if (cost > 0n) {
          lines.push({
            account: chart.role('costOfSales').code,
            debit: cost,
            credit: 0n,
            memo: label(l),
          });
          lines.push({
            account: l.stockAccount!,
            debit: 0n,
            credit: cost,
            productId: l.productId!,
            warehouseId: l.warehouseId!,
            quantity: -l.quantity!,
            memo: label(l),
          });
        } else {
          // Zero-cost stock still leaves the register; record the movement without money.
          lines.push({
            account: l.stockAccount!,
            debit: 0n,
            credit: 0n,
            productId: l.productId!,
            warehouseId: l.warehouseId!,
            quantity: -l.quantity!,
            memo: label(l),
          });
        }
      }
    });
    if (vat > 0n)
      lines.push({
        account: chart.role('vatOutput').code,
        debit: 0n,
        credit: vat,
        memo: `ƏDV · ${doc.number}`,
      });
  }
  return checkEntry(chart, lines);
}

export type PaymentDirection = 'in' | 'out';
/**
 * What a bank document settles (1C: "əməliyyat növü"). `settlement` is the stage-A behaviour:
 * customers pay 211, we pay suppliers on 531, and only these payments are linked to invoices.
 * The other kinds post the bank movement against one account family chosen per kind.
 */
export type PaymentKind =
  | 'settlement'
  | 'refund'
  | 'capital'
  | 'loan'
  | 'tax'
  | 'social'
  | 'salary'
  | 'transfer'
  | 'fee'
  | 'other';
interface KindRule {
  label: Record<PaymentDirection, string | null>;
  /** Allowed counter-account families per direction (first one is the default). */
  families: Record<PaymentDirection, readonly string[]>;
  partner: 'required' | 'optional';
}
export const paymentKinds: Record<PaymentKind, KindRule> = {
  settlement: {
    label: { in: 'Alıcıdan ödəniş', out: 'Malsatana ödəniş' },
    families: { in: [roles.receivables], out: [roles.payables] },
    partner: 'required',
  },
  refund: {
    label: { in: 'Malsatandan qaytarılan vəsait', out: 'Alıcıya qaytarılan vəsait' },
    families: { in: [roles.payables], out: [roles.receivables] },
    partner: 'required',
  },
  capital: {
    label: { in: 'Nizamnamə kapitalına qoyuluş', out: null },
    families: { in: [roles.capital], out: [] },
    partner: 'required',
  },
  loan: {
    label: { in: 'Kreditin alınması', out: 'Kreditin qaytarılması' },
    families: { in: [roles.loans], out: [roles.loans] },
    partner: 'required',
  },
  tax: {
    label: { in: 'Vergi qaytarılması', out: 'Vergi ödənişi' },
    families: { in: [roles.taxPayable], out: [roles.taxPayable] },
    partner: 'optional',
  },
  social: {
    label: { in: null, out: 'Sosial sığorta ödənişi' },
    families: { in: [], out: [roles.social] },
    partner: 'optional',
  },
  salary: {
    label: { in: null, out: 'Əmək haqqının ödənilməsi' },
    families: { in: [], out: [roles.payroll] },
    partner: 'optional',
  },
  transfer: {
    label: { in: 'Öz hesabından / kassadan daxilolma', out: 'Öz hesabına / kassaya köçürmə' },
    families: { in: [roles.transit, roles.cash], out: [roles.transit, roles.cash] },
    partner: 'optional',
  },
  fee: {
    label: { in: null, out: 'Bank xidmət haqqı' },
    families: { in: [], out: [roles.adminExpenses] },
    partner: 'optional',
  },
  other: {
    label: { in: 'Digər daxilolma', out: 'Digər ödəniş' },
    families: { in: [roles.otherIncome], out: [roles.otherExpenses, roles.adminExpenses] },
    partner: 'optional',
  },
};
/** Kinds whose payments are linked to invoices of the same partner. */
export const settlesInvoices = (kind: PaymentKind) => kind === 'settlement';

export interface PaymentDoc {
  direction: PaymentDirection;
  kind?: PaymentKind;
  bankAccount: string;
  reference: string;
  partnerId?: string;
  partnerName: string;
  /** Counter account for non-settlement kinds; defaults to the first family of the kind. */
  counterAccount?: string;
  expenseItemId?: string;
  amount: Minor;
  memo: string;
}
export const bankFamilies = [roles.bank, roles.vatDeposit] as const;

/** Resolves and checks the counter account of a bank document. */
export function paymentCounterAccount(chart: Chart, doc: PaymentDoc): Account {
  const kind = doc.kind ?? 'settlement';
  const rule = paymentKinds[kind];
  if (!rule) throw new DomainError('Bank əməliyyatının növü düzgün deyil.', 'kind');
  const families = rule.families[doc.direction];
  if (!families.length || !rule.label[doc.direction])
    throw new DomainError(
      `Bu əməliyyat növü ${doc.direction === 'in' ? 'daxilolma' : 'ödəniş'} üçün deyil.`,
      'kind',
    );
  const code = doc.counterAccount || families[0]!;
  const family = familyOf(code, families);
  if (!family)
    throw new DomainError(
      `${rule.label[doc.direction]} üçün hesab ${families.join(', ')} qrupundan olmalıdır.`,
      'counterAccount',
    );
  const account = chart.requirePostable(code, family, 'counterAccount');
  if (account.analytics.includes('partner') && !doc.partnerId)
    throw new DomainError(`${account.code} hesabı üçün kontragent seçin.`, 'partnerId');
  if (account.analytics.includes('expenseItem') && !doc.expenseItemId)
    throw new DomainError(`${account.code} hesabı üçün xərc maddəsi seçin.`, 'expenseItemId');
  return account;
}

export function postPayment(chart: Chart, doc: PaymentDoc): JournalLine[] {
  const family = familyOf(doc.bankAccount, bankFamilies);
  if (!family) throw new DomainError('Bank hesabı 223 və ya 224.04 olmalıdır.', 'bankAccount');
  chart.requirePostable(doc.bankAccount, family, 'bankAccount');
  if (doc.amount <= 0n) throw new DomainError('Məbləğ sıfırdan böyük olmalıdır.', 'amount');
  const kind = doc.kind ?? 'settlement';
  if (paymentKinds[kind]?.partner === 'required' && !doc.partnerId)
    throw new DomainError('Kontragent seçin.', 'partnerId');
  const counter = paymentCounterAccount(chart, doc);
  if (inFamily(counter.code, doc.bankAccount) || inFamily(doc.bankAccount, counter.code))
    throw new DomainError('Pul öz hesabına köçürülə bilməz.', 'counterAccount');
  const label = paymentKinds[kind].label[doc.direction]!;
  const memo = doc.memo || `${label}${doc.partnerName ? ` · ${doc.partnerName}` : ''}`;
  const counterLine: Omit<JournalLine, 'debit' | 'credit'> = {
    account: counter.code,
    ...(counter.analytics.includes('partner') && doc.partnerId ? { partnerId: doc.partnerId } : {}),
    ...(counter.analytics.includes('expenseItem') && doc.expenseItemId
      ? { expenseItemId: doc.expenseItemId }
      : {}),
    memo,
  };
  const lines: JournalLine[] =
    doc.direction === 'in'
      ? [
          { account: doc.bankAccount, debit: doc.amount, credit: 0n, memo },
          { ...counterLine, debit: 0n, credit: doc.amount },
        ]
      : [
          { ...counterLine, debit: doc.amount, credit: 0n },
          { account: doc.bankAccount, debit: 0n, credit: doc.amount, memo },
        ];
  return checkEntry(chart, lines);
}

/** Mirror image of an entry, used for corrections and cancellations. */
export function reverse(lines: readonly JournalLine[]): JournalLine[] {
  return lines.map((l) => ({
    ...l,
    debit: l.credit,
    credit: l.debit,
    ...(l.quantity !== undefined ? { quantity: -l.quantity } : {}),
  }));
}

const analyticField: Record<AnalyticKind, keyof Analytics> = {
  partner: 'partnerId',
  warehouse: 'warehouseId',
  product: 'productId',
  expenseItem: 'expenseItemId',
};

/** Validates balance, sides, accounts and required analytics of a complete entry. */
export function checkEntry(chart: Chart, lines: JournalLine[]): JournalLine[] {
  let debit = 0n;
  let credit = 0n;
  for (const l of lines) {
    if (l.debit < 0n || l.credit < 0n || (l.debit > 0n && l.credit > 0n))
      throw new DomainError('Yazılış sətrində yalnız debet və ya kredit ola bilər.');
    if (l.debit === 0n && l.credit === 0n && l.quantity === undefined)
      throw new DomainError('Boş yazılış sətri yaradıla bilməz.');
    const account = chart.get(l.account);
    if (!account || !chart.postable(l.account))
      throw new DomainError(`${l.account} hesabına yazılış etmək olmaz.`);
    for (const kind of account.analytics)
      if (!l[analyticField[kind]])
        throw new DomainError(`${l.account} hesabı üçün analitika çatışmır.`);
    if (l.quantity !== undefined && !account.quantitative)
      throw new DomainError(`${l.account} hesabında miqdar uçotu aparılmır.`);
    debit += l.debit;
    credit += l.credit;
  }
  if (debit !== credit || debit === 0n) throw new DomainError('Debet və kredit bərabər deyil.');
  return lines;
}
