import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Building2,
  FileInput,
  FileSpreadsheet,
  FileOutput,
  History,
  LayoutGrid,
  ListTree,
  Package,
  Scale,
  ScrollText,
  Settings,
  UserRound,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { Page, View } from './workspace';

export const pages: Record<Page, { title: string; hint: string; icon: LucideIcon }> = {
  home: { title: 'İş masası', hint: 'Bu günün xülasəsi', icon: LayoutGrid },
  purchases: {
    title: 'Alış qaimələri',
    hint: 'Gələn qaimələr və kreditor borcları',
    icon: FileInput,
  },
  sales: { title: 'Satış qaimələri', hint: 'Gedən qaimələr və debitor borcları', icon: FileOutput },
  bankStatement: {
    title: 'Bank çıxarışı',
    hint: 'Çıxarışı yüklə — sistem əməliyyatları tanıyıb uçota alır',
    icon: FileSpreadsheet,
  },
  bankIn: {
    title: 'Daxilolmalar',
    hint: 'Hesaba daxil olan bank əməliyyatları',
    icon: ArrowDownLeft,
  },
  bankOut: { title: 'Ödənişlər', hint: 'Hesabdan çıxan bank əməliyyatları', icon: ArrowUpRight },
  trial: { title: 'Dövriyyə balansı', hint: 'Hesablar üzrə qalıq və dövriyyə', icon: Scale },
  journal: { title: 'Jurnal', hint: 'Bütün müxabirləşmələr', icon: ScrollText },
  receivables: { title: 'Debitorlar', hint: '211 üzrə kontragent qalıqları', icon: UserRound },
  payables: { title: 'Kreditorlar', hint: '531 üzrə kontragent qalıqları', icon: Building2 },
  stock: { title: 'Anbar qalığı', hint: 'Məhsul, anbar və hesab üzrə', icon: Boxes },
  products: { title: 'Nomenklatura', hint: 'Məhsul kartları və vahidlər', icon: Package },
  partners: { title: 'Kontragentlər', hint: 'VÖEN üzrə kitabça', icon: Users },
  accounts: { title: 'Hesab planı', hint: 'Hesablar və subhesablar', icon: ListTree },
  warehouses: { title: 'Anbarlar', hint: 'Saxlanma yerləri', icon: Warehouse },
  audit: { title: 'Dəyişiklik tarixçəsi', hint: 'Kim, nə vaxt, nəyi dəyişib', icon: History },
  settings: { title: 'Parametrlər', hint: 'Şirkət, dövr və ehtiyat nüsxə', icon: Settings },
};
export const navigation: { heading?: string; items: Page[] }[] = [
  { items: ['home'] },
  { heading: 'Sənədlər', items: ['purchases', 'sales'] },
  { heading: 'Bank', items: ['bankStatement', 'bankIn', 'bankOut'] },
  { heading: 'Hesabatlar', items: ['trial', 'journal', 'receivables', 'payables'] },
  { heading: 'Anbar', items: ['stock', 'products', 'warehouses'] },
  { heading: 'Kitabçalar', items: ['partners', 'accounts'] },
];
export const footerPages: Page[] = ['audit', 'settings'];

export function viewTitle(view: View, label?: string): string {
  switch (view.type) {
    case 'page':
      return pages[view.page].title;
    case 'invoice':
      return view.id
        ? `${view.direction === 'sale' ? 'Satış' : 'Alış'} qaiməsi${label ? ` ${label}` : ''}`
        : `Yeni ${view.direction === 'sale' ? 'satış' : 'alış'} qaiməsi`;
    case 'payment':
      return view.id
        ? `${view.direction === 'in' ? 'Daxilolma' : 'Ödəniş'}${label ? ` ${label}` : ''}`
        : view.direction === 'in'
          ? 'Yeni daxilolma'
          : 'Yeni ödəniş';
    case 'accountCard':
      return `Hesab kartı ${view.account}`;
  }
}
