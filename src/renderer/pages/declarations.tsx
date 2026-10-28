/**
 * Stage 9 — the figures of the tax returns (docs/MERHELE-9-VERGI-BEYANNAMELERI.md §6). One page for
 * all of them: the period (a month, a quarter or a year), the checks on top, the sections with the
 * source of every figure, the lists behind them; Excel and print. A row with an account opens its
 * card for the period.
 */
import { useState } from 'react';
import type { DeclarationKind, DeclarationView } from '../../contracts/queries';
import { ModuleFrame } from '../frame';
import { MonthFilter } from '../filters';
import { money } from '../format';
import { useQuery } from '../hooks';
import { pages } from '../pages';
import { Amount, Empty, Notice } from '../ui';
import { usePeriod, useWindow, useWorkspace, type Page } from '../workspace';
import type { Cell } from '../xlsx';
import { useOutput } from './reports';

const pageOf: Record<DeclarationKind, Page> = {
  vat: 'vatReturn',
  payroll: 'payrollReturn',
  taxDepreciation: 'vatReturn',
  profitTax: 'vatReturn',
};
const unit: Record<DeclarationKind, 'month' | 'quarter' | 'year'> = {
  vat: 'month',
  payroll: 'quarter',
  taxDepreciation: 'year',
  profitTax: 'year',
};
const pattern = { month: /^\d{4}-\d{2}$/, quarter: /^\d{4}-Q[1-4]$/, year: /^\d{4}$/ };

function initial(kind: DeclarationKind, from: string): string {
  const u = unit[kind];
  if (u === 'month') return from.slice(0, 7);
  if (u === 'year') return from.slice(0, 4);
  return `${from.slice(0, 4)}-Q${Math.floor((Number(from.slice(5, 7)) - 1) / 3) + 1}`;
}

function PeriodFilter({
  kind,
  value,
  onChange,
}: {
  kind: DeclarationKind;
  value: string;
  onChange: (v: string) => void;
}) {
  const u = unit[kind];
  if (u === 'month') return <MonthFilter value={value} onChange={onChange} />;
  // A quarter is "2026-Q3"; the year may be half typed ("20-Q3"), the quarter is kept.
  const [year = '', quarter = 'Q1'] = value.split('-');
  return (
    <>
      <label className="filter-text">
        <span>İl</span>
        <input
          aria-label="İl"
          inputMode="numeric"
          maxLength={4}
          value={year}
          onChange={(e) => {
            const y = e.target.value.replace(/\D/g, '');
            onChange(u === 'year' ? y : `${y}-${quarter}`);
          }}
        />
      </label>
      {u === 'quarter' && (
        <label className="filter-text">
          <span>Rüb</span>
          <select
            aria-label="Rüb"
            value={quarter}
            onChange={(e) => onChange(`${year}-${e.target.value}`)}
          >
            {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
              <option key={q} value={q}>
                {q.slice(1)}-ci rüb
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

export function DeclarationPage({ kind }: { kind: DeclarationKind }) {
  const win = useWindow();
  const ws = useWorkspace();
  const [period, setPeriod] = useState(initial(kind, usePeriod().from));
  const valid = pattern[unit[kind]].test(period);
  const view = useQuery<DeclarationView>(
    valid ? { type: 'declaration', companyId: win.companyId, kind, period } : null,
  );
  const v =
    view.data && view.data.period === period && view.data.kind === kind ? view.data : undefined;
  const meta = pages[pageOf[kind]];
  const body = v && (
    <>
      {v.sections.map((s) => (
        <table key={s.title} className="grid report">
          <caption>{s.title}</caption>
          <thead>
            <tr>
              <th scope="col">Göstərici</th>
              {s.columns.map((c) => (
                <th key={c} scope="col" className="num">
                  {c}
                </th>
              ))}
              <th scope="col">Mənbə</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr
                key={r.key}
                className={r.total ? 'total' : r.level ? 'child' : undefined}
                onDoubleClick={() =>
                  r.account &&
                  ws.open(
                    { type: 'accountCard', account: r.account, from: v.from, to: v.to },
                    win.companyId,
                  )
                }
              >
                <th scope="row" className={r.level ? 'indent' : undefined}>
                  {r.label}
                </th>
                {r.values.map((x, i) => (
                  <td key={i} className="num">
                    {x === '' ? (
                      ''
                    ) : /^-?\d+\.\d{2}$/.test(x) ? (
                      <Amount value={x} strong={r.total} />
                    ) : (
                      x
                    )}
                  </td>
                ))}
                <td className="muted">{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {v.appendices.map((a) => (
        <table key={a.title} className="grid report">
          <caption>{a.title}</caption>
          <thead>
            <tr>
              {a.columns.map((c, i) => (
                <th key={c} scope="col" className={a.money[i] ? 'num' : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.rows.length ? (
              a.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((x, i) => (
                    <td key={i} className={a.money[i] ? 'num' : undefined}>
                      {a.money[i] && x ? money(x) : x}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={a.columns.length} className="muted">
                  Sənəd yoxdur
                </td>
              </tr>
            )}
          </tbody>
        </table>
      ))}
    </>
  );
  const out = useOutput(
    `${meta.title} ${period}`,
    () => {
      const rows: Cell[][] = [];
      const width = Math.max(
        ...v!.sections.map((s) => s.columns.length + 2),
        ...v!.appendices.map((a) => a.columns.length),
      );
      for (const s of v!.sections) {
        rows.push([s.title], ['Göstərici', ...s.columns, 'Mənbə']);
        for (const r of s.rows)
          rows.push([
            r.level ? `  ${r.label}` : r.label,
            ...r.values.map((x): Cell => (/^-?\d+\.\d{2}$/.test(x) ? { money: x } : x)),
            r.source,
          ]);
        rows.push([]);
      }
      for (const a of v!.appendices) {
        rows.push([a.title], a.columns);
        for (const r of a.rows)
          rows.push(r.map((x, i): Cell => (a.money[i] && x ? { money: x } : x)));
        rows.push([]);
      }
      return {
        name: meta.title.slice(0, 28),
        title: [v!.title, ...v!.checks.map((c) => `• ${c.text}`)],
        header: [],
        rows,
        widths: [46, ...Array.from({ length: width - 1 }, () => 18)],
      };
    },
    () => (
      <>
        <h1>{v!.title}</h1>
        {body}
      </>
    ),
  );
  return (
    <ModuleFrame
      title={meta.title}
      hint={v ? `${v.title} · ${v.ms} ms · sətrə iki dəfə klik — hesab kartı` : meta.hint}
      onRefresh={view.reload}
      actions={v && out.buttons}
      filters={<PeriodFilter kind={kind} value={period} onChange={setPeriod} />}
      notices={
        <>
          {view.error && <Notice>{view.error}</Notice>}
          {v?.checks.map((c, i) => (
            <Notice key={i} kind={c.kind === 'warning' ? 'warning' : 'info'}>
              {c.text}
            </Notice>
          ))}
          {out.notice}
        </>
      }
    >
      {!valid ? (
        <Empty title="Dövrü seçin" />
      ) : !v ? (
        <div className="loading">Yüklənir…</div>
      ) : (
        <div className="table-scroll declaration">{body}</div>
      )}
      {out.sheet}
    </ModuleFrame>
  );
}
