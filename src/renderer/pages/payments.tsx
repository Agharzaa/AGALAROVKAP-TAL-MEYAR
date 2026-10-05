import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { PaymentView } from '../../contracts/queries';
import { ModuleFrame } from '../frame';
import { RangeFields, SearchField, matches, useRange } from '../filters';
import { addAmounts, day, isZero } from '../format';
import { useQuery } from '../hooks';
import { pages } from '../pages';
import { Amount, DataTable, Empty, Notice, Status, type Column } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

export function PaymentList({ direction }: { direction: 'in' | 'out' }) {
  const win = useWindow();
  const ws = useWorkspace();
  const range = useRange();
  const [search, setSearch] = useState('');
  const result = useQuery<PaymentView[]>({
    type: 'payments',
    companyId: win.companyId,
    direction,
    ...range.applied,
  });
  const rows = (result.data ?? []).filter((p) =>
    matches(search, p.reference, p.partnerName, p.note),
  );
  const posted = rows.filter((p) => p.status === 'posted');
  const page = pages[direction === 'in' ? 'bankIn' : 'bankOut'];
  const openDoc = (id?: string) =>
    ws.open({ type: 'payment', direction, ...(id ? { id } : {}) }, win.companyId);
  const columns: Column<PaymentView>[] = [
    {
      key: 'reference',
      label: 'Bank sənədi',
      render: (p) => (
        <button type="button" className="link" onClick={() => openDoc(p.id)}>
          {p.reference}
        </button>
      ),
    },
    { key: 'date', label: 'Tarix', render: (p) => day(p.date) },
    {
      key: 'partner',
      label: direction === 'in' ? 'Ödəyici' : 'Alan',
      className: 'wide',
      render: (p) => (
        <div className="two-line">
          <strong title={p.partnerName}>{p.partnerName}</strong>
          <small>
            {p.note ||
              (p.allocations.some((a) => a.status === 'active')
                ? p.allocations
                    .filter((a) => a.status === 'active')
                    .map((a) => a.invoiceNumber)
                    .join(', ')
                : 'Qaiməyə bağlanmayıb')}
          </small>
        </div>
      ),
    },
    {
      key: 'account',
      label: 'Hesab',
      render: (p) => <span className="account-code">{p.bankAccount}</span>,
    },
    {
      key: 'amount',
      label: 'Məbləğ',
      align: 'end',
      render: (p) => <Amount value={p.amount} strong />,
    },
    {
      key: 'allocated',
      label: 'Qaimələrə',
      align: 'end',
      render: (p) => (p.status === 'posted' ? <Amount value={p.allocated} /> : '—'),
    },
    {
      key: 'advance',
      label: 'Bağlanmamış',
      align: 'end',
      render: (p) =>
        p.status !== 'posted' ? (
          '—'
        ) : isZero(p.unallocated) ? (
          <Amount value={p.unallocated} />
        ) : (
          <b className="advance">
            <Amount value={p.unallocated} />
          </b>
        ),
    },
    { key: 'status', label: 'Vəziyyət', render: (p) => <Status status={p.status} /> },
  ];
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      count={rows.length}
      onRefresh={result.reload}
      onFilter={range.apply}
      actions={
        <button type="button" className="button primary" onClick={() => openDoc()}>
          <Plus size={15} /> {direction === 'in' ? 'Yeni daxilolma' : 'Yeni ödəniş'}
        </button>
      }
      filters={
        <>
          <RangeFields range={range} />
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Sənəd nömrəsi, kontragent"
          />
          <span className="currency">AZN</span>
        </>
      }
      notices={result.error && <Notice>{result.error}</Notice>}
    >
      <DataTable
        label={page.title}
        rows={rows}
        columns={columns}
        rowKey={(p) => p.id}
        onOpen={(p) => openDoc(p.id)}
        rowClass={(p) => (p.status === 'cancelled' ? 'cancelled' : '')}
        empty={
          <Empty title={search ? 'Axtarışa uyğun sənəd yoxdur' : 'Bu dövrdə bank sənədi yoxdur'}>
            <button type="button" className="button secondary" onClick={() => openDoc()}>
              <Plus size={15} /> Sənəd yarat
            </button>
          </Empty>
        }
        footer={
          <tr>
            <td colSpan={4}>Uçotdakı sənədlər üzrə cəmi</td>
            <td className="num">
              <Amount value={addAmounts(posted.map((p) => p.amount))} strong />
            </td>
            <td className="num">
              <Amount value={addAmounts(posted.map((p) => p.allocated))} />
            </td>
            <td className="num">
              <Amount value={addAmounts(posted.map((p) => p.unallocated))} />
            </td>
            <td />
          </tr>
        }
      />
    </ModuleFrame>
  );
}
