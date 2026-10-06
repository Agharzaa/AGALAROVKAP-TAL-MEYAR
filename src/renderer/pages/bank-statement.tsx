import { useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Ban, Check, FileUp, Wand2 } from 'lucide-react';
import { inFamily } from '../../domain/accounts';
import { paymentKinds, type PaymentKind } from '../../domain/posting';
import { readStatementTable, type StatementSuggestion } from '../../domain/statement';
import type { StatementPostInput } from '../../contracts/commands';
import type { Catalog, StatementLineView } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { SearchField, matches } from '../filters';
import { addAmounts, day } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages } from '../pages';
import { readSheet, SheetError } from '../sheet-reader';
import { Amount, Confirm, DataTable, Empty, Field, Notice, type Column } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

type Status = 'new' | 'posted' | 'ignored' | 'all';
type Booking = Omit<StatementSuggestion, 'confidence' | 'reason'>;

const confidenceLabel = { high: 'Dəqiq', medium: 'Yoxlayın', low: 'Tanınmadı' } as const;

/** The booking the user sees for a row: the system's proposal with the user's changes on top. */
function bookingOf(row: StatementLineView, edits: Record<string, Booking>): Booking {
  const {
    confidence: _c,
    reason: _r,
    ...proposal
  } = row.suggestion ?? {
    kind: 'other' as PaymentKind,
    confidence: 'low',
    reason: '',
  };
  return edits[row.id] ?? proposal;
}

/** What is still missing before a row can be posted, or '' when it is complete. */
function missing(row: StatementLineView, b: Booking, catalog: Catalog): string {
  const rule = paymentKinds[b.kind];
  if (!rule.label[row.direction])
    return `Bu növ ${row.direction === 'in' ? 'daxilolma' : 'ödəniş'} üçün deyil`;
  if (rule.partner === 'required' && !b.partnerId && !b.createPartner) return 'Kontragent seçin';
  if (b.kind !== 'settlement') {
    const code = b.counterAccount ?? rule.families[row.direction][0];
    const account = catalog.accounts.find((a) => a.code === code);
    if (account?.analytics.includes('expenseItem') && !b.expenseItemId) return 'Xərc maddəsi seçin';
    if (account?.analytics.includes('partner') && !b.partnerId && !b.createPartner)
      return 'Kontragent seçin';
  }
  return '';
}

function toInput(row: StatementLineView, b: Booking): StatementPostInput {
  return {
    lineId: row.id,
    kind: b.kind,
    ...(b.partnerId ? { partnerId: b.partnerId } : {}),
    createPartner: !b.partnerId && !!b.createPartner,
    ...(b.kind !== 'settlement' && b.counterAccount ? { counterAccount: b.counterAccount } : {}),
    ...(b.expenseItemId ? { expenseItemId: b.expenseItemId } : {}),
    autoAllocate: true,
  };
}

function BookingCell({
  row,
  booking,
  catalog,
  onChange,
}: {
  row: StatementLineView;
  booking: Booking;
  catalog: Catalog;
  onChange: (b: Booking) => void;
}) {
  const rule = paymentKinds[booking.kind];
  const kinds = (Object.keys(paymentKinds) as PaymentKind[]).filter(
    (k) => paymentKinds[k].label[row.direction],
  );
  const families = rule.families[row.direction];
  const accounts = catalog.accounts.filter(
    (a) => a.postable && families.some((f) => inFamily(a.code, f)),
  );
  const counter = booking.counterAccount ?? families[0] ?? '';
  const account = catalog.accounts.find((a) => a.code === counter);
  const needsPartner =
    rule.partner === 'required' || booking.kind === 'settlement' || booking.kind === 'refund';
  return (
    <div className="stmt-booking">
      <select
        aria-label="Əməliyyat növü"
        value={booking.kind}
        onChange={(e) => {
          const kind = e.target.value as PaymentKind;
          const fam = paymentKinds[kind].families[row.direction];
          onChange({
            kind,
            ...(booking.partnerId ? { partnerId: booking.partnerId } : {}),
            ...(booking.createPartner ? { createPartner: true } : {}),
            ...(kind !== 'settlement' && fam[0] ? { counterAccount: fam[0] } : {}),
          });
        }}
      >
        {kinds.map((k) => (
          <option key={k} value={k}>
            {paymentKinds[k].label[row.direction]}
          </option>
        ))}
      </select>
      {booking.kind !== 'settlement' && accounts.length > 1 && (
        <select
          aria-label="Müxabirləşən hesab"
          value={counter}
          onChange={(e) => onChange({ ...booking, counterAccount: e.target.value })}
        >
          {accounts.map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} · {a.name}
            </option>
          ))}
        </select>
      )}
      {(needsPartner || booking.partnerId) && (
        <select
          aria-label="Kontragent"
          value={booking.partnerId ?? (booking.createPartner ? '__new' : '')}
          onChange={(e) => {
            const { partnerId: _p, createPartner: _c, ...rest } = booking;
            const v = e.target.value;
            onChange(
              v === '__new'
                ? { ...rest, createPartner: true }
                : v
                  ? { ...rest, partnerId: v }
                  : rest,
            );
          }}
        >
          <option value="">{needsPartner ? 'Kontragent seçin' : '—'}</option>
          {row.counterpartyTaxId &&
            !catalog.partners.some((p) => p.taxId === row.counterpartyTaxId) && (
              <option value="__new">+ Yeni: {row.counterparty || row.counterpartyTaxId}</option>
            )}
          {catalog.partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.taxId}
            </option>
          ))}
        </select>
      )}
      {booking.kind !== 'settlement' && account?.analytics.includes('expenseItem') && (
        <select
          aria-label="Xərc maddəsi"
          value={booking.expenseItemId ?? ''}
          onChange={(e) => {
            const { expenseItemId: _x, ...rest } = booking;
            onChange(e.target.value ? { ...rest, expenseItemId: e.target.value } : rest);
          }}
        >
          <option value="">Xərc maddəsi</option>
          {catalog.expenseItems.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function BankStatement() {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const [bankAccount, setBankAccount] = useState('223');
  const [status, setStatus] = useState<Status>('new');
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, Booking>>({});
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const [ignore, setIgnore] = useState<StatementLineView | null>(null);
  const [reason, setReason] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const m = useMutation();
  const result = useQuery<StatementLineView[]>({
    type: 'bankStatement',
    companyId: win.companyId,
    bankAccount,
    status,
  });
  const page = pages.bankStatement;
  const rows = (result.data ?? []).filter((r) =>
    matches(search, r.counterparty, r.counterpartyTaxId, r.purpose, r.reference),
  );
  const banks = (catalog?.accounts ?? []).filter(
    (a) => a.postable && (inFamily(a.code, '223') || a.code === '224.04'),
  );
  const ready = catalog
    ? rows.filter(
        (r) =>
          r.status === 'new' &&
          !edits[r.id] &&
          r.suggestion?.confidence === 'high' &&
          !missing(r, bookingOf(r, edits), catalog),
      )
    : [];

  async function upload(f: File) {
    setMessage('');
    setProblem('');
    try {
      const table = readStatementTable(
        await readSheet(f.name, new Uint8Array(await f.arrayBuffer())),
      );
      if (!table.lines.length) {
        setProblem(table.problems[0]?.message ?? 'Faylda əməliyyat sətri tapılmadı.');
        return;
      }
      const r = await m.run({
        type: 'bankStatement.import',
        companyId: win.companyId,
        bankAccount,
        fileName: f.name,
        lines: table.lines,
      });
      if (!r) return;
      setStatus('new');
      setMessage(
        `${f.name}: ${r.count ?? 0} yeni sətir yükləndi${r.skipped ? `, ${r.skipped} sətir əvvəl yüklənib (təkrar keçildi)` : ''}.` +
          (table.problems.length
            ? ` ${table.problems.length} sətir oxunmadı: ${table.problems
                .slice(0, 3)
                .map((p) => `${p.row}-ci sətir`)
                .join(', ')}.`
            : ''),
      );
      result.reload();
    } catch (e) {
      setProblem(e instanceof SheetError ? e.message : `Fayl oxunmadı: ${(e as Error).message}`);
    }
  }

  async function post(lines: StatementPostInput[], done: string) {
    setMessage('');
    const r = await m.run({ type: 'bankStatement.post', companyId: win.companyId, lines });
    if (!r) return;
    setEdits((all) => {
      const next = { ...all };
      for (const l of lines) delete next[l.lineId];
      return next;
    });
    setMessage(
      `${done}: ${r.count} sənəd uçota alındı${r.skipped ? `, ${r.skipped} qaimə ilə əvəzləşdirildi` : ''}.`,
    );
    result.reload();
  }

  const columns: Column<StatementLineView>[] = [
    { key: 'date', label: 'Tarix', render: (r) => day(r.date) },
    {
      key: 'amount',
      label: 'Məbləğ',
      align: 'end',
      render: (r) => (
        <span className={`stmt-amount ${r.direction}`}>
          {r.direction === 'in' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
          <Amount value={r.amount} strong />
        </span>
      ),
    },
    {
      key: 'counterparty',
      label: 'Qarşı tərəf · təyinat',
      className: 'wide',
      render: (r) => (
        <div className="two-line">
          <strong title={r.counterparty}>
            {r.counterparty || '—'}
            {r.counterpartyTaxId && <span className="tax-id"> · {r.counterpartyTaxId}</span>}
          </strong>
          <small title={r.purpose}>
            {r.reference && `№ ${r.reference} · `}
            {r.purpose}
          </small>
        </div>
      ),
    },
    {
      key: 'booking',
      label: 'Uçot',
      render: (r) => {
        if (r.status === 'posted')
          return (
            <button
              type="button"
              className="link"
              onClick={() =>
                r.paymentId &&
                ws.open({ type: 'payment', direction: r.direction, id: r.paymentId }, win.companyId)
              }
            >
              {r.paymentReference}
            </button>
          );
        if (r.status === 'ignored')
          return <span className="muted-text">Kənarlaşdırılıb: {r.reason}</span>;
        if (!catalog) return null;
        return (
          <BookingCell
            row={r}
            booking={bookingOf(r, edits)}
            catalog={catalog}
            onChange={(b) => setEdits((all) => ({ ...all, [r.id]: b }))}
          />
        );
      },
    },
    {
      key: 'check',
      label: 'Təklif',
      render: (r) => {
        if (r.status !== 'new' || !r.suggestion || !catalog) return null;
        const gap = missing(r, bookingOf(r, edits), catalog);
        const level = edits[r.id] ? (gap ? 'low' : 'high') : r.suggestion.confidence;
        return (
          <div className="two-line stmt-suggest">
            <span
              className={`badge ${level === 'high' ? '' : level === 'medium' ? 'warn' : 'bad'}`}
            >
              {edits[r.id] ? (gap ? 'Natamam' : 'Hazır') : confidenceLabel[r.suggestion.confidence]}
            </span>
            <small title={r.suggestion.reason}>{gap || r.suggestion.reason}</small>
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      render: (r) =>
        r.status === 'new' && catalog ? (
          <div className="row-actions">
            <button
              type="button"
              className="icon-button"
              title="Uçota al"
              aria-label={`Uçota al ${r.date} ${r.amount}`}
              disabled={m.busy || !!missing(r, bookingOf(r, edits), catalog)}
              onClick={() => void post([toInput(r, bookingOf(r, edits))], 'Sətir keçirildi')}
            >
              <Check size={15} />
            </button>
            <button
              type="button"
              className="icon-button danger"
              title="Kənarlaşdır"
              aria-label={`Kənarlaşdır ${r.date} ${r.amount}`}
              onClick={() => (setReason(''), setIgnore(r))}
            >
              <Ban size={14} />
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      count={rows.length}
      onRefresh={result.reload}
      actions={
        <>
          <input
            ref={file}
            type="file"
            hidden
            accept=".xlsx,.csv,.txt,.xls"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void upload(f);
            }}
          />
          <button
            type="button"
            className="button secondary"
            disabled={m.busy}
            onClick={() => file.current?.click()}
          >
            <FileUp size={15} /> Çıxarış yüklə
          </button>
          <button
            type="button"
            className="button primary"
            disabled={m.busy || !ready.length}
            title="Yalnız sistemin dəqiq tanıdığı sətirlər keçirilir; qalanlarını özünüz yoxlayın."
            onClick={() =>
              void post(
                ready.map((r) => toInput(r, bookingOf(r, edits))),
                'Avtomatik keçirmə',
              )
            }
          >
            <Wand2 size={15} /> Avtomatik keçir ({ready.length})
          </button>
        </>
      }
      filters={
        <>
          <Field label="Bank hesabı">
            <select value={bankAccount} onChange={(e) => setBankAccount(e.target.value)}>
              {banks.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="segmented" role="group" aria-label="Vəziyyət">
            {(
              [
                ['new', 'Gözləyən'],
                ['posted', 'Keçirilmiş'],
                ['ignored', 'Kənarlaşdırılmış'],
                ['all', 'Hamısı'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={status === value}
                className={status === value ? 'active' : ''}
                onClick={() => setStatus(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Kontragent, VÖEN, təyinat"
          />
        </>
      }
      notices={
        <>
          {result.error && <Notice>{result.error}</Notice>}
          {problem && <Notice onClose={() => setProblem('')}>{problem}</Notice>}
          {m.error && <Notice onClose={m.clear}>{m.error.message}</Notice>}
          {message && (
            <Notice kind="success" onClose={() => setMessage('')}>
              {message}
            </Notice>
          )}
        </>
      }
    >
      <DataTable
        label={page.title}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowClass={(r) => (r.status === 'ignored' ? 'cancelled' : '')}
        empty={
          <Empty
            title={
              status === 'new'
                ? 'Gözləyən çıxarış sətri yoxdur'
                : 'Bu seçimə uyğun çıxarış sətri yoxdur'
            }
          >
            <p className="empty-hint">
              Bankın internet-bankından çıxarışı Excel (.xlsx) və ya CSV kimi endirin və “Çıxarış
              yüklə” düyməsi ilə seçin. Eyni faylı təkrar yükləmək dublikat yaratmır.
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={() => file.current?.click()}
            >
              <FileUp size={15} /> Çıxarış yüklə
            </button>
          </Empty>
        }
        footer={
          <tr>
            <td>Cəmi</td>
            <td className="num">
              <span className="stmt-amount in">
                <ArrowDownLeft size={13} />
                <Amount
                  value={addAmounts(rows.filter((r) => r.direction === 'in').map((r) => r.amount))}
                />
              </span>
              <span className="stmt-amount out">
                <ArrowUpRight size={13} />
                <Amount
                  value={addAmounts(rows.filter((r) => r.direction === 'out').map((r) => r.amount))}
                />
              </span>
            </td>
            <td colSpan={4} />
          </tr>
        }
      />
      {ignore && (
        <Confirm
          title="Sətri kənarlaşdır"
          confirmLabel="Kənarlaşdır"
          destructive
          onCancel={() => setIgnore(null)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'bankStatement.ignore',
              companyId: win.companyId,
              lineIds: [ignore.id],
              reason,
            });
            if (r) {
              setIgnore(null);
              setMessage('Sətir kənarlaşdırıldı; uçota alınmayacaq.');
              result.reload();
            }
          }}
        >
          <p>
            {day(ignore.date)} · {ignore.counterparty || '—'} · <Amount value={ignore.amount} />{' '}
            AZN. Məsələn, əməliyyat artıq əl ilə uçota alınıbsa.
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
