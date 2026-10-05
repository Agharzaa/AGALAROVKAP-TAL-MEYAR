import { useState } from 'react';
import { CheckCheck, TriangleAlert } from 'lucide-react';
import type {
  AccountCard,
  PartnerBalanceView,
  PostingView,
  StockRowView,
  TrialBalance,
  TrialRow,
} from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { RangeFields, SearchField, matches, useRange } from '../filters';
import { addAmounts, day, isZero, qty, today } from '../format';
import { useQuery } from '../hooks';
import { pages } from '../pages';
import { Amount, DataTable, DateInput, Empty, Notice, type Column } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

export function TrialBalancePage() {
  const win = useWindow();
  const ws = useWorkspace();
  const range = useRange();
  const [rollup, setRollup] = useState(false);
  const r = useQuery<TrialBalance>({
    type: 'trialBalance',
    companyId: win.companyId,
    ...range.applied,
    rollup,
  });
  const rows = r.data?.rows ?? [];
  const t = r.data?.totals;
  const balanced =
    t &&
    t.debit === t.credit &&
    t.closingDebit === t.closingCredit &&
    t.openingDebit === t.openingCredit;
  const pair = (key: keyof TrialRow, label: string): Column<TrialRow> => ({
    key,
    label,
    align: 'end',
    render: (row) => <Amount value={row[key] as string} strong={row.depth === 0} />,
  });
  return (
    <ModuleFrame
      title={pages.trial.title}
      hint={pages.trial.hint}
      onRefresh={r.reload}
      onFilter={range.apply}
      filters={
        <>
          <RangeFields range={range} />
          <label className="check">
            <input type="checkbox" checked={rollup} onChange={(e) => setRollup(e.target.checked)} />{' '}
            Yalnız əsas hesablar
          </label>
          {t && (
            <span className={`balance-check ${balanced ? 'ok' : 'bad'}`} role="status">
              {balanced ? <CheckCheck size={15} /> : <TriangleAlert size={15} />}
              {balanced ? 'Debet = kredit' : 'Debet və kredit fərqlidir'}
            </span>
          )}
        </>
      }
      notices={r.error && <Notice>{r.error}</Notice>}
    >
      <DataTable
        label={pages.trial.title}
        rows={rows}
        rowKey={(row) => row.account}
        rowClass={(row) => (row.depth > 0 ? `child depth-${row.depth}` : '')}
        onOpen={(row) => ws.open({ type: 'accountCard', account: row.account }, win.companyId)}
        columns={[
          {
            key: 'account',
            label: 'Hesab',
            render: (row) => (
              <button
                type="button"
                className="link account"
                style={{ paddingLeft: row.depth * 14 }}
                onClick={() =>
                  ws.open({ type: 'accountCard', account: row.account }, win.companyId)
                }
              >
                {row.account}
              </button>
            ),
          },
          { key: 'name', label: 'Adı', className: 'wide', render: (row) => row.name },
          pair('openingDebit', 'Əvvələ · Dt'),
          pair('openingCredit', 'Əvvələ · Kt'),
          pair('debit', 'Dövriyyə · Dt'),
          pair('credit', 'Dövriyyə · Kt'),
          pair('closingDebit', 'Sona · Dt'),
          pair('closingCredit', 'Sona · Kt'),
        ]}
        empty={
          <Empty title="Bu dövrdə yazılış yoxdur">
            Qaimə və bank sənədləri uçota alındıqca balans özü formalaşır.
          </Empty>
        }
        footer={
          t && (
            <tr>
              <td colSpan={2}>Yekun</td>
              {(
                [
                  'openingDebit',
                  'openingCredit',
                  'debit',
                  'credit',
                  'closingDebit',
                  'closingCredit',
                ] as const
              ).map((k) => (
                <td key={k} className="num">
                  <Amount value={t[k]} strong />
                </td>
              ))}
            </tr>
          )
        }
      />
    </ModuleFrame>
  );
}

const postingColumns = (open: (p: PostingView) => void): Column<PostingView>[] => [
  { key: 'date', label: 'Tarix', render: (p) => day(p.date) },
  {
    key: 'doc',
    label: 'Sənəd',
    render: (p) => (
      <button type="button" className="link" onClick={() => open(p)}>
        {p.sourceNumber}
      </button>
    ),
  },
  {
    key: 'account',
    label: 'Hesab',
    render: (p) => <span className="account-code">{p.account}</span>,
  },
  {
    key: 'analytics',
    label: 'Analitika',
    className: 'wide',
    render: (p) => (
      <div className="two-line">
        <strong>{p.analytics || '—'}</strong>
        <small>
          {p.memo}
          {p.reversal ? ' · əks yazılış' : ''}
          {p.quantity ? ` · ${qty(p.quantity)}` : ''}
        </small>
      </div>
    ),
  },
  {
    key: 'debit',
    label: 'Debet',
    align: 'end',
    render: (p) => (isZero(p.debit) ? '' : <Amount value={p.debit} />),
  },
  {
    key: 'credit',
    label: 'Kredit',
    align: 'end',
    render: (p) => (isZero(p.credit) ? '' : <Amount value={p.credit} />),
  },
];

function useOpenSource() {
  const ws = useWorkspace();
  const win = useWindow();
  return (p: PostingView) =>
    ws.open(
      p.sourceType === 'invoice'
        ? { type: 'invoice', direction: p.sourceDirection as 'purchase' | 'sale', id: p.sourceId }
        : { type: 'payment', direction: p.sourceDirection as 'in' | 'out', id: p.sourceId },
      win.companyId,
    );
}

export function JournalPage() {
  const win = useWindow();
  const { catalog } = useCatalog(win.companyId);
  const range = useRange();
  const [account, setAccount] = useState('');
  const [applied, setApplied] = useState('');
  const [search, setSearch] = useState('');
  const r = useQuery<PostingView[]>({
    type: 'journal',
    companyId: win.companyId,
    ...range.applied,
    account: applied,
  });
  const open = useOpenSource();
  const rows = (r.data ?? []).filter((p) => matches(search, p.sourceNumber, p.analytics, p.memo));
  return (
    <ModuleFrame
      title={pages.journal.title}
      hint={pages.journal.hint}
      count={rows.length}
      onRefresh={r.reload}
      onFilter={() => {
        range.apply();
        setApplied(account);
      }}
      filters={
        <>
          <RangeFields range={range} />
          <select aria-label="Hesab" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Bütün hesablar</option>
            {catalog?.accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Sənəd, kontragent, məhsul"
          />
        </>
      }
      notices={r.error && <Notice>{r.error}</Notice>}
    >
      <DataTable
        label={pages.journal.title}
        rows={rows}
        rowKey={(p) => `${p.entryId}-${p.lineNo}`}
        rowClass={(p) => (p.reversal ? 'reversal' : '')}
        columns={postingColumns(open)}
        footer={
          <tr>
            <td colSpan={4}>Cəmi</td>
            <td className="num">
              <Amount value={addAmounts(rows.map((p) => p.debit))} strong />
            </td>
            <td className="num">
              <Amount value={addAmounts(rows.map((p) => p.credit))} strong />
            </td>
          </tr>
        }
        empty={<Empty title="Bu dövrdə yazılış yoxdur" />}
      />
    </ModuleFrame>
  );
}

export function AccountCardPage({ account, partnerId }: { account: string; partnerId?: string }) {
  const win = useWindow();
  const range = useRange();
  const r = useQuery<AccountCard>({
    type: 'accountCard',
    companyId: win.companyId,
    account,
    ...range.applied,
    ...(partnerId ? { partnerId } : {}),
  });
  const open = useOpenSource();
  const c = r.data;
  return (
    <ModuleFrame
      title={`Hesab kartı · ${account}`}
      hint={c?.name}
      onRefresh={r.reload}
      onFilter={range.apply}
      filters={
        <>
          <RangeFields range={range} />
          {c && (
            <span className="card-balances">
              Əvvələ <Amount value={c.opening} strong /> · Sona <Amount value={c.closing} strong />
            </span>
          )}
        </>
      }
      notices={r.error && <Notice>{r.error}</Notice>}
    >
      <DataTable
        label={`Hesab kartı ${account}`}
        rows={c?.rows ?? []}
        rowKey={(p) => `${p.entryId}-${p.lineNo}`}
        rowClass={(p) => (p.reversal ? 'reversal' : '')}
        columns={[
          ...postingColumns(open),
          {
            key: 'balance',
            label: 'Qalıq',
            align: 'end',
            render: (p) => <Amount value={(p as PostingView & { balance: string }).balance} />,
          },
        ]}
        footer={
          c && (
            <tr>
              <td colSpan={4}>Dövriyyə</td>
              <td className="num">
                <Amount value={c.debit} strong />
              </td>
              <td className="num">
                <Amount value={c.credit} strong />
              </td>
              <td className="num">
                <Amount value={c.closing} strong />
              </td>
            </tr>
          )
        }
        empty={<Empty title="Bu dövrdə hərəkət yoxdur" />}
      />
    </ModuleFrame>
  );
}

export function PartnerBalancesPage({ side }: { side: 'receivable' | 'payable' }) {
  const win = useWindow();
  const ws = useWorkspace();
  const [asOf, setAsOf] = useState(today());
  const [applied, setApplied] = useState(asOf);
  const [search, setSearch] = useState('');
  const r = useQuery<PartnerBalanceView[]>({
    type: 'partnerBalances',
    companyId: win.companyId,
    asOf: applied,
  });
  const rows = (r.data ?? []).filter((b) => !isZero(b[side]) && matches(search, b.name, b.taxId));
  const page = pages[side === 'receivable' ? 'receivables' : 'payables'];
  const account = side === 'receivable' ? '211' : '531';
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      count={rows.length}
      onRefresh={r.reload}
      onFilter={() => setApplied(asOf)}
      filters={
        <>
          <label className="filter-dates">
            <span>Tarixə</span>
            <DateInput aria-label="Tarixə" value={asOf} onChange={setAsOf} />
          </label>
          <button type="submit" className="button tonal">
            Göstər
          </button>
          <SearchField value={search} onChange={setSearch} placeholder="Kontragent, VÖEN" />
        </>
      }
      notices={r.error && <Notice>{r.error}</Notice>}
    >
      <DataTable
        label={page.title}
        rows={rows}
        rowKey={(b) => b.partnerId}
        onOpen={(b) =>
          ws.open({ type: 'accountCard', account, partnerId: b.partnerId }, win.companyId)
        }
        columns={[
          {
            key: 'name',
            label: 'Kontragent',
            className: 'wide',
            render: (b) => <strong>{b.name}</strong>,
          },
          { key: 'tax', label: 'VÖEN', render: (b) => b.taxId },
          {
            key: 'balance',
            label: side === 'receivable' ? 'Borc (+) / avans (−)' : 'Borcumuz (+) / avansımız (−)',
            align: 'end',
            render: (b) => <Amount value={b[side]} strong />,
          },
        ]}
        footer={
          <tr>
            <td colSpan={2}>Cəmi</td>
            <td className="num">
              <Amount value={addAmounts(rows.map((b) => b[side]))} strong />
            </td>
          </tr>
        }
        empty={<Empty title="Bu tarixə açıq qalıq yoxdur" />}
      />
    </ModuleFrame>
  );
}

export function StockPage() {
  const win = useWindow();
  const [asOf, setAsOf] = useState(today());
  const [applied, setApplied] = useState(asOf);
  const [search, setSearch] = useState('');
  const r = useQuery<StockRowView[]>({ type: 'stock', companyId: win.companyId, asOf: applied });
  const rows = (r.data ?? []).filter((s) =>
    matches(search, s.productName, s.productCode, s.warehouseName),
  );
  return (
    <ModuleFrame
      title={pages.stock.title}
      hint={pages.stock.hint}
      count={rows.length}
      onRefresh={r.reload}
      onFilter={() => setApplied(asOf)}
      filters={
        <>
          <label className="filter-dates">
            <span>Tarixə</span>
            <DateInput aria-label="Tarixə" value={asOf} onChange={setAsOf} />
          </label>
          <button type="submit" className="button tonal">
            Göstər
          </button>
          <SearchField value={search} onChange={setSearch} placeholder="Məhsul, kod, anbar" />
        </>
      }
      notices={r.error && <Notice>{r.error}</Notice>}
    >
      <DataTable
        label={pages.stock.title}
        rows={rows}
        rowKey={(s) => `${s.account}|${s.warehouseId}|${s.productId}`}
        columns={[
          { key: 'code', label: 'Kod', render: (s) => s.productCode },
          {
            key: 'name',
            label: 'Məhsul',
            className: 'wide',
            render: (s) => <strong>{s.productName}</strong>,
          },
          { key: 'warehouse', label: 'Anbar', render: (s) => s.warehouseName },
          {
            key: 'account',
            label: 'Hesab',
            render: (s) => <span className="account-code">{s.account}</span>,
          },
          {
            key: 'qty',
            label: 'Miqdar',
            align: 'end',
            render: (s) => `${qty(s.quantity)} ${s.unit}`,
          },
          {
            key: 'value',
            label: 'Dəyər',
            align: 'end',
            render: (s) => <Amount value={s.value} strong />,
          },
        ]}
        footer={
          <tr>
            <td colSpan={5}>Cəmi dəyər</td>
            <td className="num">
              <Amount value={addAmounts(rows.map((s) => s.value))} strong />
            </td>
          </tr>
        }
        empty={
          <Empty title="Anbarda qalıq yoxdur">
            Alış qaiməsində mal sətri uçota alındıqda qalıq yaranır.
          </Empty>
        }
      />
    </ModuleFrame>
  );
}
