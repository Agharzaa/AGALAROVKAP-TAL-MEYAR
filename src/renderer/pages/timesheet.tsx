/**
 * Stage 8d — the timesheet (plan §13): the list of months and the month's grid, employee × day.
 * A cell takes hours ("8", "7,5"), or a code — E (a business trip), M (vacation), Ö (unpaid), X
 * (sick), Q (absent without a reason), B (a day off). "Doldur" fills it from the calendar, the
 * employment and the vacation / sick leave documents; the arrows and Enter move between cells.
 * The payroll of the month pays by it.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Ban, Check, FileDown, Plus, UserRound } from '../icons';
import type {
  TimesheetDay,
  TimesheetDetail,
  TimesheetFill,
  TimesheetView,
} from '../../contracts/queries';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { monthTitle, today } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages, viewTitle } from '../pages';
import { usePrint } from '../print';
import {
  Confirm,
  DataTable,
  Empty,
  Field,
  MonthInput,
  Notice,
  PostingRule,
  Status,
  type Column,
} from '../ui';
import { useWindow, useWorkspace } from '../workspace';
import { workbook } from '../xlsx';

const weekday = ['B', 'B.e', 'Ç.a', 'Ç', 'C.a', 'C', 'Ş'];
const previousMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

export function TimesheetsPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const page = pages.timesheets;
  const result = useQuery<TimesheetView[]>({ type: 'timesheets', companyId: win.companyId });
  const rows = result.data ?? [];
  const open = (id?: string) =>
    ws.open({ type: 'timesheet', ...(id ? { id } : {}) }, win.companyId);
  const columns: Column<TimesheetView>[] = [
    { key: 'month', label: 'Ay', render: (d) => monthTitle(d.month) },
    {
      key: 'number',
      label: 'Nömrə',
      render: (d) => (
        <button type="button" className="link" onClick={() => open(d.id)}>
          {d.number}
        </button>
      ),
    },
    { key: 'rows', label: 'İşçi', align: 'end', render: (d) => String(d.rows.length) },
    {
      key: 'stale',
      label: 'Sənədlərlə',
      render: (d) => (d.stale.length ? `uyğun deyil: ${d.stale.join(', ')}` : 'uyğundur'),
    },
    { key: 'status', label: 'Vəziyyət', render: (d) => <Status status={d.status} /> },
  ];
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      count={rows.length}
      onRefresh={result.reload}
      actions={
        <button type="button" className="button primary" onClick={() => open()}>
          <Plus size={15} /> Tabel
        </button>
      }
      notices={result.error && <Notice>{result.error}</Notice>}
    >
      <DataTable
        label={page.title}
        rows={rows}
        columns={columns}
        rowKey={(d) => d.id}
        onOpen={(d) => open(d.id)}
        rowClass={(d) => (d.status === 'cancelled' ? 'cancelled' : '')}
        empty={<Empty title="Hələ tabel yoxdur" />}
      />
    </ModuleFrame>
  );
}

interface RowForm {
  employeeId: string;
  name: string;
  cells: string[];
  overtime: string;
  night: string;
}

/** Hours of a cell for the live totals (the ledger checks the text). */
function cellHours(text: string): { code: string; h: number } {
  const t = text.trim().toUpperCase().replace('İ', 'I');
  const m = /^(?:I|E)?(\d{1,2}(?:[.,]\d{1,2})?)$/.exec(t);
  if (m) return { code: t.startsWith('E') ? 'E' : 'İ', h: Number(m[1]!.replace(',', '.')) };
  if (t === 'E') return { code: 'E', h: 8 };
  return { code: t, h: 0 };
}
const fmt = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '').replace('.', ',');

function rowTotals(r: RowForm, days: TimesheetDay[]) {
  let worked = 0;
  let over = 0;
  let off = 0;
  let count = 0;
  const codes: Record<string, number> = {};
  r.cells.forEach((c, i) => {
    const d = days[i];
    if (!d) return;
    const x = cellHours(c);
    if (x.code === 'İ' || x.code === 'E') {
      if (x.h > 0) count++;
      if (d.workday) {
        worked += Math.min(x.h, d.norm);
        over += Math.max(0, x.h - d.norm);
      } else off += x.h;
    } else if (x.code) codes[x.code] = (codes[x.code] ?? 0) + 1;
  });
  return { worked, over, off, count, codes };
}

export function TimesheetEditor({ id }: { id?: string }) {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog, company } = useCatalog(win.companyId);
  const detail = useQuery<TimesheetDetail>(
    id ? { type: 'timesheet', companyId: win.companyId, id } : null,
  );
  const doc = detail.data;
  const [month, setMonth] = useState(previousMonth(today().slice(0, 7)));
  const [days, setDays] = useState<TimesheetDay[]>([]);
  const [rows, setRows] = useState<RowForm[] | null>(null);
  const m = useMutation();
  const [message, setMessage] = useState('');
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const grid = useRef<HTMLTableElement>(null);
  const printer = usePrint();

  async function fill(ym: string, keepExtra = true) {
    try {
      const f = await api.query<TimesheetFill>({
        type: 'timesheetFill',
        companyId: win.companyId,
        month: ym,
      });
      setDays(f.days);
      setRows(
        f.rows.map((r) => {
          const old = keepExtra ? rows?.find((x) => x.employeeId === r.employeeId) : undefined;
          return { ...r, overtime: old?.overtime ?? '', night: old?.night ?? '' };
        }),
      );
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    if (rows) return;
    if (id && !doc) return;
    if (doc) {
      setMonth(doc.month);
      setDays(doc.days);
      setRows(
        doc.rows.map((r) => ({
          employeeId: r.employeeId,
          name: r.name,
          cells: r.cells,
          overtime: r.overtime === '0' ? '' : r.overtime,
          night: r.night === '0' ? '' : r.night,
        })),
      );
    } else void fill(month, false);
  }, [doc, rows, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (doc) ws.setLabel(win.id, doc.number);
  }, [doc?.number]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!catalog || !rows)
    return (
      <ModuleFrame title={viewTitle(win.view, win.label)}>
        <div className="loading">{detail.error || 'Yüklənir…'}</div>
      </ModuleFrame>
    );
  const locked = doc?.status === 'cancelled';
  const setCell = (i: number, j: number, v: string) =>
    setRows(
      rows.map((r, k) => (k === i ? { ...r, cells: r.cells.map((c, n) => (n === j ? v : c)) } : r)),
    );
  const setRow = (i: number, patch: Partial<RowForm>) =>
    setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const move = (e: KeyboardEvent<HTMLInputElement>, i: number, j: number) => {
    const d = {
      ArrowRight: [0, 1],
      Enter: [0, 1],
      ArrowLeft: [0, -1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    }[e.key];
    if (!d) return;
    const target = grid.current?.querySelector<HTMLInputElement>(
      `input[data-cell="${i + d[0]!}-${j + d[1]!}"]`,
    );
    if (target) {
      e.preventDefault();
      target.focus();
      target.select();
    }
  };
  async function save() {
    if (!rows || locked || m.busy) return;
    setMessage('');
    const r = await m.run({
      type: 'timesheet.save',
      companyId: win.companyId,
      month,
      number: doc?.number ?? '',
      memo: doc?.memo ?? '',
      rows: rows.map((x) => ({
        employeeId: x.employeeId,
        cells: x.cells,
        overtime: x.overtime,
        night: x.night,
      })),
      ...(id && doc ? { id, version: doc.version } : {}),
    });
    if (!r) return;
    setMessage(id ? 'Tabel saxlanıldı.' : `Tabel ${r.number} saxlanıldı.`);
    if (!id) ws.retarget(win.id, { type: 'timesheet', id: r.id });
    else {
      setRows(null);
      detail.reload();
    }
  }
  const norm = days.reduce((s, d) => s + d.norm, 0);
  const head = (
    <thead>
      <tr>
        <th scope="col" className="ts-name">
          İşçi
        </th>
        {days.map((d) => (
          <th
            key={d.date}
            scope="col"
            className={`ts-day${d.workday ? '' : ' off'}${d.holiday ? ' holiday' : ''}`}
            title={d.name || undefined}
          >
            {Number(d.date.slice(8))}
            <small>{weekday[new Date(`${d.date}T00:00:00Z`).getUTCDay()]}</small>
          </th>
        ))}
        <th scope="col" className="num">
          Gün
        </th>
        <th scope="col" className="num" title={`Norma ${norm} saat`}>
          Saat
        </th>
        <th scope="col" className="num" title="İstirahət / bayram günü işlənən saatlar">
          Bayram
        </th>
        <th
          scope="col"
          className="num"
          title="Normadan artıq (günün normasından artıq saatlar özü əlavə olunur)"
        >
          Artıq
        </th>
        <th scope="col" className="num">
          Gecə
        </th>
        <th scope="col" title="M — məzuniyyət, X — xəstəlik, Ö — ödənişsiz, Q — üzrsüz">
          Yox
        </th>
      </tr>
    </thead>
  );
  const exportSheet = async () => {
    try {
      const spec = {
        name: `Tabel ${month}`,
        title: [
          `İş vaxtının uçotu tabeli · ${monthTitle(month)}`,
          `${company?.name ?? ''} · norma ${norm} saat`,
        ],
        header: [
          'İşçi',
          ...days.map((d) => String(Number(d.date.slice(8)))),
          'Gün',
          'Saat',
          'Bayram',
          'Artıq',
          'Gecə',
        ],
        rows: rows.map((r) => {
          const t = rowTotals(r, days);
          return [
            r.name,
            ...r.cells,
            t.count,
            t.worked,
            t.off,
            t.over + (Number(r.overtime.replace(',', '.')) || 0),
            r.night,
          ];
        }),
        widths: [28, ...days.map(() => 4), 6, 7, 7, 7, 7],
      };
      const saved = await api.saveFile(`Tabel ${month}.xlsx`, workbook(spec));
      if (saved) setMessage(`Saxlanıldı: ${saved}`);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <ModuleFrame
      title={viewTitle(win.view, win.label)}
      hint={`${monthTitle(month)} · norma ${norm} saat, ${days.filter((d) => d.workday).length} iş günü`}
      status={doc ? doc.status : 'draft'}
      actions={
        <>
          {!locked && (
            <button
              type="button"
              className="button primary"
              disabled={m.busy}
              onClick={() => void save()}
            >
              <Check size={15} /> {m.busy ? 'Saxlanılır…' : 'Saxla'}
            </button>
          )}
          {!locked && (
            <button type="button" className="button secondary" onClick={() => void fill(month)}>
              <UserRound size={15} /> Doldur
            </button>
          )}
          <button type="button" className="button secondary" onClick={() => void exportSheet()}>
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
                  <h1>İş vaxtının uçotu tabeli · {monthTitle(month)}</h1>
                  <table className="grid timesheet-grid print">
                    {head}
                    <tbody>
                      {rows.map((r) => {
                        const t = rowTotals(r, days);
                        return (
                          <tr key={r.employeeId}>
                            <th scope="row">{r.name}</th>
                            {r.cells.map((c, j) => (
                              <td key={j}>{c}</td>
                            ))}
                            <td>{t.count}</td>
                            <td>{fmt(t.worked)}</td>
                            <td>{fmt(t.off)}</td>
                            <td>{fmt(t.over + (Number(r.overtime.replace(',', '.')) || 0))}</td>
                            <td>{r.night}</td>
                            <td />
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>,
              )
            }
          >
            Çap et
          </button>
          {doc && doc.status === 'posted' && (
            <button
              type="button"
              className="button secondary push-right"
              onClick={() => (setReason(''), setCancel(true))}
            >
              <Ban size={15} /> Ləğv et
            </button>
          )}
        </>
      }
      notices={
        <>
          {m.error && <Notice onClose={m.clear}>{m.error.message}</Notice>}
          {message && (
            <Notice kind="success" onClose={() => setMessage('')}>
              {message}
            </Notice>
          )}
          {doc && doc.stale.length > 0 && (
            <Notice kind="warning">
              Məzuniyyət / xəstəlik sənədlərinə uyğun deyil: {doc.stale.join(', ')}. "Doldur" və
              saxlayın — o vaxtadək ay bağlanmır.
            </Notice>
          )}
        </>
      }
    >
      <div className="doc-header">
        <Field label="Ay">
          <MonthInput
            value={month}
            onChange={(ym) => {
              if (id) return;
              setMonth(ym);
              void fill(ym, false);
            }}
            aria-label="Ay"
          />
        </Field>
      </div>
      <div className="table-scroll">
        <table className="grid timesheet-grid" aria-label="Tabel" ref={grid}>
          {head}
          <tbody>
            {rows.map((r, i) => {
              const t = rowTotals(r, days);
              const absent = Object.entries(t.codes)
                .filter(([c]) => c !== 'B')
                .map(([c, n]) => `${c}${n}`)
                .join(' ');
              return (
                <tr key={r.employeeId}>
                  <th scope="row" className="ts-name">
                    {r.name}
                  </th>
                  {r.cells.map((c, j) => (
                    <td
                      key={j}
                      className={`ts-cell${days[j]?.workday ? '' : ' off'}${/^[MXÖQ]$/i.test(c) ? ` code-${c.toUpperCase()}` : ''}`}
                    >
                      <input
                        aria-label={`${r.name}, ${j + 1}`}
                        data-cell={`${i}-${j}`}
                        value={c}
                        disabled={locked}
                        maxLength={6}
                        onKeyDown={(e) => move(e, i, j)}
                        onChange={(e) => setCell(i, j, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="num" aria-label={`${r.name}: gün`}>
                    {t.count}
                  </td>
                  <td className="num" aria-label={`${r.name}: saat`}>
                    {fmt(t.worked)}
                  </td>
                  <td className="num">{fmt(t.off)}</td>
                  <td>
                    <input
                      className="num ts-extra"
                      aria-label={`${r.name}: artıq iş saatı`}
                      placeholder={t.over ? `+${fmt(t.over)}` : ''}
                      value={r.overtime}
                      disabled={locked}
                      onChange={(e) => setRow(i, { overtime: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="num ts-extra"
                      aria-label={`${r.name}: gecə saatı`}
                      value={r.night}
                      disabled={locked}
                      onChange={(e) => setRow(i, { night: e.target.value })}
                    />
                  </td>
                  <td className="muted">{absent}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <Empty title="Bu ay işləyən işçi yoxdur" />}
      <PostingRule>
        Xana: saat (8, 7,5) — iş; E — ezamiyyət (E8); M — məzuniyyət; Ö — ödənişsiz; X — xəstəlik; Q
        — üzrsüz gəlməmə; B — istirahət. Günün normasından artıq saatlar və "Artıq" sütunu — artıq
        iş (× 2), istirahət / bayram günü saatları — × 2, gecə saatları — + 40% (Dərəcələr). Əmək
        haqqı bu tabeldən: maaş × işlənmiş norma saatları / ayın norması ({norm} saat).
      </PostingRule>
      {printer.sheet}
      {cancel && doc && (
        <Confirm
          title={`Tabeli ləğv et · ${doc.number}`}
          confirmLabel="Ləğv et"
          destructive
          onCancel={() => setCancel(false)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'timesheet.cancel',
              companyId: win.companyId,
              id: doc.id,
              version: doc.version,
              reason,
            });
            if (r) {
              setCancel(false);
              setMessage('Tabel ləğv edildi.');
              setRows(null);
              detail.reload();
            }
          }}
        >
          <Field label="Səbəb">
            <input
              autoFocus
              required
              maxLength={240}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {m.error && <Notice>{m.error.message}</Notice>}
        </Confirm>
      )}
    </ModuleFrame>
  );
}
