import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Calculator,
  CalendarDays,
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
  Truck,
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
  bank: {
    title: 'Bank sənədləri',
    hint: 'Daxilolma və məxaric, qaimələrə bölgü, ƏDV depoziti',
    icon: Landmark,
  },
  cash: {
    title: 'Kassa sənədləri',
    hint: 'Mədaxil və məxaric orderləri (KMO / KXO), qaimələrə bölgü, avans',
    icon: Wallet,
  },
  cashBook: {
    title: 'Kassa kitabı',
    hint: 'Kassa üzrə gün-gün: qalıq, mədaxil, məxaric',
    icon: BookOpen,
  },
  statements: {
    title: 'Bank çıxarışları',
    hint: 'Excel/CSV yükləmə, sətirlərin uçotu, bank ↔ uçot qalığı',
    icon: Upload,
  },
  eqPurchase: {
    title: 'Alınan e-qaimələr (DVX)',
    hint: 'DVX-dən yüklənən gələn e-qaimələr: bir dəfə, statusu ilə',
    icon: Upload,
  },
  eqSale: {
    title: 'Göndərilən e-qaimələr (DVX)',
    hint: 'DVX-dən yüklənən göndərilən e-qaimələr: bir dəfə, statusu ilə',
    icon: Upload,
  },
  eqMaps: {
    title: 'E-qaimə uyğunluqları',
    hint: 'DVX malı → nomenklatura və hesab: təklif və avtomatik',
    icon: ListTree,
  },
  rules: {
    title: 'Bank qaydaları',
    hint: 'Mühasibin qərarlarından öyrənilən uçot qaydaları: təklif və avtomatik',
    icon: ListTree,
  },
  budgetCodes: {
    title: 'Büdcə təsnifat kodları',
    hint: 'Vergi ödənişinin kodu → 521 / 522 subhesabı',
    icon: ListTree,
  },
  trial: { title: 'Dövriyyə balansı', hint: 'Hesablar və subkontolar üzrə', icon: Scale },
  card: { title: 'Hesab kartı', hint: 'Hesab və subkonto üzrə hərəkət', icon: FileSpreadsheet },
  accounts: { title: 'Hesab planı', hint: 'Hesablar, subhesablar və subkontolar', icon: ListTree },
  partners: { title: 'Kontragentlər və müqavilələr', hint: 'VÖEN üzrə kitabça', icon: Users },
  bankAccounts: { title: 'Bank hesabları', hint: 'IBAN, valyuta və hesab', icon: Landmark },
  rates: {
    title: 'Valyuta məzənnələri',
    hint: 'AMB-nin rəsmi məzənnələri tarix üzrə: yükləmə və əl ilə',
    icon: Scale,
  },
  revaluation: {
    title: 'Valyuta yenidən qiymətləndirilməsi',
    hint: 'Ay sonu valyuta qalıqları AMB məzənnəsi ilə: 611 / 731',
    icon: Scale,
  },
  closing: {
    title: 'Ay bağlanışı',
    hint: 'FIFO, yenidən qiymətləndirmə, ƏDV, 6xx / 7xx → 801 → 341 və dövrün bağlanması',
    icon: Lock,
  },
  profitLoss: {
    title: 'Mənfəət və zərər',
    hint: 'Gəlir və xərclər aylar üzrə, ay bağlanışı yazılışları çıxılmaqla',
    icon: Reports,
  },
  cashFlow: {
    title: 'Pul vəsaitlərinin hərəkəti',
    hint: 'Bank və kassa sətirləri maddələr üzrə; qalıq 221 + 223 + 224',
    icon: Wallet,
  },
  vatSummary: {
    title: 'ƏDV icmalı',
    hint: 'Ay üzrə satış və alış ƏDV-si, ödənilməli ƏDV, DVX ilə tutuşdurma',
    icon: ReceiptText,
  },
  vatReturn: {
    title: 'ƏDV bəyannaməsi',
    hint: 'Bəyannamə üçün rəqəmlər: satış dərəcələr üzrə, hesablanmış və əvəzləşdirilən ƏDV, 521.01, əlavələr',
    icon: ReceiptText,
  },
  profitTaxReturn: {
    title: 'Mənfəət vergisi bəyannaməsi',
    hint: 'İl: gəlirlər, gəlirdən çıxılan xərclər, vergi amortizasiyası, keçmiş zərər, vergi, ödənilən',
    icon: Reports,
  },
  payrollReturn: {
    title: 'Muzdlu iş bəyannaməsi',
    hint: 'Rüb, ay-ay: gəlir vergisi, DSMF, işsizlik və tibbi sığorta — baza, haqlar, hesablarla tutuşma, işçilər üzrə',
    icon: Reports,
  },
  dashboard: {
    title: 'İdarə paneli',
    hint: 'Ayın əsas göstəriciləri və 12 ayın dinamikası',
    icon: LayoutDashboard,
  },
  cashboxes: { title: 'Kassalar', hint: 'Kassa, hesab (221) və valyuta', icon: Wallet },
  products: { title: 'Nomenklatura', hint: 'Mallar, materiallar, əsas vəsaitlər', icon: Package },
  employees: { title: 'İşçilər', hint: '244, 533 subkontosu', icon: UserRound },
  fixedAssets: {
    title: 'Əsas vəsaitlər',
    hint: 'İlkin dəyər, amortizasiya, qalıq dəyər, aylıq məbləğ və qalan ay',
    icon: Truck,
  },
  assetCommissions: {
    title: 'İstismara vermə',
    hint: 'Əsas vəsaitin 113-dən 111-ə keçməsi və amortizasiya şərtləri',
    icon: Truck,
  },
  depreciationSchedule: {
    title: 'Amortizasiya cədvəli',
    hint: 'Əsas vəsait və ay üzrə: yazılmış və proqnoz',
    icon: Reports,
  },
  taxDepreciation: {
    title: 'Vergi amortizasiyası',
    hint: 'VM 114: kateqoriyalar üzrə il sonuna qalıq dəyər, norma, amortizasiya; uçotla müqayisə',
    icon: Reports,
  },
  assetDisposals: {
    title: 'Əsas vəsaitlərin silinməsi',
    hint: 'Silinmə: yığılmış amortizasiya 111-dən, qalıq dəyər 731-ə',
    icon: Truck,
  },
  assetOpenings: {
    title: 'Əsas vəsaitlərin başlanğıc qalıqları',
    hint: 'Meyar-dan əvvəl alınmış vəsaitlər: dəyər, yığılmış amortizasiya, qalan ay',
    icon: Truck,
  },
  payrolls: {
    title: 'Əmək haqqının hesablanması',
    hint: 'Ay üzrə: hesablanan, tutulan vergi və fondlar, ödəniləcək, işəgötürənin payı',
    icon: Calculator,
  },
  timesheets: {
    title: 'Tabel',
    hint: 'İş vaxtının uçotu: işçi × gün — saat, ezamiyyət, məzuniyyət, xəstəlik, gəlməmə',
    icon: CalendarDays,
  },
  workCalendar: {
    title: 'İstehsalat təqvimi',
    hint: 'Bayramlar, köçürülmüş istirahət günləri, qısaldılmış günlər; aylıq norma',
    icon: CalendarDays,
  },
  vacationBalances: {
    title: 'Məzuniyyət qalıqları',
    hint: 'İşçi üzrə: iş ili, illik hüquq, qazanılıb, istifadə olunub, qalıq',
    icon: Reports,
  },
  vacations: {
    title: 'Məzuniyyətlər',
    hint: 'Məzuniyyət haqqı: 12 ay / 30,4 × gün; ödənişsiz məzuniyyət',
    icon: CalendarDays,
  },
  sickLeaves: {
    title: 'Xəstəlik vərəqələri',
    hint: 'İlk 14 gün işəgötürən, qalanı DSMF; 4 rübün orta günlük qazancı × staj faizi',
    icon: CalendarDays,
  },
  payslip: {
    title: 'Hesablaşma vərəqəsi',
    hint: 'İşçi və ay: hesablanıb, tutulub, ödənilib, borc',
    icon: Reports,
  },
  payrollSettlements: {
    title: 'İşçilərlə hesablaşmalar',
    hint: '533 işçi üzrə: əvvəl, hesablanıb, tutulub, ödənilib, son',
    icon: Reports,
  },
  payrollTaxes: {
    title: 'Vergi və fondlar',
    hint: 'Əmək haqqından: gəlir vergisi, DSMF, işsizlik və tibbi sığorta — hesablanıb, köçürülüb, borc',
    icon: Reports,
  },
  payrollRates: {
    title: 'Əmək haqqı dərəcələri',
    hint: 'Gəlir vergisi, DSMF, işsizlik və tibbi sığorta — tarixdən qüvvədə',
    icon: Scale,
  },
  lists: {
    title: 'Siyahılar',
    hint: 'Xərc maddələri, gəlir və vergi növləri, fondlar, pul hərəkəti maddələri',
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
          { label: 'Bank sənədləri', icon: Landmark, action: page('bank') },
          { label: 'Bank çıxarışları', icon: Upload, action: page('statements') },
          { label: 'Kassa sənədləri', icon: Wallet, action: page('cash') },
        ],
      },
      {
        title: 'Yarat',
        items: [
          {
            label: 'Bank daxilolması',
            icon: ArrowDownLeft,
            action: { kind: 'view', view: { type: 'bank', direction: 'in' } },
          },
          {
            label: 'Bank məxarici',
            icon: ArrowUpRight,
            action: { kind: 'view', view: { type: 'bank', direction: 'out' } },
          },
          {
            label: 'Kassa mədaxili',
            icon: ArrowDownLeft,
            action: { kind: 'view', view: { type: 'cash', direction: 'in' } },
          },
          {
            label: 'Kassa məxarici',
            icon: ArrowUpRight,
            action: { kind: 'view', view: { type: 'cash', direction: 'out' } },
          },
        ],
      },
      {
        title: 'Hesabatlar',
        items: [
          card('223', 'Hesab kartı 223'),
          card('224', 'ƏDV depoziti (224)'),
          { label: 'Kassa kitabı', icon: BookOpen, action: page('cashBook') },
          card('221', 'Hesab kartı 221'),
          { label: 'Pul vəsaitlərinin hərəkəti', icon: Wallet, action: page('cashFlow') },
        ],
      },
      {
        title: 'Kitabçalar',
        items: [
          { label: 'Bank hesabları', icon: Landmark, action: page('bankAccounts') },
          { label: 'Kassalar', icon: Wallet, action: page('cashboxes') },
          { label: 'Valyuta məzənnələri', icon: Scale, action: page('rates') },
          { label: 'Bank qaydaları', icon: ListTree, action: page('rules') },
          { label: 'Büdcə təsnifat kodları', icon: ListTree, action: page('budgetCodes') },
        ],
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
        items: [
          { label: 'Satış qaimələri', icon: ReceiptText, action: page('sales') },
          { label: 'Göndərilən e-qaimələr (DVX)', icon: Upload, action: page('eqSale') },
        ],
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
          { label: 'E-qaimə uyğunluqları', icon: ListTree, action: page('eqMaps') },
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
        items: [
          { label: 'Alış qaimələri', icon: ReceiptText, action: page('purchases') },
          { label: 'Alınan e-qaimələr (DVX)', icon: Upload, action: page('eqPurchase') },
        ],
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
          { label: 'E-qaimə uyğunluqları', icon: ListTree, action: page('eqMaps') },
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
        items: [
          { label: 'Əl ilə əməliyyatlar', icon: ScrollText, action: page('operations') },
          { label: 'Ay bağlanışları', icon: Lock, action: page('closing') },
        ],
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
        items: [
          { label: 'Ay bağlanışı', icon: Lock, action: page('closing') },
          {
            label: 'Valyuta yenidən qiymətləndirilməsi',
            icon: Scale,
            action: page('revaluation'),
          },
          { label: 'Dövrün bağlanması', icon: Lock, action: page('settings') },
        ],
      },
      {
        title: 'Hesabatlar',
        items: [
          { label: 'Mənfəət və zərər', icon: Reports, action: page('profitLoss') },
          { label: 'ƏDV icmalı', icon: ReceiptText, action: page('vatSummary') },
          { label: 'ƏDV bəyannaməsi', icon: ReceiptText, action: page('vatReturn') },
          { label: 'Mənfəət vergisi bəyannaməsi', icon: Reports, action: page('profitTaxReturn') },
        ],
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
    id: 'assets',
    label: 'Əsas vəsaitlər',
    icon: Truck,
    groups: [
      {
        title: 'Sənədlər',
        items: [
          { label: 'Əsas vəsaitlər', icon: Truck, action: page('fixedAssets') },
          { label: 'İstismara vermə', icon: Truck, action: page('assetCommissions') },
          { label: 'Başlanğıc qalıqlar', icon: ScrollText, action: page('assetOpenings') },
          { label: 'Silinmə', icon: Truck, action: page('assetDisposals') },
        ],
      },
      {
        title: 'Yarat',
        items: [
          {
            label: 'İstismara vermə',
            icon: FilePlus2,
            action: { kind: 'view', view: { type: 'asset', kind: 'commission' } },
          },
          {
            label: 'Başlanğıc qalıq',
            icon: FilePlus2,
            action: { kind: 'view', view: { type: 'asset', kind: 'opening' } },
          },
          {
            label: 'Silinmə',
            icon: FilePlus2,
            action: { kind: 'view', view: { type: 'asset', kind: 'disposal' } },
          },
        ],
      },
      {
        title: 'Hesabatlar',
        items: [
          { label: 'Amortizasiya cədvəli', icon: Reports, action: page('depreciationSchedule') },
          { label: 'Vergi amortizasiyası', icon: Reports, action: page('taxDepreciation') },
          card('111', 'Əsas vəsaitlərin dəyəri (111)'),
          card('112', 'Yığılmış amortizasiya (112)'),
          card('113', 'Kapitallaşdırılan məsrəflər (113)'),
        ],
      },
    ],
  },
  {
    id: 'payroll',
    label: 'Əmək haqqı',
    icon: Calculator,
    groups: [
      {
        title: 'Sənədlər',
        items: [
          { label: 'Əmək haqqının hesablanması', icon: Calculator, action: page('payrolls') },
          { label: 'Tabel', icon: CalendarDays, action: page('timesheets') },
          { label: 'Məzuniyyətlər', icon: CalendarDays, action: page('vacations') },
          { label: 'Xəstəlik vərəqələri', icon: CalendarDays, action: page('sickLeaves') },
        ],
      },
      {
        title: 'Yarat',
        items: [
          {
            label: 'Əmək haqqını hesabla',
            icon: FilePlus2,
            action: { kind: 'view', view: { type: 'payroll' } },
          },
          {
            label: 'Məzuniyyət',
            icon: FilePlus2,
            action: { kind: 'view', view: { type: 'absence', kind: 'vacation' } },
          },
          {
            label: 'Xəstəlik vərəqəsi',
            icon: FilePlus2,
            action: { kind: 'view', view: { type: 'absence', kind: 'sick' } },
          },
          {
            label: 'Tabel (yeni)',
            icon: FilePlus2,
            action: { kind: 'view', view: { type: 'timesheet' } },
          },
        ],
      },
      {
        title: 'Kitabçalar',
        items: [
          { label: 'İşçilər', icon: UserRound, action: page('employees') },
          { label: 'Dərəcələr', icon: Scale, action: page('payrollRates') },
          { label: 'İstehsalat təqvimi', icon: CalendarDays, action: page('workCalendar') },
        ],
      },
      {
        title: 'Hesabatlar',
        items: [
          { label: 'Hesablaşma vərəqəsi', icon: Reports, action: page('payslip') },
          { label: 'Məzuniyyət qalıqları', icon: Reports, action: page('vacationBalances') },
          { label: 'İşçilərlə hesablaşmalar', icon: Reports, action: page('payrollSettlements') },
          { label: 'Vergi və fondlar', icon: Reports, action: page('payrollTaxes') },
          { label: 'Muzdlu iş bəyannaməsi', icon: Reports, action: page('payrollReturn') },
          card('533', 'Hesab kartı 533'),
          card('521.03', 'Gəlir vergisi (521.03)'),
          card('522.01', 'DSMF (522.01)'),
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
          { label: 'İdarə paneli', icon: LayoutDashboard, action: page('dashboard') },
          { label: 'Dövriyyə balansı', icon: Scale, action: page('trial') },
          { label: 'Hesab kartı', icon: FileSpreadsheet, action: page('card') },
          { label: 'Mənfəət və zərər', icon: Reports, action: page('profitLoss') },
          { label: 'Pul vəsaitlərinin hərəkəti', icon: Wallet, action: page('cashFlow') },
          { label: 'ƏDV icmalı', icon: ReceiptText, action: page('vatSummary') },
        ],
      },
      {
        title: 'Vergi bəyannamələri',
        items: [
          { label: 'ƏDV bəyannaməsi', icon: ReceiptText, action: page('vatReturn') },
          { label: 'Muzdlu iş bəyannaməsi', icon: Reports, action: page('payrollReturn') },
          { label: 'Vergi amortizasiyası', icon: Reports, action: page('taxDepreciation') },
          { label: 'Mənfəət vergisi bəyannaməsi', icon: Reports, action: page('profitTaxReturn') },
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
          { label: 'Kassalar', icon: Wallet, action: page('cashboxes') },
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

/** The section a window belongs to. */
export function sectionOfView(view: View): string {
  switch (view.type) {
    case 'invoice':
      return view.direction === 'sale' ? 'sales' : 'purchases';
    case 'operation':
      return 'ledger';
    case 'bank':
    case 'cash':
      return 'bank';
    case 'asset':
      return 'assets';
    case 'payroll':
    case 'absence':
    case 'timesheet':
      return 'payroll';
    case 'accountCard': {
      const a = view.account;
      if (a.startsWith('11')) return 'assets';
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
        case 'eqSale':
          return 'sales';
        case 'purchases':
        case 'eqPurchase':
        case 'eqMaps':
          return 'purchases';
        case 'fixedAssets':
        case 'assetCommissions':
        case 'assetOpenings':
        case 'assetDisposals':
        case 'depreciationSchedule':
        case 'taxDepreciation':
          return 'assets';
        case 'payrolls':
        case 'payrollRates':
        case 'vacations':
        case 'sickLeaves':
        case 'payslip':
        case 'payrollSettlements':
        case 'payrollTaxes':
        case 'timesheets':
        case 'workCalendar':
        case 'vacationBalances':
          return 'payroll';
        case 'operations':
        case 'accounts':
        case 'revaluation':
        case 'closing':
          return 'ledger';
        case 'trial':
        case 'card':
        case 'audit':
        case 'profitLoss':
        case 'vatSummary':
        case 'vatReturn':
        case 'payrollReturn':
        case 'profitTaxReturn':
        case 'dashboard':
          return 'reports';
        case 'cashFlow':
          return 'bank';
        case 'bank':
        case 'statements':
        case 'rules':
        case 'budgetCodes':
        case 'bankAccounts':
        case 'cash':
        case 'cashBook':
        case 'cashboxes':
        case 'rates':
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
  {
    label: 'Bank daxilolması',
    icon: Landmark,
    action: { kind: 'view', view: { type: 'bank', direction: 'in' } },
  },
  {
    label: 'Bank məxarici',
    icon: Landmark,
    action: { kind: 'view', view: { type: 'bank', direction: 'out' } },
  },
  {
    label: 'Kassa mədaxili',
    icon: Wallet,
    action: { kind: 'view', view: { type: 'cash', direction: 'in' } },
  },
  {
    label: 'Kassa məxarici',
    icon: Wallet,
    action: { kind: 'view', view: { type: 'cash', direction: 'out' } },
  },
];

export function viewTitle(view: View, label?: string): string {
  switch (view.type) {
    case 'page':
      return pages[view.page].title;
    case 'operation':
      return view.id ? `Əməliyyat${label ? ` ${label}` : ''}` : 'Yeni əməliyyat';
    case 'invoice': {
      const kind = view.direction === 'sale' ? 'Satış qaiməsi' : 'Alış qaiməsi';
      if (view.id) return `${kind}${label ? ` ${label}` : ''}`;
      return view.eqDocumentId
        ? `Yeni ${kind.toLowerCase()} (DVX e-qaiməsindən)`
        : `Yeni ${kind.toLowerCase()}`;
    }
    case 'bank': {
      const kind = view.direction === 'in' ? 'Bank daxilolması' : 'Bank məxarici';
      return view.id ? `${kind}${label ? ` ${label}` : ''}` : `Yeni ${kind.toLowerCase()}`;
    }
    case 'cash': {
      const kind = view.direction === 'in' ? 'Kassa mədaxil orderi' : 'Kassa məxaric orderi';
      return view.id ? `${kind}${label ? ` ${label}` : ''}` : `Yeni ${kind.toLowerCase()}`;
    }
    case 'asset': {
      const kind = {
        commission: 'İstismara vermə',
        opening: 'Əsas vəsaitin başlanğıc qalığı',
        disposal: 'Əsas vəsaitin silinməsi',
      }[view.kind];
      return view.id ? `${kind}${label ? ` ${label}` : ''}` : `${kind} (yeni)`;
    }
    case 'payroll':
      return view.id
        ? `Əmək haqqının hesablanması${label ? ` ${label}` : ''}`
        : 'Əmək haqqının hesablanması (yeni)';
    case 'absence': {
      const kind = {
        vacation: 'Məzuniyyət',
        unpaid: 'Ödənişsiz məzuniyyət',
        sick: 'Xəstəlik vərəqəsi',
        compensation: 'Məzuniyyət kompensasiyası',
      }[view.kind];
      return view.id ? `${kind}${label ? ` ${label}` : ''}` : `${kind} (yeni)`;
    }
    case 'timesheet':
      return view.id ? `Tabel${label ? ` ${label}` : ''}` : 'Tabel (yeni)';
    case 'accountCard':
      return `Hesab kartı ${view.account}`;
  }
}
