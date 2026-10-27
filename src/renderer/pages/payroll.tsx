/**
 * Stage 8 — payroll (docs/MERHELE-8-EMEK-HAQQI.md §7, §12): the month documents, the document with
 * its lines computed as they are typed (the same domain rules the ledger posts by: exemptions,
 * vacation and sick pay, deductions), its Excel sheet, and the dated rates.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Ban, Check, CheckCheck, FileDown, Pencil, Plus, Trash2, UserRound } from '../icons';
import { formatMinor, parseMoney } from '../../domain/money';
import {
  contributionKeys,
  contributionLabel,
  extraPayLabel,
  noExemption,
  parseRates,
  payrollFor,
  rates2026,
  type Exemption,
  type PayrollAmounts,
  type RatesInput,
} from '../../domain/payroll';
import type {
  EmployeeView,
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
import { accountOptions, Picker, SubkontoFields } from '../picker';
import { workbook } from '../xlsx';
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

interface DeductionForm {
  amount: string;
  account: string;
  sk: string[];
  memo: string;
}
interface LineForm {
  employeeId: string;
  salary: string;
  bonus: string;
  /** From the vacation and sick leave documents (8c): shown, never typed. */
  vacation: string;
  sick: string;
  /** The timesheet's extra pay (8d): overtime, work on days off, night hours. */
  extra: string;
  extraTitle: string;
  deductions: DeductionForm[];
}
interface Form {
  month: string;
  number: string;
  memo: string;
  lines: LineForm[];
}
const blank = (): LineForm => ({
  employeeId: '',
  salary: '',
  bonus: '',
  vacation: '0.00',
  sick: '0.00',
  extra: '0.00',
  extraTitle: '',
  deductions: [],
});
const extraOf = (x: { overtime: string; holidayWork: string; night: string }) => ({
  extra: formatMinor(parseMoney(x.overtime) + parseMoney(x.holidayWork) + parseMoney(x.night)),
  extraTitle: `Artıq iş ${x.overtime} · bayram / istirahət günü ${x.holidayWork} · gecə ${x.night}`,
});
const toInput = (l: LineForm) => ({
  employeeId: l.employeeId,
  salary: l.salary.trim(),
  bonus: l.bonus.trim(),
  deductions: l.deductions
    .filter((d) => d.amount.trim())
    .map((d) => ({ amount: d.amount.trim(), account: d.account, sk: d.sk, memo: d.memo })),
});
const fromDetail = (d: PayrollDocumentDetail): Form => ({
  month: d.month,
  number: d.number,
  memo: d.memo,
  lines: d.lines.map((l) => ({
    employeeId: l.employeeId,
    salary: l.salary,
    bonus: l.bonus === '0.00' ? '' : l.bonus,
    vacation: l.vacation,
    sick: l.sick,
    ...extraOf(l),
    deductions: l.deductions,
  })),
});
/** New lines from the employees; a bonus or a deduction typed before stays with its employee. */
const fromFill = (lines: PayrollFillLine[], before: LineForm[]): LineForm[] =>
  lines.map((l) => {
    const old = before.find((b) => b.employeeId === l.employeeId);
    return {
      employeeId: l.employeeId,
      salary: l.salary,
      bonus: old?.bonus ?? '',
      vacation: l.vacation,
      sick: l.sick,
      ...extraOf(l),
      deductions: old?.deductions ?? [],
    };
  });

/** The employee's own exemption in force in the month, as the ledger reads it (8c). */
function exemptionFor(e: EmployeeView | undefined, month: string): Exemption {
  if (!e || !e.mainJob) return noExemption;
  const first = `${month}-01`;
  const last = monthEndOf(month);
  if ((e.exemptionFrom && e.exemptionFrom > last) || (e.exemptionTo && e.exemptionTo < first))
    return noExemption;
  return { amount: BigInt(e.exemption) * 100n, extra: e.exemptionExtra ? 5_000n : 0n };
}

interface LineAmounts extends PayrollAmounts {
  deducted: bigint;
  /** Net after the deductions: what the employee is paid. */
  pay: bigint;
}

/** The amounts of a line as the ledger will post them; null while the input is not a number. */
function compute(
  l: LineForm,
  rates: ReturnType<typeof parseRates> | null,
  exemption: Exemption,
): LineAmounts | null {
  if (!rates) return null;
  try {
    const a = payrollFor(
      parseMoney(l.salary || '0') +
        parseMoney(l.bonus || '0') +
        parseMoney(l.vacation) +
        parseMoney(l.extra),
      rates,
      exemption,
      parseMoney(l.sick),
    );
    const deducted = l.deductions.reduce((s, d) => s + parseMoney(d.amount || '0'), 0n);
    return { ...a, deducted, pay: a.net - deducted };
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
      setForm({ ...base, month, lines: lines.length ? fromFill(lines, base.lines) : [blank()] });
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
  const byId = new Map(catalog.employees.map((e) => [e.id, e]));
  const amounts = form.lines.map((l) =>
    compute(l, rates?.rates ?? null, exemptionFor(byId.get(l.employeeId), form.month)),
  );
  const total = (pick: (a: LineAmounts) => bigint) =>
    formatMinor(amounts.reduce((s, a) => s + (a ? pick(a) : 0n), 0n));
  const errorLine = /^lines\.(\d+)\./.exec(m.error?.field ?? '')?.[1];
  const cell = (a: LineAmounts | null, v: (a: LineAmounts) => bigint) =>
    a ? money(formatMinor(v(a))) : '—';
  const zero = (v: string) => (v === '0.00' ? '' : money(v));
  const deductionAccounts = accountOptions(catalog, (c) => c !== '533' && !c.startsWith('52'));
  const setDeduction = (i: number, j: number, patch: Partial<DeductionForm>) =>
    setLine(i, {
      deductions: form.lines[i]!.deductions.map((d, k) => (k === j ? { ...d, ...patch } : d)),
    });
  const exportSheet = async () => {
    try {
      const head = [
        'Tabel №',
        'İşçi',
        'Əmək haqqı',
        'Mükafat',
        'Məzuniyyət',
        'Xəstəlik',
        'Tabel əlavəsi',
        'Hesablanıb',
        'Güzəşt',
        ...shown.map((k) => contributionLabel[k]),
        'Tutulma',
        'Ödəniləcək',
        ...employerKeys.map((k) => contributionLabel[k]),
      ];
      const rows = form.lines.map((l, i) => {
        const a = amounts[i];
        const e = byId.get(l.employeeId);
        const mny = (v: bigint | undefined) => ({ money: v === undefined ? '' : formatMinor(v) });
        return [
          e?.tabNo ?? '',
          e?.name ?? '',
          { money: l.salary },
          { money: l.bonus },
          { money: l.vacation },
          { money: l.sick },
          { money: l.extra },
          mny(a ? a.gross + a.sick : undefined),
          mny(a?.exemption),
          ...shown.map((k) => mny(a?.[k])),
          mny(a?.deducted),
          mny(a?.pay),
          ...employerKeys.map((k) => mny(a?.[k])),
        ];
      });
      const saved = await api.saveFile(
        `Əmək haqqı cədvəli ${form.month}.xlsx`,
        workbook({
          name: `Əmək haqqı ${form.month}`,
          title: [
            'Əmək haqqı cədvəli',
            `${monthTitle(form.month)}${form.number ? ` · ${form.number}` : ''}`,
          ],
          header: head,
          rows,
          widths: [10, 30, ...head.slice(2).map(() => 13)],
        }),
      );
      if (saved) setMessage(`Saxlanıldı: ${saved}`);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
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
          <button type="button" className="button secondary" onClick={() => void exportSheet()}>
            <FileDown size={15} /> Excel
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
          {fillError && <Notice onClose={() => setFillError('')}>{fillError}</Notice>}
          {doc && doc.stale.length > 0 && (
            <Notice kind="warning">
              Uçotdan sonra dəyişən məzuniyyət, xəstəlik vərəqəsi, tabel, təqvim və ya işə qəbul /
              çıxma tarixi: {doc.stale.join(', ')}. "İşçilərə görə doldur" və düzəlişi uçota alın —
              o vaxtadək ay bağlanmır.
            </Notice>
          )}
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
                  <th scope="col" className="num" title="Məzuniyyət sənədlərindən">
                    Məzuniyyət
                  </th>
                  <th
                    scope="col"
                    className="num"
                    title="Xəstəlik vərəqələrindən: işəgötürənin günləri"
                  >
                    Xəstəlik
                  </th>
                  <th
                    scope="col"
                    className="num"
                    title="Tabeldən: artıq iş, bayram / istirahət günü, gecə"
                  >
                    Tabel əlavəsi
                  </th>
                  <th scope="col" className="num">
                    Hesablanıb
                  </th>
                  {shown.map((k) => (
                    <th key={k} scope="col" className="num">
                      {contributionLabel[k].replace(' — işçi', '')}
                    </th>
                  ))}
                  <th scope="col" className="num" title="Aliment, avansın qaytarılması və s.">
                    Tutulma
                  </th>
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
                      <td className="num" aria-label={`Sətir ${i + 1}: məzuniyyət`}>
                        {zero(l.vacation)}
                      </td>
                      <td className="num" aria-label={`Sətir ${i + 1}: xəstəlik`}>
                        {zero(l.sick)}
                      </td>
                      <td
                        className="num"
                        aria-label={`Sətir ${i + 1}: tabel əlavəsi`}
                        title={l.extra === '0.00' ? undefined : l.extraTitle}
                      >
                        {zero(l.extra)}
                      </td>
                      <td className="num">{cell(a, (x) => x.gross + x.sick)}</td>
                      {shown.map((k) => (
                        <td
                          key={k}
                          className="num"
                          {...(k === 'incomeTax' && a?.exemption
                            ? { title: `Güzəşt ${money(formatMinor(a.exemption))}` }
                            : {})}
                        >
                          {cell(a, (x) => x[k])}
                        </td>
                      ))}
                      <td className="num">
                        <button
                          type="button"
                          className="link"
                          aria-label={`Sətir ${i + 1}: tutulma əlavə et`}
                          onClick={() =>
                            setLine(i, {
                              deductions: [
                                ...l.deductions,
                                { amount: '', account: '', sk: [], memo: '' },
                              ],
                            })
                          }
                        >
                          {a && a.deducted ? money(formatMinor(a.deducted)) : '+'}
                        </button>
                      </td>
                      <td className="num" aria-label={`Sətir ${i + 1}: ödəniləcək`}>
                        <strong>{cell(a, (x) => x.pay)}</strong>
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
                  <td />
                  <td />
                  <td />
                  <td className="num">{money(total((a) => a.gross + a.sick))}</td>
                  {shown.map((k) => (
                    <td key={k} className="num">
                      {money(total((a) => a[k]))}
                    </td>
                  ))}
                  <td className="num">{money(total((a) => a.deducted))}</td>
                  <td className="num" aria-label="Cəmi ödəniləcək">
                    <strong>{money(total((a) => a.pay))}</strong>
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
          {form.lines.some((l) => l.deductions.length > 0) && (
            <section className="panel payroll-deductions" aria-label="Tutulmalar">
              <h2>Tutulmalar</h2>
              {form.lines.map((l, i) =>
                l.deductions.map((d, j) => (
                  <div key={`${i}-${j}`} className="deduction-row">
                    <span className="deduction-who">
                      {byId.get(l.employeeId)?.name ?? `Sətir ${i + 1}`}
                    </span>
                    <input
                      aria-label={`Sətir ${i + 1}, tutulma ${j + 1}: məbləğ`}
                      inputMode="decimal"
                      placeholder="Məbləğ"
                      value={d.amount}
                      onChange={(e) => setDeduction(i, j, { amount: e.target.value })}
                    />
                    <Picker
                      className="account-picker"
                      ariaLabel={`Sətir ${i + 1}, tutulma ${j + 1}: hesab`}
                      value={d.account}
                      options={deductionAccounts}
                      placeholder="Hesab (məs. 538, 244)"
                      onChange={(account) => setDeduction(i, j, { account, sk: [] })}
                    />
                    <SubkontoFields
                      catalog={catalog}
                      companyId={win.companyId}
                      account={d.account}
                      values={d.sk}
                      onChange={(sk) => setDeduction(i, j, { sk })}
                      side={`Sətir ${i + 1}, tutulma ${j + 1}`}
                    />
                    <input
                      aria-label={`Sətir ${i + 1}, tutulma ${j + 1}: məzmun`}
                      placeholder="Məzmun (məs. Aliment)"
                      maxLength={200}
                      value={d.memo}
                      onChange={(e) => setDeduction(i, j, { memo: e.target.value })}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Sətir ${i + 1}, tutulma ${j + 1}: sil`}
                      onClick={() =>
                        setLine(i, { deductions: l.deductions.filter((_, k) => k !== j) })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )),
              )}
            </section>
          )}
        </fieldset>
        <PostingRule>
          Ayın son günü: Dt 701 / 721 ("Əmək haqqı") / Kt 533 — hesablanan; Dt 533 / Kt 521.03,
          522.01, 522.03.1, 522.04.1 — işçidən tutulan; Dt 701 / 721 ("Sosial sığorta ayırmaları") /
          Kt 522.01, 522.03.2, 522.04.2 — işəgötürənin payı. Xərc hesabı işçinin kartındadır.
          {rates ? ` Dərəcələr ${day(rates.from)} tarixindən.` : ''} Məzuniyyət və xəstəlik vərəqəsi
          öz sənədlərindən gəlir (xəstəlik — "Xəstəlik vərəqəsi üzrə müavinət", yalnız gəlir
          vergisi); güzəşt işçinin kartındadır. Tutulma: Dt 533 / Kt seçilən hesab. Ödəniş — bank və
          ya kassa sənədi ilə (Dt 533).
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
        <fieldset className="rate-brackets" aria-label="Tabel üzrə əlavə ödəniş">
          <legend>Tabel üzrə əlavə ödəniş (saatlıq əmək haqqının faizi)</legend>
          {(Object.keys(extraPayLabel) as (keyof typeof extraPayLabel)[]).map((k) => (
            <div key={k} className="rate-bracket">
              <span className="muted">{extraPayLabel[k]}</span>
              <input
                aria-label={extraPayLabel[k]}
                inputMode="decimal"
                value={(r.pay ?? rates2026.pay!)[k]}
                onChange={(e) =>
                  setR({ ...r, pay: { ...(r.pay ?? rates2026.pay!), [k]: e.target.value } })
                }
              />
              <span className="muted">%</span>
            </div>
          ))}
        </fieldset>
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
              <tr>
                <th scope="row">Tabel: artıq iş / bayram günü / gecə</th>
                <td>
                  {(s.rates.pay ?? rates2026.pay!).overtime}% /{' '}
                  {(s.rates.pay ?? rates2026.pay!).holidayWork}% / +
                  {(s.rates.pay ?? rates2026.pay!).night}%
                </td>
              </tr>
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
