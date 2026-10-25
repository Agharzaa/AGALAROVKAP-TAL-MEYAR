/**
 * Stage 7a — putting fixed assets into service (ƏV: Dt 111 / Kt 113) and their opening balances
 * (ƏB: Dt 111, Kt 112 against a counter account), with the depreciation terms of every asset
 * (docs/MERHELE-7-ESAS-VESAITLER.md §4.1, §7; QERARLAR 2026-10-26).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Ban, Check, CheckCheck, Plus, Trash2 } from '../icons';
import { assetGroups, monthAfter, monthlyAmount } from '../../domain/assets';
import { formatMinor, parseMoney } from '../../domain/money';
import type { AssetLineInput } from '../../contracts/commands';
import type { AssetDocumentDetail, Catalog } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { day, money, today } from '../format';
import { useMutation, useQuery } from '../hooks';
import { viewTitle } from '../pages';
import { accountOptions, Picker, SubkontoFields } from '../picker';
import { Postings } from '../postings';
import { Confirm, DateInput, Field, Notice, PostingRule } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

type Kind = 'commission' | 'opening';

interface LineForm {
  assetId: string;
  productId: string;
  quantity: string;
  cost: string;
  accumulated: string;
  salvage: string;
  lifeMonths: string;
  remainingMonths: string;
  expenseAccount: string;
  expenseSk: string[];
  counterAccount: string;
  counterSk: string[];
}
interface Form {
  number: string;
  date: string;
  memo: string;
  lines: LineForm[];
}

const blank = (kind: Kind): LineForm => ({
  assetId: '',
  productId: '',
  quantity: '1',
  cost: '',
  accumulated: '0',
  salvage: '0',
  lifeMonths: '',
  remainingMonths: '',
  expenseAccount: '',
  expenseSk: [],
  counterAccount: kind === 'opening' ? '343' : '',
  counterSk: [],
});

function fromDetail(d: AssetDocumentDetail): Form {
  return {
    number: d.number,
    date: d.date,
    memo: d.memo,
    lines: d.lines.map((l) => ({
      assetId: l.assetId,
      productId: l.productId,
      quantity: l.quantity || '1',
      cost: l.cost,
      accumulated: l.accumulated,
      salvage: l.salvage,
      lifeMonths: String(l.lifeMonths),
      remainingMonths: String(l.remainingMonths),
      expenseAccount: l.expenseAccount,
      expenseSk: l.expenseSk,
      counterAccount: l.counterAccount,
      counterSk: l.counterSk,
    })),
  };
}

function toInput(kind: Kind, l: LineForm): AssetLineInput {
  return {
    assetId: l.assetId,
    productId: kind === 'commission' ? l.productId : '',
    quantity: kind === 'commission' ? l.quantity : '',
    cost: kind === 'opening' ? l.cost : '',
    accumulated: kind === 'opening' ? l.accumulated || '0' : '0',
    salvage: l.salvage || '0',
    lifeMonths: Number(l.lifeMonths) || 0,
    ...(kind === 'opening' ? { remainingMonths: Number(l.remainingMonths) || 0 } : {}),
    expenseAccount: l.expenseAccount,
    expenseSk: l.expenseSk,
    counterAccount: kind === 'opening' ? l.counterAccount : '',
    counterSk: kind === 'opening' ? l.counterSk : [],
  };
}

/**
 * Depreciation goes by the asset's group (QERARLAR 2026-10-26 §3): transport to 701 (the cost of
 * the transport service), the rest to 721, with the "Amortizasiya" expense item.
 */
function defaultsFor(catalog: Catalog, assetId: string): Partial<LineForm> {
  const asset = catalog.fixedAssets.find((a) => a.id === assetId);
  if (!asset) return {};
  const role = (r: string) => catalog.items.find((i) => i.role === r && !i.archived)?.id ?? '';
  const months = assetGroups.find((g) => g.id === asset.group)?.months ?? 60;
  return asset.group === 'transport'
    ? {
        lifeMonths: String(months),
        expenseAccount: '701',
        expenseSk: [role('defaultProductGroup'), role('depreciation')],
      }
    : { lifeMonths: String(months), expenseAccount: '721', expenseSk: [role('depreciation')] };
}

const isExpense = (code: string) =>
  ['202', '701', '711', '721', '731'].some((f) => code === f || code.startsWith(`${f}.`));

/** Monthly amount of an opening balance, as the month closing will post it. */
function preview(kind: Kind, date: string, l: LineForm): string {
  if (kind !== 'opening') return '';
  try {
    const months = Number(l.remainingMonths);
    if (!months) return '';
    return formatMinor(
      monthlyAmount({
        cost: parseMoney(l.cost),
        accumulated: parseMoney(l.accumulated || '0'),
        salvage: parseMoney(l.salvage || '0'),
        months,
        start: monthAfter(date),
      }),
    );
  } catch {
    return '';
  }
}

export function AssetEditor({ kind, id }: { kind: Kind; id?: string }) {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const detail = useQuery<AssetDocumentDetail>(
    id ? { type: 'assetDocument', companyId: win.companyId, id } : null,
  );
  const [form, setForm] = useState<Form | null>(null);
  const baseline = useRef('');
  const resync = useRef(false);
  const m = useMutation();
  const [message, setMessage] = useState('');
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const doc = detail.data;
  const snapshot = (f: Form) =>
    JSON.stringify({ ...f, lines: f.lines.map((l) => toInput(kind, l)) });

  useEffect(() => {
    if (form) return;
    if (id && !doc) return;
    const initial: Form = doc
      ? fromDetail(doc)
      : { number: '', date: today(), memo: '', lines: [blank(kind)] };
    baseline.current = snapshot(initial);
    setForm(initial);
  }, [doc, form, id]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const locked = doc?.status === 'cancelled';
  async function save(close = false) {
    if (!form || locked || m.busy) return;
    setMessage('');
    const r = await m.run({
      type: 'asset.save',
      companyId: win.companyId,
      kind,
      number: form.number,
      date: form.date,
      memo: form.memo,
      lines: form.lines.map((l) => toInput(kind, l)),
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
      ws.retarget(win.id, { type: 'asset', kind, id: r.id });
    } else detail.reload();
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ws.activeId !== win.id) return;
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (e.ctrlKey && e.key === 'Enter') {
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
  const assets = catalog.fixedAssets
    .filter((a) => !a.archived)
    .map((a) => ({
      value: a.id,
      label: `${a.inventoryNo} ${a.name}`,
      ...(a.plate ? { hint: a.plate } : {}),
    }));
  const products = catalog.products
    .filter((p) => p.kind === 'asset' && !p.archived)
    .map((p) => ({ value: p.id, label: p.name, hint: p.unit }));
  const expenseAccounts = accountOptions(catalog, isExpense);
  const counterAccounts = accountOptions(catalog, (c) => !['111', '112', '113'].includes(c));
  const errorLine = /^lines\.(\d+)\./.exec(m.error?.field ?? '')?.[1];
  const monthlyOf = (i: number) =>
    kind === 'opening' ? preview(kind, form.date, form.lines[i]!) : (doc?.lines[i]?.monthly ?? '');
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
              placeholder={kind === 'commission' ? 'ƏV-000001' : 'ƏB-000001'}
              onChange={(e) => set({ number: e.target.value })}
            />
          </Field>
          <Field label="Tarix" hint="Amortizasiya növbəti aydan başlayır">
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
              onChange={(e) => set({ memo: e.target.value })}
            />
          </Field>
        </fieldset>
        <fieldset className="lines asset-lines" disabled={m.busy || locked}>
          {form.lines.map((l, i) => (
            <section
              key={i}
              className={`asset-line${errorLine === String(i) ? ' invalid' : ''}`}
              aria-label={`Sətir ${i + 1}`}
            >
              <Field label="Əsas vəsait" wide>
                <Picker
                  ariaLabel={`Sətir ${i + 1}: əsas vəsait`}
                  value={l.assetId}
                  options={assets}
                  onChange={(assetId) =>
                    setLine(i, {
                      assetId,
                      ...(l.expenseAccount ? {} : defaultsFor(catalog, assetId)),
                    })
                  }
                />
              </Field>
              {kind === 'commission' ? (
                <>
                  <Field label="113-dən (nomenklatura)" wide>
                    <Picker
                      ariaLabel={`Sətir ${i + 1}: nomenklatura`}
                      value={l.productId}
                      options={products}
                      onChange={(productId) => setLine(i, { productId })}
                    />
                  </Field>
                  <Field label="Miqdar">
                    <input
                      aria-label={`Sətir ${i + 1}: miqdar`}
                      inputMode="decimal"
                      value={l.quantity}
                      onChange={(e) => setLine(i, { quantity: e.target.value })}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="İlkin dəyər">
                    <input
                      aria-label={`Sətir ${i + 1}: ilkin dəyər`}
                      inputMode="decimal"
                      value={l.cost}
                      onChange={(e) => setLine(i, { cost: e.target.value })}
                    />
                  </Field>
                  <Field label="Yığılmış amortizasiya">
                    <input
                      aria-label={`Sətir ${i + 1}: yığılmış amortizasiya`}
                      inputMode="decimal"
                      value={l.accumulated}
                      onChange={(e) => setLine(i, { accumulated: e.target.value })}
                    />
                  </Field>
                  <Field label="Qalan ay">
                    <input
                      aria-label={`Sətir ${i + 1}: qalan ay`}
                      inputMode="numeric"
                      value={l.remainingMonths}
                      onChange={(e) => setLine(i, { remainingMonths: e.target.value })}
                    />
                  </Field>
                </>
              )}
              <Field label="Müddət (ay)">
                <input
                  aria-label={`Sətir ${i + 1}: müddət`}
                  inputMode="numeric"
                  value={l.lifeMonths}
                  onChange={(e) => setLine(i, { lifeMonths: e.target.value })}
                />
              </Field>
              <Field label="Ləğv dəyəri">
                <input
                  aria-label={`Sətir ${i + 1}: ləğv dəyəri`}
                  inputMode="decimal"
                  value={l.salvage}
                  onChange={(e) => setLine(i, { salvage: e.target.value })}
                />
              </Field>
              <Field label="Amortizasiyanın xərci" wide>
                <div className="asset-account">
                  <Picker
                    className="account-picker"
                    ariaLabel={`Sətir ${i + 1}: xərc hesabı`}
                    value={l.expenseAccount}
                    options={expenseAccounts}
                    onChange={(expenseAccount) => setLine(i, { expenseAccount, expenseSk: [] })}
                    placeholder="Hesab"
                  />
                  <SubkontoFields
                    catalog={catalog}
                    companyId={win.companyId}
                    account={l.expenseAccount}
                    values={l.expenseSk}
                    onChange={(expenseSk) => setLine(i, { expenseSk })}
                    side={`Sətir ${i + 1}: xərc`}
                  />
                </div>
              </Field>
              {kind === 'opening' && (
                <Field label="Qarşı hesab" wide hint="Başlanğıc qalıqların qarşı hesabı (məs. 343)">
                  <div className="asset-account">
                    <Picker
                      className="account-picker"
                      ariaLabel={`Sətir ${i + 1}: qarşı hesab`}
                      value={l.counterAccount}
                      options={counterAccounts}
                      onChange={(counterAccount) => setLine(i, { counterAccount, counterSk: [] })}
                      placeholder="Hesab"
                    />
                    <SubkontoFields
                      catalog={catalog}
                      companyId={win.companyId}
                      account={l.counterAccount}
                      values={l.counterSk}
                      onChange={(counterSk) => setLine(i, { counterSk })}
                      side={`Sətir ${i + 1}: qarşı`}
                    />
                  </div>
                </Field>
              )}
              <div className="asset-line-foot">
                <span role="status" aria-label={`Sətir ${i + 1}: aylıq amortizasiya`}>
                  {monthlyOf(i)
                    ? `Aylıq amortizasiya: ${money(monthlyOf(i))} ₼ (${monthAfter(form.date).split('-').reverse().join('.')}-dən)`
                    : kind === 'commission'
                      ? 'Aylıq amortizasiya uçota alınandan sonra görünür (dəyər 113-dən gəlir).'
                      : ''}
                </span>
                {form.lines.length > 1 && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Sətir ${i + 1}: sil`}
                    onClick={() => set({ lines: form.lines.filter((_, j) => j !== i) })}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </section>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() => set({ lines: [...form.lines, blank(kind)] })}
          >
            <Plus size={15} /> Əsas vəsait əlavə et
          </button>
        </fieldset>
        <PostingRule>
          {kind === 'commission'
            ? 'İstismara vermə: Dt 111 (əsas vəsait) / Kt 113 (nomenklatura). Dəyər 113-ün qalığından miqdara görə gəlir; amortizasiya ay bağlanışında, növbəti aydan, düz xətt ilə hesablanır.'
            : 'Başlanğıc qalıq: Dt 111 / Kt qarşı hesab — ilkin dəyər; Dt qarşı hesab / Kt 112 — yığılmış amortizasiya. Qalan dəyər qalan aylara bölünür.'}
        </PostingRule>
        {doc && doc.postings.length > 0 && <Postings postings={doc.postings} />}
        {doc && (
          <p className="muted">
            {day(doc.date)} · cəmi {money(doc.total)} ₼
          </p>
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
              type: 'asset.cancel',
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
