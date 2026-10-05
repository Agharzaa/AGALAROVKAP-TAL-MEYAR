import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Ban, Check, Link2, ListOrdered, Unlink, X } from 'lucide-react';
import { inFamily } from '../../domain/accounts';
import { formatMinor, parseMoney } from '../../domain/money';
import type { InvoiceSummary, PaymentDetail } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { addAmounts, day, isZero, money, toField, today } from '../format';
import { useMutation, useQuery } from '../hooks';
import { viewTitle } from '../pages';
import { Amount, Confirm, DateInput, Field, Notice, Status } from '../ui';
import { useWindow, useWorkspace } from '../workspace';
import { PostingsPanel } from './postings';

interface Form {
  reference: string;
  date: string;
  bankAccount: string;
  amount: string;
  partnerId: string;
  note: string;
  split: Record<string, string>;
}
interface Candidate {
  id: string;
  number: string;
  date: string;
  total: string;
  available: string;
}
const toMinor = (v: string) => {
  try {
    return parseMoney(v);
  } catch {
    return null;
  }
};

/** Oldest-first proposal; it only fills the cells and is saved only when the user saves. */
function oldestFirst(amount: bigint, candidates: Candidate[]): Record<string, string> {
  const result: Record<string, string> = {};
  let left = amount;
  for (const c of [...candidates].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.number.localeCompare(b.number, 'az', { numeric: true }),
  )) {
    if (left <= 0n) break;
    const available = parseMoney(c.available);
    const take = available < left ? available : left;
    if (take > 0n) {
      result[c.id] = toField(formatMinor(take));
      left -= take;
    }
  }
  return result;
}

function SplitTable({
  caption,
  candidates,
  values,
  onChange,
  available,
  notAfter,
}: {
  caption: string;
  candidates: Candidate[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  available: bigint | null;
  notAfter?: string;
}) {
  const eligible = candidates.filter((c) => !notAfter || c.date <= notAfter);
  let error = '';
  let linked = 0n;
  for (const c of eligible) {
    const raw = (values[c.id] ?? '').trim();
    if (!raw) continue;
    const v = toMinor(raw);
    if (v === null) {
      error = `${c.number}: məbləği düzgün yazın (məsələn 120,50).`;
      continue;
    }
    if (v > parseMoney(c.available)) error = `${c.number}: qalıq borc ${money(c.available)}-dir.`;
    linked += v;
  }
  const left = available === null ? null : available - linked;
  return (
    <section className="split" aria-label={caption}>
      <header className="split-heading">
        <h3>{caption}</h3>
        <button
          type="button"
          className="button secondary small"
          disabled={!available || available <= 0n || !eligible.length}
          onClick={() => onChange(oldestFirst(available ?? 0n, eligible))}
        >
          <ListOrdered size={14} /> Köhnədən bölüşdür
        </button>
        <button
          type="button"
          className="button secondary small"
          disabled={!Object.values(values).some((v) => v.trim())}
          onClick={() => onChange({})}
        >
          <X size={14} /> Təmizlə
        </button>
      </header>
      {candidates.length === 0 ? (
        <p className="split-empty">
          Bu kontragentin açıq qaiməsi yoxdur. Məbləğ avans kimi qalacaq.
        </p>
      ) : (
        <div className="split-scroll">
          <table className="split-table">
            <thead>
              <tr>
                <th scope="col">Qaimə</th>
                <th scope="col">Tarix</th>
                <th scope="col" className="num">
                  Cəmi
                </th>
                <th scope="col" className="num">
                  Qalıq borc
                </th>
                <th scope="col" className="num">
                  Bağlanan
                </th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const late = !!notAfter && c.date > notAfter;
                return (
                  <tr key={c.id} className={late ? 'muted' : ''}>
                    <td>{c.number}</td>
                    <td>
                      {day(c.date)}
                      {late && <small>ödənişdən sonrakı tarix</small>}
                    </td>
                    <td className="num">
                      <Amount value={c.total} />
                    </td>
                    <td className="num">
                      <Amount value={c.available} />
                    </td>
                    <td className="num">
                      <input
                        aria-label={`Bağlanan məbləğ · ${c.number}`}
                        inputMode="decimal"
                        disabled={late}
                        placeholder="0,00"
                        value={values[c.id] ?? ''}
                        onChange={(e) => onChange({ ...values, [c.id]: e.target.value })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <footer className="split-summary" aria-live="polite">
        <span>
          Qaimələrə: <Amount value={formatMinor(linked)} strong />
        </span>
        {left !== null && (
          <span className={left < 0n ? 'negative' : ''}>
            {left < 0n ? 'Artıq bölgü' : 'Avans qalır'}:{' '}
            <Amount value={formatMinor(left < 0n ? -left : left)} strong />
          </span>
        )}
      </footer>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function splitLines(values: Record<string, string>, candidates: Candidate[], notAfter?: string) {
  return candidates
    .filter(
      (c) =>
        (!notAfter || c.date <= notAfter) &&
        (values[c.id] ?? '').trim() &&
        toMinor(values[c.id]!) !== 0n,
    )
    .map((c) => ({ invoiceId: c.id, amount: values[c.id]!.trim() }));
}

export function PaymentEditor({ direction, id }: { direction: 'in' | 'out'; id?: string }) {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const detail = useQuery<PaymentDetail>(
    id ? { type: 'payment', companyId: win.companyId, id } : null,
  );
  const invoices = useQuery<InvoiceSummary[]>({
    type: 'invoices',
    companyId: win.companyId,
    direction: direction === 'in' ? 'sale' : 'purchase',
    from: '2000-01-01',
    to: '2099-12-31',
  });
  const [form, setForm] = useState<Form | null>(null);
  const baseline = useRef('');
  const m = useMutation();
  const [message, setMessage] = useState('');
  /** Set after a successful change: the next server copy becomes the new baseline. */
  const resync = useRef(false);
  const [later, setLater] = useState<Record<string, string>>({});
  const [laterDate, setLaterDate] = useState('');
  const [laterKey, setLaterKey] = useState(0);
  const [confirm, setConfirm] = useState<
    null | { type: 'cancel' } | { type: 'unlink'; allocationId: string; number: string }
  >(null);
  const [reason, setReason] = useState('');

  const payment = detail.data;
  // Links made on the payment date are edited in the main split; later ones are listed apart.
  const atDate = useMemo(
    () =>
      payment
        ? payment.allocations.filter((a) => a.status === 'active' && a.date === payment.date)
        : [],
    [payment],
  );
  useEffect(() => {
    if (form || !catalog) return;
    if (id && !payment) return;
    const initial: Form = payment
      ? {
          reference: payment.reference,
          date: payment.date,
          bankAccount: payment.bankAccount,
          amount: toField(payment.amount),
          partnerId: payment.partnerId,
          note: payment.note,
          split: Object.fromEntries(atDate.map((a) => [a.invoiceId, toField(a.amount)])),
        }
      : {
          reference: '',
          date: today(),
          bankAccount: '223',
          amount: '',
          partnerId: '',
          note: '',
          split: {},
        };
    baseline.current = JSON.stringify(initial);
    setForm(initial);
  }, [catalog, payment, form, id, atDate]);
  useEffect(() => {
    if (!payment || !form || !resync.current) return;
    resync.current = false;
    const next: Form = {
      reference: payment.reference,
      date: payment.date,
      bankAccount: payment.bankAccount,
      amount: toField(payment.amount),
      partnerId: payment.partnerId,
      note: payment.note,
      split: Object.fromEntries(atDate.map((a) => [a.invoiceId, toField(a.amount)])),
    };
    baseline.current = JSON.stringify(next);
    setForm(next);
  }, [payment]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!form && JSON.stringify(form) !== baseline.current;
  useEffect(() => ws.setDirty(win.id, dirty), [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (payment) ws.setLabel(win.id, payment.reference);
  }, [payment?.reference]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!catalog || !form)
    return (
      <ModuleFrame title={viewTitle(win.view, win.label)}>
        <div className="loading">{detail.error || 'Yüklənir…'}</div>
      </ModuleFrame>
    );

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const status = payment?.status;
  const locked = status === 'cancelled';
  const own = (invoiceId: string) =>
    atDate.filter((a) => a.invoiceId === invoiceId).map((a) => a.amount);
  const candidates: Candidate[] = (invoices.data ?? [])
    .filter((i) => i.partnerId === form.partnerId && i.status === 'posted')
    .map((i) => ({
      id: i.id,
      number: i.number,
      date: i.date,
      total: i.total,
      available: addAmounts([i.remaining, ...own(i.id)]),
    }))
    .filter((c) => !isZero(c.available));
  const amount = toMinor(form.amount);
  const banks = catalog.accounts.filter(
    (a) => a.postable && (inFamily(a.code, '223') || a.code === '224.04'),
  );
  const laterLinks = payment
    ? payment.allocations.filter((a) => a.status === 'active' && a.date !== payment.date)
    : [];
  const unallocated = payment ? parseMoney(payment.unallocated) : 0n;
  const openForLater: Candidate[] = (invoices.data ?? [])
    .filter(
      (i) =>
        payment &&
        i.partnerId === payment.partnerId &&
        i.status === 'posted' &&
        !isZero(i.remaining),
    )
    .map((i) => ({
      id: i.id,
      number: i.number,
      date: i.date,
      total: i.total,
      available: i.remaining,
    }));
  const laterLines = splitLines(later, openForLater);
  const laterMin = laterLines
    .map((l) => openForLater.find((c) => c.id === l.invoiceId)!.date)
    .reduce((max, d) => (d > max ? d : max), payment?.date ?? '');

  async function save() {
    if (!form || locked) return;
    setMessage('');
    const r = await m.run({
      type: 'payment.save',
      companyId: win.companyId,
      direction,
      bankAccount: form.bankAccount,
      reference: form.reference,
      date: form.date,
      partnerId: form.partnerId,
      amount: form.amount,
      note: form.note,
      allocations: splitLines(form.split, candidates, form.date),
      ...(id && payment ? { id, version: payment.version } : {}),
    });
    if (!r) return;
    setMessage(id ? 'Düzəliş uçota alındı.' : 'Ödəniş uçota alındı.');
    resync.current = true;
    if (!id) {
      baseline.current = JSON.stringify(form);
      ws.setDirty(win.id, false);
      ws.retarget(win.id, { type: 'payment', direction, id: r.id });
    } else detail.reload();
    invoices.reload();
  }

  return (
    <ModuleFrame
      title={viewTitle(win.view, win.label)}
      hint={status ? undefined : 'Saxlanmayıb'}
      actions={
        <>
          {status && <Status status={status} />}
          {id && status === 'posted' && (
            <button
              type="button"
              className="button secondary"
              onClick={() => (setReason(''), setConfirm({ type: 'cancel' }))}
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
        noValidate
        className="document"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset className="document-body" disabled={m.busy || locked}>
          <div className="document-header">
            <Field label="Bank sənədinin nömrəsi">
              <input
                required
                maxLength={80}
                autoFocus={!id}
                value={form.reference}
                onChange={(e) => set({ reference: e.target.value })}
              />
            </Field>
            <Field label="Tarix">
              <DateInput required value={form.date} onChange={(date) => set({ date })} />
            </Field>
            <Field label="Bank hesabı">
              <select
                value={form.bankAccount}
                onChange={(e) => set({ bankAccount: e.target.value })}
              >
                {banks.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Məbləğ · AZN">
              <input
                required
                inputMode="decimal"
                placeholder="0,00"
                value={form.amount}
                onChange={(e) => set({ amount: e.target.value })}
              />
            </Field>
            <Field label={direction === 'in' ? 'Ödəyici' : 'Alan'} wide>
              <select
                required
                value={form.partnerId}
                onChange={(e) => set({ partnerId: e.target.value, split: {} })}
              >
                <option value="">Kontragent seçin</option>
                {catalog.partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.taxId}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Təyinat" wide>
              <input
                maxLength={500}
                value={form.note}
                onChange={(e) => set({ note: e.target.value })}
              />
            </Field>
          </div>
          {form.partnerId && (
            <SplitTable
              caption="Qaimələr üzrə bölgü"
              candidates={candidates}
              values={form.split}
              onChange={(split) => set({ split })}
              available={amount}
              notAfter={form.date}
            />
          )}
          <p className="document-hint">
            Bütün məbləğ{' '}
            {direction === 'in'
              ? `Dt ${form.bankAccount} / Kt 211`
              : `Dt 531 / Kt ${form.bankAccount}`}{' '}
            kimi uçota alınır. Qaimələrə bağlanmayan hissə kontragentin avansıdır; bağlama yalnız
            borcların hesablaşmasını göstərir, yazılışı dəyişmir.
            {laterLinks.length > 0 &&
              ` Düzəliş saxlanarsa, sonradan edilmiş ${laterLinks.length} bağlantı açılacaq.`}
          </p>
        </fieldset>

        {payment && status === 'posted' && (
          <section className="links" aria-label="Bağlantılar">
            <h2>Qaimə bağlantıları</h2>
            {payment.allocations.length === 0 ? (
              <p className="split-empty">Hələ heç bir qaiməyə bağlanmayıb.</p>
            ) : (
              <table className="split-table">
                <thead>
                  <tr>
                    <th scope="col">Qaimə</th>
                    <th scope="col">Bağlama tarixi</th>
                    <th scope="col" className="num">
                      Məbləğ
                    </th>
                    <th scope="col">Vəziyyət</th>
                    <th scope="col">
                      <span className="sr-only">Əməliyyat</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payment.allocations.map((a) => (
                    <tr key={a.id} className={a.status === 'cancelled' ? 'muted' : ''}>
                      <td>{a.invoiceNumber}</td>
                      <td>{day(a.date)}</td>
                      <td className="num">
                        <Amount value={a.amount} />
                      </td>
                      <td>{a.status === 'active' ? 'Aktiv' : `Açılıb: ${a.reason}`}</td>
                      <td>
                        {a.status === 'active' && (
                          <button
                            type="button"
                            className="icon-button danger"
                            aria-label={`Bağlantını aç ${a.invoiceNumber}`}
                            title="Bağlantını aç"
                            onClick={() => (
                              setReason(''),
                              setConfirm({
                                type: 'unlink',
                                allocationId: a.id,
                                number: a.invoiceNumber,
                              })
                            )}
                          >
                            <Unlink size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {unallocated > 0n && !dirty && (
              <div className="later" key={laterKey}>
                <SplitTable
                  caption={`Avansı bağla · ${money(payment.unallocated)} AZN`}
                  candidates={openForLater}
                  values={later}
                  onChange={setLater}
                  available={unallocated}
                />
                <div className="later-actions">
                  <Field
                    label="Bağlama tarixi"
                    hint="Ödəniş və seçilmiş qaimələrin tarixindən əvvəl olmamalıdır."
                  >
                    <DateInput
                      min={laterMin}
                      value={laterDate || laterMin}
                      onChange={setLaterDate}
                    />
                  </Field>
                  <button
                    type="button"
                    className="button primary"
                    disabled={m.busy || laterLines.length === 0}
                    onClick={async () => {
                      const r = await m.run({
                        type: 'allocation.create',
                        companyId: win.companyId,
                        paymentId: payment.id,
                        date: laterDate || laterMin,
                        allocations: laterLines,
                      });
                      if (r) {
                        setLater({});
                        setLaterDate('');
                        setLaterKey((k) => k + 1);
                        setMessage('Avans qaimələrə bağlandı.');
                        resync.current = true;
                        detail.reload();
                        invoices.reload();
                      }
                    }}
                  >
                    <Link2 size={15} /> Qaimələrə bağla
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {payment && (
          <PostingsPanel
            postings={payment.postings}
            currentVersion={payment.version}
            accounts={catalog.accounts}
          />
        )}

        <footer className="document-actions">
          {!locked && (
            <button type="submit" className="button primary" disabled={m.busy || (!!id && !dirty)}>
              <Check size={15} /> {m.busy ? 'Saxlanılır…' : id ? 'Düzəlişi uçota al' : 'Uçota al'}
            </button>
          )}
        </footer>
      </form>
      {confirm?.type === 'cancel' && payment && (
        <Confirm
          title="Ödənişi ləğv et"
          confirmLabel="Ləğv et"
          destructive
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'payment.cancel',
              companyId: win.companyId,
              id: payment.id,
              version: payment.version,
              reason,
            });
            if (r) {
              setConfirm(null);
              setMessage('Ödəniş ləğv edildi; əks yazılış yaradıldı və bağlantılar açıldı.');
              resync.current = true;
              detail.reload();
              invoices.reload();
            }
          }}
        >
          <p>Bank yazılışı silinmir: əks yazılış yaradılır, qaimə bağlantıları açılır.</p>
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
      {confirm?.type === 'unlink' && (
        <Confirm
          title={`Bağlantını aç · ${confirm.number}`}
          confirmLabel="Bağlantını aç"
          destructive
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'allocation.cancel',
              companyId: win.companyId,
              id: confirm.allocationId,
              reason,
            });
            if (r) {
              setConfirm(null);
              setMessage('Bağlantı açıldı; bank yazılışı dəyişmədi.');
              resync.current = true;
              detail.reload();
              invoices.reload();
            }
          }}
        >
          <p>Qaimənin borcu bərpa olunur, məbləğ ödənişin avansına qayıdır.</p>
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
