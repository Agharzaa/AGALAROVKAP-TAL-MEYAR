/**
 * Bank document (stage 3a): receipt ("Bank daxilolması") or payment ("Bank məxarici"). The bank
 * account gives one side of every posting; each line names the counter account with its subkonto.
 * A 211 line of a receipt (531 of a payment) left without a settlement document is matched to the
 * open invoices by the server; the entry under the form shows where the money went.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Ban, Check, CheckCheck } from '../icons';
import type {
  BankDocumentDetail,
  Catalog,
  RuleDraft,
  StatementLineView,
} from '../../contracts/queries';
import { formFromDraft, RuleDialog } from './rules';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { day, money, toField } from '../format';
import { useMutation, useQuery } from '../hooks';
import { viewTitle } from '../pages';
import {
  blankLine as blank,
  linesFromView,
  MoneyLines,
  toLineInput as toInput,
  typedRate,
  withTemplate,
  type LineForm,
  type Template,
} from '../money-lines';
import { Picker, type Option } from '../picker';
import { rateHint, useAutoRate } from '../rates';
import { Postings, todayIso } from '../postings';
import { Confirm, DateInput, Field, Notice } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

type Direction = 'in' | 'out';
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

/**
 * "Əməliyyat növü": a template that only fills the counter account of the line (QERARLAR
 * 2026-10-07: the counter account stays free). Settlement accounts follow the bank currency.
 */
const templates: Record<Direction, Template[]> = {
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
    lines: linesFromView(d.lines),
  };
}

export function BankEditor({
  direction,
  id,
  statementLineId,
}: {
  direction: Direction;
  id?: string;
  statementLineId?: string;
}) {
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
  const [learn, setLearn] = useState(false);
  const doc = detail.data;
  const draft = useQuery<RuleDraft>(
    learn && id ? { type: 'ruleDraft', companyId: win.companyId, documentId: id } : null,
  );
  // A new document for a statement row starts from what the bank wrote and what was recognised.
  const fromStatement = !id && !!statementLineId;
  const source = useQuery<StatementLineView>(
    fromStatement ? { type: 'statementLine', companyId: win.companyId, id: statementLineId } : null,
  );
  const row = source.data;
  const incoming = direction === 'in';
  const snapshot = (f: Form) => JSON.stringify({ ...f, lines: f.lines.map(toInput) });

  useEffect(() => {
    if (form || !catalog) return;
    if (id && !doc) return;
    if (fromStatement && !row) return;
    const accounts = catalog.bankAccounts.filter((b) => !b.archived);
    const initial: Form = doc
      ? fromDetail(doc)
      : row
        ? {
            number: '',
            date: row.date,
            bankAccountId: row.bankAccountId,
            rate: '',
            bankReference: row.reference,
            counterpartyName: row.counterparty,
            counterpartyTaxId: row.counterpartyTaxId,
            purpose: row.purpose,
            // A rule proposes all its lines with the row's amount already split.
            lines: row.proposal?.lines?.length
              ? row.proposal.lines.map((l) => ({
                  ...blank(l.account),
                  sk: l.sk,
                  amount: toField(l.amount),
                  cashFlowItem: l.cashFlowItem,
                  memo: l.memo,
                }))
              : [
                  {
                    ...blank(row.proposal?.account ?? ''),
                    sk: row.proposal?.sk ?? [],
                    amount: toField(row.amount),
                  },
                ],
          }
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
    // A prefilled statement row is not saved yet: it counts as unsaved work.
    baseline.current = row && !doc ? '' : snapshot(initial);
    setForm(initial);
  }, [doc, form, id, catalog, row]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const autoRate = useAutoRate(
    win.companyId,
    catalog?.bankAccounts.find((b) => b.id === form?.bankAccountId)?.currency ?? 'AZN',
    form?.date ?? '',
    form?.rate ?? '',
    (rate) => setForm((f) => (f ? { ...f, rate } : f)),
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
      ...(fromStatement && statementLineId ? { statementLineId } : {}),
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
  async function pair(pairId: string) {
    if (!doc) return;
    setMessage('');
    const r = await m.run({ type: 'bank.pair', companyId: win.companyId, id: doc.id, pairId });
    if (!r) return;
    setMessage(pairId ? 'ƏDV cütü bağlandı.' : 'ƏDV cütü ayrıldı.');
    detail.reload();
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
        <div className="loading">{detail.error || source.error || 'Yüklənir…'}</div>
      </ModuleFrame>
    );
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const headerError = (field: string) => (m.error?.field === field ? m.error.message : undefined);
  const bank = catalog.bankAccounts.find((b) => b.id === form.bankAccountId);
  const currency = bank?.currency ?? 'AZN';
  const foreign = currency !== 'AZN';
  const rate = typedRate(foreign, form.rate);
  const applyTemplate = (label: string) => {
    const t = templates[direction].find((x) => x.label === label);
    if (!t) return;
    set({ lines: withTemplate(form.lines, t, foreign), purpose: form.purpose || t.label });
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
          {doc && doc.status === 'posted' && doc.origin === 'statement' && !doc.ruleName && (
            <button
              type="button"
              className="button secondary"
              title="Bu qərarı növbəti oxşar sətirlər üçün qayda kimi yadda saxla"
              onClick={() => setLearn(true)}
            >
              Qayda kimi saxla
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
          {doc?.warnings.map((w) => (
            <Notice key={w} kind="warning">
              {w}
            </Notice>
          ))}
          {/* The VAT pair matters before the lines: say it at the top, details further down. */}
          {doc?.pair && !doc.pair.ok && (
            <Notice kind="warning">
              ƏDV cütü {doc.pair.number}: depozitə {money(doc.pair.deposit)}, 18/118 üzrə{' '}
              {money(doc.pair.expected)} (fərq {money(doc.pair.difference)}). Ətraflı — aşağıda “ƏDV
              cütü”.
            </Notice>
          )}
          {doc && !doc.pair && doc.pairable && doc.pairCandidates.length > 0 && (
            <Notice kind="info">
              ƏDV cütü seçilməyib: {doc.pairCandidates.length} uyğun sənəd var (
              {doc.pairCandidates.map((c) => c.number).join(', ')}) — aşağıda “ƏDV cütü” bölməsində
              seçin.
            </Notice>
          )}
          {row && !doc && (
            <Notice kind="info">
              Çıxarış sətri {row.row}: {row.direction === 'in' ? 'daxilolma' : 'məxaric'}{' '}
              {money(row.amount)}. {row.proposal?.reason}
              {row.proposal?.newPartner &&
                ` Kontragentlər kitabçasına əlavə edin: ${row.proposal.newPartner.name}, VÖEN ${row.proposal.newPartner.taxId}.`}{' '}
              Sətirlərin cəmi çıxarışdakı məbləğə bərabər olmalıdır.
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
          {fromStatement ? (
            <>
              <Field label="Tarix" hint="Çıxarışdan">
                <input aria-label="Tarix" readOnly value={day(form.date)} />
              </Field>
              <Field label="Bank hesabı" className="partner" hint="Çıxarışdan">
                <input
                  aria-label="Bank hesabı"
                  readOnly
                  value={bankOptions.find((o) => o.value === form.bankAccountId)?.label ?? ''}
                />
              </Field>
            </>
          ) : (
            <>
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
            </>
          )}
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
          <MoneyLines
            catalog={catalog as Catalog}
            companyId={win.companyId}
            direction={direction}
            currency={currency}
            rate={rate}
            lines={form.lines}
            onChange={(lines) => set({ lines })}
            errorField={m.error?.field}
          />
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
        {doc && doc.pairable && (
          <section className="invoice-postings" aria-label="ƏDV cütü">
            <div className="section-head">
              <h2>ƏDV cütü</h2>
            </div>
            {doc.pair ? (
              <>
                <p>
                  Cüt sənəd:{' '}
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      ws.open({ type: 'bank', direction, id: doc.pair!.id }, win.companyId)
                    }
                  >
                    {doc.pair.number}
                  </button>{' '}
                  · {day(doc.pair.date)} · {doc.pair.account} · {money(doc.pair.amount)}
                </p>
                <p className={doc.pair.ok ? 'pair-ok' : 'pair-bad'} role="status">
                  Ödənişin cəmi {money(doc.pair.total)}: depozitə {money(doc.pair.deposit)}, 18/118
                  üzrə {money(doc.pair.expected)}
                  {doc.pair.ok
                    ? ' — uyğundur.'
                    : ` — fərq ${money(doc.pair.difference)}. ƏDV hissəsi səhv köçürülüb və ya ödənişin bir hissəsi ƏDV-sizdir.`}
                </p>
                {!locked && (
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={m.busy}
                    onClick={() => void pair('')}
                  >
                    Cütü ayır
                  </button>
                )}
              </>
            ) : doc.pairCandidates.length ? (
              <>
                <p>
                  {doc.pairCandidates.length === 1
                    ? 'Uyğun sənəd tapıldı, amma o başqa sənədlə də uyğun gəlir; seçimi siz edin:'
                    : 'Bir neçə uyğun sənəd var (eyni ödəyici, ±3 gün); hansının cüt olduğunu seçin:'}
                </p>
                <ul className="pair-candidates">
                  {doc.pairCandidates.map((c) => (
                    <li key={c.id}>
                      {c.number} · {day(c.date)} · {c.account} · {money(c.amount)}{' '}
                      <button
                        type="button"
                        className="button secondary small"
                        disabled={m.busy || locked}
                        aria-label={`${c.number} ilə cütləşdir`}
                        onClick={() => void pair(c.id)}
                      >
                        Cütləşdir
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="doc-hint">
                Cüt yoxdur. {doc.account.startsWith('224') ? 'Əsas hissənin' : 'ƏDV hissəsinin'}{' '}
                sənədi uçota alınanda (eyni ödəyici, ±3 gün) cüt avtomatik bağlanır.
              </p>
            )}
          </section>
        )}
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
      {learn && draft.data && (
        <RuleDialog
          companyId={win.companyId}
          catalog={catalog as Catalog}
          initial={formFromDraft(draft.data)}
          existing={draft.data.existing}
          onClose={() => setLearn(false)}
          onSaved={() =>
            setMessage('Qayda saxlanıldı (“Təklif” rejimi). Bank və kassa → Bank qaydaları.')
          }
        />
      )}
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
