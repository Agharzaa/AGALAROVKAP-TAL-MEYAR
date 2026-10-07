import {
  BookOpen,
  Building2,
  FileCog,
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

export type RibbonAction =
  { kind: 'view'; view: View } | { kind: 'backup' } | { kind: 'soon'; stage: string };
export interface RibbonButton {
  label: string;
  icon: LucideIcon;
  size: 'large' | 'small';
  action: RibbonAction;
}
export interface RibbonGroup {
  name: string;
  buttons: RibbonButton[];
}
const page = (p: Page): RibbonAction => ({ kind: 'view', view: { type: 'page', page: p } });
const soon = (stage: string): RibbonAction => ({ kind: 'soon', stage });

export const ribbon: { tab: string; groups: RibbonGroup[] }[] = [
  {
    tab: 'Əsas',
    groups: [
      {
        name: 'Yeni sənəd',
        buttons: [
          {
            label: 'Əl ilə əməliyyat',
            icon: FilePlus2,
            size: 'large',
            action: { kind: 'view', view: { type: 'operation' } },
          },
          {
            label: 'Satış qaiməsi',
            icon: ReceiptText,
            size: 'small',
            action: soon('2-ci mərhələ'),
          },
          { label: 'Alış qaiməsi', icon: ReceiptText, size: 'small', action: soon('2-ci mərhələ') },
          { label: 'Bank sənədi', icon: Landmark, size: 'small', action: soon('3-cü mərhələ') },
        ],
      },
      {
        name: 'Hesabatlar',
        buttons: [
          { label: 'Dövriyyə balansı', icon: Scale, size: 'large', action: page('trial') },
          { label: 'Hesab kartı', icon: FileSpreadsheet, size: 'small', action: page('card') },
          { label: 'Əməliyyatlar', icon: ScrollText, size: 'small', action: page('operations') },
        ],
      },
      {
        name: 'Kitabçalar',
        buttons: [
          { label: 'Kontragentlər', icon: Users, size: 'large', action: page('partners') },
          { label: 'Bank hesabları', icon: Landmark, size: 'small', action: page('bankAccounts') },
          { label: 'Hesab planı', icon: ListTree, size: 'small', action: page('accounts') },
        ],
      },
      {
        name: 'Dövr',
        buttons: [
          { label: 'Dövrün bağlanması', icon: Lock, size: 'large', action: page('settings') },
        ],
      },
    ],
  },
  {
    tab: 'Sənədlər',
    groups: [
      {
        name: 'Uçot',
        buttons: [
          {
            label: 'Əl ilə əməliyyatlar',
            icon: ScrollText,
            size: 'large',
            action: page('operations'),
          },
          {
            label: 'Yeni əməliyyat',
            icon: FilePlus2,
            size: 'small',
            action: { kind: 'view', view: { type: 'operation' } },
          },
        ],
      },
      {
        name: 'Qaimələr',
        buttons: [
          {
            label: 'Satış qaimələri',
            icon: ReceiptText,
            size: 'small',
            action: soon('2-ci mərhələ'),
          },
          {
            label: 'Alış qaimələri',
            icon: ReceiptText,
            size: 'small',
            action: soon('2-ci mərhələ'),
          },
        ],
      },
      {
        name: 'Bank',
        buttons: [
          { label: 'Bank sənədləri', icon: Landmark, size: 'small', action: soon('3-cü mərhələ') },
          { label: 'Bank çıxarışı', icon: Upload, size: 'small', action: soon('3-cü mərhələ') },
        ],
      },
      {
        name: 'Yüklə',
        buttons: [
          {
            label: 'DVX-dan e-qaimələr',
            icon: Upload,
            size: 'small',
            action: soon('4-cü mərhələ'),
          },
        ],
      },
    ],
  },
  {
    tab: 'Hesabatlar',
    groups: [
      {
        name: 'Uçot',
        buttons: [
          { label: 'Dövriyyə balansı', icon: Scale, size: 'large', action: page('trial') },
          { label: 'Hesab kartı', icon: FileSpreadsheet, size: 'large', action: page('card') },
        ],
      },
      {
        name: 'Nəzarət',
        buttons: [
          { label: 'Dəyişiklik tarixçəsi', icon: History, size: 'small', action: page('audit') },
          { label: 'Bütövlük yoxlaması', icon: ShieldCheck, size: 'small', action: page('home') },
        ],
      },
    ],
  },
  {
    tab: 'Kitabçalar',
    groups: [
      {
        name: 'Hesablaşma',
        buttons: [
          {
            label: 'Kontragentlər və müqavilələr',
            icon: Users,
            size: 'large',
            action: page('partners'),
          },
          { label: 'Bank hesabları', icon: Landmark, size: 'large', action: page('bankAccounts') },
        ],
      },
      {
        name: 'Uçot obyektləri',
        buttons: [
          { label: 'Nomenklatura', icon: Package, size: 'small', action: page('products') },
          { label: 'İşçilər', icon: UserRound, size: 'small', action: page('employees') },
          { label: 'Siyahılar', icon: Building2, size: 'small', action: page('lists') },
        ],
      },
      {
        name: 'Hesablar',
        buttons: [
          { label: 'Hesab planı', icon: ListTree, size: 'large', action: page('accounts') },
        ],
      },
    ],
  },
  {
    tab: 'Servis',
    groups: [
      {
        name: 'Şirkət',
        buttons: [{ label: 'Parametrlər', icon: FileCog, size: 'large', action: page('settings') }],
      },
      {
        name: 'Baza',
        buttons: [
          { label: 'Ehtiyat nüsxə', icon: ShieldCheck, size: 'large', action: { kind: 'backup' } },
          { label: 'Dəyişiklik tarixçəsi', icon: History, size: 'small', action: page('audit') },
        ],
      },
    ],
  },
];

export function viewTitle(view: View, label?: string): string {
  switch (view.type) {
    case 'page':
      return pages[view.page].title;
    case 'operation':
      return view.id ? `Əməliyyat${label ? ` ${label}` : ''}` : 'Yeni əməliyyat';
    case 'accountCard':
      return `Hesab kartı ${view.account}`;
  }
}
