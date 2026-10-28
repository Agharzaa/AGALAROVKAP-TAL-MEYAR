/**
 * Stage 9 — the figures of the tax returns (docs/MERHELE-9-VERGI-BEYANNAMELERI.md §6). One page for
 * all of them: the period (a month, a quarter or a year), the checks on top, the sections with the
 * source of every figure, the lists behind them; Excel and print. A row with an account opens its
 * card for the period.
 */
import { useState } from 'react';
import type { DeclarationKind, DeclarationView, TaxYearView } from '../../contracts/queries';
import { ModuleFrame } from '../frame';
import { MonthFilter } from '../filters';
import { money } from '../format';
import { useMutation, useQuery } from '../hooks';
import { Plus } from '../icons';
import { pages } from '../pages';
import { Amount, Empty, Field, Modal, Notice } from '../ui';
import { usePeriod, useWindow, useWorkspace, type Page } from '../workspace';
import type { Cell } from '../xlsx';
import { useOutput } from './reports';

const pageOf: Record<DeclarationKind, Page> = {
  vat: 'vatReturn',
  payroll: 'payrollReturn',
  taxDepreciation: 'taxDepreciation',
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
  const [editing, setEditing] = useState(false);
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
      actions={
        v && (
          <>
            {v.params && (
              <button type="button" className="button secondary" onClick={() => setEditing(true)}>
                Parametrlər
              </button>
            )}
            {out.buttons}
          </>
        )
      }
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
      {editing && v?.params && (
        <TaxYearDialog
          params={v.params}
          onClose={() => {
            setEditing(false);
            view.reload();
          }}
        />
      )}
    </ModuleFrame>
  );
}

/** The year's tax parameters (9c / 9d): VM 114 rates, the coefficient, the profit tax. */
function TaxYearDialog({ params, onClose }: { params: TaxYearView; onClose: () => void }) {
  const win = useWindow();
  const m = useMutation();
  const [p, setP] = useState(params);
  const locked = params.locked;
  const save = async () => {
    const done = await m.run({
      type: 'taxYear.save',
      companyId: win.companyId,
      year: p.year,
      rates: Object.fromEntries(p.rates.map((r) => [r.category, r.rate])),
      coefficient: p.coefficient,
      writeOff: p.writeOff,
      profitRate: p.profitRate,
      losses: p.losses,
      adjustments: p.adjustments,
    });
    if (done) onClose();
  };
  const setAdjustment = (i: number, patch: object) =>
    setP({ ...p, adjustments: p.adjustments.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  return (
    <Modal
      title={`Vergi parametrləri · ${p.year}`}
      subtitle={locked ? 'İl bağlanıb — parametrlər dəyişdirilmir' : 'Mühasib təsdiq edir'}
      onClose={onClose}
    >
      <form className="dialog-form" noValidate onSubmit={(e) => (e.preventDefault(), void save())}>
        <fieldset className="form-grid" disabled={locked || m.busy}>
          {p.rates.map((r, i) => (
            <Field key={r.category} label={r.label} hint={`VM 114.3: ${r.max}%-dək`}>
              <input
                aria-label={`Norma: ${r.label}`}
                inputMode="decimal"
                value={r.rate}
                onChange={(e) =>
                  setP({
                    ...p,
                    rates: p.rates.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)),
                  })
                }
              />
            </Field>
          ))}
          <Field label="Əmsal" hint="Kiçik sahibkar 1,5, mikro 2 (VM 114.3-1, 114.3-2)">
            <select
              aria-label="Əmsal"
              value={p.coefficient}
              onChange={(e) => setP({ ...p, coefficient: e.target.value })}
            >
              {['1', '1,5', '2'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kateqoriya silinir, qalıq azdırsa" hint="₼">
            <input
              aria-label="Silinmə həddi"
              inputMode="decimal"
              value={p.writeOff}
              onChange={(e) => setP({ ...p, writeOff: e.target.value })}
            />
          </Field>
          <Field label="Mənfəət vergisinin dərəcəsi" hint="%">
            <input
              aria-label="Mənfəət vergisinin dərəcəsi"
              inputMode="decimal"
              value={p.profitRate}
              onChange={(e) => setP({ ...p, profitRate: e.target.value })}
            />
          </Field>
          <Field label="Keçmiş illərin zərəri (Meyar-dan əvvəl)" hint="VM 121: 5 il">
            <input
              aria-label="Keçmiş illərin zərəri"
              inputMode="decimal"
              value={p.losses}
              onChange={(e) => setP({ ...p, losses: e.target.value })}
            />
          </Field>
        </fieldset>
        <fieldset className="lines" disabled={locked || m.busy}>
          <legend>Düzəlişlər (+ gəlir / gəlirdən çıxılmayan xərc, − çıxılan)</legend>
          {p.adjustments.map((a, i) => (
            <div key={i} className="inline-pair">
              <input
                aria-label={`Düzəliş ${i + 1}: ad`}
                value={a.label}
                onChange={(e) => setAdjustment(i, { label: e.target.value })}
              />
              <input
                aria-label={`Düzəliş ${i + 1}: məbləğ`}
                inputMode="decimal"
                value={a.amount}
                onChange={(e) => setAdjustment(i, { amount: e.target.value })}
              />
              <button
                type="button"
                className="button secondary small"
                onClick={() => setP({ ...p, adjustments: p.adjustments.filter((_, j) => j !== i) })}
              >
                Sil
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary small"
            onClick={() =>
              setP({ ...p, adjustments: [...p.adjustments, { label: '', amount: '' }] })
            }
          >
            <Plus size={13} /> Düzəliş
          </button>
        </fieldset>
        {m.error && <Notice>{m.error.message}</Notice>}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Ləğv et
          </button>
          {!locked && (
            <button type="submit" className="button primary" disabled={m.busy}>
              Saxla
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
