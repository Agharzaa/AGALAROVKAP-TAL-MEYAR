/**
 * Stage 8c — vacations and sick leaves (plan §12, QERARLAR 2026-10-27 §9, §10): the lists and the
 * document. The pay is worked out by the ledger when the document is saved and shown with how it
 * was worked out; it goes to the payroll of the month the absence starts in.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Ban, Check, Plus } from '../icons';
import type { AbsenceView } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { day, money, today } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages, viewTitle } from '../pages';
import { Picker } from '../picker';
import {
  Amount,
  Confirm,
  DataTable,
  DateInput,
  Empty,
  Field,
  Notice,
  PostingRule,
  Status,
  type Column,
} from '../ui';
import { useWindow, useWorkspace } from '../workspace';

export type AbsenceKind = 'vacation' | 'unpaid' | 'sick';
export const absenceTitle: Record<AbsenceKind, string> = {
  vacation: 'Məzuniyyət',
  unpaid: 'Ödənişsiz məzuniyyət',
  sick: 'Xəstəlik vərəqəsi',
};

/** Vacations (paid and unpaid) or sick leaves. */
export function AbsencesPage({ sick }: { sick: boolean }) {
  const win = useWindow();
  const ws = useWorkspace();
  const page = sick ? pages.sickLeaves : pages.vacations;
  const result = useQuery<AbsenceView[]>({ type: 'absences', companyId: win.companyId });
  const rows = (result.data ?? []).filter((a) => (a.kind === 'sick') === sick);
  const open = (kind: AbsenceKind, id?: string) =>
    ws.open({ type: 'absence', kind, ...(id ? { id } : {}) }, win.companyId);
  const columns: Column<AbsenceView>[] = [
    {
      key: 'number',
      label: 'Nömrə',
      render: (a) => (
        <button type="button" className="link" onClick={() => open(a.kind, a.id)}>
          {a.number}
        </button>
      ),
    },
    { key: 'employee', label: 'İşçi', className: 'wide', render: (a) => a.employeeName },
    ...(sick
      ? [{ key: 'sheet', label: 'Vərəqə', render: (a: AbsenceView) => a.sheetNo }]
      : [{ key: 'kind', label: 'Növ', render: (a: AbsenceView) => absenceTitle[a.kind] }]),
    { key: 'from', label: 'Başlama', render: (a) => day(a.from) },
    { key: 'to', label: 'Bitmə', render: (a) => day(a.to) },
    { key: 'days', label: 'Gün', align: 'end', render: (a) => String(a.days) },
    {
      key: 'amount',
      label: sick ? 'İşəgötürən ödəyir' : 'Məzuniyyət haqqı',
      align: 'end',
      render: (a) => <Amount value={a.amount} strong />,
    },
    { key: 'status', label: 'Vəziyyət', render: (a) => <Status status={a.status} /> },
  ];
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      count={rows.length}
      onRefresh={result.reload}
      actions={
        sick ? (
          <button type="button" className="button primary" onClick={() => open('sick')}>
            <Plus size={15} /> Xəstəlik vərəqəsi
          </button>
        ) : (
          <>
            <button type="button" className="button primary" onClick={() => open('vacation')}>
              <Plus size={15} /> Məzuniyyət
            </button>
            <button type="button" className="button secondary" onClick={() => open('unpaid')}>
              <Plus size={15} /> Ödənişsiz məzuniyyət
            </button>
          </>
        )
      }
      notices={result.error && <Notice>{result.error}</Notice>}
    >
      <DataTable
        label={page.title}
        rows={rows}
        columns={columns}
        rowKey={(a) => a.id}
        onOpen={(a) => open(a.kind, a.id)}
        rowClass={(a) => (a.status === 'cancelled' ? 'cancelled' : '')}
        empty={<Empty title="Hələ sənəd yoxdur" />}
      />
    </ModuleFrame>
  );
}

interface Form {
  number: string;
  employeeId: string;
  from: string;
  to: string;
  sheetNo: string;
  percent: string;
  employerAll: boolean;
  manual: string;
  memo: string;
}
const blank = (): Form => ({
  number: '',
  employeeId: '',
  from: today(),
  to: today(),
  sheetNo: '',
  percent: '100',
  employerAll: false,
  manual: '',
  memo: '',
});
const fromView = (a: AbsenceView): Form => ({
  number: a.number,
  employeeId: a.employeeId,
  from: a.from,
  to: a.to,
  sheetNo: a.sheetNo,
  percent: String(a.percent),
  employerAll: a.employerAll,
  manual: a.manual,
  memo: a.memo,
});

export function AbsenceEditor({ kind, id }: { kind: AbsenceKind; id?: string }) {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const detail = useQuery<AbsenceView>(
    id ? { type: 'absence', companyId: win.companyId, id } : null,
  );
  const doc = detail.data;
  const [form, setForm] = useState<Form | null>(null);
  const m = useMutation();
  const [message, setMessage] = useState('');
  const [warning, setWarning] = useState('');
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (form) return;
    if (id && !doc) return;
    setForm(doc ? fromView(doc) : blank());
  }, [doc, form, id]);
  useEffect(() => {
    if (doc) ws.setLabel(win.id, doc.number);
  }, [doc?.number]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!catalog || !form)
    return (
      <ModuleFrame title={viewTitle(win.view, win.label)}>
        <div className="loading">{detail.error || 'Yüklənir…'}</div>
      </ModuleFrame>
    );
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const locked = doc?.status === 'cancelled';
  const sick = kind === 'sick';
  async function save() {
    if (!form || locked || m.busy) return;
    setMessage('');
    setWarning('');
    const r = await m.run({
      type: 'absence.save',
      companyId: win.companyId,
      kind,
      number: form.number,
      employeeId: form.employeeId,
      from: form.from,
      to: form.to,
      sheetNo: form.sheetNo,
      percent: Number(form.percent) || 0,
      employerAll: form.employerAll,
      manual: form.manual,
      memo: form.memo,
      ...(id && doc ? { id, version: doc.version } : {}),
    });
    if (!r) return;
    setMessage(id ? 'Dəyişiklik saxlanıldı.' : `Sənəd ${r.number} saxlanıldı.`);
    setWarning(r.warning ?? '');
    setForm(null);
    if (!id) ws.retarget(win.id, { type: 'absence', kind, id: r.id });
    else detail.reload();
  }
  const employees = catalog.employees
    .filter((e) => !e.archived)
    .map((e) => ({ value: e.id, label: e.name, ...(e.position ? { hint: e.position } : {}) }));
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
              disabled={m.busy}
              onClick={() => void save()}
            >
              <Check size={15} />{' '}
              {m.busy ? 'Saxlanılır…' : id ? 'Yenidən hesabla və saxla' : 'Hesabla və saxla'}
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
          {message && (
            <Notice kind="success" onClose={() => setMessage('')}>
              {message}
            </Notice>
          )}
          {warning && (
            <Notice kind="warning" onClose={() => setWarning('')}>
              {warning}
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
          <Field label="Nömrə" hint={id ? undefined : 'Boş qalsa avtomatik'}>
            <input
              maxLength={40}
              value={form.number}
              placeholder={{ vacation: 'MZ-000001', unpaid: 'ÖM-000001', sick: 'XV-000001' }[kind]}
              onChange={(e) => set({ number: e.target.value })}
            />
          </Field>
          <Field label="İşçi" wide>
            <Picker
              ariaLabel="İşçi"
              value={form.employeeId}
              options={employees}
              onChange={(employeeId) => set({ employeeId })}
            />
          </Field>
          <Field label="Başlama">
            <DateInput value={form.from} onChange={(from) => set({ from })} aria-label="Başlama" />
          </Field>
          <Field label="Bitmə" hint="Daxil olmaqla, təqvim günləri">
            <DateInput value={form.to} onChange={(to) => set({ to })} aria-label="Bitmə" />
          </Field>
          {sick && (
            <>
              <Field label="Vərəqənin nömrəsi">
                <input
                  maxLength={40}
                  value={form.sheetNo}
                  onChange={(e) => set({ sheetNo: e.target.value })}
                />
              </Field>
              <Field label="Staj faizi" hint="Sığorta stajına görə: 60 / 80 / 100">
                <select
                  aria-label="Staj faizi"
                  value={form.percent}
                  onChange={(e) => set({ percent: e.target.value })}
                >
                  {['100', '80', '60'].map((p) => (
                    <option key={p} value={p}>
                      {p}%
                    </option>
                  ))}
                </select>
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.employerAll}
                  onChange={(e) => set({ employerAll: e.target.checked })}
                />{' '}
                İstehsalat qəzası işəgötürənin günahı ilə — bütün günləri işəgötürən ödəyir
              </label>
            </>
          )}
          {kind !== 'unpaid' && (
            <Field
              label={sick ? 'Orta günlük qazanc (əl ilə)' : 'Orta aylıq qazanc (əl ilə)'}
              hint="Boş — Meyar-dakı əmək haqqından hesablanır"
            >
              <input
                inputMode="decimal"
                value={form.manual}
                onChange={(e) => set({ manual: e.target.value })}
              />
            </Field>
          )}
          <Field label="Məzmun" wide>
            <input
              maxLength={500}
              value={form.memo}
              onChange={(e) => set({ memo: e.target.value })}
            />
          </Field>
        </fieldset>
        {doc && (
          <section className="panel" aria-label="Hesablama">
            <p role="status" aria-label="Hesablama">
              {doc.basis}
            </p>
            {kind !== 'unpaid' && (
              <p>
                <strong>
                  {sick ? 'İşəgötürən ödəyir' : 'Məzuniyyət haqqı'}: {money(doc.amount)} ₼
                </strong>
                {sick && doc.fundDays > 0 && ` · ${doc.fundDays} gün DSMF-dən`}
              </p>
            )}
          </section>
        )}
        <PostingRule>
          {sick
            ? 'Yazılış bu sənəddə deyil: işəgötürənin ödədiyi ilk 14 gün xəstəliyin başladığı ayın əmək haqqına düşür (Dt 701 / 721 "Xəstəlik vərəqəsi üzrə müavinət" / Kt 533); gəlir vergisi tutulur, DSMF, işsizlik və tibbi sığorta yox. 15-ci gündən DSMF ödəyir. Həmin günlərin maaşı hesablanmır.'
            : kind === 'vacation'
              ? 'Yazılış bu sənəddə deyil: məzuniyyət haqqı başladığı ayın əmək haqqına düşür və adi əmək haqqı kimi vergiyə və fondlara cəlb olunur. Məzuniyyət günlərinin maaşı hesablanmır.'
              : 'Ödənişsiz məzuniyyət: yalnız həmin iş günlərinin maaşı hesablanmır.'}{' '}
          Uçotdakı əmək haqqından sonra dəyişsə, əmək haqqı sənədini yenidən saxlayın.
        </PostingRule>
      </form>
      {cancel && doc && (
        <Confirm
          title={`Sənədi ləğv et · ${doc.number}`}
          confirmLabel="Ləğv et"
          destructive
          onCancel={() => setCancel(false)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'absence.cancel',
              companyId: win.companyId,
              id: doc.id,
              version: doc.version,
              reason,
            });
            if (r) {
              setCancel(false);
              setMessage('Sənəd ləğv edildi.');
              setWarning(r.warning ?? '');
              setForm(null);
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
