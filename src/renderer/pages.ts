import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  LayoutDashboard,
  Building2,
  FilePlus2,
  FileSpreadsheet,
  History,
  Landmark,
  ListTree,
  Lock,
  Package,
  Reports,
  ReceiptText,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from './icons';
import type { Page, View } from './workspace';

export const pages: Record<Page, { title: string; hint: string; icon: LucideIcon }> = {
  home: { title: 'Başlanğıc', hint: 'Gözləyən işlər, qalıqlar və nəzarət', icon: BookOpen },
  operations: {
    title: 'Əl ilə əməliyyatlar',
    hint: 'Dt/Kt yazılışları və başlanğıc qalıqlar',
    icon: ScrollText,
  },
  sales: {
    title: 'Satış qaimələri',
    hint: 'Satış, ƏDV, maya dəyəri (FIFO), avansların əvəzləşdirilməsi',
    icon: ReceiptText,
  },
  purchases: {
    title: 'Alış qaimələri',
    hint: 'Mal, material, xidmət və əsas vəsait alışı, ƏDV',
    icon: ReceiptText,
  },
  trial: { title: 'Dövriyyə balansı', hint: 'Hesablar və subkontolar üzrə', icon: Scale },
  card: { title: 'Hesab kartı', hint: 'Hesab və subkonto üzrə hərəkət', icon: FileSpreadsheet },
  accounts: { title: 'Hesab planı', hint: 'Hesablar, subhesablar və subkontolar', icon: ListTree },
  partners: { title: 'Kontragentlər və müqavilələr', hint: 'VÖEN üzrə kitabça', icon: Users },
  bankAccounts: { title: 'Bank hesabları', hint: 'IBAN, valyuta və hesab', icon: Landmark },
  products: { title: 'Nomenklatura', hint: 'Mallar, materiallar, əsas vəsaitlər', icon: Package },
  employees: { title: 'İşçilər', hint: '244, 533 subkontosu', icon: UserRound },
  lists: {
    title: 'Siyahılar',
    hint: 'Xərc maddələri, gəlir və vergi növləri, fondlar, kassalar',
    icon: Building2,
  },
  audit: { title: 'Dəyişiklik tarixçəsi', hint: 'Kim, nə vaxt, nəyi dəyişib', icon: History },
  settings: {
    title: 'Parametrlər',
    hint: 'Şirkət, dövrün bağlanması, ehtiyat nüsxə',
    icon: Settings,
  },
};

export type NavAction =
  { kind: 'view'; view: View } | { kind: 'backup' } | { kind: 'soon'; stage: string };
/** One entry of the top module bar or of one of its menus. */
export interface NavItem {
  /** Full name: the tooltip and what screen readers announce. */
  label: string;
  /** Shorter text shown in the bar, when the full name is too long for it. */
  short?: string;
  icon: LucideIcon;
  action: NavAction;
}
const page = (p: Page): NavAction => ({ kind: 'view', view: { type: 'page', page: p } });
const soon = (stage: string): NavAction => ({ kind: 'soon', stage });

/**
 * Sections of the program (1C's main menu, as a rail on the left). Opening a section shows its
 * documents, what can be created there, its reports and the lists it uses.
 */
export interface Section {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Empty for Başlanğıc, which simply shows the work area. */
  groups: { title: string; items: NavItem[] }[];
}
const card = (account: string, label: string): NavItem => ({
  label,
  icon: FileSpreadsheet,
  action: { kind: 'view', view: { type: 'accountCard', account } },
});
export const sections: Section[] = [
  { id: 'home', label: 'Başlanğıc', icon: LayoutDashboard, groups: [] },
  {
    id: 'bank',
    label: 'Bank və kassa',
    icon: Landmark,
    groups: [
      {
        title: 'Sənədlər',
        items: [
          { label: 'Bank sənədləri', icon: Landmark, action: soon('3-cü mərhələ') },
          { label: 'Bank çıxarışının yüklənməsi', icon: Upload, action: soon('3-cü mərhələ') },
          { label: 'Kassa sənədləri', icon: Wallet, action: soon('5-ci mərhələ') },
        ],
      },
      {
        title: 'Hesabatlar',
        items: [card('223', 'Hesab kartı 223'), card('221', 'Hesab kartı 221')],
      },
      {
        title: 'Kitabçalar',
        items: [{ label: 'Bank hesabları', icon: Landmark, action: page('bankAccounts') }],
      },
    ],
  },
  {
    id: 'sales',
    label: 'Satış',
    icon: ArrowUpRight,
    groups: [
      {
        title: 'Sənədlər',
        items: [{ label: 'Satış qaimələri', icon: ReceiptText, action: page('sales') }],
      },
      {
        title: 'Yarat',
        items: [
          {
            label: 'Satış qaiməsi',
            icon: FilePlus2,
            action: { kind: 'view', view: { type: 'invoice', direction: 'sale' } },
          },
        ],
      },
      {
        title: 'Hesabatlar',
        items: [card('211', 'Alıcılarla hesablaşma (211)'), card('543', 'Alınmış avanslar (543)')],
      },
      {
        title: 'Kitabçalar',
        items: [
          { label: 'Kontragentlər və müqavilələr', icon: Users, action: page('partners') },
          { label: 'Nomenklatura', icon: Package, action: page('products') },
        ],
      },
    ],
  },
  {
    id: 'purchases',
    label: 'Alış',
    icon: ArrowDownLeft,
    groups: [
      {
        title: 'Sənədlər',
        items: [{ label: 'Alış qaimələri', icon: ReceiptText, action: page('purchases') }],
      },
      {
        title: 'Yarat',
        items: [
          {
            label: 'Alış qaiməsi',
            icon: FilePlus2,
            action: { kind: 'view', view: { type: 'invoice', direction: 'purchase' } },
          },
        ],
      },
      {
        title: 'Hesabatlar',
        items: [
          card('531', 'Malsatanlarla hesablaşma (531)'),
          card('243', 'Verilmiş avanslar (243)'),
        ],
      },
      {
        title: 'Kitabçalar',
        items: [
          { label: 'Kontragentlər və müqavilələr', icon: Users, action: page('partners') },
          { label: 'Nomenklatura', icon: Package, action: page('products') },
        ],
      },
    ],
  },
  {
    id: 'stock',
    label: 'Anbar',
    icon: Package,
    groups: [
      {
        title: 'Sənədlər',
        items: [{ label: 'Anbar hərəkəti', icon: Package, action: soon('5-ci mərhələ') }],
      },
      {
        title: 'Hesabatlar',
        items: [card('205', 'Mallar (205)'), card('201', 'Materiallar (201)')],
      },
      {
        title: 'Kitabçalar',
        items: [{ label: 'Nomenklatura', icon: Package, action: page('products') }],
      },
    ],
  },
  {
    id: 'ledger',
    label: 'Mühasibat',
    icon: ScrollText,
    groups: [
      {
        title: 'Sənədlər',
        items: [{ label: 'Əl ilə əməliyyatlar', icon: ScrollText, action: page('operations') }],
      },
      {
        title: 'Yarat',
        items: [
          {
            label: 'Əl ilə əməliyyat',
            icon: FilePlus2,
            action: { kind: 'view', view: { type: 'operation' } },
          },
        ],
      },
      {
        title: 'Dövr',
        items: [{ label: 'Dövrün bağlanması', icon: Lock, action: page('settings') }],
      },
      {
        title: 'Kitabçalar',
        items: [
          { label: 'Hesab planı', icon: ListTree, action: page('accounts') },
          { label: 'İşçilər', icon: UserRound, action: page('employees') },
          { label: 'Siyahılar', icon: Building2, action: page('lists') },
        ],
      },
    ],
  },
  {
    id: 'reports',
    label: 'Hesabatlar',
    icon: Reports,
    groups: [
      {
        title: 'Standart hesabatlar',
        items: [
          { label: 'Dövriyyə balansı', icon: Scale, action: page('trial') },
          { label: 'Hesab kartı', icon: FileSpreadsheet, action: page('card') },
        ],
      },
      {
        title: 'Nəzarət',
        items: [{ label: 'Dəyişiklik tarixçəsi', icon: History, action: page('audit') }],
      },
    ],
  },
  {
    id: 'lists',
    label: 'Kitabçalar',
    icon: BookOpen,
    groups: [
      {
        title: 'Hesablaşma',
        items: [
          { label: 'Kontragentlər və müqavilələr', icon: Users, action: page('partners') },
          { label: 'Bank hesabları', icon: Landmark, action: page('bankAccounts') },
        ],
      },
      {
        title: 'Uçot obyektləri',
        items: [
          { label: 'Nomenklatura', icon: Package, action: page('products') },
          { label: 'İşçilər', icon: UserRound, action: page('employees') },
          { label: 'Siyahılar', icon: Building2, action: page('lists') },
          { label: 'Hesab planı', icon: ListTree, action: page('accounts') },
        ],
      },
    ],
  },
  {
    id: 'company',
    label: 'Müəssisə',
    icon: Settings,
    groups: [
      {
        title: 'Parametrlər',
        items: [
          { label: 'Şirkət və dövrün bağlanması', icon: Settings, action: page('settings') },
          { label: 'Dəyişiklik tarixçəsi', icon: History, action: page('audit') },
        ],
      },
      {
        title: 'Baza',
        items: [
          { label: 'Ehtiyat nüsxə', icon: ShieldCheck, action: { kind: 'backup' } },
          { label: 'DVX-dan e-qaimələr', icon: Upload, action: soon('4-cü mərhələ') },
        ],
      },
    ],
  },
];

/** The section a window belongs to, so the rail shows where the user is. */
export function sectionOfView(view: View): string {
  switch (view.type) {
    case 'invoice':
      return view.direction === 'sale' ? 'sales' : 'purchases';
    case 'operation':
      return 'ledger';
    case 'accountCard': {
      const a = view.account;
      if (a.startsWith('211') || a.startsWith('543')) return 'sales';
      if (a.startsWith('531') || a.startsWith('243')) return 'purchases';
      if (a.startsWith('22')) return 'bank';
      if (a.startsWith('20')) return 'stock';
      return 'reports';
    }
    case 'page':
      switch (view.page) {
        case 'home':
          return 'home';
        case 'sales':
          return 'sales';
        case 'purchases':
          return 'purchases';
        case 'operations':
        case 'accounts':
          return 'ledger';
        case 'trial':
        case 'card':
        case 'audit':
          return 'reports';
        case 'bankAccounts':
          return 'bank';
        case 'settings':
          return 'company';
        default:
          return 'lists';
      }
  }
}

/** "Yarat" menu: the documents a new window can be opened for. */
export const createItems: NavItem[] = [
  {
    label: 'Əl ilə əməliyyat',
    icon: FilePlus2,
    action: { kind: 'view', view: { type: 'operation' } },
  },
  {
    label: 'Satış qaiməsi',
    icon: ArrowUpRight,
    action: { kind: 'view', view: { type: 'invoice', direction: 'sale' } },
  },
  {
    label: 'Alış qaiməsi',
    icon: ArrowDownLeft,
    action: { kind: 'view', view: { type: 'invoice', direction: 'purchase' } },
  },
  { label: 'Bank sənədi', icon: Landmark, action: soon('3-cü mərhələ') },
];

export function viewTitle(view: View, label?: string): string {
  switch (view.type) {
    case 'page':
      return pages[view.page].title;
    case 'operation':
      return view.id ? `Əməliyyat${label ? ` ${label}` : ''}` : 'Yeni əməliyyat';
    case 'invoice': {
      const kind = view.direction === 'sale' ? 'Satış qaiməsi' : 'Alış qaiməsi';
      return view.id ? `${kind}${label ? ` ${label}` : ''}` : `Yeni ${kind.toLowerCase()}`;
    }
    case 'accountCard':
      return `Hesab kartı ${view.account}`;
  }
}
