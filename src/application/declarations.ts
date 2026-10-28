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
import { checkMonth } from './revaluation.js';

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

  const payable = v.salesVat - v.offset;
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
        [v.offset],
        closed ? `AB-${month} · 241 → 521.01` : 'ay bağlanışında yazılır',
        { account: '241' },
      ),
      row('v:waiting', 'Əvəzləşdirilməmiş (241-də, ayın sonuna)', [v.waiting], '241 · qalıq', {
        level: 1,
        account: '241',
      }),
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

  if (!closed)
    checks.push({
      kind: 'warning',
      text: `${month} ayı bağlanmayıb: alış ƏDV-sinin əvəzləşdirilməsi ay bağlanışında yazılır, "Əvəzləşdirilən" bağlanışdan sonra dəqiqdir.`,
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

export function declaration(
  db: Db,
  companyId: string,
  kind: DeclarationKind,
  period: string,
): DeclarationView {
  switch (kind) {
    case 'vat':
      return vatReturn(db, companyId, period);
    default:
      throw new DomainError('Bu bəyannamə hələ hazır deyil.', 'kind');
  }
}
