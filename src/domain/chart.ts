/**
 * Chart of accounts with subkonto (analytical dimensions), the way the Azerbaijani chart is
 * kept in 1C. Every account names up to three subkonto kinds in a fixed order; every posting
 * line on the account carries one value per kind, and every report can be opened along them
 * (account → partner → contract → settlement document).
 *
 * The seeded accounts and their subkonto follow docs/QERARLAR.md. Accounts restructured after the
 * comparison with a real 1C AzStandart chart carry 1C's names; the rest are still working titles.
 */
import { DomainError } from './errors.js';

export type SubkontoKind =
  | 'partner'
  | 'contract'
  | 'document'
  | 'bankAccount'
  | 'cashbox'
  | 'product'
  | 'productGroup'
  | 'expenseItem'
  | 'incomeType'
  | 'vatRate'
  | 'taxType'
  | 'paymentKind'
  | 'fund'
  | 'capitalChange'
  | 'employee';

export const subkontoKinds: readonly SubkontoKind[] = [
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
];

export const subkontoLabel: Record<SubkontoKind, string> = {
  partner: 'Kontragent',
  contract: 'Müqavilə',
  document: 'Hesablaşma sənədi',
  bankAccount: 'Bank hesabı',
  cashbox: 'Kassa',
  product: 'Nomenklatura',
  productGroup: 'Nomenklatura qrupu',
  expenseItem: 'Xərc maddəsi',
  incomeType: 'Gəlir növü',
  vatRate: 'ƏDV dərəcəsi',
  taxType: 'Vergi növü',
  paymentKind: 'Ödəniş növü',
  fund: 'Fond',
  capitalChange: 'Kapitalda dəyişiklik növü',
  employee: 'İşçi',
};

/** VAT rates are fixed by law, not a user list: they decide postings and declaration lines. */
export const vatRates = [
  { id: '18', name: '18%' },
  { id: '0', name: '0%' },
  { id: 'exempt', name: 'ƏDV-dən azad' },
  { id: 'nontaxable', name: 'ƏDV-yə cəlb olunmayan' },
] as const;
export type VatRate = (typeof vatRates)[number]['id'];

/** Currencies of 223.02-type accounts. AZN is the ledger currency. */
export const currencies = ['USD', 'EUR', 'GBP', 'RUB', 'TRY', 'CNY', 'CHF', 'AED'] as const;
export type CurrencyCode = 'AZN' | (typeof currencies)[number];

export type AccountNature = 'active' | 'passive' | 'active-passive';
export interface Account {
  code: string;
  name: string;
  parentCode: string | null;
  nature: AccountNature;
  subkonto: SubkontoKind[];
  /** Quantity is tracked on lines of this account (stock, fixed assets). */
  quantitative: boolean;
  /** Lines carry a foreign-currency amount next to the AZN amount. */
  currency: boolean;
  system: boolean;
  archived: boolean;
}

type Seed = [
  code: string,
  name: string,
  nature: AccountNature,
  subkonto: SubkontoKind[],
  flags?: { qty?: boolean; cur?: boolean },
];
const A = 'active' as const;
const P = 'passive' as const;
const AP = 'active-passive' as const;
/** Settlements: partner → contract → settlement document. */
const PCD: SubkontoKind[] = ['partner', 'contract', 'document'];
/** Tax and social liabilities: the sub-account names the tax, the subkonto the kind of payment. */
const PK: SubkontoKind[] = ['paymentKind'];
const seed: Seed[] = [
  ['101', 'Qeyri-maddi aktivlərin dəyəri', A, ['product'], { qty: true }],
  ['111', 'Torpaq, tikili və avadanlıqların dəyəri', A, ['product'], { qty: true }],
  ['112', 'Torpaq, tikili və avadanlıqlar üzrə yığılmış amortizasiya', P, ['product']],
  ['113', 'TTA ilə bağlı məsrəflərin kapitallaşdırılması', A, ['product'], { qty: true }],
  ['201', 'Material ehtiyatları', A, ['product'], { qty: true }],
  ['202', 'İstehsalat (iş və xidmət) məsrəfləri', A, ['expenseItem']],
  ['204', 'Hazır məhsul', A, ['product'], { qty: true }],
  ['205', 'Mallar', A, ['product'], { qty: true }],
  ['211', 'Alıcıların və sifarişçilərin qısamüddətli debitor borcları', AP, PCD],
  ['211.01', 'Alıcılar və sifarişçilərlə hesablaşmalar (manatla)', AP, PCD],
  ['211.02', 'Alıcılar və sifarişçilərlə hesablaşmalar (valyuta ilə)', AP, PCD, { cur: true }],
  ['217', 'Digər qısamüddətli debitor borcları', AP, ['partner', 'contract']],
  ['221', 'Kassa', A, ['cashbox']],
  ['221.01', 'Kassa (manatla)', A, ['cashbox']],
  ['221.02', 'Əməliyyat kassası', A, ['cashbox']],
  ['221.03', 'Pul sənədləri (manatla)', A, []],
  ['221.04', 'Kassa (valyuta ilə)', A, ['cashbox'], { cur: true }],
  ['221.05', 'Pul sənədləri (valyuta ilə)', A, [], { cur: true }],
  ['222', 'Yolda olan pul köçürmələri', A, []],
  ['222.01', 'Yolda olan pul köçürmələri (manatla)', A, []],
  ['222.02', 'Xarici valyutanın alınması', A, PCD],
  ['222.03', 'Yolda olan pul köçürmələri (valyuta ilə)', A, [], { cur: true }],
  ['222.04', 'Xarici valyutanın satılması', A, PCD, { cur: true }],
  ['223', 'Bank hesablaşma hesabları', A, ['bankAccount']],
  ['223.01', 'Bank hesabları (AZN)', A, ['bankAccount']],
  ['223.02', 'Bank hesabları (xarici valyuta)', A, ['bankAccount'], { cur: true }],
  ['224', 'Tələblərə əsasən açılan digər bank hesabları', A, ['bankAccount']],
  ['224.04', 'ƏDV depozit hesabı', A, ['bankAccount']],
  ['241', 'Əvəzləşdirilən ƏDV', A, ['partner', 'document', 'vatRate']],
  ['242', 'Gələcək hesabat dövrlərinin xərcləri', A, ['expenseItem']],
  ['243', 'Verilmiş qısamüddətli avanslar', A, PCD],
  ['243.01', 'Verilmiş avanslar üzrə hesablaşmalar (manatla)', A, PCD],
  ['243.02', 'Verilmiş avanslar üzrə hesablaşmalar (valyuta ilə)', A, PCD, { cur: true }],
  ['244', 'Təhtəlhesab məbləğlər', AP, ['employee']],
  ['244.01', 'Təhtəlhesab məbləğlər (manatla)', AP, ['employee']],
  ['244.02', 'Təhtəlhesab məbləğlər (valyuta ilə)', AP, ['employee'], { cur: true }],
  ['301', 'Nizamnamə (nominal) kapitalı', P, ['partner', 'capitalChange']],
  ['341', 'Hesabat dövründə xalis mənfəət (zərər)', AP, []],
  ['343', 'Keçmiş illər üzrə bölüşdürülməmiş mənfəət (ödənilməmiş zərər)', AP, []],
  ['344', 'Elan edilmiş dividendlər', AP, []],
  ['401', 'Uzunmüddətli bank kreditləri', P, ['partner', 'contract']],
  ['422', 'Digər təxirə salınmış vergi öhdəlikləri', AP, ['partner', 'contract']],
  ['501', 'Qısamüddətli bank kreditləri', P, ['partner', 'contract']],
  ['521', 'Vergi öhdəlikləri', AP, PK],
  ['521.01', 'Əlavə dəyər vergisi', AP, PK],
  ['521.02', 'Əmlak vergisi', AP, PK],
  ['521.03', 'Gəlir vergisi', AP, PK],
  ['521.04', 'Mənfəət vergisi', AP, PK],
  ['521.05', 'Torpaq vergisi', AP, PK],
  ['521.06', 'Sanksiyalar', AP, PK],
  ['521.07', 'Ödəmə mənbəyindən vergi', AP, [...PK, 'partner']],
  ['521.08', 'Sadələşdirilmiş vergi', AP, PK],
  ['521.09', 'Sair vergi və rüsumlar', AP, PK],
  ['521.10', 'Yol vergisi', AP, PK],
  ['521.11', 'Aksizlər', AP, PK],
  ['521.12', 'Mədən vergisi', AP, PK],
  ['521.13', 'ƏDV vergi agenti', AP, PCD],
  ['522', 'Sosial sığorta və təminat üzrə öhdəliklər', AP, PK],
  ['522.01', 'Sosial sığorta və təminat üzrə öhdəliklər — əmək sazişi', AP, PK],
  ['522.02', 'Sosial sığorta və təminat üzrə öhdəliklər — xidmət müqaviləsi', AP, PK],
  ['522.03', 'İşsizlikdən sığorta haqları', AP, PK],
  ['522.03.1', 'İşsizlikdən sığorta haqları — işçi', AP, PK],
  ['522.03.2', 'İşsizlikdən sığorta haqları — işəgötürən', AP, PK],
  ['522.04', 'İcbari tibbi sığorta haqları', AP, PK],
  ['522.04.1', 'İcbari tibbi sığorta haqları — işçi', AP, PK],
  ['522.04.2', 'İcbari tibbi sığorta haqları — işəgötürən', AP, PK],
  ['531', 'Malsatan və podratçılara qısamüddətli kreditor borcları', AP, PCD],
  ['531.01', 'Malsatan və podratçılara qısamüddətli kreditor borcları (manatla)', AP, PCD],
  [
    '531.02',
    'Malsatan və podratçılara qısamüddətli kreditor borcları (valyuta ilə)',
    AP,
    PCD,
    { cur: true },
  ],
  ['533', 'Əməyin ödənişi üzrə işçi heyətinə borclar', AP, ['employee']],
  ['534', 'Dividendlərin ödənilməsi üzrə təsisçilərə kreditor borcları', AP, []],
  ['534.01', 'Dividendlərin ödənilməsi üzrə təsisçilərə kreditor borcları', AP, []],
  ['538', 'Digər qısamüddətli kreditor borcları', AP, ['partner', 'contract']],
  ['543', 'Alınmış qısamüddətli avanslar', P, PCD],
  ['543.01', 'Alınmış avanslar üzrə hesablaşmalar (manatla)', P, PCD],
  ['543.02', 'Alınmış avanslar üzrə hesablaşmalar (valyuta ilə)', P, PCD, { cur: true }],
  ['601', 'Satış', P, ['incomeType', 'vatRate']],
  ['602', 'Satılmış malların qaytarılması və ucuzlaşdırılması', A, ['incomeType', 'vatRate']],
  ['603', 'Verilmiş güzəştlər', A, ['incomeType', 'vatRate']],
  ['604', 'Satış üzrə ƏDV', A, ['vatRate']],
  ['604.1', 'Satışın ƏDV-si', A, ['vatRate']],
  ['611', 'Sair əməliyyat gəlirləri', P, ['incomeType']],
  ['631', 'Maliyyə gəlirləri', P, ['partner', 'contract']],
  ['701', 'Satışın maya dəyəri', A, ['productGroup', 'expenseItem']],
  ['711', 'Kommersiya xərcləri', A, ['expenseItem']],
  ['721', 'İnzibati xərclər', A, ['expenseItem']],
  ['731', 'Sair əməliyyat xərcləri', A, ['expenseItem']],
  ['751', 'Maliyyə xərcləri', A, ['partner', 'contract']],
  ['801', 'Ümumi mənfəət (zərər)', AP, []],
  ['901', 'Cari mənfəət vergisi', A, []],
];

const parentOf = (code: string) =>
  code.includes('.') ? code.slice(0, code.lastIndexOf('.')) : null;

export const baseChart: readonly Account[] = seed.map(([code, name, nature, subkonto, f]) => ({
  code,
  name,
  parentCode: parentOf(code),
  nature,
  subkonto: [...subkonto],
  quantitative: !!f?.qty,
  currency: !!f?.cur,
  system: true,
  archived: false,
}));

const CODE = /^\d{3}(\.\d{1,2}){0,3}$/;

export function checkSubkonto(list: readonly SubkontoKind[], field = 'subkonto'): SubkontoKind[] {
  if (list.length > 3) throw new DomainError('Hesabda ən çox 3 subkonto ola bilər.', field);
  if (new Set(list).size !== list.length)
    throw new DomainError('Eyni subkonto iki dəfə seçilib.', field);
  for (const k of list)
    if (!subkontoKinds.includes(k)) throw new DomainError('Subkonto növü tanınmadı.', field);
  const c = list.indexOf('contract');
  if (c >= 0 && list.indexOf('partner') !== c - 1)
    throw new DomainError('Müqavilə subkontosu kontragentdən dərhal sonra gəlməlidir.', field);
  return [...list];
}

export interface NewAccount {
  code: string;
  name: string;
  nature?: AccountNature;
  subkonto?: SubkontoKind[];
  quantitative?: boolean;
  currency?: boolean;
}

/**
 * Validates a new account. A sub-account (223.03) inherits nature, subkonto, quantity and
 * currency from its parent unless given; a new top-level account must state them.
 */
export function newAccount(chart: Chart, input: NewAccount): Account {
  const code = input.code.trim();
  if (!CODE.test(code))
    throw new DomainError('Hesab kodu 3 rəqəmlə başlamalıdır (məsələn 721 və ya 721.01).', 'code');
  if (chart.get(code)) throw new DomainError('Bu kodla hesab artıq var.', 'code', 'conflict');
  const parentCode = parentOf(code);
  const parent = parentCode ? chart.get(parentCode) : undefined;
  if (parentCode && !parent)
    throw new DomainError(`Əvvəlcə ${parentCode} hesabı olmalıdır.`, 'code', 'not-found');
  if (parent?.archived) throw new DomainError('Arxivdəki hesaba subhesab açılmır.', 'code');
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 200) throw new DomainError('Hesabın adını yazın.', 'name');
  const nature = input.nature ?? parent?.nature;
  if (!nature)
    throw new DomainError('Hesabın növünü seçin (aktiv, passiv, aktiv-passiv).', 'nature');
  return {
    code,
    name,
    parentCode,
    nature,
    subkonto: checkSubkonto(input.subkonto ?? parent?.subkonto ?? []),
    quantitative: input.quantitative ?? parent?.quantitative ?? false,
    currency: input.currency ?? parent?.currency ?? false,
    system: false,
    archived: false,
  };
}

export const compareCodes = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
};

/** True when `code` is `base` or one of its sub-accounts. */
export const inFamily = (code: string, base: string) =>
  code === base || code.startsWith(`${base}.`);

export class Chart {
  private readonly byCode: Map<string, Account>;
  private readonly kids = new Map<string, Account[]>();
  constructor(accounts: Iterable<Account>) {
    this.byCode = new Map([...accounts].map((a) => [a.code, a]));
    for (const a of this.byCode.values())
      if (a.parentCode) {
        const list = this.kids.get(a.parentCode) ?? [];
        list.push(a);
        this.kids.set(a.parentCode, list);
      }
  }
  get(code: string): Account | undefined {
    return this.byCode.get(code);
  }
  all(): Account[] {
    return [...this.byCode.values()].sort((a, b) => compareCodes(a.code, b.code));
  }
  children(code: string, includeArchived = false): Account[] {
    return (this.kids.get(code) ?? [])
      .filter((a) => includeArchived || !a.archived)
      .sort((a, b) => compareCodes(a.code, b.code));
  }
  /** Group accounts (with sub-accounts) take no postings; their children do. */
  postable(code: string): boolean {
    const a = this.byCode.get(code);
    return !!a && !a.archived && this.children(code).length === 0;
  }
  /** Account must exist, be active and take postings. */
  require(code: string, field: string): Account {
    const a = this.byCode.get(code);
    if (!a)
      throw new DomainError(`${code || '—'} hesabı hesab planında yoxdur.`, field, 'not-found');
    if (a.archived) throw new DomainError(`${code} hesabı arxivdədir.`, field);
    if (!this.postable(code))
      throw new DomainError(`${code} hesabının subhesabları var; subhesab seçin.`, field);
    return a;
  }
}
