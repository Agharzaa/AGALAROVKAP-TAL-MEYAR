import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Ban, Check, Copy, Plus, Trash2 } from 'lucide-react';
import { parseMoney } from '../../domain/money';
import type { OperationLineInput } from '../../contracts/commands';
import type { Catalog, OperationDetail } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { addAmounts, day, money, toField } from '../format';
import { useMutation, useQuery } from '../hooks';
import { viewTitle } from '../pages';
import { AccountPicker, SubkontoFields } from '../picker';
import { Confirm, DateInput, Field, Notice } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

interface LineForm {
  key: number;
  dtAccount: string;
  dtSk: string[];
  ktAccount: string;
  ktSk: string[];
  amount: string;
  quantity: string;
  dtCur: string;
  ktCur: string;
  memo: string;
}
interface Form {
  number: string;
  date: string;
  memo: string;
  lines: LineForm[];
}
let keys = 0;
const blank = (): LineForm => ({
  key: ++keys,
  dtAccount: '',
  dtSk: [],
  ktAccount: '',
  ktSk: [],
  amount: '',
  quantity: '',
  dtCur: '',
  ktCur: '',
  memo: '',
});

function fromDetail(d: OperationDetail): Form {
  const self = `operation:${d.id}`;
  const unself = (v: string[]) => v.map((x) => (x === self ? '' : x));
  return {
    number: d.number,
    date: d.date,
    memo: d.memo,
    lines: d.postings.map((p) => ({
      key: ++keys,
      dtAccount: p.dt.account,
      dtSk: unself(p.dt.sk),
      ktAccount: p.kt.account,
      ktSk: unself(p.kt.sk),
      amount: toField(p.amount),
      quantity: p.quantity.replace('.', ','),
      dtCur: toField(p.dt.curAmount),
      ktCur: toField(p.kt.curAmount),
      memo: p.memo,
    })),
  };
}

function toInput(l: LineForm): OperationLineInput {
  return {
    dtAccount: l.dtAccount,
    dtSk: l.dtSk,
    ktAccount: l.ktAccount,
    ktSk: l.ktSk,
    amount: l.amount.trim(),
    ...(l.quantity.trim() ? { quantity: l.quantity.trim() } : {}),
    ...(l.dtCur.trim() ? { dtCurAmount: l.dtCur.trim() } : {}),
    ...(l.ktCur.trim() ? { ktCurAmount: l.ktCur.trim() } : {}),
    memo: l.memo,
  };
}

/** Which line/side/slot the server error points at ("lines.2.kt.sk.1"). */
function errorAt(field: string | undefined) {
  const m =
    /^lines\.(\d+)(?:\.(dt|kt))?(?:\.(account|sk|amount|quantity|curAmount))?(?:\.(\d+))?/.exec(
      field ?? '',
    );
  if (!m) return null;
  return {
    line: Number(m[1]),
    side: m[2] as 'dt' | 'kt' | undefined,
    part: m[3],
    slot: m[4] !== undefined ? Number(m[4]) : undefined,
  };
}

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
          lines: [blank()],
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
  async function save() {
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
  const err = errorAt(m.error?.field);
  const acc = (code: string) => catalog.accounts.find((a) => a.code === code);
  const total = addAmounts(
    form.lines.map((l) => {
      try {
        const v = parseMoney(l.amount.trim());
        return `${v / 100n}.${String(v % 100n).padStart(2, '0')}`;
      } catch {
        return '0.00';
      }
    }),
  );
  const anyCurrency = form.lines.some(
    (l) => acc(l.dtAccount)?.currency || acc(l.ktAccount)?.currency,
  );
  const anyQty = form.lines.some(
    (l) => acc(l.dtAccount)?.quantitative || acc(l.ktAccount)?.quantitative,
  );

  return (
    <ModuleFrame
      title={viewTitle(win.view, win.label)}
      hint={doc ? `Versiya ${doc.version}${locked ? ' · ləğv edilib' : ''}` : 'Saxlanmayıb'}
      actions={
        <>
          {doc && doc.status === 'posted' && (
            <button
              type="button"
              className="button secondary"
              onClick={() => (setReason(''), setCancel(true))}
            >
              <Ban size={15} /> Ləğv et
            </button>
          )}
          {!locked && (
            <button
              type="button"
              className="button primary"
              disabled={m.busy || (!!id && !dirty)}
              onClick={() => void save()}
            >
              <Check size={15} /> {m.busy ? 'Saxlanılır…' : id ? 'Düzəlişi uçota al' : 'Uçota al'}
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
          <table className="grid entry-grid">
            <thead>
              <tr>
                <th scope="col" className="n">
                  №
                </th>
                <th scope="col">Debet hesabı və subkonto</th>
                <th scope="col">Kredit hesabı və subkonto</th>
                {anyQty && (
                  <th scope="col" className="num narrow">
                    Miqdar
                  </th>
                )}
                {anyCurrency && (
                  <th scope="col" className="num narrow">
                    Valyuta
                  </th>
                )}
                <th scope="col" className="num narrow">
                  Məbləğ, AZN
                </th>
                <th scope="col">Məzmun</th>
                <th scope="col" className="n">
                  <span className="sr-only">Əməliyyat</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {form.lines.map((l, i) => {
                const e = err && err.line === i ? err : null;
                const dt = acc(l.dtAccount);
                const kt = acc(l.ktAccount);
                return (
                  <tr key={l.key} className={e ? 'has-error' : ''}>
                    <td className="n">{i + 1}</td>
                    <td className="side">
                      <AccountPicker
                        catalog={catalog}
                        ariaLabel={`Sətir ${i + 1} debet hesabı`}
                        value={l.dtAccount}
                        invalid={e?.side === 'dt' && e.part === 'account'}
                        onChange={(dtAccount) => setLine(i, { dtAccount, dtSk: [], dtCur: '' })}
                      />
                      <SubkontoFields
                        catalog={catalog as Catalog}
                        companyId={win.companyId}
                        account={l.dtAccount}
                        values={l.dtSk}
                        side={`Sətir ${i + 1} debet`}
                        onChange={(dtSk) => setLine(i, { dtSk })}
                        {...(e?.side === 'dt' && e.part === 'sk' && e.slot !== undefined
                          ? { errorIndex: e.slot }
                          : {})}
                      />
                    </td>
                    <td className="side">
                      <AccountPicker
                        catalog={catalog}
                        ariaLabel={`Sətir ${i + 1} kredit hesabı`}
                        value={l.ktAccount}
                        invalid={e?.side === 'kt' && e.part === 'account'}
                        onChange={(ktAccount) => setLine(i, { ktAccount, ktSk: [], ktCur: '' })}
                      />
                      <SubkontoFields
                        catalog={catalog as Catalog}
                        companyId={win.companyId}
                        account={l.ktAccount}
                        values={l.ktSk}
                        side={`Sətir ${i + 1} kredit`}
                        onChange={(ktSk) => setLine(i, { ktSk })}
                        {...(e?.side === 'kt' && e.part === 'sk' && e.slot !== undefined
                          ? { errorIndex: e.slot }
                          : {})}
                      />
                    </td>
                    {anyQty && (
                      <td className="num narrow">
                        {(dt?.quantitative || kt?.quantitative) && (
                          <input
                            aria-label={`Sətir ${i + 1} miqdar`}
                            inputMode="decimal"
                            className={e?.part === 'quantity' ? 'invalid' : ''}
                            value={l.quantity}
                            onChange={(ev) => setLine(i, { quantity: ev.target.value })}
                          />
                        )}
                      </td>
                    )}
                    {anyCurrency && (
                      <td className="num narrow">
                        {dt?.currency && (
                          <input
                            aria-label={`Sətir ${i + 1} debet valyuta məbləği`}
                            placeholder="Dt val."
                            inputMode="decimal"
                            value={l.dtCur}
                            onChange={(ev) => setLine(i, { dtCur: ev.target.value })}
                          />
                        )}
                        {kt?.currency && (
                          <input
                            aria-label={`Sətir ${i + 1} kredit valyuta məbləği`}
                            placeholder="Kt val."
                            inputMode="decimal"
                            value={l.ktCur}
                            onChange={(ev) => setLine(i, { ktCur: ev.target.value })}
                          />
                        )}
                      </td>
                    )}
                    <td className="num narrow">
                      <input
                        aria-label={`Sətir ${i + 1} məbləğ`}
                        inputMode="decimal"
                        placeholder="0,00"
                        className={e?.part === 'amount' ? 'invalid' : ''}
                        value={l.amount}
                        onChange={(ev) => setLine(i, { amount: ev.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Sətir ${i + 1} məzmun`}
                        maxLength={300}
                        value={l.memo}
                        onChange={(ev) => setLine(i, { memo: ev.target.value })}
                      />
                    </td>
                    <td className="n row-tools">
                      <button
                        type="button"
                        className="icon-button"
                        title="Sətri köçür"
                        aria-label={`Sətir ${i + 1} köçür`}
                        onClick={() =>
                          set({
                            lines: [
                              ...form.lines.slice(0, i + 1),
                              { ...l, key: ++keys },
                              ...form.lines.slice(i + 1),
                            ],
                          })
                        }
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        title="Sətri sil"
                        aria-label={`Sətir ${i + 1} sil`}
                        disabled={form.lines.length === 1}
                        onClick={() => set({ lines: form.lines.filter((_, j) => j !== i) })}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3 + (anyQty ? 1 : 0) + (anyCurrency ? 1 : 0)}>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => set({ lines: [...form.lines, blank()] })}
                  >
                    <Plus size={14} /> Sətir əlavə et
                  </button>
                </td>
                <td className="num">
                  <b>{money(total)}</b>
                </td>
                <td colSpan={2}>{form.lines.length} yazılış</td>
              </tr>
            </tfoot>
          </table>
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
