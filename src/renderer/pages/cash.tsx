/**
 * Cash (stage 5a): the order journal, the cash order — "Kassa mədaxil orderi" (KMO) / "Kassa
 * məxaric orderi" (KXO) — and the cash book. The order is the bank document's twin: the cashbox
 * gives one side of every posting, each line names the counter account; the printed order is the
 * paper the cashier signs.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Ban, Check, CheckCheck } from '../icons';
import type {
  CashBookView,
  CashDocumentDetail,
  CashDocumentSummary,
  Catalog,
  CompanyView,
} from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { RangeFields, SearchField, matches, useRange } from '../filters';
import { addAmounts, day, money, toField } from '../format';
import { useMutation, useQuery } from '../hooks';
import {
  blankLine,
  linesFromView,
  MoneyLines,
  toLineInput,
  typedRate,
  withTemplate,
  type Direction,
  type LineForm,
  type Template,
} from '../money-lines';
import { pages, viewTitle } from '../pages';
import { Picker, type Option } from '../picker';
import { Postings, todayIso } from '../postings';
import { usePrint } from '../print';
import { rateHint, useAutoRate } from '../rates';
import {
  Amount,
  Confirm,
  DataTable,
  DateInput,
  Empty,
  Field,
  Notice,
  PostingRule,
  Status,
  type Column,
} from '../ui';
import { useWindow, useWorkspace } from '../workspace';

const orderName = { in: 'Kassa mədaxil orderi', out: 'Kassa məxaric orderi' } as const;

const cashboxOptions = (catalog: Catalog | undefined, keep = ''): Option[] =>
  (catalog?.cashboxes ?? [])
    .filter((b) => !b.archived || b.id === keep)
    .map((b) => ({ value: b.id, label: `${b.account} · ${b.name}`, hint: b.currency }));

// ---------------------------------------------------------------------------------------------
// Journal

export function CashDocumentsPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const range = useRange(ws.period);
  const [search, setSearch] = useState('');
  const [cashboxId, setCashboxId] = useState('');
  const page = pages.cash;
  const result = useQuery<CashDocumentSummary[]>({
    type: 'cashDocuments',
    companyId: win.companyId,
    ...range.applied,
    ...(cashboxId ? { cashboxId } : {}),
  });
  const rows = (result.data ?? []).filter((r) =>
    matches(search, r.number, r.counterpartyName, r.basis, r.accounts),
  );
  const open = (direction: Direction, id?: string) =>
    ws.open({ type: 'cash', direction, ...(id ? { id } : {}) }, win.companyId);
  const posted = rows.filter((r) => r.status === 'posted');
  const amount = (r: CashDocumentSummary) => (
    <>
      <Amount value={r.amount} strong />
      {r.currency !== 'AZN' && <small className="currency"> {r.currency}</small>}
    </>
  );
  const columns: Column<CashDocumentSummary>[] = [
    { key: 'date', label: 'Tarix', render: (r) => day(r.date) },
    {
      key: 'number',
      label: 'Nömrə',
      className: 'nowrap',
      render: (r) => (
        <button type="button" className="link" onClick={() => open(r.direction, r.id)}>
          {r.number}
        </button>
      ),
    },
    {
      key: 'direction',
      label: 'Növ',
      className: 'nowrap',
      render: (r) => (r.direction === 'in' ? 'Mədaxil' : 'Məxaric'),
    },
    {
      key: 'cashbox',
      label: 'Kassa',
      className: 'clip',
      render: (r) => (
        <span title={r.cashbox}>
          {r.account} · {r.cashbox}
        </span>
      ),
    },
    {
      key: 'counterparty',
      label: 'Kimdən / kimə',
      className: 'clip',
      render: (r) => <span title={r.counterpartyName}>{r.counterpartyName || '—'}</span>,
    },
    { key: 'accounts', label: 'Müxabir hesab', className: 'nowrap', render: (r) => r.accounts },
    {
      key: 'basis',
      label: 'Əsas',
      className: 'clip',
      render: (r) => <span title={r.basis}>{r.basis}</span>,
    },
    {
      key: 'in',
      label: 'Mədaxil',
      align: 'end',
      render: (r) => (r.direction === 'in' ? amount(r) : null),
    },
    {
      key: 'out',
      label: 'Məxaric',
      align: 'end',
      render: (r) => (r.direction === 'out' ? amount(r) : null),
    },
    { key: 'status', label: 'Vəziyyət', render: (r) => <Status status={r.status} /> },
  ];
  const actions = (
    <>
      <button type="button" className="button primary" onClick={() => open('in')}>
        <ArrowDownLeft size={15} /> Mədaxil
      </button>
      <button type="button" className="button secondary" onClick={() => open('out')}>
        <ArrowUpRight size={15} /> Məxaric
      </button>
    </>
  );
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      count={rows.length}
      onRefresh={result.reload}
      onFilter={range.apply}
      actions={actions}
      filters={
        <>
          <RangeFields range={range} />
          <label className="filter-text">
            <span>Kassa</span>
            <select
              aria-label="Kassa"
              value={cashboxId}
              onChange={(e) => setCashboxId(e.target.value)}
            >
              <option value="">Hamısı</option>
              {(catalog?.cashboxes ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.account} · {b.name} · {b.currency}
                </option>
              ))}
            </select>
          </label>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Nömrə, kimdən / kimə, əsas"
          />
        </>
      }
      notices={result.error && <Notice>{result.error}</Notice>}
    >
      <DataTable
        label={page.title}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onOpen={(r) => open(r.direction, r.id)}
        rowClass={(r) => (r.status === 'cancelled' ? 'cancelled' : '')}
        empty={
          <Empty title={search ? 'Axtarışa uyğun sənəd yoxdur' : 'Bu dövrdə kassa sənədi yoxdur'}>
            {actions}
          </Empty>
        }
        footer={
          <tr>
            <td colSpan={7}>Uçotdakı sənədlər üzrə cəmi, AZN</td>
            <td className="num">
              <Amount
                value={addAmounts(
                  posted.filter((r) => r.direction === 'in').map((r) => r.amountAzn),
                )}
                strong
              />
            </td>
            <td className="num">
              <Amount
                value={addAmounts(
                  posted.filter((r) => r.direction === 'out').map((r) => r.amountAzn),
                )}
                strong
              />
            </td>
            <td />
          </tr>
        }
      />
    </ModuleFrame>
  );
}

// ---------------------------------------------------------------------------------------------
// Cash book

export function CashBookPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog, company } = useCatalog(win.companyId);
  const range = useRange(ws.period);
  const [cashboxId, setCashboxId] = useState('');
  const boxes = (catalog?.cashboxes ?? []).filter((b) => !b.archived);
  const chosen = cashboxId || boxes[0]?.id || '';
  const book = useQuery<CashBookView>(
    chosen
      ? { type: 'cashBook', companyId: win.companyId, cashboxId: chosen, ...range.applied }
      : null,
  );
  const printer = usePrint();
  const page = pages.cashBook;
  const b = book.data;
  const foreign = !!b && b.currency !== 'AZN';
  const openLine = (l: CashBookView['days'][number]['lines'][number]) => {
    if (l.sourceType === 'cash' && l.direction)
      ws.open({ type: 'cash', direction: l.direction, id: l.sourceId }, win.companyId);
  };
  const table = b && (
    <table className="grid cash-book">
      <thead>
        <tr>
          <th scope="col">Sənəd</th>
          <th scope="col">Kimdən / kimə</th>
          <th scope="col">Müxabir hesab</th>
          <th scope="col">Əsas</th>
          <th scope="col" className="num">
            Mədaxil{foreign ? `, ${b.currency}` : ''}
          </th>
          <th scope="col" className="num">
            Məxaric{foreign ? `, ${b.currency}` : ''}
          </th>
        </tr>
      </thead>
      <tbody>
        {b.days.map((d) => (
          <DayRows key={d.date} d={d} foreign={foreign} onOpen={openLine} />
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4}>
            Dövr üzrə: qalıq əvvələ {money(b.opening)}, sona {money(b.closing)} AZN
            {foreign && ` (${money(b.openingCur)} → ${money(b.closingCur)} ${b.currency})`}
          </td>
          <td className="num">
            <Amount value={b.income} strong />
          </td>
          <td className="num">
            <Amount value={b.expense} strong />
          </td>
        </tr>
      </tfoot>
    </table>
  );
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      onRefresh={book.reload}
      onFilter={range.apply}
      actions={
        b && (
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              printer.print(
                <>
                  <h1>Kassa kitabı</h1>
                  <p>
                    {company?.name} · VÖEN {company?.taxId}
                    <br />
                    {b.account} · {b.cashbox} · {day(range.applied.from)} — {day(range.applied.to)}
                  </p>
                  {table}
                  <p className="signatures">Kassir ____________ Baş mühasib ____________</p>
                </>,
              )
            }
          >
            Çap et
          </button>
        )
      }
      filters={
        <>
          <RangeFields range={range} />
          <label className="filter-text">
            <span>Kassa</span>
            <select
              aria-label="Kassa"
              value={chosen}
              onChange={(e) => setCashboxId(e.target.value)}
            >
              {boxes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.account} · {x.name} · {x.currency}
                </option>
              ))}
            </select>
          </label>
        </>
      }
      notices={
        <>
          {book.error && <Notice>{book.error}</Notice>}
          {b?.truncated && (
            <Notice kind="warning">
              Dövrdə çox hərəkət var; kitab qısaldılıb — dövrü daraldın.
            </Notice>
          )}
        </>
      }
    >
      {!chosen ? (
        <Empty title="Kassa yoxdur">Bank və kassa → Kassalar kitabçasında kassa yaradın.</Empty>
      ) : !b ? (
        <div className="loading">Yüklənir…</div>
      ) : b.days.length ? (
        <div className="table-scroll">{table}</div>
      ) : (
        <Empty title="Bu dövrdə kassada hərəkət yoxdur">
          Qalıq: {money(b.closing)} AZN{foreign && ` · ${money(b.closingCur)} ${b.currency}`}
        </Empty>
      )}
      {printer.sheet}
    </ModuleFrame>
  );
}

function DayRows({
  d,
  foreign,
  onOpen,
}: {
  d: CashBookView['days'][number];
  foreign: boolean;
  onOpen: (l: CashBookView['days'][number]['lines'][number]) => void;
}) {
  return (
    <>
      <tr className="day-head">
        <td colSpan={4}>
          <b>{day(d.date)}</b> · qalıq günün əvvəlinə {money(d.opening)}
          {foreign && ` · ${money(d.openingCur)}`}
        </td>
        <td colSpan={2} />
      </tr>
      {d.lines.map((l) => (
        <tr key={`${l.sourceType}:${l.sourceId}`} onDoubleClick={() => onOpen(l)}>
          <td className="nowrap">
            {l.sourceType === 'cash' ? (
              <button type="button" className="link" onClick={() => onOpen(l)}>
                {l.number}
              </button>
            ) : (
              l.number
            )}
          </td>
          <td className="clip">{l.counterparty}</td>
          <td className="nowrap">{l.account}</td>
          <td className="clip" title={l.memo}>
            {l.memo}
          </td>
          <td className="num">{l.income && money(foreign ? l.incomeCur : l.income)}</td>
          <td className="num">{l.expense && money(foreign ? l.expenseCur : l.expense)}</td>
        </tr>
      ))}
      <tr className="day-foot">
        <td colSpan={4}>
          Gün üzrə cəmi · qalıq günün sonuna <b>{money(d.closing)}</b>
          {foreign && ` · ${money(d.closingCur)}`}
        </td>
        <td className="num">{money(d.income)}</td>
        <td className="num">{money(d.expense)}</td>
      </tr>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Cash order

interface Form {
  number: string;
  date: string;
  cashboxId: string;
  rate: string;
  counterpartyName: string;
  basis: string;
  attachment: string;
  lines: LineForm[];
}

/** "Əməliyyat növü" (QERARLAR 2026-10-17 §1): fills only the counter account of new lines. */
const templates: Record<Direction, Template[]> = {
  in: [
    { label: 'Alıcıdan nağd ödəniş', accounts: ['211'] },
    { label: 'Bankdan nağd pulun alınması', accounts: ['222.01'] },
    { label: 'Təhtəlhesab qalığının qaytarılması', accounts: ['244'] },
    { label: 'Malsatandan qaytarma', accounts: ['243'] },
    { label: 'Nizamnamə kapitalına qoyuluş', accounts: ['301'] },
  ],
  out: [
    { label: 'Malsatana nağd ödəniş', accounts: ['531'] },
    { label: 'Təhtəlhesab verilməsi', accounts: ['244'] },
    { label: 'Əmək haqqının ödənişi', accounts: ['533'] },
    { label: 'Nağd pulun banka verilməsi', accounts: ['222.01'] },
    { label: 'Alıcıya qaytarma', accounts: ['543'] },
  ],
};

function fromDetail(d: CashDocumentDetail): Form {
  return {
    number: d.number,
    date: d.date,
    cashboxId: d.cashboxId,
    rate: d.currency === 'AZN' ? '' : toField(d.rate),
    counterpartyName: d.counterpartyName,
    basis: d.basis,
    attachment: d.attachment,
    lines: linesFromView(d.lines),
  };
}

export function CashEditor({ direction, id }: { direction: Direction; id?: string }) {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog, company } = useCatalog(win.companyId);
  const detail = useQuery<CashDocumentDetail>(
    id ? { type: 'cashDocument', companyId: win.companyId, id } : null,
  );
  const [form, setForm] = useState<Form | null>(null);
  const baseline = useRef('');
  const resync = useRef(false);
  const m = useMutation();
  const [message, setMessage] = useState('');
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const printer = usePrint();
  const doc = detail.data;
  const incoming = direction === 'in';
  const snapshot = (f: Form) => JSON.stringify({ ...f, lines: f.lines.map(toLineInput) });

  useEffect(() => {
    if (form || !catalog) return;
    if (id && !doc) return;
    const boxes = catalog.cashboxes.filter((b) => !b.archived);
    const initial: Form = doc
      ? fromDetail(doc)
      : {
          number: '',
          date: ws.period.to < todayIso() ? ws.period.to : todayIso(),
          cashboxId: boxes.length === 1 ? boxes[0]!.id : '',
          rate: '',
          counterpartyName: '',
          basis: '',
          attachment: '',
          lines: [blankLine()],
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
  const boxOptions = useMemo(
    () => cashboxOptions(catalog, form?.cashboxId),
    [catalog, form?.cashboxId],
  );

  const autoRate = useAutoRate(
    win.companyId,
    catalog?.cashboxes.find((b) => b.id === form?.cashboxId)?.currency ?? 'AZN',
    form?.date ?? '',
    form?.rate ?? '',
    (rate) => setForm((f) => (f ? { ...f, rate } : f)),
  );
  const locked = doc?.status === 'cancelled';
  async function save(close = false) {
    if (!form || locked || m.busy) return;
    setMessage('');
    const r = await m.run({
      type: 'cash.save',
      companyId: win.companyId,
      direction,
      number: form.number,
      date: form.date,
      cashboxId: form.cashboxId,
      rate: form.rate.trim(),
      counterpartyName: form.counterpartyName,
      basis: form.basis,
      attachment: form.attachment,
      lines: form.lines.map(toLineInput),
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
        : `Order ${r.number} uçota alındı.`,
    );
    resync.current = true;
    if (!id) {
      baseline.current = snapshot({ ...form, number: r.number ?? form.number });
      ws.setDirty(win.id, false);
      ws.retarget(win.id, { type: 'cash', direction, id: r.id });
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
  const headerError = (field: string) => (m.error?.field === field ? m.error.message : undefined);
  const box = catalog.cashboxes.find((b) => b.id === form.cashboxId);
  const currency = box?.currency ?? 'AZN';
  const foreign = currency !== 'AZN';
  const applyTemplate = (label: string) => {
    const t = templates[direction].find((x) => x.label === label);
    if (t) set({ lines: withTemplate(form.lines, t, foreign), basis: form.basis || t.label });
  };

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
          {doc && !locked && (
            <button
              type="button"
              className="button secondary"
              title={
                dirty ? 'Əvvəlcə dəyişikliyi uçota alın' : 'Orderi çap et və ya PDF kimi saxla'
              }
              disabled={dirty}
              onClick={() => printer.print(<OrderSheet doc={doc} company={company} />)}
            >
              Çap et
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
              placeholder={incoming ? 'KMO-000001' : 'KXO-000001'}
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
          <Field label="Kassa" className="partner" error={headerError('cashboxId')}>
            <Picker
              ariaLabel="Kassa"
              value={form.cashboxId}
              options={boxOptions}
              invalid={m.error?.field === 'cashboxId'}
              onChange={(cashboxId) => set({ cashboxId, rate: '' })}
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
          <Field label={incoming ? 'Kimdən qəbul edilib' : 'Kimə verilib'} wide>
            <input
              aria-label={incoming ? 'Kimdən qəbul edilib' : 'Kimə verilib'}
              maxLength={240}
              value={form.counterpartyName}
              onChange={(e) => set({ counterpartyName: e.target.value })}
            />
          </Field>
          <Field label="Əsas" wide>
            <input
              aria-label="Əsas"
              maxLength={500}
              value={form.basis}
              onChange={(e) => set({ basis: e.target.value })}
            />
          </Field>
          <Field label="Əlavə" hint="Qoşulan sənədlər">
            <input
              aria-label="Əlavə"
              maxLength={240}
              value={form.attachment}
              onChange={(e) => set({ attachment: e.target.value })}
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
            catalog={catalog}
            companyId={win.companyId}
            direction={direction}
            currency={currency}
            rate={typedRate(foreign, form.rate)}
            lines={form.lines}
            onChange={(lines) => set({ lines })}
            errorField={m.error?.field}
          />
        </fieldset>
        <PostingRule>
          {incoming ? 'Dt kassa (221) / Kt sətrin hesabı.' : 'Dt sətrin hesabı / Kt kassa (221).'}{' '}
          {incoming ? '211' : '531'} sətrində hesablaşma sənədi seçilməsə, məbləğ müqavilənin açıq
          qaimələrinə ən köhnədən bölünür, qalanı avans olur ({incoming ? '543' : '243'}). Bank ilə
          kassa arasında pul 222.01 vasitəsilə keçir. Kassa qalığı heç bir gündə mənfi ola bilməz.
          Düzəliş köhnə yazılışı qırmızı storno edir; jurnal heç vaxt silinmir.
        </PostingRule>
        {doc && (
          <section className="invoice-postings" aria-label="Yazılışlar">
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
      {printer.sheet}
      {cancel && doc && (
        <Confirm
          title={`Sənədi ləğv et · ${doc.number}`}
          confirmLabel="Ləğv et"
          destructive
          onCancel={() => setCancel(false)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'cash.cancel',
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

/** The paper order (standard KMO / KXO layout); a receipt also has the tear-off "qəbz". */
function OrderSheet({
  doc,
  company,
}: {
  doc: CashDocumentDetail;
  company: CompanyView | undefined;
}) {
  const incoming = doc.direction === 'in';
  const sum = `${money(doc.amount)} ${doc.currency}`;
  const head = (
    <p>
      {company?.name}
      <br />
      VÖEN {company?.taxId}
    </p>
  );
  return (
    <>
      <section className="order">
        {head}
        <h1>
          {orderName[doc.direction].toUpperCase()} № {doc.number}
        </h1>
        <p>Tarix: {day(doc.date)}</p>
        <table>
          <thead>
            <tr>
              <th>{incoming ? 'Debet' : 'Kredit'}</th>
              <th>{incoming ? 'Kredit (müxabir hesab)' : 'Debet (müxabir hesab)'}</th>
              <th>Məbləğ, {doc.currency}</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i}>
                <td>{doc.account}</td>
                <td>
                  {l.account} {l.skNames.filter(Boolean).join(' · ')}
                </td>
                <td className="num">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl>
          <dt>{incoming ? 'Kimdən qəbul edilib' : 'Kimə verilib'}</dt>
          <dd>{doc.counterpartyName || '________________________'}</dd>
          <dt>Əsas</dt>
          <dd>{doc.basis || '________________________'}</dd>
          <dt>Məbləğ</dt>
          <dd>
            {sum} ({doc.amountWords})
          </dd>
          <dt>Əlavə</dt>
          <dd>{doc.attachment || '________________________'}</dd>
        </dl>
        {incoming ? (
          <p className="signatures">
            Baş mühasib ____________ &nbsp;&nbsp; Qəbul etdi (kassir) ____________
          </p>
        ) : (
          <p className="signatures">
            Rəhbər ____________ &nbsp;&nbsp; Baş mühasib ____________
            <br />
            Aldım: {doc.amountWords} &nbsp;&nbsp; İmza ____________ &nbsp;&nbsp; {day(doc.date)}
            <br />
            Şəxsiyyət vəsiqəsi: ________________________ &nbsp;&nbsp; Verdi (kassir) ____________
          </p>
        )}
      </section>
      {incoming && (
        <section className="order receipt">
          {head}
          <h2>QƏBZ · kassa mədaxil orderinə № {doc.number}</h2>
          <p>
            Tarix: {day(doc.date)}
            <br />
            Kimdən qəbul edilib: {doc.counterpartyName}
            <br />
            Əsas: {doc.basis}
            <br />
            Məbləğ: {sum} ({doc.amountWords})
          </p>
          <p className="signatures">
            Baş mühasib ____________ &nbsp;&nbsp; Kassir ____________ &nbsp;&nbsp; M.Y.
          </p>
        </section>
      )}
    </>
  );
}
