import { useState } from 'react';
import { Plus } from '../icons';
import type { OperationSummary } from '../../contracts/queries';
import { ModuleFrame } from '../frame';
import { RangeFields, SearchField, matches, useRange } from '../filters';
import { addAmounts, day } from '../format';
import { useQuery } from '../hooks';
import { pages } from '../pages';
import { Amount, DataTable, Empty, Notice, Status, type Column } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

export function OperationsPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const range = useRange(ws.period);
  const [search, setSearch] = useState('');
  const result = useQuery<OperationSummary[]>({
    type: 'operations',
    companyId: win.companyId,
    ...range.applied,
  });
  const rows = (result.data ?? []).filter((o) => matches(search, o.number, o.memo));
  const open = (id?: string) =>
    ws.open({ type: 'operation', ...(id ? { id } : {}) }, win.companyId);
  const columns: Column<OperationSummary>[] = [
    { key: 'date', label: 'Tarix', render: (o) => day(o.date) },
    {
      key: 'number',
      label: 'Nömrə',
      render: (o) => (
        <button type="button" className="link" onClick={() => open(o.id)}>
          {o.number}
        </button>
      ),
    },
    { key: 'memo', label: 'Məzmun', className: 'wide', render: (o) => o.memo || '—' },
    { key: 'lines', label: 'Yazılış', align: 'end', render: (o) => o.lines },
    {
      key: 'total',
      label: 'Məbləğ',
      align: 'end',
      render: (o) => <Amount value={o.total} strong />,
    },
    { key: 'status', label: 'Vəziyyət', render: (o) => <Status status={o.status} /> },
  ];
  return (
    <ModuleFrame
      title={pages.operations.title}
      hint={pages.operations.hint}
      count={rows.length}
      onRefresh={result.reload}
      onFilter={range.apply}
      actions={
        <button type="button" className="button primary" onClick={() => open()}>
          <Plus size={15} /> Yeni əməliyyat
        </button>
      }
      filters={
        <>
          <RangeFields range={range} />
          <SearchField value={search} onChange={setSearch} placeholder="Nömrə, məzmun" />
        </>
      }
      notices={result.error && <Notice>{result.error}</Notice>}
    >
      <DataTable
        label={pages.operations.title}
        rows={rows}
        columns={columns}
        rowKey={(o) => o.id}
        onOpen={(o) => open(o.id)}
        rowClass={(o) => (o.status === 'cancelled' ? 'cancelled' : '')}
        empty={
          <Empty title={search ? 'Axtarışa uyğun sənəd yoxdur' : 'Bu dövrdə sənəd yoxdur'}>
            <button type="button" className="button secondary" onClick={() => open()}>
              <Plus size={15} /> Yeni əməliyyat
            </button>
          </Empty>
        }
        footer={
          <tr>
            <td colSpan={4}>Uçotdakı sənədlər üzrə cəmi</td>
            <td className="num">
              <Amount
                value={addAmounts(rows.filter((o) => o.status === 'posted').map((o) => o.total))}
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
