/** Journal of bank documents (1C "Bank çıxarışları"): receipts and payments of every bank account. */
import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight } from '../icons';
import type { BankDocumentSummary } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { RangeFields, SearchField, matches, useRange } from '../filters';
import { addAmounts, day } from '../format';
import { useQuery } from '../hooks';
import { pages } from '../pages';
import { Amount, DataTable, Empty, Notice, Status, type Column } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

export function BankDocumentsPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const range = useRange(ws.period);
  const [search, setSearch] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const page = pages.bank;
  const result = useQuery<BankDocumentSummary[]>({
    type: 'bankDocuments',
    companyId: win.companyId,
    ...range.applied,
    ...(bankAccountId ? { bankAccountId } : {}),
  });
  const rows = (result.data ?? []).filter((r) =>
    matches(
      search,
      r.number,
      r.bankReference,
      r.counterpartyName,
      r.counterpartyTaxId,
      r.purpose,
      r.accounts,
    ),
  );
  const open = (direction: 'in' | 'out', id?: string) =>
    ws.open({ type: 'bank', direction, ...(id ? { id } : {}) }, win.companyId);
  const posted = rows.filter((r) => r.status === 'posted');
  const columns: Column<BankDocumentSummary>[] = [
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
      render: (r) => (r.direction === 'in' ? 'Daxilolma' : 'Məxaric'),
    },
    {
      key: 'bank',
      label: 'Bank hesabı',
      className: 'clip',
      render: (r) => (
        <span title={r.bankAccount}>
          {r.account} · {r.bankAccount}
        </span>
      ),
    },
    {
      key: 'counterparty',
      label: 'Kontragent (bankda)',
      className: 'clip',
      render: (r) => <span title={r.counterpartyName}>{r.counterpartyName || '—'}</span>,
    },
    { key: 'accounts', label: 'Müxabir hesab', className: 'nowrap', render: (r) => r.accounts },
    {
      key: 'purpose',
      label: 'Təyinat',
      className: 'clip',
      render: (r) => <span title={r.purpose}>{r.purpose}</span>,
    },
    {
      key: 'in',
      label: 'Daxilolma',
      align: 'end',
      render: (r) =>
        r.direction === 'in' ? (
          <>
            <Amount value={r.amount} strong />
            {r.currency !== 'AZN' && <small className="currency"> {r.currency}</small>}
          </>
        ) : null,
    },
    {
      key: 'out',
      label: 'Məxaric',
      align: 'end',
      render: (r) =>
        r.direction === 'out' ? (
          <>
            <Amount value={r.amount} strong />
            {r.currency !== 'AZN' && <small className="currency"> {r.currency}</small>}
          </>
        ) : null,
    },
    { key: 'status', label: 'Vəziyyət', render: (r) => <Status status={r.status} /> },
  ];
  const actions = (
    <>
      <button type="button" className="button primary" onClick={() => open('in')}>
        <ArrowDownLeft size={15} /> Daxilolma
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
            <span>Bank hesabı</span>
            <select
              aria-label="Bank hesabı"
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
            >
              <option value="">Hamısı</option>
              {(catalog?.bankAccounts ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.account} · {b.name || b.iban} · {b.currency}
                </option>
              ))}
            </select>
          </label>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Nömrə, kontragent, VÖEN, təyinat"
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
          <Empty title={search ? 'Axtarışa uyğun sənəd yoxdur' : 'Bu dövrdə bank sənədi yoxdur'}>
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
