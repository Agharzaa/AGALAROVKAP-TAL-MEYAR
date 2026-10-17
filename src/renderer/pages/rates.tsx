/**
 * Currency rates catalog and the month's revaluation (stage 5b). Rates are the official AMB ones,
 * shared by all companies: loaded from cbar.az on request (never by themselves) or typed by hand.
 * The revaluation page shows, for a month, every currency balance at the month-end rate and the
 * difference it would post to 611 / 731; posting again replaces the previous one (storno).
 */
import { useState } from 'react';
import { Check, FileDown as Download, Plus } from '../icons';
import { currencies } from '../../domain/chart';
import { monthEnd } from '../../domain/rates';
import type { RateView, RevaluationLine, RevaluationView } from '../../contracts/queries';
import { api } from '../api';
import { ModuleFrame } from '../frame';
import { RangeFields, useRange } from '../filters';
import { day, money, toField } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages } from '../pages';
import { loadAmb } from '../rates';
import { Amount, Confirm, DateInput, Empty, Field, Modal, Notice } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

const dmy = (iso: string) => iso.split('-').reverse().join('.');
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Loads AMB files with progress; shared by both pages. */
function useAmbLoader(companyId: string, done: () => void) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function run(from: string, to: string) {
    setError('');
    setMessage('');
    try {
      const r = await loadAmb(companyId, from, to, (i, n) =>
        setBusy(`AMB-dən yüklənir… ${i + 1} / ${n}`),
      );
      setMessage(
        r.loaded
          ? `AMB: ${r.loaded} bülleten yükləndi — ${r.added} yeni, ${r.updated} dəyişdi.${r.empty.length ? ` ${r.empty.length} gün üçün ayrıca bülleten yoxdur (istirahət, bayram və ya gələcək gün — əvvəlki məzənnə qüvvədədir).` : ''}`
          : `${dmy(from)} – ${dmy(to)} üçün AMB faylı tapılmadı.`,
      );
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return { busy, message, error, run, clear: () => (setMessage(''), setError('')) };
}

export function RatesPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const range = useRange(ws.period);
  const [currency, setCurrency] = useState('');
  const page = pages.rates;
  const list = useQuery<RateView[]>({
    type: 'rates',
    companyId: win.companyId,
    ...range.applied,
    ...(currency ? { currency } : {}),
  });
  const amb = useAmbLoader(win.companyId, list.reload);
  const m = useMutation();
  const [manual, setManual] = useState<{ date: string; currency: string; rate: string } | null>(
    null,
  );
  const rows = list.data ?? [];
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      count={rows.length}
      onRefresh={list.reload}
      onFilter={range.apply}
      actions={
        <>
          <button
            type="button"
            className="button primary"
            disabled={!!amb.busy || !api.hasAmb}
            title={
              api.hasAmb
                ? `${dmy(range.applied.from)} – ${dmy(range.applied.to)} üçün cbar.az-dan`
                : 'Yalnız masaüstü proqramda'
            }
            onClick={() => void amb.run(range.applied.from, range.applied.to)}
          >
            <Download size={15} /> {amb.busy || 'AMB-dən yüklə'}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              setManual({
                date: range.applied.to,
                currency: currency || 'USD',
                rate: '',
              })
            }
          >
            <Plus size={15} /> Əl ilə
          </button>
        </>
      }
      filters={
        <>
          <RangeFields range={range} />
          <label className="filter-text">
            <span>Valyuta</span>
            <select
              aria-label="Valyuta"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="">Hamısı</option>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </>
      }
      notices={
        <>
          {list.error && <Notice>{list.error}</Notice>}
          {amb.error && <Notice onClose={amb.clear}>{amb.error}</Notice>}
          {amb.message && (
            <Notice kind="success" onClose={amb.clear}>
              {amb.message}
            </Notice>
          )}
        </>
      }
    >
      {rows.length ? (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Tarix</th>
                <th scope="col">Valyuta</th>
                <th scope="col" className="num">
                  Məzənnə, AZN
                </th>
                <th scope="col">Mənbə</th>
                <th scope="col">Yazıb</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.date}${r.currency}`}
                  onDoubleClick={() =>
                    setManual({ date: r.date, currency: r.currency, rate: toField(r.rate) })
                  }
                >
                  <td>{day(r.date)}</td>
                  <td>{r.currency}</td>
                  <td className="num">{toField(r.rate)}</td>
                  <td>{r.source === 'amb' ? 'AMB' : 'əl ilə'}</td>
                  <td>
                    {r.actor} · {day(r.loadedAt.slice(0, 10))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Bu dövrdə məzənnə yoxdur">
          “AMB-dən yüklə” seçilmiş dövrün hər günü üçün cbar.az-ın rəsmi faylını yükləyir.
        </Empty>
      )}
      {manual && (
        <Modal title="Məzənnə (əl ilə)" onClose={() => setManual(null)}>
          <form
            className="dialog-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await m.run({
                type: 'rates.save',
                companyId: win.companyId,
                date: manual.date,
                source: 'manual',
                rates: [{ currency: manual.currency, rate: manual.rate }],
              });
              if (r) {
                setManual(null);
                list.reload();
              }
            }}
          >
            <Field label="Tarix">
              <DateInput
                aria-label="Tarix"
                value={manual.date}
                onChange={(date) => setManual({ ...manual, date })}
              />
            </Field>
            <Field label="Valyuta">
              <select
                aria-label="Valyuta"
                value={manual.currency}
                onChange={(e) => setManual({ ...manual, currency: e.target.value })}
              >
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Məzənnə" hint="1 vahid üçün, AZN, 4 onluq">
              <input
                aria-label="Məzənnə"
                autoFocus
                inputMode="decimal"
                placeholder="1,7000"
                value={manual.rate}
                onChange={(e) => setManual({ ...manual, rate: e.target.value })}
              />
            </Field>
            {m.error && <Notice>{m.error.message}</Notice>}
            <div className="form-actions">
              <button type="submit" className="button primary" disabled={m.busy}>
                <Check size={15} /> Saxla
              </button>
            </div>
          </form>
        </Modal>
      )}
    </ModuleFrame>
  );
}

function Lines({ lines }: { lines: RevaluationLine[] }) {
  return (
    <div className="table-scroll">
      <table className="grid">
        <thead>
          <tr>
            <th scope="col">Hesab</th>
            <th scope="col">Subkonto</th>
            <th scope="col" className="num">
              Valyuta qalığı
            </th>
            <th scope="col" className="num">
              Məzənnə
            </th>
            <th scope="col" className="num">
              Uçotda, AZN
            </th>
            <th scope="col" className="num">
              Məzənnə ilə, AZN
            </th>
            <th scope="col" className="num">
              Fərq
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={`${l.account}|${l.sk.join('|')}`}>
              <td className="code">{l.account}</td>
              <td className="clip">{l.skNames.filter(Boolean).join(' · ')}</td>
              <td className="num">
                {money(l.curBalance)} {l.currency}
              </td>
              <td className="num" title={dmy(l.rateDate)}>
                {toField(l.rate)}
              </td>
              <td className="num">{money(l.booked)}</td>
              <td className="num">{money(l.value)}</td>
              <td className="num">
                <Amount value={l.difference} strong />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RevaluationPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const [month, setMonth] = useState(ws.period.from.slice(0, 7));
  const valid = /^\d{4}-\d{2}$/.test(month);
  const view = useQuery<RevaluationView>(
    valid ? { type: 'revaluation', companyId: win.companyId, month } : null,
  );
  const amb = useAmbLoader(win.companyId, view.reload);
  const m = useMutation();
  const [message, setMessage] = useState('');
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const v = view.data && view.data.month === month ? view.data : undefined;
  const page = pages.revaluation;
  async function post() {
    setMessage('');
    const r = await m.run({ type: 'revaluation.post', companyId: win.companyId, month });
    if (r) {
      setMessage(`${r.number} uçota alındı (versiya ${r.version}).`);
      view.reload();
    }
  }
  const canPost = !!v && !v.closed && !v.error && !v.missingRates.length;
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      onRefresh={view.reload}
      actions={
        <>
          {canPost && !v!.posted && v!.proposal.length > 0 && (
            <button
              type="button"
              className="button primary"
              disabled={m.busy}
              onClick={() => void post()}
            >
              <Check size={15} /> Uçota al
            </button>
          )}
          {canPost && v!.posted?.stale && (
            <button
              type="button"
              className="button primary"
              disabled={m.busy}
              onClick={() => void post()}
            >
              <Check size={15} /> Yenidən uçota al
            </button>
          )}
          {v?.posted && !v.closed && (
            <button
              type="button"
              className="button secondary push-right"
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
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
      }
      notices={
        <>
          {view.error && <Notice>{view.error}</Notice>}
          {v?.error && <Notice>{v.error}</Notice>}
          {v?.closed && (
            <Notice kind="info">
              Bu ay bağlı dövrdədir: yenidən qiymətləndirmə dəyişdirilmir.
            </Notice>
          )}
          {v && v.missingRates.length > 0 && (
            <Notice kind="warning">
              {dmy(v.date)} üçün AMB məzənnəsi yoxdur: {v.missingRates.join(', ')}.{' '}
              {api.hasAmb && (
                <button
                  type="button"
                  className="button secondary small"
                  disabled={!!amb.busy}
                  onClick={() => void amb.run(shift(v.date, -6), v.date)}
                >
                  {amb.busy || 'AMB-dən yüklə'}
                </button>
              )}
            </Notice>
          )}
          {v?.posted?.stale && (
            <Notice kind="warning">
              {v.posted.number} uçota alınandan sonra qalıqlar dəyişib — yenidən uçota alın.
            </Notice>
          )}
          {amb.error && <Notice onClose={amb.clear}>{amb.error}</Notice>}
          {amb.message && (
            <Notice kind="success" onClose={amb.clear}>
              {amb.message}
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
          <p className="doc-hint">
            {dmy(monthEnd(month))} tarixinə: valyuta qalığı × AMB məzənnəsi − uçotdakı manat qalığı.
            Artım Kt 611, azalma Dt 731 ("Məzənnə fərqi"); valyuta məbləği dəyişmir.
            {v.rates.length > 0 &&
              ` Məzənnələr: ${v.rates.map((r) => `${r.currency} ${toField(r.rate)} (${dmy(r.date)})`).join(', ')}.`}
          </p>
          {v.posted && (
            <section className="invoice-postings" aria-label="Uçotda">
              <div className="section-head">
                <h2>
                  {v.posted.number} · uçotda (versiya {v.posted.version}) · gəlir{' '}
                  {money(v.posted.income)} · xərc {money(v.posted.expense)}
                </h2>
              </div>
              <Lines lines={v.posted.lines} />
            </section>
          )}
          {(!v.posted || v.posted.stale) &&
            (v.proposal.length ? (
              <section className="invoice-postings" aria-label="Hesablama">
                <div className="section-head">
                  <h2>
                    {v.posted ? 'İndi uçota alınsa' : 'Hesablama'} · gəlir 611: {money(v.income)} ·
                    xərc 731: {money(v.expense)}
                  </h2>
                </div>
                <Lines lines={v.proposal} />
              </section>
            ) : (
              !v.error &&
              !v.missingRates.length && (
                <Empty title="Fərq yoxdur">
                  Valyuta qalıqları {dmy(v.date)} tarixinin məzənnəsi ilə uyğundur.
                </Empty>
              )
            ))}
        </>
      )}
      {cancel && v?.posted && (
        <Confirm
          title={`Yenidən qiymətləndirməni ləğv et · ${v.posted.number}`}
          confirmLabel="Ləğv et"
          destructive
          onCancel={() => setCancel(false)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'revaluation.cancel',
              companyId: win.companyId,
              id: v.posted!.id,
              version: v.posted!.version,
              reason,
            });
            if (r) {
              setCancel(false);
              setMessage('Yenidən qiymətləndirmə ləğv edildi: yazılışları storno edildi.');
              view.reload();
            }
          }}
        >
          <p>
            Yazılışlar qırmızı storno ilə ləğv olunur; istifadə olunan məzənnələr yenidən
            dəyişdirilə bilər.
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
    </ModuleFrame>
  );
}
