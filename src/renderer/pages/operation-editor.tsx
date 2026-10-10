import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Ban, Check, CheckCheck } from '../icons';
import type { Catalog, OperationDetail } from '../../contracts/queries';
import {
  blankEntryLine,
  EntryGrid,
  entryLinesFrom,
  toEntryInput,
  type EntryLine,
} from '../entry-grid';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { day } from '../format';
import { useMutation, useQuery } from '../hooks';
import { viewTitle } from '../pages';
import { Confirm, DateInput, Field, Notice } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

interface Form {
  number: string;
  date: string;
  memo: string;
  lines: EntryLine[];
}

function fromDetail(d: OperationDetail): Form {
  return {
    number: d.number,
    date: d.date,
    memo: d.memo,
    lines: entryLinesFrom(d.postings, `operation:${d.id}`),
  };
}
const toInput = toEntryInput;

export function OperationEditor({ id }: { id?: string }) {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const detail = useQuery<OperationDetail>(
    id ? { type: 'operation', companyId: win.companyId, id } : null,
  );
  const [form, setForm] = useState<Form | null>(null);
  const baseline = useRef('');
  const resync = useRef(false);
  const m = useMutation();
  const [message, setMessage] = useState('');
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const doc = detail.data;

  useEffect(() => {
    if (form) return;
    if (id && !doc) return;
    const initial: Form = doc
      ? fromDetail(doc)
      : {
          number: '',
          date: ws.period.to < todayIso() ? ws.period.to : todayIso(),
          memo: '',
          lines: [blankEntryLine()],
        };
    baseline.current = JSON.stringify({ ...initial, lines: initial.lines.map(toInput) });
    setForm(initial);
  }, [doc, form, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!doc || !resync.current) return;
    resync.current = false;
    const next = fromDetail(doc);
    baseline.current = JSON.stringify({ ...next, lines: next.lines.map(toInput) });
    setForm(next);
  }, [doc]);
  const dirty =
    !!form && JSON.stringify({ ...form, lines: form.lines.map(toInput) }) !== baseline.current;
  useEffect(() => ws.setDirty(win.id, dirty), [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (doc) ws.setLabel(win.id, doc.number);
  }, [doc?.number]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = doc?.status === 'cancelled';
  async function save(close = false) {
    if (!form || locked || m.busy) return;
    setMessage('');
    const r = await m.run({
      type: 'operation.save',
      companyId: win.companyId,
      number: form.number,
      date: form.date,
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
      baseline.current = JSON.stringify({
        ...form,
        number: r.number ?? form.number,
        lines: form.lines.map(toInput),
      });
      ws.setDirty(win.id, false);
      ws.retarget(win.id, { type: 'operation', id: r.id });
    } else detail.reload();
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ws.activeId !== win.id) return;
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (e.ctrlKey && e.key === 'Enter') {
        // 1C: Ctrl+Enter posts the document and closes its form.
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
  return (
    <ModuleFrame
      title={viewTitle(win.view, win.label)}
      hint={doc ? `Versiya ${doc.version}${locked ? ' · ləğv edilib' : ''}` : 'Saxlanmayıb'}
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
              placeholder="ƏƏ-000001"
              onChange={(e) => set({ number: e.target.value })}
            />
          </Field>
          <Field label="Tarix">
            <DateInput
              required
              value={form.date}
              onChange={(date) => set({ date })}
              aria-label="Tarix"
            />
          </Field>
          <Field label="Məzmun" wide>
            <input
              maxLength={500}
              value={form.memo}
              placeholder="Məsələn: başlanğıc qalıqlar, avansın əvəzləşdirilməsi…"
              onChange={(e) => set({ memo: e.target.value })}
            />
          </Field>
        </fieldset>
        <fieldset className="lines" disabled={m.busy || locked}>
          <EntryGrid
            catalog={catalog as Catalog}
            companyId={win.companyId}
            lines={form.lines}
            onChange={(lines) => set({ lines })}
            errorField={m.error?.field}
          />
        </fieldset>
        <p className="doc-hint">
          Hər sətir bir yazılışdır: Dt hesab (subkontoları ilə) / Kt hesab. “Hesablaşma sənədi” boş
          qalarsa, bu sənədin özü yazılır. Düzəliş köhnə yazılışı qırmızı storno edir; jurnal heç
          vaxt silinmir.
        </p>
        {doc && doc.history.length > 0 && (
          <section className="history" aria-label="Sənədin tarixçəsi">
            <h2>Tarixçə</h2>
            <ul>
              {doc.history.map((h) => (
                <li key={`${h.version}${h.status}`}>
                  v{h.version} · {h.status === 'posted' ? 'uçota alındı' : 'ləğv edildi'} ·{' '}
                  {day(h.at.slice(0, 10))} {h.at.slice(11, 16)} · {h.actor}
                </li>
              ))}
            </ul>
          </section>
        )}
      </form>
      {cancel && doc && (
        <Confirm
          title={`Sənədi ləğv et · ${doc.number}`}
          confirmLabel="Ləğv et"
          destructive
          onCancel={() => setCancel(false)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'operation.cancel',
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

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
