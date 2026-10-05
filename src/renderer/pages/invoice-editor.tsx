import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Ban, Check, FileText, Percent, Plus, Save, Trash2 } from 'lucide-react';
import { Chart, inFamily, type Account } from '../../domain/accounts';
import { formatMinor, parseMoney, percentOf } from '../../domain/money';
import { postInvoice, type InvoiceLine } from '../../domain/posting';
import { lineAmount, parsePrice, parseQty, toBaseQty } from '../../domain/quantity';
import type { InvoiceLineInput } from '../../contracts/commands';
import type { Catalog, InvoiceDetail } from '../../contracts/queries';
import { reloadCatalog, useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { addAmounts, money, toField, today } from '../format';
import { useMutation, useQuery } from '../hooks';
import { viewTitle } from '../pages';
import { Amount, Confirm, DateInput, Field, Modal, Notice, Status } from '../ui';
import { useWindow, useWorkspace } from '../workspace';
import { PostingsPanel, type PreviewLine } from './postings';
import { PartnerForm, ProductForm } from './quick-forms';

interface LineForm {
  uid: string;
  kind: 'service' | 'stock';
  description: string;
  account: string;
  stockAccount: string;
  productId: string;
  warehouseId: string;
  quantity: string;
  unit: 'base' | 'purchase';
  unitPrice: string;
  net: string;
  vat: string;
  expenseItemId: string;
}
interface Form {
  number: string;
  date: string;
  partnerId: string;
  note: string;
  lines: LineForm[];
}
let uidSeq = 0;
const uid = () => `l${++uidSeq}`;

function firstPostable(chart: Chart, family: string): string {
  return chart.postable(family)
    ? family
    : (chart.all().find((a) => inFamily(a.code, family) && chart.postable(a.code))?.code ?? family);
}
function blankLine(
  direction: 'purchase' | 'sale',
  kind: 'service' | 'stock',
  chart: Chart,
  catalog: Catalog,
): LineForm {
  return {
    uid: uid(),
    kind,
    description: '',
    account:
      kind === 'service'
        ? firstPostable(chart, direction === 'purchase' ? '721' : '601')
        : direction === 'sale'
          ? firstPostable(chart, '601')
          : '',
    stockAccount: '',
    productId: '',
    warehouseId: catalog.warehouses[0]?.id ?? '',
    quantity: '',
    unit: direction === 'purchase' ? 'purchase' : 'base',
    unitPrice: '',
    net: '',
    vat: '0',
    expenseItemId: '',
  };
}
function fromDetail(d: InvoiceDetail): Form {
  return {
    number: d.number,
    date: d.date,
    partnerId: d.partnerId,
    note: d.note,
    lines: d.lines.map((l) => ({
      uid: uid(),
      kind: l.kind,
      description: l.description,
      account: l.account,
      stockAccount: l.stockAccount ?? '',
      productId: l.productId ?? '',
      warehouseId: l.warehouseId ?? '',
      quantity: toField(l.quantity),
      unit: l.unit ?? 'base',
      unitPrice: toField(l.unitPrice),
      net: toField(l.net),
      vat: toField(l.vat),
      expenseItemId: l.expenseItemId ?? '',
    })),
  };
}
/** Net amount the server will compute; '' while the line is incomplete. */
function lineNet(l: LineForm): string {
  try {
    if (l.kind === 'service') return formatMinor(parseMoney(l.net));
    return formatMinor(lineAmount(parseQty(l.quantity), parsePrice(l.unitPrice)));
  } catch {
    return '';
  }
}
function lineVat(l: LineForm): string {
  try {
    return formatMinor(parseMoney(l.vat));
  } catch {
    return '';
  }
}
function toInput(l: LineForm, direction: 'purchase' | 'sale'): InvoiceLineInput {
  if (l.kind === 'service')
    return {
      kind: 'service',
      description: l.description,
      account: l.account,
      net: l.net,
      vat: l.vat,
      ...(l.expenseItemId ? { expenseItemId: l.expenseItemId } : {}),
    };
  return {
    kind: 'stock',
    description: l.description,
    account: l.account,
    ...(direction === 'sale' && l.stockAccount ? { stockAccount: l.stockAccount } : {}),
    productId: l.productId,
    warehouseId: l.warehouseId,
    quantity: l.quantity,
    unit: l.unit,
    unitPrice: l.unitPrice,
    vat: l.vat,
  };
}
const storageKey = (companyId: string, direction: string, id?: string) =>
  `meyar.unsaved.${companyId}.invoice.${direction}.${id ?? 'new'}`;

export function InvoiceEditor({ direction, id }: { direction: 'purchase' | 'sale'; id?: string }) {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const detail = useQuery<InvoiceDetail>(
    id ? { type: 'invoice', companyId: win.companyId, id } : null,
  );
  const chart = useMemo(() => (catalog ? new Chart(catalog.accounts) : undefined), [catalog]);
  const [form, setForm] = useState<Form | null>(null);
  const baseline = useRef('');
  const mutation = useMutation();
  const [saved, setSaved] = useState('');
  /** Set after a successful save: the next server copy becomes the new baseline. */
  const resync = useRef(false);
  const [modal, setModal] = useState<null | 'partner' | { product: string } | 'cancel'>(null);
  const [reason, setReason] = useState('');
  const [recovery, setRecovery] = useState<Form | null>(null);
  const key = storageKey(win.companyId, direction, id);

  // Initialise once the reference data (and the document, when editing) are loaded.
  useEffect(() => {
    if (form || !catalog || !chart) return;
    if (id && !detail.data) return;
    const initial: Form = detail.data
      ? fromDetail(detail.data)
      : {
          number: '',
          date: today(),
          partnerId: '',
          note: '',
          lines: [blankLine(direction, 'service', chart, catalog)],
        };
    baseline.current = JSON.stringify(stripUid(initial));
    setForm(initial);
    try {
      const stored = localStorage.getItem(key);
      if (stored && stored !== baseline.current) setRecovery(withUids(JSON.parse(stored) as Form));
    } catch {
      /* storage unavailable: recovery is a convenience only */
    }
  }, [catalog, chart, detail.data, form, id, direction, key]);

  // After a save the server copy becomes the new baseline.
  useEffect(() => {
    if (!detail.data || !form || !resync.current) return;
    resync.current = false;
    const next = fromDetail(detail.data);
    baseline.current = JSON.stringify(stripUid(next));
    setForm(next);
  }, [detail.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!form && JSON.stringify(stripUid(form)) !== baseline.current;
  useEffect(() => {
    ws.setDirty(win.id, dirty);
    try {
      if (dirty && form) localStorage.setItem(key, JSON.stringify(stripUid(form)));
    } catch {
      /* ignore */
    }
  }, [dirty, form]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  useEffect(() => {
    if (detail.data) ws.setLabel(win.id, detail.data.number);
  }, [detail.data?.number]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!catalog || !chart || !form)
    return (
      <ModuleFrame title={viewTitle(win.view, win.label)}>
        <div className="loading">{detail.error || 'Yüklənir…'}</div>
      </ModuleFrame>
    );

  const status = detail.data?.status;
  const locked = status === 'cancelled';
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const setLine = (uid: string, patch: Partial<LineForm>) =>
    set({ lines: form.lines.map((l) => (l.uid === uid ? { ...l, ...patch } : l)) });
  const nets = form.lines.map(lineNet);
  const vats = form.lines.map(lineVat);
  const totalNet = addAmounts(nets);
  const totalVat = addAmounts(vats);
  const total = addAmounts([totalNet, totalVat]);
  const fieldError = (path: string) =>
    mutation.error?.field === path ? mutation.error.message : undefined;

  async function submit(mode: 'post' | 'draft') {
    if (!form || locked) return;
    setSaved('');
    const result = await mutation.run({
      type: 'invoice.save',
      companyId: win.companyId,
      mode,
      direction,
      number: form.number,
      date: form.date,
      partnerId: form.partnerId,
      note: form.note,
      lines: form.lines.map((l) => toInput(l, direction)),
      ...(id && detail.data ? { id, version: detail.data.version } : {}),
    });
    if (!result) return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    setSaved(
      mode === 'post' ? 'Qaimə uçota alındı.' : 'Qaralama saxlanıldı; maliyyə yazılışı yaranmadı.',
    );
    resync.current = true;
    if (!id) {
      baseline.current = JSON.stringify(stripUid(form));
      ws.setDirty(win.id, false);
      ws.retarget(win.id, { type: 'invoice', direction, id: result.id });
    } else detail.reload();
  }
  async function cancel() {
    if (!id || !detail.data) return;
    const result = await mutation.run({
      type: 'invoice.cancel',
      companyId: win.companyId,
      id,
      version: detail.data.version,
      reason,
    });
    if (result) {
      setModal(null);
      resync.current = true;
      setSaved('Qaimə ləğv edildi; əks yazılış yaradıldı.');
      detail.reload();
    }
  }

  const partners = catalog.partners;
  const accountOptions = (families: readonly string[]) =>
    catalog.accounts.filter((a) => a.postable && families.some((f) => inFamily(a.code, f)));
  const preview = previewLines(chart, direction, form, catalog);

  return (
    <ModuleFrame
      title={viewTitle(win.view, win.label)}
      hint={status ? undefined : 'Saxlanmayıb'}
      actions={
        <>
          {status && <Status status={status} />}
          {id && status !== 'cancelled' && (
            <button
              type="button"
              className="button secondary"
              onClick={() => (setReason(''), setModal('cancel'))}
            >
              <Ban size={15} /> Ləğv et
            </button>
          )}
        </>
      }
      notices={
        <>
          {recovery && (
            <Notice kind="info" onClose={() => setRecovery(null)}>
              Bu sənəd üçün saxlanmamış dəyişikliklər tapıldı.{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setForm(recovery);
                  setRecovery(null);
                }}
              >
                Bərpa et
              </button>
            </Notice>
          )}
          {mutation.error && <Notice onClose={mutation.clear}>{mutation.error.message}</Notice>}
          {saved && (
            <Notice kind="success" onClose={() => setSaved('')}>
              {saved}
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
          void submit('post');
        }}
      >
        <fieldset className="document-body" disabled={mutation.busy || locked}>
          <div className="document-header">
            <Field label="Qaimə nömrəsi" error={fieldError('number')}>
              <input
                required
                maxLength={80}
                value={form.number}
                autoFocus={!id}
                onChange={(e) => set({ number: e.target.value })}
              />
            </Field>
            <Field label="Tarix" error={fieldError('date')}>
              <DateInput required value={form.date} onChange={(date) => set({ date })} />
            </Field>
            <Field
              label={direction === 'sale' ? 'Alıcı' : 'Təchizatçı'}
              wide
              error={fieldError('partnerId')}
            >
              <div className="with-action">
                <select
                  required
                  value={form.partnerId}
                  onChange={(e) => set({ partnerId: e.target.value })}
                >
                  <option value="">Kontragent seçin</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.taxId}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button secondary square"
                  aria-label="Yeni kontragent"
                  title="Yeni kontragent"
                  onClick={() => setModal('partner')}
                >
                  <Plus size={15} />
                </button>
              </div>
            </Field>
            <Field label="Qeyd" wide>
              <input
                maxLength={500}
                value={form.note}
                onChange={(e) => set({ note: e.target.value })}
              />
            </Field>
          </div>

          <div className="lines">
            <div className="lines-scroll">
              <table className="lines-table" aria-label="Qaimə sətirləri">
                <thead>
                  <tr>
                    <th scope="col" className="c-kind">
                      Növ
                    </th>
                    <th scope="col" className="c-item">
                      Mal / xidmət
                    </th>
                    <th scope="col" className="c-account">
                      Hesab
                    </th>
                    <th scope="col" className="c-qty num">
                      Miqdar
                    </th>
                    <th scope="col" className="c-price num">
                      Qiymət
                    </th>
                    <th scope="col" className="c-net num">
                      Məbləğ
                    </th>
                    <th scope="col" className="c-vat num">
                      ƏDV
                    </th>
                    <th scope="col" className="c-total num">
                      Cəmi
                    </th>
                    <th scope="col" className="c-del">
                      <span className="sr-only">Sil</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((l, i) => {
                    const product = catalog.products.find((p) => p.id === l.productId);
                    const at = `lines.${i}`;
                    const invalid = (f: string) =>
                      mutation.error?.field === `${at}.${f}` ? 'invalid' : '';
                    const purchaseUnit = product
                      ? catalog.units.find((u) => u.code === product.purchaseUnit)?.name
                      : '';
                    const baseUnit = product
                      ? catalog.units.find((u) => u.code === product.baseUnit)?.name
                      : '';
                    let base = '';
                    if (
                      product &&
                      l.unit === 'purchase' &&
                      product.purchaseUnit !== product.baseUnit
                    )
                      try {
                        base = `= ${trimQty(toBaseQty(parseQty(l.quantity), parseQty(product.factor)))} ${baseUnit}`;
                      } catch {
                        base = '';
                      }
                    return (
                      <tr key={l.uid}>
                        <td className="c-kind">
                          <select
                            aria-label={`Sətir ${i + 1}: növ`}
                            value={l.kind}
                            onChange={(e) => {
                              const kind = e.target.value as 'service' | 'stock';
                              setLine(l.uid, {
                                ...blankLine(direction, kind, chart, catalog),
                                uid: l.uid,
                                vat: l.vat,
                              });
                            }}
                          >
                            <option value="service">Xidmət</option>
                            <option value="stock">Mal / material</option>
                          </select>
                        </td>
                        <td className="c-item">
                          {l.kind === 'stock' ? (
                            <div className="stack">
                              <div className="with-action">
                                <select
                                  aria-label={`Sətir ${i + 1}: nomenklatura`}
                                  className={invalid('productId')}
                                  value={l.productId}
                                  onChange={(e) => {
                                    const p = catalog.products.find((x) => x.id === e.target.value);
                                    setLine(l.uid, {
                                      productId: e.target.value,
                                      ...(p && direction === 'purchase'
                                        ? { account: p.account }
                                        : {}),
                                      ...(p && direction === 'sale'
                                        ? {
                                            stockAccount: inFamily(p.account, '113')
                                              ? ''
                                              : p.account,
                                          }
                                        : {}),
                                    });
                                  }}
                                >
                                  <option value="">Məhsul seçin</option>
                                  {catalog.products.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.code} · {p.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="button secondary square"
                                  aria-label={`Sətir ${i + 1}: yeni məhsul`}
                                  title="Yeni məhsul"
                                  onClick={() => setModal({ product: l.uid })}
                                >
                                  <Plus size={14} />
                                </button>
                              </div>
                              <select
                                aria-label={`Sətir ${i + 1}: anbar`}
                                value={l.warehouseId}
                                onChange={(e) => setLine(l.uid, { warehouseId: e.target.value })}
                              >
                                {catalog.warehouses.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div className="stack">
                              <input
                                aria-label={`Sətir ${i + 1}: təsvir`}
                                placeholder="Xidmətin təsviri"
                                maxLength={240}
                                value={l.description}
                                onChange={(e) => setLine(l.uid, { description: e.target.value })}
                              />
                              {chart.get(l.account)?.analytics.includes('expenseItem') && (
                                <select
                                  aria-label={`Sətir ${i + 1}: xərc maddəsi`}
                                  className={invalid('expenseItemId')}
                                  value={l.expenseItemId}
                                  onChange={(e) =>
                                    setLine(l.uid, { expenseItemId: e.target.value })
                                  }
                                >
                                  <option value="">Xərc maddəsi seçin</option>
                                  {catalog.expenseItems.map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="c-account">
                          <div className="stack">
                            <AccountSelect
                              label={`Sətir ${i + 1}: ${direction === 'sale' ? 'gəlir hesabı' : 'debet hesabı'}`}
                              className={invalid('account')}
                              value={l.account}
                              options={accountOptions(
                                direction === 'sale'
                                  ? ['601']
                                  : l.kind === 'service'
                                    ? ['721']
                                    : ['205', '201', '113'],
                              )}
                              onChange={(account) => setLine(l.uid, { account })}
                            />
                            {direction === 'sale' && l.kind === 'stock' && (
                              <AccountSelect
                                label={`Sətir ${i + 1}: silinən ehtiyat`}
                                className={invalid('stockAccount')}
                                value={l.stockAccount}
                                options={accountOptions(['205', '201'])}
                                onChange={(stockAccount) => setLine(l.uid, { stockAccount })}
                                placeholder="Ehtiyat hesabı"
                              />
                            )}
                          </div>
                        </td>
                        <td className="c-qty num">
                          {l.kind === 'stock' ? (
                            <div className="stack">
                              <input
                                aria-label={`Sətir ${i + 1}: miqdar`}
                                className={invalid('quantity')}
                                inputMode="decimal"
                                value={l.quantity}
                                onChange={(e) => setLine(l.uid, { quantity: e.target.value })}
                              />
                              {product && product.purchaseUnit !== product.baseUnit ? (
                                <select
                                  aria-label={`Sətir ${i + 1}: vahid`}
                                  value={l.unit}
                                  onChange={(e) =>
                                    setLine(l.uid, { unit: e.target.value as 'base' | 'purchase' })
                                  }
                                >
                                  <option value="purchase">{purchaseUnit}</option>
                                  <option value="base">{baseUnit}</option>
                                </select>
                              ) : (
                                <small>{baseUnit}</small>
                              )}
                              {base && <small>{base}</small>}
                            </div>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="c-price num">
                          {l.kind === 'stock' ? (
                            <input
                              aria-label={`Sətir ${i + 1}: qiymət`}
                              className={invalid('unitPrice')}
                              inputMode="decimal"
                              value={l.unitPrice}
                              onChange={(e) => setLine(l.uid, { unitPrice: e.target.value })}
                            />
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="c-net num">
                          {l.kind === 'service' ? (
                            <input
                              aria-label={`Sətir ${i + 1}: məbləğ`}
                              className={invalid('net')}
                              inputMode="decimal"
                              value={l.net}
                              onChange={(e) => setLine(l.uid, { net: e.target.value })}
                            />
                          ) : (
                            <output aria-label={`Sətir ${i + 1}: məbləğ`}>
                              {nets[i] ? money(nets[i]!) : '—'}
                            </output>
                          )}
                        </td>
                        <td className="c-vat num">
                          <div className="with-action">
                            <input
                              aria-label={`Sətir ${i + 1}: ƏDV`}
                              className={invalid('vat')}
                              inputMode="decimal"
                              value={l.vat}
                              onChange={(e) => setLine(l.uid, { vat: e.target.value })}
                            />
                            <button
                              type="button"
                              className="button secondary square"
                              title="Məbləğin 18%-ni hesabla (yalnız köməkçi)"
                              aria-label={`Sətir ${i + 1}: ƏDV 18%`}
                              disabled={!nets[i]}
                              onClick={() =>
                                setLine(l.uid, {
                                  vat: toField(formatMinor(percentOf(parseMoney(nets[i]!), 1800))),
                                })
                              }
                            >
                              <Percent size={13} />
                            </button>
                          </div>
                        </td>
                        <td className="c-total num">
                          {nets[i] && vats[i] ? (
                            <Amount value={addAmounts([nets[i]!, vats[i]!])} strong />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="c-del">
                          <button
                            type="button"
                            className="icon-button danger"
                            aria-label={`Sətir ${i + 1}: sil`}
                            disabled={form.lines.length === 1}
                            onClick={() =>
                              set({ lines: form.lines.filter((x) => x.uid !== l.uid) })
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="lines-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  set({ lines: [...form.lines, blankLine(direction, 'service', chart, catalog)] })
                }
              >
                <Plus size={14} /> Xidmət sətri
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  set({ lines: [...form.lines, blankLine(direction, 'stock', chart, catalog)] })
                }
              >
                <Plus size={14} /> Mal sətri
              </button>
            </div>
          </div>

          <dl className="totals">
            <div>
              <dt>Əsas məbləğ</dt>
              <dd>
                <Amount value={totalNet} />
              </dd>
            </div>
            <div>
              <dt>ƏDV</dt>
              <dd>
                <Amount value={totalVat} />
              </dd>
            </div>
            <div className="grand">
              <dt>Cəmi</dt>
              <dd>
                <Amount value={total} strong /> <small>AZN</small>
              </dd>
            </div>
          </dl>

          <PostingsPanel
            preview={dirty || !id ? preview : undefined}
            postings={detail.data?.postings}
            currentVersion={detail.data?.version}
            accounts={catalog.accounts}
          />
        </fieldset>
        <footer className="document-actions">
          <span className="document-note">
            <FileText size={14} aria-hidden="true" />
            {status === 'posted'
              ? 'Düzəliş köhnə yazılışı əks edir və yenisini yaradır.'
              : 'Uçota alınanda müxabirləşmə dərhal yaranır.'}
          </span>
          {status !== 'posted' && !locked && (
            <button
              type="button"
              className="button secondary"
              disabled={mutation.busy}
              onClick={() => void submit('draft')}
            >
              <Save size={15} /> Qaralama kimi saxla
            </button>
          )}
          {!locked && (
            <button
              type="submit"
              className="button primary"
              disabled={mutation.busy || (status === 'posted' && !dirty)}
            >
              <Check size={15} />{' '}
              {mutation.busy
                ? 'Saxlanılır…'
                : status === 'posted'
                  ? 'Düzəlişi uçota al'
                  : 'Uçota al'}
            </button>
          )}
        </footer>
      </form>
      {modal === 'partner' && (
        <Modal title="Yeni kontragent" onClose={() => setModal(null)} size="small">
          <PartnerForm
            companyId={win.companyId}
            onDone={async (partnerId) => {
              await reloadCatalog(win.companyId);
              set({ partnerId });
              setModal(null);
            }}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {modal && typeof modal === 'object' && (
        <Modal title="Yeni məhsul kartı" onClose={() => setModal(null)}>
          <ProductForm
            companyId={win.companyId}
            catalog={catalog}
            onDone={async (productId, account) => {
              await reloadCatalog(win.companyId);
              setLine(modal.product, {
                productId,
                ...(direction === 'purchase'
                  ? { account }
                  : { stockAccount: inFamily(account, '113') ? '' : account }),
              });
              setModal(null);
            }}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {modal === 'cancel' && (
        <Confirm
          title="Qaiməni ləğv et"
          confirmLabel="Ləğv et"
          destructive
          onCancel={() => setModal(null)}
          onConfirm={() => void cancel()}
        >
          <p>
            Uçot yazılışları silinmir: qaimənin tarixinə əks yazılış yaradılır və anbar qalığı bərpa
            olunur.
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
          {mutation.error && <Notice>{mutation.error.message}</Notice>}
        </Confirm>
      )}
    </ModuleFrame>
  );
}

function AccountSelect({
  label,
  value,
  options,
  onChange,
  className,
  placeholder,
}: {
  label: string;
  value: string;
  options: (Account & { postable: boolean })[];
  onChange: (code: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <select
      aria-label={label}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {!placeholder && !options.some((o) => o.code === value) && (
        <option value={value}>{value || 'Hesab seçin'}</option>
      )}
      {options.map((a) => (
        <option key={a.code} value={a.code}>
          {a.code} · {a.name}
        </option>
      ))}
    </select>
  );
}

function trimQty(q: bigint): string {
  const whole = q / 1_000_000n;
  const fraction = (q % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `,${fraction}` : ''}`;
}
const stripUid = (f: Form) => ({ ...f, lines: f.lines.map(({ uid: _u, ...rest }) => rest) });
const withUids = (f: Form): Form => ({ ...f, lines: f.lines.map((l) => ({ ...l, uid: uid() })) });

/**
 * Client-side preview of the entry using the very same posting rules as the server. Sale
 * cost of goods depends on stock at save time and is marked as pending instead of guessed.
 */
function previewLines(
  chart: Chart,
  direction: 'purchase' | 'sale',
  form: Form,
  catalog: Catalog,
): PreviewLine[] | string {
  try {
    const partner = catalog.partners.find((p) => p.id === form.partnerId);
    const lines: InvoiceLine[] = form.lines.map((l) => {
      const product = catalog.products.find((p) => p.id === l.productId);
      const net = parseMoney(lineNet(l) || 'x');
      const vat = parseMoney(l.vat);
      if (l.kind === 'service')
        return {
          kind: 'service',
          description: l.description,
          account: l.account,
          net,
          vat,
          ...(l.expenseItemId ? { expenseItemId: l.expenseItemId } : {}),
        };
      if (!product) throw new Error('Məhsul seçilməyib.');
      const quantity =
        l.unit === 'purchase'
          ? toBaseQty(parseQty(l.quantity), parseQty(product.factor))
          : parseQty(l.quantity);
      return {
        kind: 'stock',
        description: l.description || product.name,
        account: l.account,
        ...(direction === 'sale' ? { stockAccount: l.stockAccount } : {}),
        productId: product.id,
        warehouseId: l.warehouseId,
        quantity,
        net,
        vat,
      };
    });
    const costs = new Map(lines.map((l, i) => [i, 0n] as const));
    const posted = postInvoice(
      chart,
      {
        direction,
        number: form.number || '—',
        partnerId: partner?.id ?? 'x',
        partnerName: partner?.name ?? '',
        lines,
      },
      costs,
    );
    return posted
      .filter((l) => l.debit > 0n || l.credit > 0n)
      .map((l) => ({
        account: l.account,
        debit: formatMinor(l.debit),
        credit: formatMinor(l.credit),
        memo: l.memo,
      }));
  } catch (e) {
    return (e as Error).message;
  }
}
