/**
 * Chart of accounts. Codes follow the Azerbaijani chart used in the product specification; only
 * the accounts the stage-A posting rules need are seeded. Users extend the chart with
 * sub-accounts (e.g. 205.01) that inherit the parent's nature and analytics and roll up into it
 * in reports. Names are working titles and require accountant review before release.
 */
import { DomainError } from './errors.js';

export type AnalyticKind = 'partner' | 'warehouse' | 'product' | 'expenseItem';
export type AccountNature = 'active' | 'passive' | 'active-passive';
export interface Account {
  code: string;
  name: string;
  parentCode: string | null;
  nature: AccountNature;
  /** Analytics every journal line on this account must carry. */
  analytics: AnalyticKind[];
  /** Quantity is tracked in the stock register for lines on this account. */
  quantitative: boolean;
  system: boolean;
  archived: boolean;
}

/** Roles decouple posting rules from concrete codes. */
export const roles = {
  fixedAssets: '111',
  assetCapex: '113',
  materials: '201',
  goods: '205',
  receivables: '211',
  cash: '221',
  transit: '222',
  bank: '223',
  vatDeposit: '224.04',
  vatInput: '241',
  taxPayable: '521',
  social: '522',
  payables: '531',
  payroll: '533',
  capital: '301',
  loans: '511',
  otherIncome: '611',
  otherExpenses: '731',
  vatOutput: '545',
  revenue: '601',
  costOfSales: '701',
  adminExpenses: '721',
} as const;
export type Role = keyof typeof roles;

type Seed = [
  code: string,
  name: string,
  nature: AccountNature,
  analytics: AnalyticKind[],
  qty?: boolean,
];
const seed: Seed[] = [
  ['111', 'Torpaq, tikili və avadanlıqların dəyəri', 'active', []],
  [
    '113',
    'Torpaq, tikili və avadanlıqlarla bağlı məsrəflərin kapitallaşdırılması',
    'active',
    ['warehouse', 'product'],
    true,
  ],
  ['201', 'Material ehtiyatları', 'active', ['warehouse', 'product'], true],
  ['205', 'Mallar', 'active', ['warehouse', 'product'], true],
  ['211', 'Alıcılar və sifarişçilərlə hesablaşmalar', 'active-passive', ['partner']],
  ['221', 'Kassa', 'active', []],
  ['222', 'Yolda olan pul köçürmələri', 'active', []],
  ['223', 'Bank hesabları', 'active', []],
  ['224.04', 'ƏDV depozit hesabı', 'active', []],
  ['241', 'Alış üzrə ƏDV', 'active', []],
  ['301', 'Nominal (nizamnamə) kapital', 'passive', ['partner']],
  ['511', 'Qısamüddətli bank kreditləri', 'passive', ['partner']],
  ['521', 'Vergi öhdəlikləri', 'active-passive', []],
  ['522', 'Sosial sığorta və təminat üzrə öhdəliklər', 'active-passive', []],
  ['531', 'Malsatan və podratçılarla hesablaşmalar', 'active-passive', ['partner']],
  ['533', 'Əməyin ödənişi üzrə işçi heyətinə borclar', 'active-passive', []],
  ['545', 'Satış üzrə ƏDV', 'passive', []],
  ['601', 'Satış gəliri', 'passive', []],
  ['611', 'Sair əməliyyat gəlirləri', 'passive', []],
  ['701', 'Satışın maya dəyəri', 'active', []],
  ['721', 'İnzibati xərclər', 'active', ['expenseItem']],
  ['731', 'Sair əməliyyat xərcləri', 'active', ['expenseItem']],
];
/** Accounts added after the first release; migrations insert them for existing companies. */
export const addedInV2 = ['222', '301', '511', '522', '533', '611', '731'] as const;
export const baseChart: readonly Account[] = seed.map(([code, name, nature, analytics, qty]) => ({
  code,
  name,
  parentCode: null,
  nature,
  analytics,
  quantitative: !!qty,
  system: true,
  archived: false,
}));

const SUB_CODE = /^\d{3}(\.\d{2}){1,3}$/;
/** Validates a new sub-account against its parent; returns the account to store. */
export function newSubAccount(
  parent: Account | undefined,
  code: string,
  name: string,
  existing: ReadonlySet<string>,
): Account {
  if (!parent) throw new DomainError('Əsas hesab tapılmadı.', 'parentCode', 'not-found');
  if (parent.archived)
    throw new DomainError('Arxivləşdirilmiş hesaba subhesab açılmır.', 'parentCode');
  const normalized = code.trim();
  if (
    !SUB_CODE.test(normalized) ||
    !normalized.startsWith(`${parent.code}.`) ||
    normalized.split('.').length !== parent.code.split('.').length + 1
  )
    throw new DomainError(`Subhesab kodu ${parent.code}.01 formatında olmalıdır.`, 'code');
  if (existing.has(normalized))
    throw new DomainError('Bu kodla hesab artıq var.', 'code', 'conflict');
  const title = name.trim();
  if (!title || title.length > 160) throw new DomainError('Hesabın adını yazın.', 'name');
  return {
    code: normalized,
    name: title,
    parentCode: parent.code,
    nature: parent.nature,
    analytics: [...parent.analytics],
    quantitative: parent.quantitative,
    system: false,
    archived: false,
  };
}

/** True when `code` is `base` or one of its sub-accounts. */
export function inFamily(code: string, base: string): boolean {
  return code === base || code.startsWith(`${base}.`);
}

export class Chart {
  private readonly byCode: Map<string, Account>;
  constructor(accounts: Iterable<Account>) {
    this.byCode = new Map([...accounts].map((a) => [a.code, a]));
  }
  get(code: string): Account | undefined {
    return this.byCode.get(code);
  }
  all(): Account[] {
    return [...this.byCode.values()].sort((a, b) =>
      a.code.localeCompare(b.code, 'en', { numeric: true }),
    );
  }
  children(code: string): Account[] {
    return this.all().filter((a) => a.parentCode === code && !a.archived);
  }
  /** Group accounts with active sub-accounts are not posted to directly. */
  postable(code: string): boolean {
    const a = this.byCode.get(code);
    return !!a && !a.archived && this.children(code).length === 0;
  }
  /** The account a role resolves to, refusing roles whose account is a group. */
  role(role: Role): Account {
    const account = this.byCode.get(roles[role]);
    if (!account)
      throw new DomainError(`Hesab planında ${roles[role]} hesabı yoxdur.`, undefined, 'not-found');
    return account;
  }
  /** Validates that a user-chosen line account belongs to the allowed family and is postable. */
  requirePostable(code: string, family: string, field: string): Account {
    const account = this.byCode.get(code);
    if (!account || !inFamily(code, family))
      throw new DomainError(
        `Bu əməliyyat üçün ${family} və ya onun subhesabı seçilməlidir.`,
        field,
      );
    if (account.archived) throw new DomainError(`${code} hesabı arxivdədir.`, field);
    if (!this.postable(code))
      throw new DomainError(`${code} hesabının subhesabları var; subhesab seçin.`, field);
    return account;
  }
}
