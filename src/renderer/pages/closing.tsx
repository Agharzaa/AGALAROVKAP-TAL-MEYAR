/**
 * Month closing (stage 5c): a month is chosen, its steps are listed with their state, totals and
 * postings, then "Ayı bağla" (Ctrl+Enter) runs them all in one go and closes the period. Blocking
 * checks stop it; warnings are read and acknowledged ("Oxudum"). The last closed month can be
 * cancelled (storno, the lock opens again) and closed again. Below: every closing of the company.
 */
import { useState, type KeyboardEvent } from 'react';
import { Check } from '../icons';
import type {
  ClosingPosting,
  ClosingStep,
  ClosingSummary,
  ClosingView,
  Signal,
} from '../../contracts/queries';
import { ModuleFrame } from '../frame';
import { money } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages } from '../pages';
import { Amount, Confirm, Empty, Field, Notice } from '../ui';
import { useWindow, useWorkspace, type View } from '../workspace';

const dmy = (iso: string) => iso.split('-').reverse().join('.');
const stateLabel: Record<ClosingStep['state'], string> = {
  done: 'yazılış var',
  empty: 'yazılış yoxdur',
  blocked: 'dayandırılıb',
};

/** Where a signal leads: the e-qaimə box, the document, or the account card. */
const signalView = (s: Signal): View | null =>
  s.eq
    ? { type: 'page', page: s.eq === 'purchase' ? 'eqPurchase' : 'eqSale' }
    : s.invoice
      ? { type: 'invoice', direction: s.invoice.direction, id: s.invoice.id }
      : s.document
        ? { type: 'bank', direction: s.document.direction, id: s.document.id }
        : s.account
          ? { type: 'accountCard', account: s.account, sk: s.sk }
          : null;

function Postings({ postings }: { postings: ClosingPosting[] }) {
  const sk = (names: string[]) => names.filter(Boolean).join(' · ');
  return (
    <div className="table-scroll">
      <table className="grid">
        <thead>
          <tr>
            <th scope="col">Dt</th>
            <th scope="col">Subkonto Dt</th>
            <th scope="col">Kt</th>
            <th scope="col">Subkonto Kt</th>
            <th scope="col" className="num">
              Məbləğ
            </th>
            <th scope="col">Məzmun</th>
          </tr>
        </thead>
        <tbody>
          {postings.map((p, i) => (
            <tr key={i}>
              <td className="code">{p.dt}</td>
              <td className="clip">{sk(p.dtNames)}</td>
              <td className="code">{p.kt}</td>
              <td className="clip">{sk(p.ktNames)}</td>
              <td className="num">
                <Amount value={p.amount} />
              </td>
              <td className="clip">{p.memo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Step({ step, index }: { step: ClosingStep; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`closing-step ${step.state}`} aria-label={step.title}>
      <div className="section-head">
        <h2>
          {index + 1}. {step.title}
        </h2>
        <span className="closing-state">{stateLabel[step.state]}</span>
      </div>
      <p>{step.summary}</p>
      {step.notes.map((n) => (
        <p key={n} className="doc-hint">
          {n}
        </p>
      ))}
      {step.totals.length > 0 && (
        <div className="table-scroll">
          <table className="grid" aria-label="Bağlanışdan əvvəlki qalıqlar">
            <thead>
              <tr>
                <th scope="col">Hesab</th>
                <th scope="col">Adı</th>
                <th scope="col" className="num">
                  Debet
                </th>
                <th scope="col" className="num">
                  Kredit
                </th>
              </tr>
            </thead>
            <tbody>
              {step.totals.map((t) => (
                <tr key={t.account}>
                  <td className="code">{t.account}</td>
                  <td className="clip">{t.name}</td>
                  <td className="num">{t.debit === '0.00' ? '' : money(t.debit)}</td>
                  <td className="num">{t.credit === '0.00' ? '' : money(t.credit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {step.postings.length > 0 && (
        <>
          <button
            type="button"
            className="button secondary small"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            Yazılışlar ({step.postings.length})
          </button>
          {open && <Postings postings={step.postings} />}
        </>
      )}
    </li>
  );
}

function Signals({ title, signals }: { title: string; signals: Signal[] }) {
  const win = useWindow();
  const ws = useWorkspace();
  return (
    <section className="closing-signals" aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {signals.map((s, i) => {
          const view = signalView(s);
          return (
            <li key={i}>
              {s.text}{' '}
              {view && (
                <button type="button" className="link" onClick={() => ws.open(view, win.companyId)}>
                  aç
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ClosingPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const [month, setMonth] = useState(ws.period.from.slice(0, 7));
  const valid = /^\d{4}-\d{2}$/.test(month);
  const view = useQuery<ClosingView>(
    valid ? { type: 'closing', companyId: win.companyId, month } : null,
  );
  const list = useQuery<ClosingSummary[]>({ type: 'closings', companyId: win.companyId });
  const m = useMutation();
  const [read, setRead] = useState(false);
  const [message, setMessage] = useState('');
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const v = view.data && view.data.month === month ? view.data : undefined;
  const page = pages.closing;
  const reload = () => {
    view.reload();
    list.reload();
  };
  const canClose = !!v && !v.posted && !v.blocking.length && (read || !v.warnings.length);
  async function run() {
    if (!canClose) return;
    setMessage('');
    const r = await m.run({
      type: 'closing.post',
      companyId: win.companyId,
      month,
      acknowledged: read,
      ...(v!.cancelled ? { version: v!.cancelled.version } : {}),
    });
    if (r) {
      setMessage(`${r.number} uçota alındı: dövr ${dmy(v!.date)} daxil olmaqla bağlandı.`);
      setRead(false);
      reload();
    }
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      void run();
    }
  };
  return (
    <div className="closing" onKeyDown={onKeyDown}>
      <ModuleFrame
        title={page.title}
        hint={page.hint}
        onRefresh={reload}
        actions={
          <>
            {v && !v.posted && (
              <button
                type="button"
                className="button primary"
                disabled={m.busy || !canClose}
                title="Ctrl+Enter"
                onClick={() => void run()}
              >
                <Check size={15} /> Ayı bağla
              </button>
            )}
            {v?.posted && (
              <button
                type="button"
                className="button secondary push-right"
                disabled={!!v.cancelBlocked}
                title={v.cancelBlocked || undefined}
                onClick={() => (setReason(''), setCancel(true))}
              >
                Ləğv et
              </button>
            )}
          </>
        }
        filters={
          <label className="filter-text">
            <span>Ay</span>
            <input
              type="month"
              aria-label="Ay"
              value={month}
              onChange={(e) => (setMonth(e.target.value), setRead(false))}
            />
          </label>
        }
        notices={
          <>
            {view.error && <Notice>{view.error}</Notice>}
            {v?.posted && (
              <Notice kind="info">
                {v.posted.number} uçotdadır (versiya {v.posted.version}): dövr {dmy(v.date)} daxil
                olmaqla bağlıdır.
                {v.cancelBlocked ? ` ${v.cancelBlocked}` : ''}
              </Notice>
            )}
            {v?.cancelled && !v.posted && (
              <Notice kind="info">
                {v.cancelled.number} ləğv edilib: yenidən bağlanış yeni versiya olacaq.
              </Notice>
            )}
            {m.error && <Notice onClose={m.clear}>{m.error.message}</Notice>}
            {message && (
              <Notice kind="success" onClose={() => setMessage('')}>
                {message}
              </Notice>
            )}
          </>
        }
      >
        {!valid ? (
          <Empty title="Ayı seçin" />
        ) : !v ? (
          <div className="loading">Yüklənir…</div>
        ) : (
          <>
            {v.blocking.length > 0 && (
              <Signals title="Bağlanışı dayandıran yoxlamalar" signals={v.blocking} />
            )}
            {v.warnings.length > 0 && (
              <>
                <Signals title="Xəbərdarlıqlar" signals={v.warnings} />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={read}
                    onChange={(e) => setRead(e.target.checked)}
                  />{' '}
                  Oxudum — xəbərdarlıqlarla bağlamaq olar
                </label>
              </>
            )}
            {v.posted && v.posted.warnings.length > 0 && (
              <section className="closing-signals" aria-label="Oxunmuş xəbərdarlıqlar">
                <h2>Bağlanışda oxunmuş xəbərdarlıqlar</h2>
                <ul>
                  {v.posted.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </section>
            )}
            <ol className="closing-steps">
              {v.steps.map((s, i) => (
                <Step key={s.key} step={s} index={i} />
              ))}
            </ol>
          </>
        )}
        {!!list.data?.length && (
          <section aria-label="Ay bağlanışları">
            <div className="section-head">
              <h2>Ay bağlanışları</h2>
            </div>
            <div className="table-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th scope="col">Ay</th>
                    <th scope="col">Nömrə</th>
                    <th scope="col">Vəziyyət</th>
                    <th scope="col" className="num">
                      Nəticə (801)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((c) => (
                    <tr
                      key={c.id}
                      className={c.month === month ? 'selected' : undefined}
                      onClick={() => (setMonth(c.month), setRead(false))}
                    >
                      <td>{c.month}</td>
                      <td>{c.number}</td>
                      <td>{c.status === 'posted' ? 'uçotda' : 'ləğv edilib'}</td>
                      <td className="num">
                        <Amount value={c.profit} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </ModuleFrame>
      {cancel && v?.posted && (
        <Confirm
          title={`Ay bağlanışını ləğv et · ${v.posted.number}`}
          confirmLabel="Ləğv et"
          destructive
          onCancel={() => setCancel(false)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'closing.cancel',
              companyId: win.companyId,
              id: v.posted!.id,
              version: v.posted!.version,
              reason,
            });
            if (r) {
              setCancel(false);
              setMessage('Ay bağlanışı ləğv edildi: yazılışları storno edildi, dövr açıldı.');
              reload();
            }
          }}
        >
          <p>
            Bağlanışın bütün yazılışları qırmızı storno ilə ləğv olunur, dövrün kilidi bağlanışdan
            əvvəlki tarixə qayıdır. Yenidən qiymətləndirmə (YQ-) ayrıca sənəddir və uçotda qalır.
          </p>
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
    </div>
  );
}
