/**
 * Bank document (stage 3a): receipt ("Bank daxilolması") or payment ("Bank məxarici"). The bank
 * account gives one side of every posting; each line names the counter account with its subkonto.
 * A 211 line of a receipt (531 of a payment) left without a settlement document is matched to the
 * open invoices by the server; the entry under the form shows where the money went.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Ban, Check, CheckCheck, Copy, Plus, Trash2 } from '../icons';
import { formatMinor, parseMoney } from '../../domain/money';
import { AZN_RATE, toAzn } from '../../domain/invoice';
import { parsePrice } from '../../domain/quantity';
import type { BankLineInput } from '../../contracts/commands';
import type { BankDocumentDetail, Catalog } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { entryErrorAt } from '../entry-grid';
import { ModuleFrame } from '../frame';
import { day, money, toField } from '../format';
import { useMutation, useQuery } from '../hooks';
import { viewTitle } from '../pages';
import { AccountPicker, Picker, SubkontoFields, type Option } from '../picker';
import { Postings, todayIso } from '../postings';
import { Confirm, DateInput, Field, Notice } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

type Direction = 'in' | 'out';
interface LineForm {
  key: number;
  account: string;
  sk: string[];
  amount: string;
  curAmount: string;
  memo: string;
}
interface Form {
  number: string;
  date: string;
  bankAccountId: string;
  rate: string;
  bankReference: string;
  counterpartyName: string;
  counterpartyTaxId: string;
  purpose: string;
  lines: LineForm[];
}

let keys = 0;
const blank = (account = ''): LineForm => ({
  key: ++keys,
  account,
  sk: [],
  amount: '',
  curAmount: '',
  memo: '',
});

/**
 * "Əməliyyat növü": a template that only fills the counter account of the line (QERARLAR
 * 2026-10-07: the counter account stays free). Settlement accounts follow the bank currency.
 */
const templates: Record<Direction, { label: string; accounts: string[] }[]> = {
  in: [
    { label: 'Alıcıdan ödəniş', accounts: ['211'] },
    { label: 'Malsatandan qaytarma', accounts: ['243'] },
    { label: 'Kreditin alınması', accounts: ['501'] },
    { label: 'Nizamnamə kapitalına qoyuluş', accounts: ['301'] },
    { label: 'Öz hesabından köçürmə', accounts: ['222.01'] },
    { label: 'Vergi qaytarılması', accounts: ['521.01'] },
  ],
  out: [
    { label: 'Malsatana ödəniş', accounts: ['531'] },
    { label: 'Alıcıya qaytarma', accounts: ['543'] },
    { label: 'Kreditin və faizin ödənişi', accounts: ['501', '751'] },
    { label: 'Vergi ödənişi', accounts: ['521.01'] },
    { label: 'Əmək haqqının ödənişi', accounts: ['533'] },
    { label: 'Bank xidməti', accounts: ['721'] },
    { label: 'Öz hesabına köçürmə', accounts: ['222.01'] },
    { label: 'Dividend ödənişi', accounts: ['534.01'] },
  ],
};
const settlementGroups = ['211', '531', '243', '543'];
const resolve = (code: string, foreign: boolean) =>
  settlementGroups.includes(code) ? `${code}.${foreign ? '02' : '01'}` : code;

function fromDetail(d: BankDocumentDetail): Form {
  return {
    number: d.number,
    date: d.date,
    bankAccountId: d.bankAccountId,
    rate: d.currency === 'AZN' ? '' : toField(d.rate),
    bankReference: d.bankReference,
    counterpartyName: d.counterpartyName,
    counterpartyTaxId: d.counterpartyTaxId,
    purpose: d.purpose,
    lines: d.lines.map((l) => ({
      key: ++keys,
      account: l.account,
      sk: l.sk,
      amount: toField(l.amount),
      curAmount: toField(l.curAmount),
      memo: l.memo,
    })),
  };
}

const toInput = (l: LineForm): BankLineInput => ({
  account: l.account,
  sk: l.sk,
  amount: l.amount.trim(),
  ...(l.curAmount.trim() ? { curAmount: l.curAmount.trim() } : {}),
  memo: l.memo,
});

const minor = (value: string): bigint | null => {
  try {
    return parseMoney(value.trim());
  } catch {
    return null;
  }
};

export function BankEditor({ direction, id }: { direction: Direction; id?: string }) {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const detail = useQuery<BankDocumentDetail>(
    id ? { type: 'bankDocument', companyId: win.companyId, id } : null,
  );
  const [form, setForm] = useState<Form | null>(null);
  const baseline = useRef('');
  const resync = useRef(false);
  const m = useMutation();
  const [message, setMessage] = useState('');
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const doc = detail.data;
  const incoming = direction === 'in';
  const snapshot = (f: Form) => JSON.stringify({ ...f, lines: f.lines.map(toInput) });

  useEffect(() => {
    if (form || !catalog) return;
    if (id && !doc) return;
    const accounts = catalog.bankAccounts.filter((b) => !b.archived);
    const initial: Form = doc
      ? fromDetail(doc)
      : {
          number: '',
          date: ws.period.to < todayIso() ? ws.period.to : todayIso(),
          bankAccountId: accounts.length === 1 ? accounts[0]!.id : '',
          rate: '',
          bankReference: '',
          counterpartyName: '',
          counterpartyTaxId: '',
          purpose: '',
          lines: [blank()],
        };
    baseline.current = snapshot(initial);
    setForm(initial);
  }, [doc, form, id, catalog]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const bankOptions = useMemo(
    (): Option[] =>
      (catalog?.bankAccounts ?? [])
        .filter((b) => !b.archived || b.id === form?.bankAccountId)
        .map((b) => ({
          value: b.id,
          label: `${b.account} · ${b.name || b.bankName}`,
          hint: `${b.iban} · ${b.currency}`,
        })),
    [catalog, form?.bankAccountId],
  );

  const locked = doc?.status === 'cancelled';
  async function save(close = false) {
    if (!form || locked || m.busy) return;
    setMessage('');
    const r = await m.run({
      type: 'bank.save',
      companyId: win.companyId,
      direction,
      number: form.number,
      date: form.date,
      bankAccountId: form.bankAccountId,
      rate: form.rate.trim(),
      bankReference: form.bankReference,
      counterpartyName: form.counterpartyName,
      counterpartyTaxId: form.counterpartyTaxId,
      purpose: form.purpose,
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
      ws.retarget(win.id, { type: 'bank', direction, id: r.id });
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
  const setLine = (i: number, patch: Partial<LineForm>) =>
    set({ lines: form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const headerError = (field: string) => (m.error?.field === field ? m.error.message : undefined);
  const err = entryErrorAt(m.error?.field);
  const bank = catalog.bankAccounts.find((b) => b.id === form.bankAccountId);
  const currency = bank?.currency ?? 'AZN';
  const foreign = currency !== 'AZN';
  const acc = (code: string) => catalog.accounts.find((a) => a.code === code);
  let rate: bigint | null = AZN_RATE;
  if (foreign)
    try {
      rate = parsePrice(form.rate.trim());
    } catch {
      rate = null;
    }
  const amounts = form.lines.map((l) => minor(l.amount));
  const total = amounts.reduce<bigint>((s, a) => s + (a ?? 0n), 0n);
  const totalAzn =
    rate === null ? null : amounts.reduce<bigint>((s, a) => s + (a ? toAzn(a, rate!) : 0n), 0n);
  const showCur = !foreign && form.lines.some((l) => acc(l.account)?.currency);
  const applyTemplate = (label: string) => {
    const t = templates[direction].find((x) => x.label === label);
    if (!t) return;
    const empty = form.lines.every((l) => !l.account && !l.amount.trim());
    const lines = t.accounts.map((code) => blank(resolve(code, foreign)));
    set({
      lines: empty ? lines : [...form.lines, ...lines],
      purpose: form.purpose || t.label,
    });
  };
  const autoMatch = (l: LineForm) => {
    const a = acc(l.account);
    return (
      !!a &&
      a.subkonto[2] === 'document' &&
      (incoming ? l.account.startsWith('211') : l.account.startsWith('531'))
    );
  };

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
          {doc && (
            <button
              type="button"
              className="button secondary"
              title="Sənədin yazılışlarına keç"
              onClick={() =>
                document
                  .getElementById(`postings-${win.id}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              <span className="dtkt" aria-hidden="true">
                Dt
                <br />
                Kt
              </span>
              Yazılışlar
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
        <fieldset className="doc-header invoice-header" disabled={m.busy || locked}>
          <Field
            label="Nömrə"
            hint={id ? undefined : 'Boş qalsa avtomatik'}
            error={headerError('number')}
          >
            <input
              maxLength={40}
              value={form.number}
              placeholder={incoming ? 'BD-000001' : 'BX-000001'}
              onChange={(e) => set({ number: e.target.value })}
            />
          </Field>
          <Field label="Tarix" error={headerError('date')}>
            <DateInput
              required
              value={form.date}
              onChange={(date) => set({ date })}
              aria-label="Tarix"
            />
          </Field>
          <Field label="Bank hesabı" className="partner" error={headerError('bankAccountId')}>
            <Picker
              ariaLabel="Bank hesabı"
              value={form.bankAccountId}
              options={bankOptions}
              invalid={m.error?.field === 'bankAccountId'}
              onChange={(bankAccountId) => set({ bankAccountId, rate: '' })}
            />
          </Field>
          {foreign && (
            <Field
              label={`${currency} məzənnəsi`}
              hint="AMB məzənnəsi, 4 onluq"
              error={headerError('rate')}
            >
              <input
                aria-label="Məzənnə"
                inputMode="decimal"
                placeholder="1,7000"
                value={form.rate}
                onChange={(e) => set({ rate: e.target.value })}
              />
            </Field>
          )}
          <Field label="Bank sənədinin nömrəsi">
            <input
              aria-label="Bank sənədinin nömrəsi"
              maxLength={80}
              value={form.bankReference}
              onChange={(e) => set({ bankReference: e.target.value })}
            />
          </Field>
          <Field label={incoming ? 'Ödəyici (bankda)' : 'Alan (bankda)'}>
            <input
              aria-label="Kontragent (bankda)"
              maxLength={240}
              value={form.counterpartyName}
              onChange={(e) => set({ counterpartyName: e.target.value })}
            />
          </Field>
          <Field label="VÖEN (bankda)">
            <input
              aria-label="VÖEN (bankda)"
              maxLength={20}
              inputMode="numeric"
              value={form.counterpartyTaxId}
              onChange={(e) => set({ counterpartyTaxId: e.target.value })}
            />
          </Field>
          <Field label="Ödənişin təyinatı" wide>
            <input
              aria-label="Ödənişin təyinatı"
              maxLength={500}
              value={form.purpose}
              onChange={(e) => set({ purpose: e.target.value })}
            />
          </Field>
          <Field label="Əməliyyat növü" hint="Yalnız sətri doldurur; məcburi deyil">
            <select
              aria-label="Əməliyyat növü"
              value=""
              onChange={(e) => applyTemplate(e.target.value)}
            >
              <option value="">Şablon seçin…</option>
              {templates[direction].map((t) => (
                <option key={t.label} value={t.label}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>
        <fieldset className="lines" disabled={m.busy || locked}>
          <table className="grid entry-grid">
            <thead>
              <tr>
                <th scope="col" className="n">
                  №
                </th>
                <th scope="col">{incoming ? 'Kredit hesabı' : 'Debet hesabı'} və subkonto</th>
                {showCur && (
                  <th scope="col" className="num narrow">
                    Valyuta
                  </th>
                )}
                <th scope="col" className="num narrow">
                  Məbləğ, {currency}
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
                const a = acc(l.account);
                return (
                  <tr key={l.key} className={e ? 'has-error' : ''}>
                    <td className="n">{i + 1}</td>
                    <td className="side">
                      <AccountPicker
                        catalog={catalog as Catalog}
                        ariaLabel={`Sətir ${i + 1} hesab`}
                        value={l.account}
                        invalid={e?.part === 'account'}
                        onChange={(account) => setLine(i, { account, sk: [], curAmount: '' })}
                      />
                      <SubkontoFields
                        catalog={catalog as Catalog}
                        companyId={win.companyId}
                        account={l.account}
                        values={l.sk}
                        side={`Sətir ${i + 1}`}
                        onChange={(sk) => setLine(i, { sk })}
                        documentEmptyLabel={
                          autoMatch(l) ? 'Açıq qaimələrə avtomatik' : 'Bu sənəd (avans)'
                        }
                        {...(e?.part === 'sk' && e.slot !== undefined
                          ? { errorIndex: e.slot }
                          : {})}
                      />
                    </td>
                    {showCur && (
                      <td className="num narrow">
                        {a?.currency && (
                          <input
                            aria-label={`Sətir ${i + 1} valyuta məbləği`}
                            inputMode="decimal"
                            className={e?.part === 'curAmount' ? 'invalid' : ''}
                            value={l.curAmount}
                            onChange={(ev) => setLine(i, { curAmount: ev.target.value })}
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
                <td colSpan={2 + (showCur ? 1 : 0)}>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => set({ lines: [...form.lines, blank()] })}
                  >
                    <Plus size={14} /> Sətir əlavə et
                  </button>
                </td>
                <td className="num">
                  <b>{money(formatMinor(total))}</b>
                </td>
                <td colSpan={2}>
                  {foreign
                    ? `Manatla: ${totalAzn === null ? '—' : money(formatMinor(totalAzn))}`
                    : `${form.lines.length} sətir`}
                </td>
              </tr>
            </tfoot>
          </table>
        </fieldset>
        <p className="doc-hint">
          {incoming
            ? 'Yazılış: Dt bank hesabı (223 / 224.04) / Kt sətrin hesabı.'
            : 'Yazılış: Dt sətrin hesabı / Kt bank hesabı (223 / 224.04).'}{' '}
          {incoming ? '211' : '531'} sətrində hesablaşma sənədi seçilməsə, məbləğ müqavilənin açıq
          qaimələrinə ən köhnədən bölünür, qalanı avans olur ({incoming ? '543' : '243'}). ƏDV
          depoziti (224.04) qaimənin yalnız ƏDV hissəsini, cari hesab qalan hissəsini bağlayır.
          Düzəliş köhnə yazılışı qırmızı storno edir; jurnal heç vaxt silinmir.
        </p>
        {doc && (
          <section className="invoice-postings" aria-label="Yazılışlar" id={`postings-${win.id}`}>
            <div className="section-head">
              <h2>Yazılışlar</h2>
            </div>
            <Postings postings={doc.postings} />
          </section>
        )}
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
              type: 'bank.cancel',
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
