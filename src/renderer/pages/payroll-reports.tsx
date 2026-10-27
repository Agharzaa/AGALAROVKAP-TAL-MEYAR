/**
 * Stage 8b — payroll reports (plan §12): the employee's payslip, settlements with employees (533)
 * and the month's taxes and funds. Each is exported to Excel and printed.
 */
import { useState } from 'react';
import type { PayrollSettlementRow, PayrollTaxesView, PayslipView } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { MonthFilter, RangeFields, useRange } from '../filters';
import { day, money, monthTitle, today } from '../format';
import { useQuery } from '../hooks';
import { pages } from '../pages';
import { Picker } from '../picker';
import { Amount, Empty, Notice } from '../ui';
import { useWindow } from '../workspace';
import { useOutput } from './reports';

const lastMonth = () => {
  const [y, m] = today().slice(0, 7).split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

function SlipTable({ s }: { s: PayslipView }) {
  const sum = (rows: { amount: string }[]) =>
    rows.reduce((t, r) => t + Math.round(Number(r.amount) * 100), 0) / 100;
  return (
    <table className="grid report payslip" aria-label="Hesablaşma vərəqəsi">
      <tbody>
        <tr className="total">
          <th scope="row">Ayın əvvəlinə borc (+ işçiyə, − işçidən)</th>
          <td className="num">
            <Amount value={s.opening} />
          </td>
        </tr>
        <tr>
          <th scope="rowgroup" colSpan={2}>
            Hesablanıb
          </th>
        </tr>
        {s.accrued.map((r) => (
          <tr key={r.label} className="child">
            <th scope="row" className="indent">
              {r.label}
            </th>
            <td className="num">{money(r.amount)}</td>
          </tr>
        ))}
        <tr>
          <th scope="rowgroup" colSpan={2}>
            Tutulub
          </th>
        </tr>
        {s.withheld.map((r) => (
          <tr key={r.label} className="child">
            <th scope="row" className="indent">
              {r.label}
            </th>
            <td className="num">{money(r.amount)}</td>
          </tr>
        ))}
        <tr>
          <th scope="rowgroup" colSpan={2}>
            Ödənilib
          </th>
        </tr>
        {s.paid.map((r, i) => (
          <tr key={i} className="child">
            <th scope="row" className="indent">
              {day(r.date)} · {r.number}
            </th>
            <td className="num">{money(r.amount)}</td>
          </tr>
        ))}
        <tr className="total">
          <th scope="row">Ayın sonuna borc</th>
          <td className="num" aria-label="Ayın sonuna borc">
            <Amount value={s.closing} strong />
          </td>
        </tr>
        <tr className="muted">
          <th scope="row">Cəmi: hesablanıb / tutulub / ödənilib</th>
          <td className="num">
            {money(sum(s.accrued).toFixed(2))} / {money(sum(s.withheld).toFixed(2))} /{' '}
            {money(sum(s.paid).toFixed(2))}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function PayslipPage() {
  const win = useWindow();
  const { catalog } = useCatalog(win.companyId);
  const [month, setMonth] = useState(lastMonth());
  const [employeeId, setEmployeeId] = useState('');
  const one = useQuery<PayslipView>(
    employeeId ? { type: 'payslip', companyId: win.companyId, employeeId, month } : null,
  );
  const employees = (catalog?.employees ?? []).filter((e) => !e.archived);
  const s = one.data;
  const out = useOutput(
    `Hesablaşma vərəqəsi ${month}${s ? ` ${s.name}` : ''}`,
    () => ({
      name: 'Vərəqə',
      title: ['Hesablaşma vərəqəsi', `${s!.name} · ${monthTitle(month)}`],
      header: ['', 'Məbləğ'],
      rows: [
        ['Ayın əvvəlinə borc', { money: s!.opening }],
        ...s!.accrued.map((r) => [`Hesablanıb: ${r.label}`, { money: r.amount }]),
        ...s!.withheld.map((r) => [`Tutulub: ${r.label}`, { money: r.amount }]),
        ...s!.paid.map((r) => [`Ödənilib: ${day(r.date)} ${r.number}`, { money: r.amount }]),
        ['Ayın sonuna borc', { money: s!.closing }],
      ],
      widths: [50, 16],
    }),
    () => (
      <>
        <h1>Hesablaşma vərəqəsi · {monthTitle(month)}</h1>
        <p>
          {s!.name}
          {s!.tabNo ? ` · tabel № ${s!.tabNo}` : ''}
          {s!.position ? ` · ${s!.position}` : ''}
        </p>
        <SlipTable s={s!} />
      </>
    ),
  );
  return (
    <ModuleFrame
      title={pages.payslip.title}
      hint={pages.payslip.hint}
      onRefresh={one.reload}
      actions={s && out.buttons}
      filters={
        <>
          <MonthFilter value={month} onChange={setMonth} />
          <div className="filter-text">
            <span aria-hidden="true">İşçi</span>
            <Picker
              ariaLabel="İşçi"
              value={employeeId}
              options={employees.map((e) => ({ value: e.id, label: e.name }))}
              onChange={setEmployeeId}
            />
          </div>
        </>
      }
      notices={
        <>
          {one.error && <Notice>{one.error}</Notice>}
          {out.notice}
        </>
      }
    >
      {!employeeId ? (
        <Empty title="İşçini seçin" />
      ) : !s ? (
        <div className="loading">Yüklənir…</div>
      ) : (
        <div className="table-scroll">
          <h2 className="report-title">
            {s.name} · {monthTitle(month)}
          </h2>
          <SlipTable s={s} />
        </div>
      )}
      {out.sheet}
    </ModuleFrame>
  );
}

export function PayrollSettlementsPage() {
  const win = useWindow();
  const range = useRange();
  const result = useQuery<PayrollSettlementRow[]>({
    type: 'payrollSettlements',
    companyId: win.companyId,
    from: range.applied.from,
    to: range.applied.to,
  });
  const rows = result.data ?? [];
  const head = ['İşçi', 'Əvvəl', 'Hesablanıb', 'Tutulub', 'Ödənilib', 'Son'];
  const keys = ['opening', 'accrued', 'withheld', 'paid', 'closing'] as const;
  const table = (
    <table className="grid report">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} scope="col" className={i ? 'num' : undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.employeeId}>
            <th scope="row">{r.name}</th>
            {keys.map((k) => (
              <td key={k} className="num">
                <Amount value={r[k]} strong={k === 'closing'} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  const out = useOutput(
    `İşçilərlə hesablaşmalar ${range.applied.from} ${range.applied.to}`,
    () => ({
      name: '533',
      title: [
        'İşçilərlə hesablaşmalar (533)',
        `${day(range.applied.from)} – ${day(range.applied.to)}`,
      ],
      header: head,
      rows: rows.map((r) => [r.name, ...keys.map((k) => ({ money: r[k] }))]),
      widths: [36, 14, 14, 14, 14, 14],
    }),
    () => (
      <>
        <h1>
          İşçilərlə hesablaşmalar · {day(range.applied.from)} – {day(range.applied.to)}
        </h1>
        {table}
      </>
    ),
  );
  return (
    <ModuleFrame
      title={pages.payrollSettlements.title}
      hint={pages.payrollSettlements.hint}
      count={rows.length}
      onRefresh={result.reload}
      actions={rows.length > 0 && out.buttons}
      filters={<RangeFields range={range} />}
      notices={
        <>
          {(result.error || range.error) && <Notice>{result.error || range.error}</Notice>}
          {out.notice}
        </>
      }
    >
      {rows.length ? (
        <div className="table-scroll">{table}</div>
      ) : (
        <Empty title="Bu dövrdə işçilərlə hesablaşma yoxdur" />
      )}
      {out.sheet}
    </ModuleFrame>
  );
}

export function PayrollTaxesPage() {
  const win = useWindow();
  const [month, setMonth] = useState(lastMonth());
  const result = useQuery<PayrollTaxesView>({
    type: 'payrollTaxes',
    companyId: win.companyId,
    month,
  });
  const v = result.data;
  const head = [
    'Hesab',
    'Vergi / fond',
    'Ayın əvvəlinə borc',
    'Hesablanıb',
    'Köçürülüb',
    'Ayın sonuna borc',
  ];
  const table = v && (
    <table className="grid report">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} scope="col" className={i > 1 ? 'num' : undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {v.rows.map((r) => (
          <tr key={r.account}>
            <td>{r.account}</td>
            <th scope="row">{r.label}</th>
            <td className="num">
              <Amount value={r.opening} />
            </td>
            <td className="num">
              <Amount value={r.accrued} />
            </td>
            <td className="num">
              <Amount value={r.paid} />
            </td>
            <td className="num">
              <Amount value={r.closing} strong />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const out = useOutput(
    `Vergi və fondlar ${month}`,
    () => ({
      name: 'Vergi və fondlar',
      title: [
        'Əmək haqqı üzrə vergi və fondlar',
        `${monthTitle(month)} · işçi: ${v!.employees} · baza: ${money(v!.base)}`,
      ],
      header: head,
      rows: v!.rows.map((r) => [
        r.account,
        r.label,
        { money: r.opening },
        { money: r.accrued },
        { money: r.paid },
        { money: r.closing },
      ]),
      widths: [10, 34, 16, 14, 14, 16],
    }),
    () => (
      <>
        <h1>Əmək haqqı üzrə vergi və fondlar · {monthTitle(month)}</h1>
        {table}
      </>
    ),
  );
  return (
    <ModuleFrame
      title={pages.payrollTaxes.title}
      hint={
        v
          ? `${monthTitle(month)} · ${v.employees} işçi · hesablanan əmək haqqı ${money(v.base)} ₼`
          : pages.payrollTaxes.hint
      }
      onRefresh={result.reload}
      actions={v && out.buttons}
      filters={<MonthFilter value={month} onChange={setMonth} />}
      notices={
        <>
          {result.error && <Notice>{result.error}</Notice>}
          {out.notice}
        </>
      }
    >
      {v ? <div className="table-scroll">{table}</div> : <div className="loading">Yüklənir…</div>}
      {out.sheet}
    </ModuleFrame>
  );
}
