import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { InvoiceSummary } from '../../contracts/queries';
import { ModuleFrame } from '../frame';
import { RangeFields, SearchField, matches, useRange } from '../filters';
import { addAmounts, day } from '../format';
import { useQuery } from '../hooks';
import { pages } from '../pages';
import { Amount, DataTable, Empty, Notice, Status, type Column } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

export function InvoicesPage({ direction }: { direction: 'sale' | 'purchase' }) {
  const win = useWindow();
  const ws = useWorkspace();
  const range = useRange(ws.period);
  const [search, setSearch] = useState('');
  const page = pages[direction === 'sale' ? 'sales' : 'purchases'];
  const result = useQuery<InvoiceSummary[]>({
    type: 'invoices',
    companyId: win.companyId,
    direction,
    ...range.applied,
  });
  const rows = (result.data ?? []).filter((r) =>
    matches(search, r.number, r.partner, r.eqSeries + r.eqNumber, r.memo),
  );
  const open = (id?: string) =>
    ws.open({ type: 'invoice', direction, ...(id ? { id } : {}) }, win.companyId);
  const newLabel = direction === 'sale' ? 'Yeni satış qaiməsi' : 'Yeni alış qaiməsi';
  const columns: Column<InvoiceSummary>[] = [
    { key: 'date', label: 'Tarix', render: (r) => day(r.date) },
    {
      key: 'number',
      label: 'Nömrə',
      className: 'nowrap',
      render: (r) => (
        <button type="button" className="link" onClick={() => open(r.id)}>
          {r.number}
        </button>
      ),
    },
    {
      key: 'eq',
      label: 'E-qaimə',
      render: (r) => (r.eqNumber ? `${r.eqSeries}${r.eqNumber}` : '—'),
    },
    { key: 'partner', label: 'Kontragent', className: 'wide', render: (r) => r.partner },
    {
      key: 'contract',
      label: 'Müqavilə',
      className: 'nowrap',
      render: (r) => r.contract.replace(/^Müqavilə /, ''),
    },
    { key: 'net', label: 'ƏDV-siz', align: 'end', render: (r) => <Amount value={r.net} /> },
    { key: 'vat', label: 'ƏDV', align: 'end', render: (r) => <Amount value={r.vat} /> },
    {
      key: 'total',
      label: 'Cəmi',
      align: 'end',
      render: (r) => (
        <>
          <Amount value={r.total} strong />
          {r.currency !== 'AZN' && <small className="currency"> {r.currency}</small>}
        </>
      ),
    },
    {
      key: 'totalAzn',
      label: 'Cəmi, AZN',
      align: 'end',
      render: (r) => <Amount value={r.totalAzn} />,
    },
    { key: 'status', label: 'Vəziyyət', render: (r) => <Status status={r.status} /> },
  ];
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      count={rows.length}
      onRefresh={result.reload}
      onFilter={range.apply}
      actions={
        <button type="button" className="button primary" onClick={() => open()}>
          <Plus size={15} /> {newLabel}
        </button>
      }
      filters={
        <>
          <RangeFields range={range} />
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Nömrə, kontragent, e-qaimə"
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
        onOpen={(r) => open(r.id)}
        rowClass={(r) => (r.status === 'cancelled' ? 'cancelled' : '')}
        empty={
          <Empty title={search ? 'Axtarışa uyğun qaimə yoxdur' : 'Bu dövrdə qaimə yoxdur'}>
            <button type="button" className="button secondary" onClick={() => open()}>
              <Plus size={15} /> {newLabel}
            </button>
          </Empty>
        }
        footer={
          <tr>
            <td colSpan={8}>Uçotdakı qaimələr üzrə cəmi, AZN</td>
            <td className="num">
              <Amount
                value={addAmounts(rows.filter((r) => r.status === 'posted').map((r) => r.totalAzn))}
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
