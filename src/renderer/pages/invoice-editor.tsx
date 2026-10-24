/**
 * Sales and purchase invoice (stage 2). The accountant types what is on the e-qaimə — product,
 * quantity, price, VAT rate — and the posting rules of docs/QERARLAR.md produce the entry; the
 * entry is shown under the document after saving, so every figure can be traced.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Ban, Check, CheckCheck, Copy, Plus, Trash2 } from '../icons';
import { vatRates, type VatRate } from '../../domain/chart';
import { aznAmounts, AZN_RATE, lineAmounts, type LineAmounts } from '../../domain/invoice';
import { formatMinor } from '../../domain/money';
import { parsePrice, parseQty } from '../../domain/quantity';
import type { InvoiceLineInput } from '../../contracts/commands';
import type { Catalog, EqDocumentDetail, InvoiceDetail } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { rateHint, useAutoRate } from '../rates';
import { ModuleFrame } from '../frame';
import { day, money, toField } from '../format';
import { useMutation, useQuery } from '../hooks';
import { viewTitle } from '../pages';
import { accountOptions, Picker, subkontoOptions, type Option } from '../picker';
import { Confirm, DateInput, Field, Notice, PostingRule } from '../ui';
import { useWindow, useWorkspace } from '../workspace';
import { EntryGrid, entryLinesFrom, toEntryInput, type EntryLine } from '../entry-grid';
import { Postings, todayIso } from '../postings';

type Direction = 'sale' | 'purchase';
type Treatment = 'offset' | 'cost';
interface LineForm {
  key: number;
  productId: string;
  quantity: string;
  price: string;
  vatRate: VatRate;
  incomeTypeId: string;
  account: string;
  expenseItemId: string;
  vatTreatment: Treatment | '';
  memo: string;
}
interface Form {
  number: string;
  date: string;
  partnerId: string;
  contractId: string;
  rate: string;
  pricesIncludeVat: boolean;
  vatTreatment: Treatment;
  eqNumber: string;
  memo: string;
  lines: LineForm[];
  /** 1C "Əl ilə düzəliş": the postings below are typed by hand instead of the rules. */
  manual: boolean;
  postings: EntryLine[];
}
let keys = 0;
const blank = (vatRate: VatRate): LineForm => ({
  key: ++keys,
  productId: '',
  quantity: '1',
  price: '',
  vatRate,
  incomeTypeId: '',
  account: '',
  expenseItemId: '',
  vatTreatment: '',
  memo: '',
});
const defaultAccount = {
  sale: { goods: '205', material: '201', asset: '', service: '' },
  purchase: { goods: '205', material: '201', asset: '113', service: '721' },
} as const;

function fromDetail(d: InvoiceDetail): Form {
  return {
    number: d.number,
    date: d.date,
    partnerId: d.partnerId,
    contractId: d.contractId,
    rate: d.currency === 'AZN' ? '' : toField(d.rate),
    pricesIncludeVat: d.pricesIncludeVat,
    vatTreatment: d.vatTreatment,
    eqNumber: `${d.eqSeries}${d.eqNumber}`,
    memo: d.memo,
    lines: d.lines.map((l) => ({
      key: ++keys,
      productId: l.productId,
      quantity: toField(l.quantity),
      price: toField(l.price),
      vatRate: l.vatRate,
      incomeTypeId: l.incomeTypeId,
      account: l.account,
      expenseItemId: l.expenseItemId,
      vatTreatment:
        d.direction === 'purchase' && l.vatTreatment !== d.vatTreatment ? l.vatTreatment : '',
      memo: l.memo,
    })),
    manual: d.manual,
    postings: d.manual ? entryLinesFrom(d.postings, `invoice:${d.id}`) : [],
  };
}

/** A new invoice prefilled from a DVX e-qaimə: what the system recognised (docs §8.4). */
function fromEq(e: EqDocumentDetail, base: Form, keepHeader = false): Form {
  const p = e.proposal;
  return {
    ...base,
    // A correction applied to a booked invoice keeps its date, partner and contract.
    ...(keepHeader
      ? {}
      : {
          // A correction booked in place of its original keeps the original's date (QERARLAR 2026-10-16 §1).
          date: p?.corrects?.date || e.date,
          partnerId: p?.partnerId ?? '',
          contractId: p?.contractId ?? '',
        }),
    // DVX took the VAT out of the gross amount: prices including VAT repeat it to the qəpik.
    pricesIncludeVat: !!p?.pricesIncludeVat,
    eqNumber: e.number,
    memo: e.note.slice(0, 500),
    lines: p?.lines.length
      ? p.lines.map((l) => ({
          key: ++keys,
          productId: l.productId,
          quantity: toField(l.quantity || '1'),
          price: toField(l.price),
          vatRate: l.vatRate || base.lines[0]!.vatRate,
          incomeTypeId: l.incomeTypeId,
          account: l.account,
          expenseItemId: l.expenseItemId,
          vatTreatment: l.vatTreatment,
          memo: l.dvx?.name.slice(0, 300) ?? '',
        }))
      : base.lines,
  };
}

function toInput(l: LineForm, direction: Direction): InvoiceLineInput {
  return {
    productId: l.productId,
    quantity: l.quantity.trim(),
    price: l.price.trim(),
    vatRate: l.vatRate,
    ...(direction === 'sale' && l.incomeTypeId ? { incomeTypeId: l.incomeTypeId } : {}),
    ...(l.account ? { account: l.account } : {}),
    ...(l.expenseItemId ? { expenseItemId: l.expenseItemId } : {}),
    ...(direction === 'purchase' && l.vatTreatment ? { vatTreatment: l.vatTreatment } : {}),
    memo: l.memo,
  };
}

/** Amounts of a line as the server will compute them, or null while the input is incomplete. */
function preview(l: LineForm, includesVat: boolean, rate: bigint) {
  try {
    const doc = lineAmounts(
      parseQty(l.quantity.trim()),
      parsePrice(l.price.trim()),
      l.vatRate,
      includesVat,
    );
    return { doc, azn: aznAmounts(doc, rate) };
  } catch {
    return null;
  }
}
const fmt = (m: bigint) => money(formatMinor(m));
function sum(xs: (LineAmounts | undefined)[]): LineAmounts {
  const total: LineAmounts = { net: 0n, vat: 0n, gross: 0n };
  for (const x of xs)
    if (x) {
      total.net += x.net;
      total.vat += x.vat;
      total.gross += x.gross;
    }
  return total;
}

function errorAt(field: string | undefined) {
  const m = /^lines\.(\d+)\.(\w+)/.exec(field ?? '');
  return m ? { line: Number(m[1]), part: m[2]! } : null;
}

export function InvoiceEditor({
  direction,
  id,
  eqDocumentId,
}: {
  direction: Direction;
  id?: string;
  /** A new invoice booking this DVX e-qaimə, prefilled from it. */
  eqDocumentId?: string;
}) {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const detail = useQuery<InvoiceDetail>(
    id ? { type: 'invoice', companyId: win.companyId, id } : null,
  );
  const [form, setForm] = useState<Form | null>(null);
  const baseline = useRef('');
  const resync = useRef(false);
  const m = useMutation();
  const [message, setMessage] = useState('');
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const doc = detail.data;
  // The e-qaimə this invoice books: the one it was opened for, or the one it is bound to.
  const eqRef = eqDocumentId || doc?.eqDocumentId || '';
  const eqDoc = useQuery<EqDocumentDetail>(
    eqRef ? { type: 'eqDocument', companyId: win.companyId, id: eqRef } : null,
  );
  const eq = eqDoc.data;
  const sale = direction === 'sale';
  const snapshot = (f: Form) =>
    JSON.stringify({
      ...f,
      lines: f.lines.map((l) => toInput(l, direction)),
      postings: f.manual ? f.postings.map(toEntryInput) : [],
    });

  useEffect(() => {
    if (form || !catalog) return;
    if (id && !doc) return;
    if (eqDocumentId && !eq) return;
    const vatPayer = catalog.company.vatPayer;
    const fresh: Form = doc
      ? fromDetail(doc)
      : {
          number: '',
          date: ws.period.to < todayIso() ? ws.period.to : todayIso(),
          partnerId: '',
          contractId: '',
          rate: '',
          pricesIncludeVat: false,
          vatTreatment: vatPayer ? catalog.company.purchaseVat : 'cost',
          eqNumber: '',
          memo: '',
          lines: [blank(vatPayer ? '18' : 'nontaxable')],
          manual: false,
          postings: [],
        };
    const initial = eqDocumentId && eq ? fromEq(eq, fresh, !!id) : fresh;
    // An invoice opened from an e-qaimə is unsaved work from the start.
    baseline.current = snapshot(fresh);
    setForm(initial);
  }, [doc, form, id, catalog, eq]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const options = useMemo(() => {
    if (!catalog) return null;
    const items = (kind: string) =>
      catalog.items
        .filter((i) => i.kind === kind && !i.archived)
        .map((i): Option => ({ value: i.id, label: i.name }));
    return {
      partners: subkontoOptions(catalog as Catalog, 'partner', '', ''),
      products: catalog.products
        .filter((p) => !p.archived && (!sale || p.kind !== 'asset'))
        .map((p): Option => ({
          value: p.id,
          label: p.name,
          hint: [p.code, p.unit].filter(Boolean).join(' · '),
        })),
      incomeTypes: items('incomeType'),
      expenseItems: items('expenseItem'),
      accounts: accountOptions(catalog),
    };
  }, [catalog, sale]);

  const autoRate = useAutoRate(
    win.companyId,
    catalog?.contracts.find((c) => c.id === form?.contractId)?.currency ?? 'AZN',
    form?.date ?? '',
    form?.rate ?? '',
    (rate) => setForm((f) => (f ? { ...f, rate } : f)),
  );
  const locked = doc?.status === 'cancelled';
  async function save(close = false) {
    if (!form || locked || m.busy) return;
    setMessage('');
    const r = await m.run({
      type: 'invoice.save',
      companyId: win.companyId,
      direction,
      number: form.number,
      date: form.date,
      partnerId: form.partnerId,
      contractId: form.contractId,
      rate: form.rate.trim(),
      pricesIncludeVat: form.pricesIncludeVat,
      ...(sale ? {} : { vatTreatment: form.vatTreatment }),
      eqSeries: '',
      eqNumber: form.eqNumber,
      memo: form.memo,
      lines: form.lines.map((l) => toInput(l, direction)),
      ...(form.manual ? { postings: form.postings.map(toEntryInput) } : {}),
      ...(id && doc ? { id, version: doc.version } : {}),
      ...(eqDocumentId ? { eqDocumentId } : {}),
    });
    if (!r) return;
    if (close) {
      ws.discard(win.id);
      return;
    }
    setMessage(
      id
        ? 'Düzəliş uçota alındı: köhnə yazılış storno edildi, yenisi yazıldı.'
        : `Qaimə ${r.number} uçota alındı${eq ? ` (DVX e-qaimə ${eq.number})` : ''}.`,
    );
    resync.current = true;
    if (!id) {
      baseline.current = snapshot({ ...form, number: r.number ?? form.number });
      ws.setDirty(win.id, false);
      ws.retarget(win.id, { type: 'invoice', direction, id: r.id });
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

  if (!catalog || !form || !options)
    return (
      <ModuleFrame title={viewTitle(win.view, win.label)}>
        <div className="loading">{detail.error || 'Yüklənir…'}</div>
      </ModuleFrame>
    );
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const setLine = (i: number, patch: Partial<LineForm>) =>
    set({ lines: form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const err = errorAt(m.error?.field);
  const headerError = (field: string) => (m.error?.field === field ? m.error.message : undefined);
  const contract = catalog.contracts.find((c) => c.id === form.contractId);
  const currency = contract?.currency ?? 'AZN';
  const foreign = currency !== 'AZN';
  let rate = AZN_RATE;
  if (foreign)
    try {
      rate = parsePrice(form.rate.trim());
    } catch {
      rate = 0n;
    }
  const contracts = catalog.contracts
    .filter((c) => c.partnerId === form.partnerId && (!c.archived || c.id === form.contractId))
    .map((c): Option => ({
      value: c.id,
      label: `№${c.number}`,
      hint: c.currency !== 'AZN' ? c.currency : day(c.date),
    }));
  const product = (pid: string) => catalog.products.find((p) => p.id === pid);
  const previews = form.lines.map((l) => preview(l, form.pricesIncludeVat, rate || AZN_RATE));
  const totals = sum(previews.map((p) => p?.doc));
  const totalsAzn = sum(previews.map((p) => p?.azn));
  // A company outside VAT does not charge it, but its suppliers' e-qaimə may carry 18%.
  const vatRateOptions = vatRates.filter((v) => !sale || catalog.company.vatPayer || v.id !== '18');

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
          {eq && <EqBanner eq={eq} fresh={!!eqDocumentId && eq.state === 'waiting'} />}
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
              placeholder={sale ? 'SQ-000001' : 'AQ-000001'}
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
          <Field
            label={sale ? 'Alıcı' : 'Malsatan'}
            className="partner"
            error={headerError('partnerId')}
          >
            <Picker
              ariaLabel="Kontragent"
              value={form.partnerId}
              options={options.partners}
              invalid={m.error?.field === 'partnerId'}
              onChange={(partnerId) => {
                const own = catalog.contracts.filter(
                  (c) => c.partnerId === partnerId && !c.archived,
                );
                set({ partnerId, contractId: own.length === 1 ? own[0]!.id : '', rate: '' });
              }}
            />
          </Field>
          <Field label="Müqavilə" error={headerError('contractId')}>
            <Picker
              ariaLabel="Müqavilə"
              value={form.contractId}
              options={contracts}
              invalid={m.error?.field === 'contractId'}
              disabled={!form.partnerId}
              onChange={(contractId) => set({ contractId, rate: '' })}
            />
          </Field>
          {foreign && (
            <Field
              label={`${currency} məzənnəsi`}
              hint={rateHint(autoRate, form.rate)}
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
          <Field label="E-qaimə nömrəsi" className="eq" error={headerError('eqNumber')}>
            <input
              aria-label="E-qaimə nömrəsi"
              maxLength={60}
              value={form.eqNumber}
              placeholder="MT2610007"
              onChange={(e) => set({ eqNumber: e.target.value })}
            />
          </Field>
          {!sale && (
            <Field label="Alış ƏDV-si">
              <select
                aria-label="Alış ƏDV-si"
                value={form.vatTreatment}
                disabled={!catalog.company.vatPayer}
                onChange={(e) => set({ vatTreatment: e.target.value as Treatment })}
              >
                <option value="offset">Əvəzləşdirilir (241)</option>
                <option value="cost">Maya dəyərinə daxil edilir</option>
              </select>
            </Field>
          )}
          <Field label="Qiymət">
            <label className="check">
              <input
                type="checkbox"
                checked={form.pricesIncludeVat}
                onChange={(e) => set({ pricesIncludeVat: e.target.checked })}
              />
              ƏDV daxildir
            </label>
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
          <table className="grid entry-grid invoice-grid">
            <thead>
              <tr>
                <th scope="col" className="n">
                  №
                </th>
                <th scope="col">Nomenklatura</th>
                <th scope="col" className="num narrow">
                  Miqdar
                </th>
                <th scope="col" className="num narrow">
                  Qiymət{form.pricesIncludeVat ? ' (ƏDV daxil)' : ''}
                </th>
                <th scope="col">ƏDV dərəcəsi</th>
                <th scope="col">{sale ? 'Gəlir növü / anbar hesabı' : 'Hesab / xərc maddəsi'}</th>
                <th scope="col" className="num">
                  ƏDV-siz
                </th>
                <th scope="col" className="num">
                  ƏDV
                </th>
                <th scope="col" className="num">
                  Cəmi{foreign ? `, ${currency}` : ''}
                </th>
                <th scope="col" className="n">
                  <span className="sr-only">Əməliyyat</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {form.lines.map((l, i) => {
                const e = err && err.line === i ? err : null;
                const p = product(l.productId);
                const kind = p?.kind;
                const fallback = kind ? defaultAccount[direction][kind] : '';
                const effective = l.account || fallback;
                const account = catalog.accounts.find((a) => a.code === effective);
                const pv = previews[i];
                const label = (x: string) => `Sətir ${i + 1} ${x}`;
                return (
                  <tr key={l.key} className={e ? 'has-error' : ''}>
                    <td className="n">{i + 1}</td>
                    <td className="side">
                      <Picker
                        ariaLabel={label('nomenklatura')}
                        value={l.productId}
                        options={options.products}
                        invalid={e?.part === 'productId'}
                        onChange={(productId) =>
                          setLine(i, {
                            productId,
                            account: '',
                            expenseItemId: '',
                            incomeTypeId: '',
                          })
                        }
                      />
                      <input
                        aria-label={label('məzmun')}
                        className="line-memo"
                        maxLength={300}
                        placeholder="Məzmun (istəyə görə)"
                        value={l.memo}
                        onChange={(ev) => setLine(i, { memo: ev.target.value })}
                      />
                    </td>
                    <td className="num narrow">
                      <input
                        aria-label={label('miqdar')}
                        inputMode="decimal"
                        className={e?.part === 'quantity' ? 'invalid' : ''}
                        value={l.quantity}
                        onChange={(ev) => setLine(i, { quantity: ev.target.value })}
                      />
                      {p && <small className="unit">{p.unit}</small>}
                    </td>
                    <td className="num narrow">
                      <input
                        aria-label={label('qiymət')}
                        inputMode="decimal"
                        placeholder="0,00"
                        className={e?.part === 'price' ? 'invalid' : ''}
                        value={l.price}
                        onChange={(ev) => setLine(i, { price: ev.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        aria-label={label('ƏDV dərəcəsi')}
                        value={l.vatRate}
                        className={e?.part === 'vatRate' ? 'invalid' : ''}
                        onChange={(ev) => setLine(i, { vatRate: ev.target.value as VatRate })}
                      >
                        {vatRateOptions.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                      {!sale && catalog.company.vatPayer && l.vatRate === '18' && (
                        <select
                          aria-label={label('ƏDV-nin taleyi')}
                          value={l.vatTreatment}
                          onChange={(ev) =>
                            setLine(i, { vatTreatment: ev.target.value as Treatment | '' })
                          }
                        >
                          <option value="">Qaimə üzrə</option>
                          <option value="offset">Əvəzləşdirilir</option>
                          <option value="cost">Maya dəyərinə</option>
                        </select>
                      )}
                    </td>
                    <td className="side">
                      {sale && (
                        <Picker
                          ariaLabel={label('gəlir növü')}
                          value={l.incomeTypeId}
                          options={options.incomeTypes}
                          emptyLabel={
                            kind === 'service'
                              ? 'Standart: xidmət satışı'
                              : 'Standart: məhsul satışı'
                          }
                          onChange={(incomeTypeId) => setLine(i, { incomeTypeId })}
                        />
                      )}
                      {(!sale || (kind && kind !== 'service')) && (
                        <Picker
                          ariaLabel={label(sale ? 'anbar hesabı' : 'hesab')}
                          value={l.account}
                          options={options.accounts}
                          invalid={e?.part === 'account'}
                          emptyLabel={fallback ? `Standart: ${fallback}` : 'Nomenklatura seçin'}
                          onChange={(code) => setLine(i, { account: code, expenseItemId: '' })}
                        />
                      )}
                      {!sale && account?.subkonto.includes('expenseItem') && (
                        <Picker
                          ariaLabel={label('xərc maddəsi')}
                          value={l.expenseItemId}
                          options={options.expenseItems}
                          placeholder="Xərc maddəsi"
                          invalid={e?.part === 'expenseItemId'}
                          onChange={(expenseItemId) => setLine(i, { expenseItemId })}
                        />
                      )}
                    </td>
                    <td className="num">{pv ? fmt(pv.doc.net) : ''}</td>
                    <td className="num">{pv ? fmt(pv.doc.vat) : ''}</td>
                    <td className="num strong">{pv ? fmt(pv.doc.gross) : ''}</td>
                    <td className="n row-tools">
                      <button
                        type="button"
                        className="icon-button"
                        title="Sətri köçür"
                        aria-label={label('köçür')}
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
                        aria-label={label('sil')}
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
                <td colSpan={6}>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() =>
                      set({
                        lines: [
                          ...form.lines,
                          blank(catalog.company.vatPayer ? '18' : 'nontaxable'),
                        ],
                      })
                    }
                  >
                    <Plus size={14} /> Sətir əlavə et
                  </button>
                </td>
                <td className="num">
                  <b>{fmt(totals.net)}</b>
                </td>
                <td className="num">
                  <b>{fmt(totals.vat)}</b>
                </td>
                <td className="num">
                  <b>{fmt(totals.gross)}</b>
                </td>
                <td />
              </tr>
              {foreign && (
                <tr>
                  <td colSpan={6}>Manatla (məzənnə {form.rate || '—'})</td>
                  <td className="num">{rate ? fmt(totalsAzn.net) : '—'}</td>
                  <td className="num">{rate ? fmt(totalsAzn.vat) : '—'}</td>
                  <td className="num">{rate ? fmt(totalsAzn.gross) : '—'}</td>
                  <td />
                </tr>
              )}
            </tfoot>
          </table>
        </fieldset>
        <PostingRule>
          {sale
            ? 'Dt 211 / Kt 601 (ƏDV daxil), Dt 604.1 / Kt 521.01 (ƏDV), mal üçün Dt 701 / Kt 205 (FIFO). Müqavilədə alınmış avans varsa, avtomatik əvəzləşir (Dt 543 / Kt 211).'
            : 'Dt 721/201/205/113 / Kt 531 (ƏDV-siz), Dt 241 / Kt 531 (ƏDV). Müqavilədə verilmiş avans varsa, avtomatik əvəzləşir (Dt 531 / Kt 243).'}{' '}
          Düzəliş köhnə yazılışı qırmızı storno edir; jurnal heç vaxt silinmir.
        </PostingRule>
        {doc && (
          <section className="invoice-postings" aria-label="Yazılışlar" id={`postings-${win.id}`}>
            <div className="section-head">
              <h2>Yazılışlar</h2>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.manual}
                  disabled={locked || m.busy}
                  onChange={(e) =>
                    set(
                      e.target.checked
                        ? {
                            manual: true,
                            postings: form.postings.length
                              ? form.postings
                              : entryLinesFrom(doc.postings, `invoice:${doc.id}`),
                          }
                        : { manual: false },
                    )
                  }
                />
                Əl ilə düzəliş
              </label>
            </div>
            {form.manual ? (
              <>
                <p className="doc-hint">
                  Yazılışlar əl ilə dəyişdirilir və qaimə qaydaları ilə yenidən hesablanmır (1C-dəki
                  kimi). “Hesablaşma sənədi” boş qalarsa, bu qaimə yazılır. Bayrağı götürsəniz,
                  yazılışlar yenə qaydalarla qurulur.
                </p>
                <fieldset className="lines" disabled={m.busy || locked}>
                  <EntryGrid
                    catalog={catalog as Catalog}
                    companyId={win.companyId}
                    lines={form.postings}
                    onChange={(postings) => set({ postings })}
                    errorField={m.error?.field}
                    errorPrefix="postings"
                  />
                </fieldset>
              </>
            ) : (
              <Postings postings={doc.postings} />
            )}
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
          title={`Qaiməni ləğv et · ${doc.number}`}
          confirmLabel="Ləğv et"
          destructive
          onCancel={() => setCancel(false)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'invoice.cancel',
              companyId: win.companyId,
              id: doc.id,
              version: doc.version,
              reason,
            });
            if (r) {
              setCancel(false);
              setMessage('Qaimə ləğv edildi: yazılışları storno edildi.');
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

/**
 * The DVX e-qaimə above the invoice: what DVX wrote, why the system did not book it by itself,
 * a new partner to create, and — once booked by hand — learning the map from this invoice.
 */
function EqBanner({ eq, fresh }: { eq: EqDocumentDetail; fresh: boolean }) {
  const win = useWindow();
  const { catalog } = useCatalog(win.companyId);
  const m = useMutation();
  const [done, setDone] = useState('');
  const p = eq.proposal;
  const missing =
    p?.newPartner && !catalog?.partners.some((x) => x.taxId === p.newPartner!.taxId)
      ? p.newPartner
      : undefined;
  return (
    <Notice kind={fresh && p?.reasons.length ? 'warning' : 'info'}>
      <b>
        DVX e-qaimə {eq.number} · {day(eq.date)} · {eq.name} · VÖEN {eq.taxId}
      </b>{' '}
      — ƏDV-siz {money(eq.net)}, ƏDV {money(eq.vat)}, cəmi {money(eq.total)}
      {eq.lines.length > 0 && (
        <details>
          <summary>DVX sətirləri ({eq.lines.length})</summary>
          <ul>
            {eq.lines.map((l, i) => (
              <li key={i}>
                {l.code && <>{l.code} · </>}
                {l.name} · {l.quantity} {l.unit} × {l.price} = {money(l.net)}, ƏDV {money(l.vat)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {fresh && p && p.reasons.length > 0 && (
        <ul aria-label="Təsdiq tələb edənlər">
          {p.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {fresh && missing && (
        <button
          type="button"
          className="button secondary small"
          disabled={m.busy}
          onClick={async () => {
            const r = await m.run({
              type: 'partner.save',
              companyId: win.companyId,
              name: missing.name,
              taxId: missing.taxId,
              kind: missing.kind,
              note: 'DVX e-qaiməsindən',
              archived: false,
            });
            if (r)
              setDone(
                `Kontragent yaradıldı: ${missing.name}. Müqaviləsini “Kontragentlər və müqavilələr”də əlavə edin, sonra seçin.`,
              );
          }}
        >
          Kontragenti yarat (VÖEN {missing.taxId})
        </button>
      )}
      {!fresh && eq.bucket === 'posted' && (
        <button
          type="button"
          className="button secondary small"
          disabled={m.busy}
          onClick={async () => {
            const r = await m.run({
              type: 'eqaime.learn',
              companyId: win.companyId,
              documentId: eq.id,
            });
            if (r)
              setDone(
                r.learned
                  ? `${r.learned} uyğunluq “təklif” rejimində saxlandı (Kitabçalar → E-qaimə uyğunluqları).`
                  : 'Bu e-qaimənin uyğunluqları artıq var.',
              );
          }}
        >
          Uyğunluq kimi saxla
        </button>
      )}
      {done && <p>{done}</p>}
      {m.error && <p className="pair-bad">{m.error.message}</p>}
    </Notice>
  );
}
