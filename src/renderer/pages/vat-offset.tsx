/**
 * The month's purchase VAT offset document (ƏƏ-2026-10; QERARLAR 2026-10-30). "Doldur" lists the
 * purchase invoices whose VAT the rule offsets this month — the e-qaimə confirmed by DVX and the
 * VAT paid through the deposit — and the accountant adds, deletes and changes lines before posting
 * it (Dt 521.01 / Kt 241). The month closing takes the posted document as it is.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, RefreshCw, Trash2 } from '../icons';
import type { VatOffsetLineView, VatOffsetView } from '../../contracts/queries';
import { ModuleFrame } from '../frame';
import { MonthFilter } from '../filters';
import { addAmounts, day, money, toField } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages } from '../pages';
import { Picker } from '../picker';
import { Confirm, Empty, Field, Notice } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

interface Line {
  invoiceId: string;
  amount: string;
}

/** "1 234,50" or "-300" as typed → canonical "1234.50" / "-300.00" ('' when not a number). */
function canonical(value: string): string {
  const text = value.replace(/[\s ]/g, '').replace(',', '.');
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return '';
  return `${m[1]}${BigInt(m[2]!)}.${(m[3] ?? '').padEnd(2, '0')}`;
}

const fromView = (lines: readonly VatOffsetLineView[]): Line[] =>
  lines.map((l) => ({ invoiceId: l.invoiceId, amount: toField(l.amount) }));

export function VatOffsetPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const [month, setMonth] = useState(ws.period.from.slice(0, 7));
  const valid = /^\d{4}-\d{2}$/.test(month);
  const view = useQuery<VatOffsetView>(
    valid ? { type: 'vatOffset', companyId: win.companyId, month } : null,
  );
  const m = useMutation();
  const [message, setMessage] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState('');
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const v = view.data && view.data.month === month ? view.data : undefined;
  const page = pages.vatOffset;

  // A fresh month (or the document saved again): the posted lines, else what "Doldur" gives.
  const loaded = v ? `${v.month}|${v.posted?.version ?? 0}` : '';
  useEffect(() => {
    if (!v) return;
    setLines(fromView(v.posted ? v.posted.lines : v.proposal));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const info = useMemo(() => {
    const map = new Map<string, VatOffsetLineView>();
    for (const l of [...(v?.candidates ?? []), ...(v?.posted?.lines ?? []), ...(v?.proposal ?? [])])
      if (!map.has(l.invoiceId)) map.set(l.invoiceId, l);
    return map;
  }, [v]);
  const options = (v?.candidates ?? [])
    .filter((c) => !lines.some((l) => l.invoiceId === c.invoiceId))
    .map((c) => ({
      value: c.invoiceId,
      label: `${c.number} · ${day(c.date)} · ${c.partner}`,
      hint: `241-də ${money(c.open)} · əvəzləşib ${money(c.offset)}`,
    }));
  const readOnly = !v || v.closed;
  const amounts = lines.map((l) => canonical(l.amount));
  const total = amounts.every(Boolean) ? addAmounts(amounts) : '';

  const change = (next: Line[]) => (setLines(next), setDirty(true));
  function fill() {
    if (!v) return;
    change(fromView(v.proposal));
    setMessage(
      v.proposal.length
        ? `Doldur: ${v.proposal.length} qaimə · ${money(v.proposalTotal)}.`
        : 'Doldur: bu ay əvəzləşdiriləcək ƏDV yoxdur.',
    );
  }
  function add(invoiceId: string) {
    const c = info.get(invoiceId);
    if (!c) return;
    const amount = c.proposal !== '0.00' ? c.proposal : c.open;
    change([...lines, { invoiceId, amount: toField(amount) }]);
    setAdding('');
  }
  async function save() {
    setMessage('');
    const r = await m.run({
      type: 'vatOffset.save',
      companyId: win.companyId,
      month,
      ...(v?.posted ? { version: v.posted.version } : {}),
      lines: lines.map((l, i) => ({ invoiceId: l.invoiceId, amount: amounts[i] || l.amount })),
    });
    if (r) {
      setMessage(`${r.number} uçota alındı (versiya ${r.version}).`);
      view.reload();
    }
  }

  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      onRefresh={view.reload}
      actions={
        <>
          {!readOnly && (
            <button type="button" className="button secondary" onClick={fill}>
              <RefreshCw size={15} /> Doldur
            </button>
          )}
          {!readOnly && (!v!.posted || dirty) && (
            <button
              type="button"
              className="button primary"
              disabled={m.busy}
              onClick={() => void save()}
            >
              <Check size={15} /> {v!.posted ? 'Yadda saxla' : 'Uçota al'}
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
      filters={<MonthFilter value={month} onChange={setMonth} />}
      notices={
        <>
          {view.error && <Notice>{view.error}</Notice>}
          {v?.error && <Notice>{v.error}</Notice>}
          {v?.closed && <Notice kind="info">Bu ay bağlı dövrdədir: sənəd dəyişdirilmir.</Notice>}
          {v && !v.posted && !v.closed && (
            <Notice kind="info">
              {v.number} hələ uçotda deyil. Ay bağlanışı onu özü doldurub uçota alacaq; əvvəlcə
              yoxlamaq və dəyişmək üçün "Uçota al" düyməsini basın.
            </Notice>
          )}
          {v?.posted?.differs && !dirty && (
            <Notice kind="warning">
              "Doldur" indi başqa nəticə verir ({v.proposal.length} qaimə · {money(v.proposalTotal)}
              ): sənəd əl ilə dəyişdirilib və ya ödənişlər sonra dəyişib.
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
            {v.number} · {day(v.date)}: Dt 521.01 ("Vergi (haqq)") / Kt 241. "Doldur" — DVX-də
            təsdiqlənmiş e-qaiməsi olan və ƏDV-si ay sonuna qədər ƏDV depozit hesabından ödənilmiş
            alış qaimələri (əvvəl əvəzləşən çıxılır); ödəniş azalıbsa və ya e-qaimə ləğv edilibsə —
            mənfi (geri alma). Sətri əl ilə əlavə etmək, silmək və məbləği dəyişmək olar.
          </p>
          <section className="invoice-postings" aria-label="Sətirlər">
            <div className="section-head">
              <h2>
                {v.posted ? `${v.posted.number} · uçotda (versiya ${v.posted.version})` : v.number}
                {total && ` · cəmi ${money(total)}`}
              </h2>
            </div>
            {lines.length === 0 ? (
              <Empty title="Sətir yoxdur">
                {readOnly ? '' : '"Doldur" basın və ya aşağıdan qaimə əlavə edin.'}
              </Empty>
            ) : (
              <div className="table-scroll">
                <table className="grid">
                  <thead>
                    <tr>
                      <th scope="col">Qaimə</th>
                      <th scope="col">Tarix</th>
                      <th scope="col">Təchizatçı</th>
                      <th scope="col">VÖEN</th>
                      <th scope="col">E-qaimə</th>
                      <th scope="col">DVX</th>
                      <th scope="col" className="num">
                        Qaimənin ƏDV-si
                      </th>
                      <th scope="col" className="num" title="Bu sənəddən əvvəl 241-də qalan">
                        241-də
                      </th>
                      <th scope="col" className="num" title="ƏDV depozit hesabından ödənilib">
                        Ödənilib
                      </th>
                      <th scope="col" className="num">
                        Doldur
                      </th>
                      <th scope="col" className="num">
                        Əvəzləşdirilir
                      </th>
                      <th scope="col">
                        <span className="sr-only">Əməliyyat</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const c = info.get(l.invoiceId);
                      const bad = !amounts[i];
                      const byHand = !!c && amounts[i] !== c.proposal;
                      return (
                        <tr key={l.invoiceId} className={bad ? 'invalid' : ''}>
                          <td className="code">{c?.number ?? ''}</td>
                          <td>{c ? day(c.date) : ''}</td>
                          <td className="clip">{c?.partner ?? ''}</td>
                          <td className="code">{c?.taxId ?? ''}</td>
                          <td className="code">{c?.eq || '—'}</td>
                          <td>{c?.confirmed ? 'təsdiqlənib' : '—'}</td>
                          <td className="num">{money(c?.invoiceVat ?? '0.00')}</td>
                          <td className="num">{money(c?.open ?? '0.00')}</td>
                          <td className="num">{money(c?.paid ?? '0.00')}</td>
                          <td className="num">{money(c?.proposal ?? '0.00')}</td>
                          <td className="num">
                            {readOnly ? (
                              money(amounts[i] || l.amount)
                            ) : (
                              <input
                                className="num"
                                aria-label={`Sətir ${i + 1}: əvəzləşdirilir`}
                                inputMode="decimal"
                                value={l.amount}
                                title={byHand ? 'Əl ilə dəyişdirilib' : undefined}
                                onChange={(e) =>
                                  change(
                                    lines.map((x, j) =>
                                      j === i ? { ...x, amount: e.target.value } : x,
                                    ),
                                  )
                                }
                              />
                            )}
                          </td>
                          <td>
                            {!readOnly && (
                              <button
                                type="button"
                                className="icon-button"
                                aria-label={`Sətir ${i + 1}: sil`}
                                title="Sətri sil"
                                onClick={() => change(lines.filter((_, j) => j !== i))}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!readOnly && (
              <Field
                label="Qaimə əlavə et"
                hint="241-də ƏDV-si olan və ya əvvəl əvəzləşmiş alış qaimələri; məbləği sonra dəyişin."
              >
                <Picker
                  ariaLabel="Qaimə əlavə et"
                  placeholder={options.length ? 'Qaimə seçin' : 'Başqa qaimə yoxdur'}
                  disabled={!options.length}
                  value={adding}
                  options={options}
                  onChange={(id) => add(id)}
                />
              </Field>
            )}
          </section>
          {(v.notes.length > 0 || v.waiting.length > 0) && (
            <section aria-label="Qeydlər">
              {[...v.notes, ...v.waiting].map((n) => (
                <p key={n} className="doc-hint">
                  {n}
                </p>
              ))}
            </section>
          )}
        </>
      )}
      {cancel && v?.posted && (
        <Confirm
          title={`ƏDV əvəzləşdirilməsini ləğv et · ${v.posted.number}`}
          confirmLabel="Ləğv et"
          destructive
          onCancel={() => setCancel(false)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'vatOffset.cancel',
              companyId: win.companyId,
              id: v.posted!.id,
              version: v.posted!.version,
              reason,
            });
            if (r) {
              setCancel(false);
              setMessage('ƏDV əvəzləşdirilməsi ləğv edildi: yazılışları storno edildi.');
              view.reload();
            }
          }}
        >
          <p>
            Yazılışlar qırmızı storno ilə ləğv olunur, ƏDV 241-ə qayıdır. Ay bağlanışı sənəd olmadan
            onu yenidən özü doldurar.
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
