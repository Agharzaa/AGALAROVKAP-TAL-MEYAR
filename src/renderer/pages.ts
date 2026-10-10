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
  ReceiptText,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
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
/** A top-bar entry: a module, or a menu of modules (Kitabçalar, Servis). */
export type NavEntry = NavItem | { label: string; icon: LucideIcon; items: NavItem[] };

const page = (p: Page): NavAction => ({ kind: 'view', view: { type: 'page', page: p } });
const soon = (stage: string): NavAction => ({ kind: 'soon', stage });

/** The module bar, left to right (the green Meyar ERP layout: modules across the top). */
export const nav: NavEntry[] = [
  { label: 'Başlanğıc', icon: LayoutDashboard, action: page('home') },
  {
    label: 'Əl ilə əməliyyatlar',
    short: 'Əməliyyatlar',
    icon: ScrollText,
    action: page('operations'),
  },
  { label: 'Satış qaimələri', short: 'Satış', icon: ArrowUpRight, action: page('sales') },
  { label: 'Alış qaimələri', short: 'Alış', icon: ArrowDownLeft, action: page('purchases') },
  { label: 'Bank', icon: Landmark, action: soon('3-cü mərhələ') },
  { label: 'Kontragentlər', icon: Users, action: page('partners') },
  { label: 'Dövriyyə balansı', short: 'DBC', icon: Scale, action: page('trial') },
  { label: 'Hesab kartı', icon: FileSpreadsheet, action: page('card') },
  {
    label: 'Kitabçalar',
    icon: BookOpen,
    items: [
      { label: 'Kontragentlər və müqavilələr', icon: Users, action: page('partners') },
      { label: 'Bank hesabları', icon: Landmark, action: page('bankAccounts') },
      { label: 'Nomenklatura', icon: Package, action: page('products') },
      { label: 'İşçilər', icon: UserRound, action: page('employees') },
      { label: 'Siyahılar', icon: Building2, action: page('lists') },
      { label: 'Hesab planı', icon: ListTree, action: page('accounts') },
    ],
  },
  {
    label: 'Servis',
    icon: Settings,
    items: [
      { label: 'Parametrlər və dövrün bağlanması', icon: Lock, action: page('settings') },
      { label: 'Dəyişiklik tarixçəsi', icon: History, action: page('audit') },
      { label: 'Ehtiyat nüsxə', icon: ShieldCheck, action: { kind: 'backup' } },
      { label: 'DVX-dan e-qaimələr', icon: Upload, action: soon('4-cü mərhələ') },
    ],
  },
];

/** "+ Yeni" menu: the documents a new window can be opened for. */
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

/** Small label above a window's title, telling which part of the program it belongs to. */
export function sectionOf(view: View): string {
  switch (view.type) {
    case 'operation':
    case 'invoice':
      return 'Sənəd';
    case 'accountCard':
      return 'Hesabat';
    case 'page':
      switch (view.page) {
        case 'operations':
        case 'sales':
        case 'purchases':
          return 'Sənədlər';
        case 'trial':
        case 'card':
          return 'Hesabatlar';
        case 'audit':
        case 'settings':
          return 'Servis';
        case 'home':
          return 'İdarəetmə paneli';
        default:
          return 'Kitabçalar';
      }
  }
}

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
