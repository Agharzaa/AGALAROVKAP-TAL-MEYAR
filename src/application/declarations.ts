/**
 * Stage 9 — the figures of the tax returns (docs/MERHELE-9-VERGI-BEYANNAMELERI.md §5, QERARLAR
 * 2026-10-28 mərhələ 9): ƏDV of a month, muzdlu iş of a quarter, vergi amortizasiyası and mənfəət
 * vergisi of a year. Nothing here is stored or posted: every figure is read from the books each
 * time, with its source, so a closed period always shows the same return. The accountant copies
 * the figures into the e-taxes form; the checks say what to look at first, they never block.
 */
import { vatRates } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney, type Minor } from '../domain/money.js';
import { monthEnd } from '../domain/rates.js';
import type {
  DeclarationKind,
  DeclarationRow,
  DeclarationSection,
  DeclarationTable,
  DeclarationView,
} from '../contracts/queries.js';
import type { Db } from '../infrastructure/sqlite/db.js';
import { vatOf, vatSummary } from './analytics.js';
import { plannedVatOffset, plannedVatPostings } from './closing.js';
import { ratesAt } from './payroll.js';
import { checkMonth } from './revaluation.js';
import { profitTaxReturn } from './profit-tax.js';
import { balanceSheet, cashFlowStatement, equityStatement, incomeStatement } from './financial.js';
import { taxDepreciationReturn } from './tax.js';

const money = (m: Minor) => formatMinor(m);
const dmy = (iso: string) => iso.split('-').reverse().join('.');

export function row(
  key: string,
  label: string,
  values: (Minor | string)[],
  source = '',
  extra: Partial<DeclarationRow> = {},
): DeclarationRow {
  return {
    key,
    label,
    values: values.map((v) => (typeof v === 'bigint' ? money(v) : v)),
    source,
    total: false,
    level: 0,
    account: '',
    ...extra,
  };
}

/** Credit − debit of an account over the months (a liability's increase). */
function turnover(db: Db, companyId: string, account: string, from: string, to: string) {
  const r = db.get(
    `SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM registers
     WHERE company_id=? AND account=? AND month BETWEEN ? AND ?`,
    companyId,
    account,
    from,
    to,
  )!;
  return { debit: r.d as bigint, credit: r.c as bigint };
}

/** Credit balance (owed) of an account at the end of a month. */
function owedAt(db: Db, companyId: string, account: string, month: string): bigint {
  return db.get(
    `SELECT COALESCE(SUM(credit-debit),0) AS b FROM registers WHERE company_id=? AND account=? AND month<=?`,
    companyId,
    account,
    month,
  )!.b as bigint;
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export const monthClosed = (db: Db, companyId: string, month: string) =>
  !!db.get(
    "SELECT 1 FROM month_closings WHERE company_id=? AND month=? AND status='posted'",
    companyId,
    month,
  );

// ---------------------------------------------------------------------------------------------
// ƏDV (§5.1)

interface SaleLine {
  vatRate: string;
  netAzn: string;
  vatAzn: string;
}

/**
 * The incoming e-qaimələr behind "Əvəzləşdirilən ƏDV": what the month offset invoice by invoice
 * (the closing's entries, or its plan in an open month), and the VAT still waiting on 241 at the
 * month's end with the reason — not confirmed in DVX, or its VAT not paid through the deposit.
 */
function offsetLists(
  db: Db,
  companyId: string,
  month: string,
  closed: boolean,
): DeclarationTable[] {
  const offset = new Map<string, bigint>();
  const add = (document: string, amount: bigint) =>
    offset.set(document, (offset.get(document) ?? 0n) + amount);
  if (closed)
    for (const r of db.all(
      `SELECT p.kt_s2 AS d, SUM(p.amount) AS a FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE p.company_id=? AND e.source_type='closing' AND p.dt_account='521.01' AND p.kt_account='241'
         AND p.date BETWEEN ? AND ? GROUP BY p.kt_s2`,
      companyId,
      `${month}-01`,
      monthEnd(month),
    ))
      add(String(r.d), r.a as bigint);
  else
    for (const p of plannedVatPostings(db, companyId, month) ?? []) add(p.kt.sk[1] ?? '', p.amount);
  // On 241 at the month's end (an open month: less what its closing would offset).
  const open = new Map<string, bigint>();
  for (const r of db.all(
    `SELECT s2, SUM(debit-credit) AS b FROM registers
     WHERE company_id=? AND account='241' AND month<=? AND s2 LIKE 'invoice:%' GROUP BY s2`,
    companyId,
    month,
  )) {
    const left = (r.b as bigint) - (closed ? 0n : (offset.get(String(r.s2)) ?? 0n));
    if (left > 0n) open.set(String(r.s2), left);
  }
  const invoice = (document: string) =>
    db.get(
      `SELECT i.id, i.number, i.date, i.vat, i.eq_series, i.eq_number, p.name, p.tax_id,
         (SELECT COUNT(*) FROM eq_documents q WHERE q.company_id=i.company_id AND q.invoice_id=i.id
            AND q.direction='purchase' AND q.status='accepted') AS confirmed
       FROM invoices i JOIN partners p ON p.company_id=i.company_id AND p.id=i.partner_id
       WHERE i.company_id=? AND i.id=?`,
      companyId,
      document.slice('invoice:'.length),
    );
  const head = (i: NonNullable<ReturnType<typeof invoice>>) => [
    String(i.number),
    dmy(String(i.date)),
    String(i.name),
    String(i.tax_id),
    `${String(i.eq_series)}${String(i.eq_number)}`,
  ];
  const byDate = (a: string[], b: string[]) =>
    a[1]!.split('.').reverse().join().localeCompare(b[1]!.split('.').reverse().join()) ||
    a[0]!.localeCompare(b[0]!);
  const offsetRows: string[][] = [];
  for (const [document, amount] of offset) {
    const i = invoice(document);
    if (i && amount) offsetRows.push([...head(i), money(i.vat as bigint), money(amount)]);
  }
  const waitingRows: string[][] = [];
  for (const [document, left] of open) {
    const i = invoice(document);
    if (!i) continue;
    const reason = !String(i.eq_number)
      ? 'e-qaimə bağlanmayıb'
      : !Number(i.confirmed)
        ? 'DVX-də təsdiqlənməyib'
        : 'ƏDV depozitdən ödənilməyib';
    waitingRows.push([...head(i), money(left), reason]);
  }
  const columns = ['Qaimə', 'Tarix', 'Təchizatçı', 'VÖEN', 'E-qaimə'];
  return [
    {
      title: `Əvəzləşdirilən gələn e-qaimələr${closed ? '' : ' (bağlanışın planı)'}`,
      columns: [...columns, 'Qaimənin ƏDV-si', 'Əvəzləşdirilir'],
      money: [false, false, false, false, false, true, true],
      rows: offsetRows.sort(byDate),
    },
    {
      title: 'Əvəzləşdirilməyən — 241-də gözləyir (ayın sonuna)',
      columns: [...columns, 'Gözləyən ƏDV', 'Səbəb'],
      money: [false, false, false, false, false, true, false],
      rows: waitingRows.sort(byDate),
    },
  ];
}

export function vatReturn(db: Db, companyId: string, monthInput: string): DeclarationView {
  const started = performance.now();
  const month = checkMonth(monthInput);
  const from = `${month}-01`;
  const to = monthEnd(month);
  const v = vatOf(db, companyId, month);
  const summary = vatSummary(db, companyId, month);
  const base = (rate: string) => parseMoney(v.sales.find((s) => s.rate === rate)?.base ?? '0.00');
  const vat18 = parseMoney(v.sales.find((s) => s.rate === '18')?.vat ?? '0.00');
  const label = (rate: string) => vatRates.find((r) => r.id === rate)!.name;
  const closed = monthClosed(db, companyId, month);

  const sales: DeclarationSection = {
    title: 'Satış (vergi tutulan və digər əməliyyatlar)',
    columns: ['Dəyər (ƏDV-siz)', 'ƏDV'],
    rows: [
      row('s:18', 'Vergi tutulan əməliyyatlar — 18%', [base('18'), vat18], '601 − 602 / 603, 604', {
        account: '601',
      }),
      row('s:0', 'Sıfır dərəcə ilə vergi tutulan əməliyyatlar', [base('0'), ''], '601, dərəcə 0%', {
        account: '601',
      }),
      row('s:exempt', 'ƏDV-dən azad olunan əməliyyatlar', [base('exempt'), ''], '601, azad', {
        account: '601',
      }),
      row(
        's:nontaxable',
        'ƏDV-yə cəlb olunmayan əməliyyatlar',
        [base('nontaxable'), ''],
        '601, cəlb olunmayan',
        { account: '601' },
      ),
      row(
        's:total',
        'Cəmi',
        [base('18') + base('0') + base('exempt') + base('nontaxable'), v.salesVat],
        '',
        { total: true },
      ),
    ],
  };

  // An open month: what its closing plan offsets now (it changes until the month is closed).
  const planned = closed ? null : plannedVatOffset(db, companyId, month);
  const offset = planned ?? v.offset;
  const payable = v.salesVat - offset;
  const vatSection: DeclarationSection = {
    title: 'ƏDV-nin hesablanması',
    columns: ['Məbləğ'],
    rows: [
      row('v:accrued', 'Hesablanmış ƏDV', [v.salesVat], '18% əməliyyatların ƏDV-si'),
      row(
        'v:purchase',
        'Alışlar üzrə ƏDV (ay ərzində 241-ə daxil olan)',
        [v.purchaseVat],
        '241 · Dt dövriyyə',
        {
          account: '241',
        },
      ),
      row(
        'v:offset',
        'Əvəzləşdirilən ƏDV',
        [offset],
        closed
          ? `AB-${month} · 241 → 521.01`
          : planned === null
            ? 'ay bağlanışında yazılır'
            : 'ay bağlanışının planı (hələ yazılmayıb)',
        { account: '241' },
      ),
      row(
        'v:waiting',
        'Əvəzləşdirilməmiş (241-də, ayın sonuna)',
        [v.waiting - (planned ?? 0n)],
        '241 · qalıq',
        {
          level: 1,
          account: '241',
        },
      ),
      row(
        'v:payable',
        payable >= 0n ? 'Büdcəyə ödənilməli ƏDV' : 'Artıq — növbəti aya keçir',
        [payable >= 0n ? payable : -payable],
        'hesablanmış − əvəzləşdirilən',
        { total: true },
      ),
    ],
  };

  // 521.01: opening + credit − debit = closing; the debit split into the offset and the rest.
  const t = turnover(db, companyId, '521.01', month, month);
  const opening = owedAt(db, companyId, '521.01', previousMonth(month));
  const ledger: DeclarationSection = {
    title: '521.01 ilə tutuşma',
    columns: ['Məbləğ'],
    rows: [
      row('l:opening', 'Ayın əvvəlinə borc (+) / artıq (−)', [opening], '521.01 · qalıq', {
        account: '521.01',
      }),
      row('l:credit', 'Hesablanıb (Kt)', [t.credit], '521.01 · Kt dövriyyə', { account: '521.01' }),
      row('l:offset', 'Əvəzləşdirilib (Dt, ay bağlanışı)', [v.offset], '241 → 521.01', {
        account: '521.01',
      }),
      row('l:paid', 'Köçürülüb və digər (Dt)', [t.debit - v.offset], '521.01 · Dt dövriyyə', {
        account: '521.01',
      }),
      row(
        'l:closing',
        'Ayın sonuna borc (+) / artıq (−)',
        [opening + t.credit - t.debit],
        '521.01 · qalıq',
        {
          total: true,
          account: '521.01',
        },
      ),
    ],
  };

  // The appendices: the sales at 0%, exempt and not taxable, invoice by invoice.
  const lists = new Map<string, string[][]>();
  const listed = new Map<string, bigint>();
  for (const i of db.all(
    `SELECT i.number, i.date, i.lines, p.name, p.tax_id FROM invoices i
       JOIN partners p ON p.company_id=i.company_id AND p.id=i.partner_id
     WHERE i.company_id=? AND i.direction='sale' AND i.status='posted' AND i.date BETWEEN ? AND ?
     ORDER BY i.date, i.number`,
    companyId,
    from,
    to,
  )) {
    const byRate = new Map<string, bigint>();
    for (const l of JSON.parse(String(i.lines)) as SaleLine[])
      if (l.vatRate !== '18')
        byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0n) + parseMoney(l.netAzn));
    for (const [rate, amount] of byRate) {
      const list = lists.get(rate) ?? [];
      list.push([
        String(i.number),
        dmy(String(i.date)),
        String(i.name),
        String(i.tax_id),
        money(amount),
      ]);
      lists.set(rate, list);
      listed.set(rate, (listed.get(rate) ?? 0n) + amount);
    }
  }
  const appendices: DeclarationTable[] = [];
  const checks: DeclarationView['checks'] = [];
  for (const rate of ['0', 'exempt', 'nontaxable']) {
    const rows = lists.get(rate) ?? [];
    if (!rows.length && !base(rate)) continue;
    appendices.push({
      title: `Satış qaimələri — ${label(rate)}`,
      columns: ['Qaimə', 'Tarix', 'Alıcı', 'VÖEN', 'Dəyər'],
      money: [false, false, false, false, true],
      rows,
    });
    const rest = base(rate) - (listed.get(rate) ?? 0n);
    if (rest)
      checks.push({
        kind: 'info',
        text: `${label(rate)}: ${money(rest)} AZN qaiməsiz dövriyyədir (əl ilə əməliyyat) — əlavədə sənədi mühasib göstərir.`,
      });
  }
  appendices.push(...offsetLists(db, companyId, month, closed));

  if (!closed)
    checks.push({
      kind: 'warning',
      text: `${month} ayı bağlanmayıb: alış ƏDV-sinin əvəzləşdirilməsi ay bağlanışında yazılır, "Əvəzləşdirilən" bağlanışın indiki planıdır, bağlanışdan sonra dəqiqdir.`,
    });
  if (base('exempt') && v.purchaseVat) {
    const taxable = base('18') + base('0');
    const all = taxable + base('exempt');
    const share = all ? Number((taxable * 10000n) / all) / 100 : 0;
    checks.push({
      kind: 'warning',
      text: `Ayda ƏDV-dən azad satış (${money(base('exempt'))}) və alış ƏDV-si var: VM 175 üzrə alış ƏDV-si vergi tutulan əməliyyatların payı qədər əvəzləşdirilir (bu ay ${share.toFixed(2).replace('.', ',')}%). Meyar bölgünü özü etmir — mühasib yoxlayır.`,
    });
  }
  if (t.credit !== v.salesVat)
    checks.push({
      kind: 'warning',
      text: `521.01-in kredit dövriyyəsi (${money(t.credit)}) satışın ƏDV-si ilə (${money(v.salesVat)}) eyni deyil — 521.01-ə başqa yazılış var.`,
    });
  for (const d of summary.dvx)
    if (d.covered && d.difference !== '0.00')
      checks.push({
        kind: 'warning',
        text: `${d.direction === 'sale' ? 'Göndərilən' : 'Alınan'} e-qaimələr: ƏDV DVX-də ${d.dvxVat}, uçotda ${d.bookedVat} — fərq ${d.difference}.`,
      });
    else if (!d.covered)
      checks.push({
        kind: 'info',
        text: `${d.direction === 'sale' ? 'Göndərilən' : 'Alınan'} e-qaimələr: bu ay üçün DVX yüklənməyib, tutuşdurulmayıb.`,
      });

  return {
    kind: 'vat',
    period: month,
    from,
    to,
    title: `ƏDV bəyannaməsi üçün rəqəmlər · ${month}`,
    sections: [sales, vatSection, ledger],
    checks,
    appendices,
    ms: Math.round(performance.now() - started),
  };
}

// ---------------------------------------------------------------------------------------------
// Muzdlu iş (§5.2)

const quarterMonths = (period: string): string[] => {
  const m = /^(\d{4})-Q([1-4])$/.exec(period);
  if (!m) throw new DomainError('Rüb düzgün deyil (məs. 2026-Q3).', 'period');
  const first = (Number(m[2]) - 1) * 3 + 1;
  return [0, 1, 2].map((i) => `${m[1]}-${String(first + i).padStart(2, '0')}`);
};

const liabilities: [string, string, (keyof Totals)[]][] = [
  ['521.03', 'Gəlir vergisi', ['incomeTax']],
  ['522.01', 'DSMF (işçi + işəgötürən)', ['dsmfEmployee', 'dsmfEmployer']],
  ['522.03.1', 'İşsizlik sığortası — işçi', ['unemploymentEmployee']],
  ['522.03.2', 'İşsizlik sığortası — işəgötürən', ['unemploymentEmployer']],
  ['522.04.1', 'Tibbi sığorta — işçi', ['medicalEmployee']],
  ['522.04.2', 'Tibbi sığorta — işəgötürən', ['medicalEmployer']],
];

interface Totals {
  employees: bigint;
  income: bigint;
  exemption: bigint;
  taxable: bigint;
  incomeTax: bigint;
  base: bigint;
  dsmfEmployee: bigint;
  dsmfEmployer: bigint;
  unemploymentEmployee: bigint;
  unemploymentEmployer: bigint;
  medicalLow: bigint;
  medicalHigh: bigint;
  medicalEmployee: bigint;
  medicalEmployer: bigint;
}
const zeroTotals = (): Totals => ({
  employees: 0n,
  income: 0n,
  exemption: 0n,
  taxable: 0n,
  incomeTax: 0n,
  base: 0n,
  dsmfEmployee: 0n,
  dsmfEmployer: 0n,
  unemploymentEmployee: 0n,
  unemploymentEmployer: 0n,
  medicalLow: 0n,
  medicalHigh: 0n,
  medicalEmployee: 0n,
  medicalEmployer: 0n,
});

export function payrollReturn(db: Db, companyId: string, period: string): DeclarationView {
  const started = performance.now();
  const months = quarterMonths(period);
  const from = `${months[0]}-01`;
  const to = monthEnd(months[2]!);
  const per = months.map(zeroTotals);
  const people = new Map<string, { name: string; fin: string; tab: string; cells: bigint[][] }>();
  const checks: DeclarationView['checks'] = [];
  const missingFin = new Set<string>();
  months.forEach((month, i) => {
    const rates = ratesAt(db, companyId, monthEnd(month));
    const medicalBound = rates?.rates.medicalEmployee[0]?.upTo ?? null;
    const dsmfTop = rates?.rates.dsmfEmployer.at(-1);
    const lines = db.all(
      `SELECT l.*, e.name, e.fin, e.tab_no FROM payroll_lines l
         JOIN payroll_documents d ON d.id=l.document_id
         JOIN employees e ON e.company_id=l.company_id AND e.id=l.employee_id
       WHERE l.company_id=? AND d.month=? AND d.status='posted' ORDER BY e.name`,
      companyId,
      month,
    );
    if (!lines.length) {
      checks.push({ kind: 'info', text: `${month}: uçotda əmək haqqı sənədi yoxdur.` });
      return;
    }
    const t = per[i]!;
    for (const l of lines) {
      const gross = l.gross as bigint;
      const sick = l.sick as bigint;
      const exemption = l.exemption as bigint;
      const low = medicalBound === null || gross <= medicalBound ? gross : medicalBound;
      t.employees += 1n;
      t.income += gross + sick;
      t.exemption += exemption;
      t.taxable += gross + sick - exemption;
      t.incomeTax += l.income_tax as bigint;
      t.base += gross;
      t.dsmfEmployee += l.dsmf_employee as bigint;
      t.dsmfEmployer += l.dsmf_employer as bigint;
      t.unemploymentEmployee += l.unemployment_employee as bigint;
      t.unemploymentEmployer += l.unemployment_employer as bigint;
      t.medicalLow += low;
      t.medicalHigh += gross - low;
      t.medicalEmployee += l.medical_employee as bigint;
      t.medicalEmployer += l.medical_employer as bigint;
      if (gross > 800_000n && (!dsmfTop || dsmfTop.rate !== 1100))
        checks.push({
          kind: 'warning',
          text: `${month}: ${String(l.name)} — gəlir 8 000 ₼-dan çoxdur, dərəcələr dəstində işəgötürənin DSMF-si 8 000-dən yuxarı 11% deyil (DVX 2026). Mühasib yoxlayır.`,
        });
      const id = String(l.employee_id);
      const p = people.get(id) ?? {
        name: String(l.name),
        fin: String(l.fin),
        tab: String(l.tab_no),
        cells: months.map(() => [0n, 0n, 0n, 0n, 0n, 0n]),
      };
      const c = p.cells[i]!;
      c[0]! += gross + sick;
      c[1]! += l.income_tax as bigint;
      c[2]! += (l.dsmf_employee as bigint) + (l.dsmf_employer as bigint);
      c[3]! += (l.unemployment_employee as bigint) + (l.unemployment_employer as bigint);
      c[4]! += (l.medical_employee as bigint) + (l.medical_employer as bigint);
      people.set(id, p);
      if (!String(l.fin)) missingFin.add(String(l.name));
    }
  });
  const columns = [...months, 'Rüb'];
  const line = (
    key: keyof Totals,
    label: string,
    source: string,
    extra: Partial<DeclarationRow> = {},
  ) =>
    row(
      `p:${key}`,
      label,
      [
        ...per.map((t) => (key === 'employees' ? String(t[key]) : t[key])),
        key === 'employees' ? '' : per.reduce((s, t) => s + t[key], 0n),
      ],
      source,
      extra,
    );
  const income: DeclarationSection = {
    title: 'Gəlir vergisi (VM 101)',
    columns,
    rows: [
      line('employees', 'İşçi sayı', 'uçotdakı əmək haqqı sətirləri'),
      line('income', 'Hesablanmış gəlir', 'əmək haqqı + xəstəlik müavinəti (işəgötürənin günləri)'),
      line('exemption', 'Güzəşt (azad olunan)', 'VM 102, 200 ₼ (≤ 2 500)', { level: 1 }),
      line('taxable', 'Vergi tutulan gəlir', 'hesablanmış − güzəşt'),
      line('incomeTax', 'Gəlir vergisi', '521.03', { total: true, account: '521.03' }),
    ],
  };
  const funds: DeclarationSection = {
    title: 'Sosial sığorta, işsizlik və tibbi sığorta',
    columns,
    rows: [
      line('base', 'DSMF və işsizlik bazası', 'əmək haqqı (xəstəlik müavinəti xaric)'),
      line('dsmfEmployee', 'DSMF — işçi', '522.01', { level: 1, account: '522.01' }),
      line('dsmfEmployer', 'DSMF — işəgötürən', '522.01', { level: 1, account: '522.01' }),
      line('unemploymentEmployee', 'İşsizlik — işçi', '522.03.1', {
        level: 1,
        account: '522.03.1',
      }),
      line('unemploymentEmployer', 'İşsizlik — işəgötürən', '522.03.2', {
        level: 1,
        account: '522.03.2',
      }),
      line('medicalLow', 'Tibbi sığorta bazası — 2 500 ₼-dək', 'əmək haqqı'),
      line('medicalHigh', 'Tibbi sığorta bazası — 2 500 ₼-dan yuxarı', 'əmək haqqı'),
      line('medicalEmployee', 'Tibbi sığorta — işçi', '522.04.1', {
        level: 1,
        account: '522.04.1',
      }),
      line('medicalEmployer', 'Tibbi sığorta — işəgötürən', '522.04.2', {
        level: 1,
        account: '522.04.2',
      }),
    ],
  };
  // The books: accrued by the payroll documents = the return; paid and owed by account.
  const ledgerRows: DeclarationRow[] = [];
  for (const [account, label, keys] of liabilities) {
    const accrued = db.get(
      `SELECT COALESCE(SUM(p.amount),0) AS a FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE p.company_id=? AND p.kt_account=? AND e.source_type='payroll' AND p.date BETWEEN ? AND ?`,
      companyId,
      account,
      from,
      to,
    )!.a as bigint;
    const t = turnover(db, companyId, account, months[0]!, months[2]!);
    const opening = owedAt(db, companyId, account, previousMonth(months[0]!));
    const declared = keys.reduce((s, k) => s + per.reduce((x, p) => x + p[k], 0n), 0n);
    ledgerRows.push(
      row(
        `l:${account}`,
        `${account} · ${label}`,
        [opening, accrued, t.debit, opening + t.credit - t.debit],
        account,
        {
          account,
        },
      ),
    );
    if (accrued !== declared)
      checks.push({
        kind: 'warning',
        text: `${account}: əmək haqqı yazılışları ${money(accrued)}, bəyannamədə ${money(declared)} — fərq var.`,
      });
  }
  const ledger: DeclarationSection = {
    title: 'Hesablarla tutuşma (rüb)',
    columns: ['Rübün əvvəlinə borc', 'Hesablanıb', 'Köçürülüb (Dt)', 'Rübün sonuna borc'],
    rows: ledgerRows,
  };
  if (missingFin.size)
    checks.push({
      kind: 'warning',
      text: `FİN-i yazılmayan işçilər (bəyannamənin əlavəsi FİN tələb edir): ${[...missingFin].join(', ')}.`,
    });
  const appendix: DeclarationTable = {
    title: 'İşçilər üzrə (ay-ay: gəlir, gəlir vergisi, DSMF, işsizlik, tibbi — işçi + işəgötürən)',
    columns: [
      'FİN',
      'İşçi',
      'Tabel №',
      'Ay',
      'Gəlir',
      'Gəlir vergisi',
      'DSMF',
      'İşsizlik',
      'Tibbi',
    ],
    money: [false, false, false, false, true, true, true, true, true],
    rows: [...people.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'az'))
      .flatMap((p) =>
        months
          .map((m, i) => ({ m, c: p.cells[i]! }))
          .filter((x) => x.c.some((v) => v !== 0n))
          .map((x) => [p.fin, p.name, p.tab, x.m, ...x.c.slice(0, 5).map(money)]),
      ),
  };
  return {
    kind: 'payroll',
    period,
    from,
    to,
    title: `Muzdlu iş bəyannaməsi üçün rəqəmlər · ${period.replace('-Q', ', ')}-ci rüb`,
    sections: [income, funds, ledger],
    checks,
    appendices: [appendix],
    ms: Math.round(performance.now() - started),
  };
}

// ---------------------------------------------------------------------------------------------

export function declaration(
  db: Db,
  companyId: string,
  kind: DeclarationKind,
  period: string,
): DeclarationView {
  switch (kind) {
    case 'vat':
      return vatReturn(db, companyId, period);
    case 'payroll':
      return payrollReturn(db, companyId, period);
    case 'taxDepreciation':
      return taxDepreciationReturn(db, companyId, period);
    case 'profitTax':
      return profitTaxReturn(db, companyId, period);
    case 'balanceSheet':
      return balanceSheet(db, companyId, period);
    case 'incomeStatement':
      return incomeStatement(db, companyId, period);
    case 'equityStatement':
      return equityStatement(db, companyId, period);
    case 'cashFlowStatement':
      return cashFlowStatement(db, companyId, period);
    default:
      throw new DomainError('Bu bəyannamə hələ hazır deyil.', 'kind');
  }
}
