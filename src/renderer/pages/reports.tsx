/**
 * Reports of stage 5d: Mənfəət və zərər (a year by months), Pul vəsaitlərinin hərəkəti (bank and
 * cash lines by item), ƏDV icmalı (a month) and İdarə paneli (the month's figures and 12 months).
 * Every figure leads on: M/Z rows to the account card (and from there to the document), the
 * dashboard tiles to their report. Each report is exported to Excel and printed.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileDown } from '../icons';
import type {
  CashFlowView,
  DashboardTile,
  DashboardView,
  ProfitLossView,
  VatSummaryView,
} from '../../contracts/queries';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { MonthFilter, RangeFields, useRange } from '../filters';
import { day, money } from '../format';
import { useQuery } from '../hooks';
import { pages } from '../pages';
import { usePrint } from '../print';
import { Amount, Empty, Notice } from '../ui';
import { monthOf, usePeriod, useWindow, useWorkspace, type View } from '../workspace';
import { workbook, type SheetSpec } from '../xlsx';

const monthNames = [
  'Yan',
  'Fev',
  'Mar',
  'Apr',
  'May',
  'İyn',
  'İyl',
  'Avq',
  'Sen',
  'Okt',
  'Noy',
  'Dek',
];
const monthLabel = (m: string) => `${monthNames[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const cell = (v: string) => (v === '0.00' ? '' : money(v));

/** Excel and print buttons of a report; `sheet` builds the workbook, `paper` the printed form. */
function useOutput(file: string, sheet: () => SheetSpec, paper: () => ReactNode) {
  const printer = usePrint();
  const { company } = useCatalog(useWindow().companyId);
  const [message, setMessage] = useState('');
  const buttons = (
    <>
      <button
        type="button"
        className="button secondary"
        onClick={async () => {
          try {
            const saved = await api.saveFile(`${file}.xlsx`, workbook(sheet()));
            if (saved) setMessage(`Saxlanıldı: ${saved}`);
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <FileDown size={15} /> Excel
      </button>
      <button
        type="button"
        className="button secondary"
        onClick={() =>
          printer.print(
            <>
              <p>
                {company?.name} · VÖEN {company?.taxId}
              </p>
              {paper()}
            </>,
          )
        }
      >
        Çap et
      </button>
    </>
  );
  const notice = message && (
    <Notice kind="success" onClose={() => setMessage('')}>
      {message}
    </Notice>
  );
  return { buttons, notice, sheet: printer.sheet };
}

// ---------------------------------------------------------------------------------------------

export function ProfitLossPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const [year, setYear] = useState(usePeriod().from.slice(0, 4));
  const valid = /^\d{4}$/.test(year);
  const view = useQuery<ProfitLossView>(
    valid ? { type: 'profitLoss', companyId: win.companyId, year } : null,
  );
  const v = view.data && view.data.year === year ? view.data : undefined;
  const table = v && (
    <table className="grid report">
      <thead>
        <tr>
          <th scope="col">Maddə</th>
          {v.months.map((m) => (
            <th key={m} scope="col" className="num">
              {monthLabel(m)}
            </th>
          ))}
          <th scope="col" className="num">
            İl
          </th>
        </tr>
      </thead>
      <tbody>
        {v.rows.map((r) => (
          <tr
            key={r.key}
            className={r.total ? 'total' : r.level ? 'child' : undefined}
            onDoubleClick={() =>
              r.account &&
              ws.open(
                {
                  type: 'accountCard',
                  account: r.account,
                  sk: r.sk,
                  from: `${year}-01-01`,
                  to: `${year}-12-31`,
                },
                win.companyId,
              )
            }
          >
            <th scope="row" className={r.level ? 'indent' : undefined}>
              {r.label}
            </th>
            {r.values.map((x, i) => (
              <td key={i} className="num">
                {r.total ? <Amount value={x} /> : cell(x)}
              </td>
            ))}
            <td className="num">
              <Amount value={r.sum} strong={r.total} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const out = useOutput(
    `Mənfəət və zərər ${year}`,
    () => ({
      name: `M-Z ${year}`,
      title: ['Mənfəət və zərər hesabatı', `${year}-ci il`],
      header: ['Maddə', ...v!.months.map(monthLabel), 'İl'],
      rows: v!.rows.map((r) => [
        r.level ? `  ${r.label}` : r.label,
        ...r.values.map((x) => ({ money: x })),
        { money: r.sum },
      ]),
      widths: [40, ...v!.months.map(() => 12), 14],
    }),
    () => (
      <>
        <h1>Mənfəət və zərər hesabatı · {year}</h1>
        {table}
      </>
    ),
  );
  return (
    <ModuleFrame
      title={pages.profitLoss.title}
      hint={v ? `${year} · ${v.ms} ms · sətrə iki dəfə klik — hesab kartı` : pages.profitLoss.hint}
      onRefresh={view.reload}
      actions={v && out.buttons}
      filters={
        <label className="filter-text">
          <span>İl</span>
          <input
            aria-label="İl"
            inputMode="numeric"
            maxLength={4}
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
          />
        </label>
      }
      notices={
        <>
          {view.error && <Notice>{view.error}</Notice>}
          {out.notice}
        </>
      }
    >
      {!v ? (
        <div className="loading">Yüklənir…</div>
      ) : v.rows.some((r) => !r.total) ? (
        <div className="table-scroll">{table}</div>
      ) : (
        <Empty title="Bu ildə gəlir və xərc yoxdur" />
      )}
      {out.sheet}
    </ModuleFrame>
  );
}

// ---------------------------------------------------------------------------------------------

export function CashFlowPage() {
  const win = useWindow();
  const range = useRange(usePeriod());
  const view = useQuery<CashFlowView>({
    type: 'cashFlow',
    companyId: win.companyId,
    ...range.applied,
  });
  const v = view.data;
  const kinds = [
    ['in', 'Daxilolmalar', v?.inflow],
    ['out', 'Ödənişlər', v?.outflow],
    ['other', 'Bank və kassa sənədlərindən kənar', v?.other],
  ] as const;
  const table = v && (
    <table className="grid report">
      <tbody>
        <tr className="total">
          <th scope="row">Dövrün əvvəlinə qalıq (221 + 223 + 224)</th>
          <td className="num">
            <Amount value={v.opening} strong />
          </td>
        </tr>
        {kinds.map(([kind, label, sum]) => {
          const rows = v.rows.filter((r) => r.kind === kind);
          if (!rows.length) return null;
          return [
            <tr key={kind} className="total">
              <th scope="row">{label}</th>
              <td className="num">
                <Amount value={sum ?? '0.00'} />
              </td>
            </tr>,
            ...rows.map((r) => (
              <tr key={r.key} className="child">
                <th scope="row" className="indent">
                  {r.label}
                </th>
                <td className="num">{money(r.amount)}</td>
              </tr>
            )),
          ];
        })}
        <tr className="total">
          <th scope="row">Dövrün sonuna qalıq (221 + 223 + 224)</th>
          <td className="num">
            <Amount value={v.closing} strong />
          </td>
        </tr>
      </tbody>
    </table>
  );
  const out = useOutput(
    `Pul vəsaitlərinin hərəkəti ${range.applied.from} ${range.applied.to}`,
    () => ({
      name: 'Pul hərəkəti',
      title: ['Pul vəsaitlərinin hərəkəti', `${day(v!.from)} – ${day(v!.to)}`],
      header: ['Maddə', 'Məbləğ'],
      rows: [
        ['Əvvələ qalıq', { money: v!.opening }],
        ...v!.rows.map((r) => [
          `${r.kind === 'in' ? 'Daxilolma' : r.kind === 'out' ? 'Ödəniş' : 'Sənədsiz'} · ${r.label}`,
          { money: r.kind === 'out' ? `-${r.amount}` : r.amount },
        ]),
        ['Sona qalıq', { money: v!.closing }],
      ],
      widths: [50, 16],
    }),
    () => (
      <>
        <h1>
          Pul vəsaitlərinin hərəkəti · {day(range.applied.from)} – {day(range.applied.to)}
        </h1>
        {table}
      </>
    ),
  );
  return (
    <ModuleFrame
      title={pages.cashFlow.title}
      hint={pages.cashFlow.hint}
      onRefresh={view.reload}
      onFilter={range.apply}
      actions={v && out.buttons}
      filters={<RangeFields range={range} />}
      notices={
        <>
          {range.error && <Notice>{range.error}</Notice>}
          {view.error && <Notice>{view.error}</Notice>}
          {v && !v.reconciled && (
            <Notice kind="warning">
              Hərəkətlər qalıqlarla tutuşmur — bütövlük yoxlamasını aparın.
            </Notice>
          )}
          {out.notice}
        </>
      }
    >
      {!v ? <div className="loading">Yüklənir…</div> : <div className="table-scroll">{table}</div>}
      {out.sheet}
    </ModuleFrame>
  );
}

// ---------------------------------------------------------------------------------------------

export function VatSummaryPage() {
  const win = useWindow();
  const [month, setMonth] = useState(usePeriod().from.slice(0, 7));
  const valid = /^\d{4}-\d{2}$/.test(month);
  const view = useQuery<VatSummaryView>(
    valid ? { type: 'vatSummary', companyId: win.companyId, month } : null,
  );
  const v = view.data && view.data.month === month ? view.data : undefined;
  const table = v && (
    <table className="grid report">
      <thead>
        <tr>
          <th scope="col">Göstərici</th>
          <th scope="col" className="num">
            Vergiyə cəlb olunan
          </th>
          <th scope="col" className="num">
            ƏDV
          </th>
        </tr>
      </thead>
      <tbody>
        {v.sales.map((s) => (
          <tr key={s.rate} className="child">
            <th scope="row" className="indent">
              Satış · {s.label}
            </th>
            <td className="num">{money(s.base)}</td>
            <td className="num">{cell(s.vat)}</td>
          </tr>
        ))}
        <tr className="total">
          <th scope="row">Satışın ƏDV-si</th>
          <td />
          <td className="num">
            <Amount value={v.salesVat} />
          </td>
        </tr>
        <tr className="child">
          <th scope="row" className="indent">
            Alışın ƏDV-si (241, ay ərzində)
          </th>
          <td />
          <td className="num">{money(v.purchaseVat)}</td>
        </tr>
        <tr className="child">
          <th scope="row" className="indent">
            Əvəzləşdirilən (ay bağlanışı, 241 → 521.01)
          </th>
          <td />
          <td className="num">{money(v.offset)}</td>
        </tr>
        <tr className="child">
          <th scope="row" className="indent">
            Əvəzləşdirilməmiş (241-də, ay sonu)
          </th>
          <td />
          <td className="num">{money(v.waiting)}</td>
        </tr>
        <tr className="total">
          <th scope="row">Ödənilməli ƏDV</th>
          <td />
          <td className="num">
            <Amount value={v.payable} strong />
          </td>
        </tr>
      </tbody>
    </table>
  );
  const out = useOutput(
    `ƏDV icmalı ${month}`,
    () => ({
      name: `ƏDV ${month}`,
      title: ['ƏDV icmalı', month],
      header: ['Göstərici', 'Vergiyə cəlb olunan', 'ƏDV'],
      rows: [
        ...v!.sales.map((s) => [`Satış · ${s.label}`, { money: s.base }, { money: s.vat }]),
        ['Satışın ƏDV-si', '', { money: v!.salesVat }],
        ['Alışın ƏDV-si', '', { money: v!.purchaseVat }],
        ['Əvəzləşdirilən', '', { money: v!.offset }],
        ['Əvəzləşdirilməmiş', '', { money: v!.waiting }],
        ['Ödənilməli ƏDV', '', { money: v!.payable }],
      ],
      widths: [40, 18, 16],
    }),
    () => (
      <>
        <h1>ƏDV icmalı · {month}</h1>
        {table}
      </>
    ),
  );
  return (
    <ModuleFrame
      title={pages.vatSummary.title}
      hint={pages.vatSummary.hint}
      onRefresh={view.reload}
      actions={v && out.buttons}
      filters={<MonthFilter value={month} onChange={setMonth} />}
      notices={
        <>
          {view.error && <Notice>{view.error}</Notice>}
          {v?.dvx
            .filter((d) => d.covered && d.difference !== '0.00')
            .map((d) => (
              <Notice key={d.direction} kind="warning">
                {d.direction === 'sale' ? 'Göndərilən' : 'Alınan'} e-qaimələr: ƏDV DVX-də{' '}
                {money(d.dvxVat)}, uçotda {money(d.bookedVat)} — fərq {money(d.difference)}.
              </Notice>
            ))}
          {out.notice}
        </>
      }
    >
      {!valid ? (
        <Empty title="Ayı seçin" />
      ) : !v ? (
        <div className="loading">Yüklənir…</div>
      ) : (
        <>
          <div className="table-scroll">{table}</div>
          <p className="doc-hint">
            DVX ↔ uçot:{' '}
            {v.dvx
              .map(
                (d) =>
                  `${d.direction === 'sale' ? 'satış' : 'alış'} — ${
                    d.covered
                      ? `DVX ${money(d.dvxVat)}, uçot ${money(d.bookedVat)}`
                      : 'bu ay üçün DVX faylı yüklənməyib'
                  }`,
              )
              .join('; ')}
            .
          </p>
        </>
      )}
      {out.sheet}
    </ModuleFrame>
  );
}

// ---------------------------------------------------------------------------------------------

/** The report of a tile, opened for the dashboard's month (M/Z: the year of it). */
const tileView = (key: DashboardTile['key'], month: string): View => {
  const period = monthOf(`${month}-01`);
  switch (key) {
    case 'income':
    case 'profit':
      return { type: 'page', page: 'profitLoss', period };
    case 'money':
      return { type: 'page', page: 'cashFlow', period };
    case 'receivables':
      return { type: 'accountCard', account: '211', ...period };
    case 'payables':
      return { type: 'accountCard', account: '531', ...period };
    case 'vat':
      return { type: 'page', page: 'vatSummary', period };
  }
};

/**
 * A Y scale of 3–4 even steps (1, 2, 2,5 or 5 × 10ⁿ) that holds every figure and zero; with no
 * figures, only the zero line.
 */
function chartScale(min: number, max: number): { min: number; max: number; ticks: number[] } {
  if (min === max) return { min: 0, max: 1, ticks: [0] };
  const range = max - min;
  let unit = 10 ** Math.floor(Math.log10(range / 4));
  for (;;) {
    for (const m of [1, 2, 2.5, 5]) {
      const s = m * unit;
      const lo = Math.floor(min / s);
      const hi = Math.ceil(max / s);
      if (hi - lo <= 4) {
        const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => (lo + i) * s);
        return { min: lo * s, max: hi * s, ticks: ticks.map((t) => (Object.is(t, -0) ? 0 : t)) };
      }
    }
    unit *= 10;
  }
}
/** A figure of the scale: whole manats with group spaces and a real minus, "−1 500". */
function tickLabel(v: number): string {
  return money(v.toFixed(2)).replace(/,00$/, '');
}

/**
 * 12 months: income and expense bars, profit as a line, on one scale. Drawn at the width it
 * really has (not stretched), so month names keep the size of the text around them.
 */
function Chart({ series }: { series: DashboardView['series'] }) {
  const figure = useRef<HTMLElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = figure.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry?.contentRect.width ?? 0);
      if (width > 0) setW(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const n = (s: string) => Number(s);
  const values = series.flatMap((s) => [s.income, s.expense, s.profit].map(n));
  const scale = chartScale(Math.min(0, ...values), Math.max(0, ...values));
  const labels = scale.ticks.map(tickLabel);
  // The figures of the scale on the left, the months under the plot.
  const left = 8 + 7 * Math.max(...labels.map((l) => l.length));
  const h = Math.round(Math.min(240, Math.max(160, w * 0.18)));
  const step = (w - left) / series.length;
  const pad = 8;
  const y = (v: number) => pad + ((scale.max - v) / (scale.max - scale.min)) * (h - 2 * pad);
  const x = (i: number) => left + i * step;
  // A bar grows from the zero line: up for a positive figure, down for a negative one (returns).
  const bar = (v: number) => ({ y: Math.min(y(v), y(0)), height: Math.abs(y(0) - y(v)) });
  const profit = series.map((s, i) => `${x(i) + step / 2},${y(n(s.profit))}`).join(' ');
  return (
    <figure className="dashboard-chart" ref={figure}>
      <svg
        width={w}
        height={h + 24}
        viewBox={`0 0 ${w} ${h + 24}`}
        role="img"
        aria-label="12 ayın gəlir, xərc və mənfəəti"
      >
        {scale.ticks.map((t, i) => (
          <g key={t}>
            <line x1={left} x2={w} y1={y(t)} y2={y(t)} className={t === 0 ? 'zero' : 'grid'} />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" className="tick">
              {labels[i]}
            </text>
          </g>
        ))}
        {series.map((s, i) => (
          <g key={s.month}>
            <rect
              className="bar income"
              x={x(i) + step * 0.15}
              width={step * 0.33}
              {...bar(n(s.income))}
            >
              <title>{`${monthLabel(s.month)}: gəlir ${money(s.income)}`}</title>
            </rect>
            <rect
              className="bar expense"
              x={x(i) + step * 0.52}
              width={step * 0.33}
              {...bar(n(s.expense))}
            >
              <title>{`${monthLabel(s.month)}: xərc ${money(s.expense)}`}</title>
            </rect>
            <text x={x(i) + step / 2} y={h + 17} textAnchor="middle">
              {monthLabel(s.month)}
            </text>
          </g>
        ))}
        <polyline points={profit} className="profit" />
      </svg>
      <figcaption>
        <span className="key income">Gəlir</span> <span className="key expense">Xərc</span>{' '}
        <span className="key profit">Mənfəət</span>
      </figcaption>
    </figure>
  );
}

export function DashboardPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const [month, setMonth] = useState(ws.period.from.slice(0, 7));
  const valid = /^\d{4}-\d{2}$/.test(month);
  const view = useQuery<DashboardView>(
    valid ? { type: 'dashboard', companyId: win.companyId, month } : null,
  );
  const v = view.data && view.data.month === month ? view.data : undefined;
  return (
    <ModuleFrame
      title={pages.dashboard.title}
      hint={v ? `${month} · ${v.ms} ms · rəqəmə klik — hesabat` : pages.dashboard.hint}
      onRefresh={view.reload}
      filters={<MonthFilter value={month} onChange={setMonth} />}
      notices={view.error && <Notice>{view.error}</Notice>}
    >
      {!valid ? (
        <Empty title="Ayı seçin" />
      ) : !v ? (
        <div className="loading">Yüklənir…</div>
      ) : (
        <>
          <ul className="dashboard-tiles">
            {v.tiles.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  className="dashboard-tile"
                  title={t.hint}
                  onClick={() => ws.open(tileView(t.key, month), win.companyId)}
                >
                  <span>{t.label}</span>
                  <strong>{money(t.value)}</strong>
                  <small>{t.hint}</small>
                </button>
              </li>
            ))}
          </ul>
          <Chart series={v.series} />
          <div className="table-scroll">
            <table className="grid report" aria-label="12 ayın dinamikası">
              <thead>
                <tr>
                  <th scope="col">Ay</th>
                  <th scope="col" className="num">
                    Gəlir
                  </th>
                  <th scope="col" className="num">
                    Xərc
                  </th>
                  <th scope="col" className="num">
                    Mənfəət
                  </th>
                  <th scope="col" className="num">
                    Pul, ay sonu
                  </th>
                </tr>
              </thead>
              <tbody>
                {v.series.map((s) => (
                  <tr key={s.month}>
                    <th scope="row">{monthLabel(s.month)}</th>
                    <td className="num">{cell(s.income)}</td>
                    <td className="num">{cell(s.expense)}</td>
                    <td className="num">
                      <Amount value={s.profit} />
                    </td>
                    <td className="num">{money(s.money)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ModuleFrame>
  );
}
