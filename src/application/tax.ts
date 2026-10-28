/**
 * Stage 9c — tax depreciation (VM 114; docs/MERHELE-9-VERGI-BEYANNAMELERI.md §5.3, QERARLAR
 * 2026-10-28 mərhələ 9 §5) and the tax parameters of a year (shared with the profit tax, 9d).
 * The assets come from the fixed-asset documents: putting into service (the cost) or an opening
 * balance (the tax residual taken over, or cost less depreciation), and leave by a write-off or a
 * sale invoice (its price without VAT). Nothing is posted: the tax depreciation is a figure of the
 * profit tax return.
 */
import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney, type Minor } from '../domain/money.js';
import { formatRate, parseRate } from '../domain/payroll.js';
import {
  checkTaxYear,
  defaultTaxYear,
  maxTaxRates,
  taxCategories,
  taxCategoryLabel,
  taxCategoryOf,
  taxDepreciation,
  type TaxAsset,
  type TaxAssetYear,
  type TaxCategory,
  type TaxYearParams,
} from '../domain/tax.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type {
  DeclarationRow,
  DeclarationSection,
  DeclarationView,
  TaxYearView,
} from '../contracts/queries.js';
import type { Db } from '../infrastructure/sqlite/db.js';
import type { Tx } from './tx.js';

const str = (v: unknown) => String(v ?? '');
const money = (m: Minor) => formatMinor(m);
const dmy = (iso: string) => iso.split('-').reverse().join('.');

export function checkYear(year: string): number {
  if (!/^\d{4}$/.test(year)) throw new DomainError('İl düzgün deyil.', 'period');
  return Number(year);
}

export interface TaxYear extends TaxYearParams {
  saved: boolean;
  /** Hundredths of a percent: 20% → 2 000. */
  profitRate: number;
  losses: Minor;
  adjustments: { label: string; amount: Minor }[];
}

/** A year's parameters: what the accountant saved, or the defaults (the code's highest rates). */
export function taxYear(db: Db, companyId: string, year: number): TaxYear {
  const r = db.get(
    'SELECT * FROM tax_years WHERE company_id=? AND year=?',
    companyId,
    String(year),
  );
  const d = defaultTaxYear();
  if (!r) return { ...d, saved: false, profitRate: 2000, losses: 0n, adjustments: [] };
  const rates = JSON.parse(str(r.rates)) as Partial<Record<TaxCategory, number>>;
  return {
    rates: { ...d.rates, ...rates },
    coefficient: Number(r.coefficient),
    writeOff: r.write_off as bigint,
    saved: true,
    profitRate: Number(r.profit_rate),
    losses: r.losses as bigint,
    adjustments: (JSON.parse(str(r.adjustments)) as { label: string; amount: string }[]).map(
      (a) => ({ label: a.label, amount: parseMoney(a.amount) }),
    ),
  };
}

const yearLocked = (db: Db, companyId: string, year: number) =>
  str(db.get('SELECT closed_through FROM companies WHERE id=?', companyId)!.closed_through) >=
  `${year}-12-31`;

export function taxYearView(db: Db, companyId: string, year: number): TaxYearView {
  const t = taxYear(db, companyId, year);
  return {
    year: String(year),
    saved: t.saved,
    locked: yearLocked(db, companyId, year),
    rates: taxCategories.map((c) => ({
      category: c,
      label: taxCategoryLabel[c],
      rate: formatRate(t.rates[c]),
      max: formatRate(maxTaxRates[c]),
    })),
    coefficient: formatRate(t.coefficient).replace('.', ','),
    writeOff: money(t.writeOff),
    profitRate: formatRate(t.profitRate),
    losses: money(t.losses),
    adjustments: t.adjustments.map((a) => ({ label: a.label, amount: money(a.amount) })),
  };
}

export function saveTaxYear(tx: Tx, cmd: CommandOf<'taxYear.save'>): CommandResult {
  tx.company(cmd.companyId);
  const year = checkYear(cmd.year);
  if (yearLocked(tx.db, cmd.companyId, year))
    throw new DomainError(
      `${year}-ci il bağlanıb: onun vergi parametrləri dəyişdirilmir.`,
      'year',
      'conflict',
    );
  const rates = {} as Record<TaxCategory, number>;
  for (const c of taxCategories)
    rates[c] = parseRate(cmd.rates[c] ?? formatRate(maxTaxRates[c]), taxCategoryLabel[c]);
  const coefficient = parseRate(cmd.coefficient, 'Əmsal');
  const writeOff = parseMoney(cmd.writeOff, 'Silinmə həddi');
  checkTaxYear({ rates, coefficient, writeOff });
  const profitRate = parseRate(cmd.profitRate, 'Mənfəət vergisinin dərəcəsi');
  const losses = parseMoney(cmd.losses || '0', 'Keçmiş illərin zərəri');
  if (losses < 0n) throw new DomainError('Keçmiş illərin zərəri mənfi ola bilməz.', 'losses');
  const adjustments = cmd.adjustments.map((a, i) => {
    const label = a.label.trim();
    if (!label) throw new DomainError(`Düzəliş ${i + 1}: adını yazın.`, `adjustments.${i}.label`);
    return { label, amount: money(parseMoney(a.amount, `Düzəliş ${i + 1}`)) };
  });
  const exists = tx.db.get(
    'SELECT 1 AS x FROM tax_years WHERE company_id=? AND year=?',
    cmd.companyId,
    String(year),
  );
  tx.db.run(
    `INSERT INTO tax_years(company_id,year,rates,coefficient,write_off,profit_rate,losses,adjustments,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(company_id,year) DO UPDATE SET rates=excluded.rates,coefficient=excluded.coefficient,
       write_off=excluded.write_off,profit_rate=excluded.profit_rate,losses=excluded.losses,
       adjustments=excluded.adjustments,updated_at=excluded.updated_at`,
    cmd.companyId,
    String(year),
    JSON.stringify(rates),
    coefficient,
    writeOff,
    profitRate,
    losses,
    JSON.stringify(adjustments),
    tx.clock.now(),
  );
  tx.audit(
    cmd.companyId,
    exists ? 'Dəyişdirildi' : 'Yaradıldı',
    'Vergi parametrləri',
    String(year),
    `${year}: normalar ${taxCategories.map((c) => `${formatRate(rates[c])}%`).join(' / ')}, əmsal ${formatRate(coefficient)}, mənfəət vergisi ${formatRate(profitRate)}%`,
  );
  return { id: String(year) };
}

// ---------------------------------------------------------------------------------------------

export interface TaxAssetInfo extends TaxAsset {
  name: string;
  inDate: string;
  outDate: string;
  /** The opening balance took over the books' residual: no tax residual was written. */
  fromBooks: boolean;
}

/** Every asset that came into service (posted documents), with how and when it left. */
export function taxAssets(db: Db, companyId: string): TaxAssetInfo[] {
  const out = new Map<string, { date: string; proceeds: Minor }>();
  for (const r of db.all(
    `SELECT l.asset_id, d.date FROM asset_lines l JOIN asset_documents d ON d.id=l.document_id
     WHERE l.company_id=? AND d.status='posted' AND d.kind='disposal'`,
    companyId,
  ))
    out.set(str(r.asset_id), { date: str(r.date), proceeds: 0n });
  for (const i of db.all(
    `SELECT date, lines FROM invoices WHERE company_id=? AND direction='sale' AND status='posted'
       AND lines LIKE '%"assetId"%'`,
    companyId,
  ))
    for (const l of JSON.parse(str(i.lines)) as { assetId?: string; netAzn: string }[])
      if (l.assetId) out.set(l.assetId, { date: str(i.date), proceeds: parseMoney(l.netAzn) });
  return db
    .all(
      `SELECT l.*, d.date AS doc_date, d.kind AS doc_kind, a.name, a.inventory_no, a.asset_group
       FROM asset_lines l JOIN asset_documents d ON d.id=l.document_id
         JOIN fixed_assets a ON a.company_id=l.company_id AND a.id=l.asset_id
       WHERE l.company_id=? AND d.status='posted' AND d.kind IN('commission','opening')
       ORDER BY a.inventory_no`,
      companyId,
    )
    .map((l): TaxAssetInfo => {
      const opening = str(l.doc_kind) === 'opening';
      const books = (l.cost as bigint) - (l.accumulated as bigint);
      const left = out.get(str(l.asset_id));
      return {
        id: str(l.asset_id),
        name: `${str(l.inventory_no)} ${str(l.name)}`,
        category: taxCategoryOf(str(l.asset_group)),
        // An opening balance of 31.12 is the residual the next year starts with (audit 0.9.9).
        inYear:
          Number(str(l.doc_date).slice(0, 4)) +
          (opening && str(l.doc_date).endsWith('-12-31') ? 1 : 0),
        inDate: str(l.doc_date),
        value: opening ? ((l.tax_residual as bigint | null) ?? books) : (l.cost as bigint),
        fromBooks: opening && l.tax_residual === null,
        outYear: left ? Number(left.date.slice(0, 4)) : 0,
        outDate: left?.date ?? '',
        proceeds: left?.proceeds ?? 0n,
      };
    });
}

export interface TaxDepreciationYear {
  assets: TaxAssetInfo[];
  rows: TaxAssetYear[];
  params: TaxYear;
}

export function taxDepreciationYear(db: Db, companyId: string, year: number): TaxDepreciationYear {
  const assets = taxAssets(db, companyId);
  const cache = new Map<number, TaxYear>();
  const params = (y: number) => {
    if (!cache.has(y)) cache.set(y, taxYear(db, companyId, y));
    return cache.get(y)!;
  };
  return { assets, rows: taxDepreciation(assets, params, year), params: params(year) };
}

export function taxDepreciationReturn(db: Db, companyId: string, period: string): DeclarationView {
  const started = performance.now();
  const year = checkYear(period);
  const { assets, rows, params } = taxDepreciationYear(db, companyId, year);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const columns = [...taxCategories.map((c) => taxCategoryLabel[c]), 'Cəmi'];
  const sum = (pick: (r: TaxAssetYear) => Minor) => {
    const values = taxCategories.map((c) =>
      rows.filter((r) => r.category === c).reduce((s, r) => s + pick(r), 0n),
    );
    return [...values, values.reduce((s, v) => s + v, 0n)];
  };
  const line = (
    key: string,
    label: string,
    pick: (r: TaxAssetYear) => Minor,
    source: string,
    extra: Partial<DeclarationRow> = {},
  ) =>
    ({
      key,
      label,
      values: sum(pick).map(money),
      source,
      total: false,
      level: 0,
      account: '',
      ...extra,
    }) as DeclarationRow;
  const effective = taxCategories.map(
    (c) =>
      `${formatRate(Math.round((params.rates[c] * params.coefficient) / 100)).replace('.', ',')}%`,
  );
  const main: DeclarationSection = {
    title: `Vergi amortizasiyası (VM 114) · ${year}`,
    columns,
    rows: [
      line('t:opening', 'İlin əvvəlinə qalıq dəyər', (r) => r.opening, 'keçən ilin sonuna qalıq'),
      line('t:added', 'İl ərzində daxil olan', (r) => r.added, 'istismara vermə, başlanğıc qalıq', {
        level: 1,
      }),
      line(
        't:removed',
        'İl ərzində çıxan (vergi qalıq dəyəri)',
        (r) => r.removed,
        'silinmə, satış qaiməsi',
        { level: 1 },
      ),
      line(
        't:base',
        'İlin sonuna qalıq dəyər (amortizasiyadan əvvəl)',
        (r) => r.base,
        'VM 114.3-ün bazası',
      ),
      {
        key: 't:rate',
        label: 'Norma',
        values: [...effective, ''],
        source:
          params.coefficient === 100
            ? 'VM 114.3'
            : `VM 114.3 × ${formatRate(params.coefficient).replace('.', ',')}`,
        total: false,
        level: 0,
        account: '',
      },
      line('t:depreciation', 'Amortizasiya', (r) => r.depreciation, 'qalıq × norma', {
        total: true,
      }),
      line(
        't:writtenOff',
        `${money(params.writeOff).replace('.', ',')} ₼-dan az qalıq — silinir`,
        (r) => r.writtenOff,
        'parametr',
        { level: 1 },
      ),
      line('t:closing', 'Növbəti ilə qalıq dəyər', (r) => r.closing, '', { total: true }),
    ],
  };
  // The books: depreciation of the year posted by the month closings (Kt 112).
  const booked = db.get(
    `SELECT COALESCE(SUM(p.amount),0) AS a FROM postings p JOIN entries e ON e.id=p.entry_id
     WHERE p.company_id=? AND p.kt_account='112' AND e.source_type='closing' AND p.date BETWEEN ? AND ?`,
    companyId,
    `${year}-01-01`,
    `${year}-12-31`,
  )!.a as bigint;
  const tax = rows.reduce((s, r) => s + r.depreciation + r.writtenOff, 0n);
  const compare: DeclarationSection = {
    title: 'Uçotla müqayisə',
    columns: ['Məbləğ'],
    rows: [
      {
        key: 'c:books',
        label: 'Uçot amortizasiyası (ay bağlanışları, Kt 112)',
        values: [money(booked)],
        source: '112 · Kt dövriyyə',
        total: false,
        level: 0,
        account: '112',
      },
      {
        key: 'c:tax',
        label: 'Vergi amortizasiyası (silinən qalıq daxil)',
        values: [money(tax)],
        source: 'yuxarıdakı cədvəl',
        total: false,
        level: 0,
        account: '',
      },
      {
        key: 'c:diff',
        label: 'Fərq (vergi − uçot)',
        values: [money(tax - booked)],
        source: 'mənfəət vergisi bəyannaməsində nəzərə alınır',
        total: true,
        level: 0,
        account: '',
      },
    ],
  };
  const checks: DeclarationView['checks'] = [];
  const fromBooks = assets.filter(
    (a) => a.fromBooks && a.inYear <= year && (!a.outYear || a.outYear >= year),
  );
  if (fromBooks.length)
    checks.push({
      kind: 'info',
      text: `Başlanğıc qalıqda vergi qalıq dəyəri yazılmayıb, uçot qalıq dəyəri götürülüb: ${fromBooks.map((a) => a.name).join(', ')}.`,
    });
  if (!params.saved)
    checks.push({
      kind: 'info',
      text: `${year} üçün parametrlər yazılmayıb: VM 114.3-ün yuxarı normaları, əmsal 1, silinmə həddi 100 ₼. Mühasib təsdiq edir.`,
    });
  return {
    kind: 'taxDepreciation',
    period: String(year),
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    title: `Vergi amortizasiyası · ${year}`,
    sections: [main, compare],
    checks,
    appendices: [
      {
        title: 'Əsas vəsaitlər üzrə',
        columns: [
          'Əsas vəsait',
          'Kateqoriya',
          'Daxil olub',
          'Çıxıb',
          'İlin əvvəlinə',
          'Daxil',
          'Çıxan',
          'Amortizasiya',
          'İlin sonuna',
        ],
        money: [false, false, false, false, true, true, true, true, true],
        rows: rows.map((r) => {
          const a = byId.get(r.id)!;
          return [
            a.name,
            taxCategoryLabel[r.category],
            dmy(a.inDate),
            a.outDate && a.outYear <= year ? dmy(a.outDate) : '',
            money(r.opening),
            money(r.added),
            money(r.removed),
            money(r.depreciation + r.writtenOff),
            money(r.closing),
          ];
        }),
      },
    ],
    params: taxYearView(db, companyId, year),
    ms: Math.round(performance.now() - started),
  };
}
