/**
 * Stage 8a — payroll (docs/MERHELE-8-EMEK-HAQQI.md §7): the month documents, the document with its
 * lines computed as they are typed (the same domain rules the ledger posts by) and the dated rates.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Ban, Check, CheckCheck, Pencil, Plus, Trash2, UserRound } from '../icons';
import { formatMinor, parseMoney } from '../../domain/money';
import {
  contributionKeys,
  contributionLabel,
  parseRates,
  payrollFor,
  rates2026,
  type PayrollAmounts,
  type RatesInput,
} from '../../domain/payroll';
import type {
  PayrollDocumentDetail,
  PayrollDocumentView,
  PayrollFillLine,
  PayrollRatesView,
} from '../../contracts/queries';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { day, money, monthTitle, today } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages, viewTitle } from '../pages';
import { Picker } from '../picker';
import { Postings } from '../postings';
import {
  Amount,
  Confirm,
  DataTable,
  DateInput,
  Empty,
  Field,
  Modal,
  MonthInput,
  Notice,
  PostingRule,
  Status,
  type Column,
} from '../ui';
import { useWindow, useWorkspace } from '../workspace';

const monthEndOf = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const previousMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------------------------
// List

export function PayrollDocumentsPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const page = pages.payrolls;
  const result = useQuery<PayrollDocumentView[]>({
    type: 'payrollDocuments',
    companyId: win.companyId,
  });
  const rows = result.data ?? [];
  const open = (id?: string) => ws.open({ type: 'payroll', ...(id ? { id } : {}) }, win.companyId);
  const columns: Column<PayrollDocumentView>[] = [
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
    { key: 'employees', label: 'İşçi', align: 'end', render: (d) => String(d.employees) },
    { key: 'gross', label: 'Hesablanıb', align: 'end', render: (d) => <Amount value={d.gross} /> },
    {
      key: 'net',
      label: 'Ödəniləcək',
      align: 'end',
      render: (d) => <Amount value={d.net} strong />,
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
          <Plus size={15} /> Əmək haqqını hesabla
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
        empty={<Empty title="Hələ əmək haqqı hesablanmayıb" />}
      />
    </ModuleFrame>
  );
}

// ---------------------------------------------------------------------------------------------
// Document

interface LineForm {
  employeeId: string;
  salary: string;
  bonus: string;
}
interface Form {
  month: string;
  number: string;
  memo: string;
  lines: LineForm[];
}
const blank = (): LineForm => ({ employeeId: '', salary: '', bonus: '' });
const toInput = (l: LineForm) => ({
  employeeId: l.employeeId,
  salary: l.salary.trim(),
  bonus: l.bonus.trim(),
});
const fromDetail = (d: PayrollDocumentDetail): Form => ({
  month: d.month,
  number: d.number,
  memo: d.memo,
  lines: d.lines.map((l) => ({
    employeeId: l.employeeId,
    salary: l.salary,
    bonus: l.bonus === '0.00' ? '' : l.bonus,
  })),
});
const fromFill = (lines: PayrollFillLine[]): LineForm[] =>
  lines.map((l) => ({ employeeId: l.employeeId, salary: l.salary, bonus: '' }));

/** The amounts of a line as the ledger will post them; null while the input is not a number. */
function compute(l: LineForm, rates: ReturnType<typeof parseRates> | null): PayrollAmounts | null {
  if (!rates) return null;
  try {
    return payrollFor(parseMoney(l.salary || '0') + parseMoney(l.bonus || '0'), rates);
  } catch {
    return null;
  }
}

const shown = ['incomeTax', 'dsmfEmployee', 'unemploymentEmployee', 'medicalEmployee'] as const;
const employerKeys = ['dsmfEmployer', 'unemploymentEmployer', 'medicalEmployer'] as const;

export function PayrollEditor({ id }: { id?: string }) {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const detail = useQuery<PayrollDocumentDetail>(
    id ? { type: 'payrollDocument', companyId: win.companyId, id } : null,
  );
  const sets = useQuery<PayrollRatesView[]>({ type: 'payrollRates', companyId: win.companyId });
  const [form, setForm] = useState<Form | null>(null);
  const baseline = useRef('');
  const resync = useRef(false);
  const m = useMutation();
  const [message, setMessage] = useState('');
  const [fillError, setFillError] = useState('');
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const doc = detail.data;
  const snapshot = (f: Form) => JSON.stringify({ ...f, lines: f.lines.map(toInput) });

  async function fill(month: string, base: Form) {
    setFillError('');
    try {
      const lines = await api.query<PayrollFillLine[]>({
        type: 'payrollFill',
        companyId: win.companyId,
        month,
      });
      setForm({ ...base, month, lines: lines.length ? fromFill(lines) : [blank()] });
      if (!lines.length)
        setFillError('Bu ay üçün əmək haqqı yazılmış işçi yoxdur (İşçilər kitabçası).');
    } catch (e) {
      setFillError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (form) return;
    if (id && !doc) return;
    if (doc) {
      const initial = fromDetail(doc);
      baseline.current = snapshot(initial);
      setForm(initial);
      return;
    }
    // A new payroll is usually for the month just ended.
    const initial: Form = {
      month: previousMonth(today().slice(0, 7)),
      number: '',
      memo: '',
      lines: [blank()],
    };
    baseline.current = snapshot(initial);
    setForm(initial);
    void fill(initial.month, initial);
  }, [doc, form, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!doc || !resync.current) return;
    resync.current = false;
    const next = fromDetail(doc);
    baseline.current = snapshot(next);
    setForm(next);
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!form && snapshot(form) !== baseline.current;
  useEffect(() => ws.setDirty(win.id, dirty), [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (doc) ws.setLabel(win.id, doc.number);
  }, [doc?.number]); // eslint-disable-line react-hooks/exhaustive-deps

  // The rates in force at the month's end, as the ledger picks them.
  const rates = useMemo(() => {
    if (!form || !sets.data) return null;
    const end = monthEndOf(form.month);
    const set = sets.data.find((s) => s.validFrom <= end);
    try {
      return set ? { from: set.validFrom, rates: parseRates(set.rates) } : null;
    } catch {
      return null;
    }
  }, [form?.month, sets.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = doc?.status === 'cancelled';
  async function save(close = false) {
    if (!form || locked || m.busy) return;
    setMessage('');
    const r = await m.run({
      type: 'payroll.save',
      companyId: win.companyId,
      month: form.month,
      number: form.number,
      memo: form.memo,
      lines: form.lines.map(toInput),
      ...(id && doc ? { id, version: doc.version } : {}),
    });
    if (!r) return;
    if (close) {
      ws.discard(win.id);
      return;
    }
    setMessage(
      id
        ? 'Düzəliş uçota alındı: köhnə yazılış storno edildi, yenisi yazıldı.'
        : `Sənəd ${r.number} uçota alındı.`,
    );
    resync.current = true;
    if (!id) {
      baseline.current = snapshot({ ...form, number: r.number ?? form.number });
      ws.setDirty(win.id, false);
      ws.retarget(win.id, { type: 'payroll', id: r.id });
    } else detail.reload();
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ws.activeId !== win.id) return;
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        void save(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!catalog || !form)
    return (
      <ModuleFrame title={viewTitle(win.view, win.label)}>
        <div className="loading">{detail.error || 'Yüklənir…'}</div>
      </ModuleFrame>
    );
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const setLine = (i: number, patch: Partial<LineForm>) =>
    set({ lines: form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const employees = catalog.employees
    .filter((e) => !e.archived)
    .map((e) => ({
      value: e.id,
      label: e.name,
      ...(e.position || e.tabNo ? { hint: [e.tabNo, e.position].filter(Boolean).join(' · ') } : {}),
    }));
  const amounts = form.lines.map((l) => compute(l, rates?.rates ?? null));
  const total = (pick: (a: PayrollAmounts) => bigint) =>
    formatMinor(amounts.reduce((s, a) => s + (a ? pick(a) : 0n), 0n));
  const errorLine = /^lines\.(\d+)\./.exec(m.error?.field ?? '')?.[1];
  const cell = (a: PayrollAmounts | null, v: (a: PayrollAmounts) => bigint) =>
    a ? money(formatMinor(v(a))) : '—';
  return (
    <ModuleFrame
      title={viewTitle(win.view, win.label)}
      hint={doc ? `Versiya ${doc.version}` : 'Saxlanmayıb'}
      status={doc ? doc.status : 'draft'}
      actions={
        <>
          {!locked && (
            <button
              type="button"
              className="button primary"
              title="Ctrl+Enter"
              disabled={m.busy || (!!id && !dirty)}
              onClick={() => void save(true)}
            >
              <CheckCheck size={15} /> Uçota al və bağla
            </button>
          )}
          {!locked && (
            <button
              type="button"
              className="button secondary"
              title="Ctrl+S"
              disabled={m.busy || (!!id && !dirty)}
              onClick={() => void save()}
            >
              <Check size={15} /> {m.busy ? 'Saxlanılır…' : id ? 'Düzəlişi uçota al' : 'Uçota al'}
            </button>
          )}
          {!locked && (
            <button
              type="button"
              className="button secondary"
              onClick={() => void fill(form.month, form)}
            >
              <UserRound size={15} /> İşçilərə görə doldur
            </button>
          )}
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
          {fillError && <Notice onClose={() => setFillError('')}>{fillError}</Notice>}
          {sets.data && !rates && (
            <Notice>
              {monthTitle(form.month)} üçün qüvvədə olan dərəcələr yoxdur (Əmək haqqı → Dərəcələr).
            </Notice>
          )}
          {message && (
            <Notice kind="success" onClose={() => setMessage('')}>
              {message}
            </Notice>
          )}
        </>
      }
    >
      <form
        className="document"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset className="doc-header" disabled={m.busy || locked}>
          <Field label="Ay" hint="Ayın son günü ilə yazılır">
            <MonthInput
              value={form.month}
              onChange={(month) => (id ? set({ month }) : void fill(month, form))}
              aria-label="Ay"
            />
          </Field>
          <Field label="Nömrə" hint={id ? undefined : 'Boş qalsa avtomatik'}>
            <input
              maxLength={40}
              value={form.number}
              placeholder="ƏH-000001"
              onChange={(e) => set({ number: e.target.value })}
            />
          </Field>
          <Field label="Məzmun" wide>
            <input
              maxLength={500}
              value={form.memo}
              onChange={(e) => set({ memo: e.target.value })}
            />
          </Field>
        </fieldset>
        <fieldset className="lines" disabled={m.busy || locked}>
          <div className="table-scroll">
            <table className="grid payroll-grid" aria-label="Əmək haqqı sətirləri">
              <thead>
                <tr>
                  <th scope="col">İşçi</th>
                  <th scope="col" className="num">
                    Əmək haqqı
                  </th>
                  <th scope="col" className="num">
                    Mükafat
                  </th>
                  <th scope="col" className="num">
                    Hesablanıb
                  </th>
                  {shown.map((k) => (
                    <th key={k} scope="col" className="num">
                      {contributionLabel[k].replace(' — işçi', '')}
                    </th>
                  ))}
                  <th scope="col" className="num">
                    Ödəniləcək
                  </th>
                  <th scope="col" className="num" title="DSMF, işsizlik və tibbi sığorta">
                    İşəgötürən
                  </th>
                  <th scope="col">
                    <span className="sr-only">Əməliyyat</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {form.lines.map((l, i) => {
                  const a = amounts[i] ?? null;
                  return (
                    <tr key={i} className={errorLine === String(i) ? 'invalid' : ''}>
                      <td className="wide">
                        <Picker
                          ariaLabel={`Sətir ${i + 1}: işçi`}
                          value={l.employeeId}
                          options={employees}
                          onChange={(employeeId) => setLine(i, { employeeId })}
                        />
                      </td>
                      <td>
                        <input
                          className="num"
                          aria-label={`Sətir ${i + 1}: əmək haqqı`}
                          inputMode="decimal"
                          value={l.salary}
                          onChange={(e) => setLine(i, { salary: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="num"
                          aria-label={`Sətir ${i + 1}: mükafat`}
                          inputMode="decimal"
                          value={l.bonus}
                          onChange={(e) => setLine(i, { bonus: e.target.value })}
                        />
                      </td>
                      <td className="num">{cell(a, (x) => x.gross)}</td>
                      {shown.map((k) => (
                        <td key={k} className="num">
                          {cell(a, (x) => x[k])}
                        </td>
                      ))}
                      <td className="num" aria-label={`Sətir ${i + 1}: ödəniləcək`}>
                        <strong>{cell(a, (x) => x.net)}</strong>
                      </td>
                      <td className="num">
                        {cell(a, (x) => employerKeys.reduce((s, k) => s + x[k], 0n))}
                      </td>
                      <td className="row-tools">
                        {form.lines.length > 1 && (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Sətir ${i + 1}: sil`}
                            onClick={() => set({ lines: form.lines.filter((_, j) => j !== i) })}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Cəmi</th>
                  <td />
                  <td />
                  <td className="num">{money(total((a) => a.gross))}</td>
                  {shown.map((k) => (
                    <td key={k} className="num">
                      {money(total((a) => a[k]))}
                    </td>
                  ))}
                  <td className="num" aria-label="Cəmi ödəniləcək">
                    <strong>{money(total((a) => a.net))}</strong>
                  </td>
                  <td className="num">
                    {money(total((a) => employerKeys.reduce((s, k) => s + a[k], 0n)))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() => set({ lines: [...form.lines, blank()] })}
          >
            <Plus size={15} /> İşçi əlavə et
          </button>
        </fieldset>
        <PostingRule>
          Ayın son günü: Dt 701 / 721 ("Əmək haqqı") / Kt 533 — hesablanan; Dt 533 / Kt 521.03,
          522.01, 522.03.1, 522.04.1 — işçidən tutulan; Dt 701 / 721 ("Sosial sığorta ayırmaları") /
          Kt 522.01, 522.03.2, 522.04.2 — işəgötürənin payı. Xərc hesabı işçinin kartındadır.
          {rates ? ` Dərəcələr ${day(rates.from)} tarixindən.` : ''} Ödəniş — bank və ya kassa
          sənədi ilə (Dt 533).
        </PostingRule>
        {doc && doc.postings.length > 0 && <Postings postings={doc.postings} />}
      </form>
      {cancel && doc && (
        <Confirm
          title={`Sənədi ləğv et · ${doc.number}`}
          confirmLabel="Ləğv et"
          destructive
          onCancel={() => setCancel(false)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'payroll.cancel',
              companyId: win.companyId,
              id: doc.id,
              version: doc.version,
              reason,
            });
            if (r) {
              setCancel(false);
              setMessage('Sənəd ləğv edildi: yazılışları storno edildi.');
              resync.current = true;
              detail.reload();
            }
          }}
        >
          <p>Yazılışlar silinmir — qırmızı storno ilə ləğv olunur.</p>
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

// ---------------------------------------------------------------------------------------------
// Rates

function RatesEditor({
  initial,
  validFrom,
  fixedDate,
  onClose,
}: {
  initial: RatesInput;
  validFrom: string;
  fixedDate: boolean;
  onClose: () => void;
}) {
  const win = useWindow();
  const m = useMutation();
  const [from, setFrom] = useState(validFrom);
  const [r, setR] = useState<RatesInput>(initial);
  const setRow = (key: (typeof contributionKeys)[number], i: number, patch: object) =>
    setR({ ...r, [key]: r[key].map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const save = async () => {
    const done = await m.run({
      type: 'payrollRates.save',
      companyId: win.companyId,
      validFrom: from,
      rates: r,
    });
    if (done) onClose();
  };
  return (
    <Modal title="Əmək haqqı dərəcələri" onClose={onClose}>
      <form className="dialog-form" noValidate onSubmit={(e) => (e.preventDefault(), void save())}>
        <div className="form-grid">
          <Field label="Qüvvəyə minir">
            {fixedDate ? (
              <input readOnly value={day(from)} aria-label="Qüvvəyə minir" />
            ) : (
              <DateInput value={from} onChange={setFrom} aria-label="Qüvvəyə minir" />
            )}
          </Field>
          <Field label="Gəlir vergisindən azad məbləğ" hint="Aylıq gəlir həddi aşmırsa">
            <span className="inline-pair">
              <input
                aria-label="Güzəşt"
                inputMode="decimal"
                value={r.relief.amount}
                onChange={(e) => setR({ ...r, relief: { ...r.relief, amount: e.target.value } })}
              />
              <input
                aria-label="Güzəştin həddi"
                inputMode="decimal"
                value={r.relief.ifUpTo}
                onChange={(e) => setR({ ...r, relief: { ...r.relief, ifUpTo: e.target.value } })}
              />
            </span>
          </Field>
        </div>
        {contributionKeys.map((key) => (
          <fieldset key={key} className="rate-brackets" aria-label={contributionLabel[key]}>
            <legend>{contributionLabel[key]}</legend>
            {r[key].map((b, i) => {
              const last = i === r[key].length - 1;
              return (
                <div key={i} className="rate-bracket">
                  <span className="muted">{i === 0 ? '0-dan' : `${r[key][i - 1]!.upTo}-dən`}</span>
                  {last ? (
                    <span className="muted">yuxarı</span>
                  ) : (
                    <input
                      aria-label={`${contributionLabel[key]}, pillə ${i + 1}: hədd`}
                      inputMode="decimal"
                      value={b.upTo}
                      onChange={(e) => setRow(key, i, { upTo: e.target.value })}
                    />
                  )}
                  <input
                    aria-label={`${contributionLabel[key]}, pillə ${i + 1}: dərəcə`}
                    inputMode="decimal"
                    value={b.rate}
                    onChange={(e) => setRow(key, i, { rate: e.target.value })}
                  />
                  <span className="muted">%</span>
                  {r[key].length > 1 && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`${contributionLabel[key]}, pillə ${i + 1}: sil`}
                      onClick={() => {
                        const rows = r[key].filter((_, j) => j !== i);
                        rows[rows.length - 1] = { ...rows[rows.length - 1]!, upTo: '' };
                        setR({ ...r, [key]: rows });
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              className="button secondary small"
              onClick={() =>
                // A new bracket before the open last one; its bound is typed in.
                setR({
                  ...r,
                  [key]: [
                    ...r[key].slice(0, -1),
                    { upTo: '', rate: '' },
                    r[key][r[key].length - 1]!,
                  ],
                })
              }
            >
              <Plus size={13} /> Pillə
            </button>
          </fieldset>
        ))}
        {m.error && <Notice>{m.error.message}</Notice>}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Ləğv et
          </button>
          <button type="submit" className="button primary" disabled={m.busy}>
            Saxla
          </button>
        </div>
      </form>
    </Modal>
  );
}

const describe = (rows: { upTo: string; rate: string }[]) =>
  rows
    .map((b, i) =>
      i === rows.length - 1 && i > 0
        ? `${money(rows[i - 1]!.upTo)}-dən yuxarı ${b.rate}%`
        : b.upTo
          ? `${money(b.upTo)}-dək ${b.rate}%`
          : `${b.rate}%`,
    )
    .join(' · ');

export function PayrollRatesPage() {
  const win = useWindow();
  const page = pages.payrollRates;
  const result = useQuery<PayrollRatesView[]>({ type: 'payrollRates', companyId: win.companyId });
  const [edit, setEdit] = useState<{
    initial: RatesInput;
    validFrom: string;
    fixedDate: boolean;
  } | null>(null);
  const rows = result.data ?? [];
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      count={rows.length}
      onRefresh={result.reload}
      actions={
        <button
          type="button"
          className="button primary"
          onClick={() =>
            setEdit({
              initial: rows[0]?.rates ?? rates2026,
              validFrom: `${today().slice(0, 7)}-01`,
              fixedDate: false,
            })
          }
        >
          <Plus size={15} /> Yeni dərəcələr
        </button>
      }
      notices={
        <>
          {result.error && <Notice>{result.error}</Notice>}
          <Notice kind="info">
            Başlanğıc dəst — 2026 dərəcələri (qeyri-neft, qeyri-dövlət sektoru). Mühasib
            taxes.gov.az və DSMF ilə yoxlamalıdır; dəyişsə, yeni tarixdən yeni dəst yazın.
          </Notice>
        </>
      }
    >
      {rows.map((s) => (
        <section
          key={s.validFrom}
          className="panel rate-set"
          aria-label={`Dəst ${day(s.validFrom)}`}
        >
          <header className="panel-head">
            <h2>{day(s.validFrom)} tarixindən</h2>
            {s.used ? (
              <span className="muted">Uçotdakı əmək haqqı sənədləri ilə istifadə olunub</span>
            ) : (
              <button
                type="button"
                className="button secondary small"
                onClick={() =>
                  setEdit({ initial: s.rates, validFrom: s.validFrom, fixedDate: true })
                }
              >
                <Pencil size={13} /> Dəyiş
              </button>
            )}
          </header>
          <table className="grid">
            <tbody>
              <tr>
                <th scope="row">Gəlir vergisindən azad</th>
                <td>
                  {money(s.rates.relief.amount)} ₼ (gəlir {money(s.rates.relief.ifUpTo)} ₼-dək
                  olanda)
                </td>
              </tr>
              {contributionKeys.map((k) => (
                <tr key={k}>
                  <th scope="row">{contributionLabel[k]}</th>
                  <td>{describe(s.rates[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {!rows.length && !result.loading && <Empty title="Dərəcələr yoxdur" />}
      {edit && (
        <RatesEditor
          {...edit}
          onClose={() => {
            setEdit(null);
            result.reload();
          }}
        />
      )}
    </ModuleFrame>
  );
}
