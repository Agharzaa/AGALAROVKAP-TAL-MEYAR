import { useState } from 'react';
import { ChevronDown, FileSpreadsheet, Plus, Radio } from 'lucide-react';
import type { InvoiceSummary } from '../../contracts/queries';
import { ModuleFrame } from '../frame';
import { RangeFields, SearchField, matches, useRange } from '../filters';
import { addAmounts, day } from '../format';
import { useQuery } from '../hooks';
import { pages } from '../pages';
import { Amount, DataTable, Empty, Notice, Status, type Column } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

export function InvoiceList({ direction }: { direction: 'purchase' | 'sale' }) {
  const win = useWindow();
  const ws = useWorkspace();
  const range = useRange();
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState(false);
  const result = useQuery<InvoiceSummary[]>({
    type: 'invoices',
    companyId: win.companyId,
    direction,
    ...range.applied,
  });
  const rows = (result.data ?? []).filter((i) =>
    matches(search, i.number, i.partnerName, i.partnerTaxId),
  );
  const posted = rows.filter((i) => i.status === 'posted');
  const page = pages[direction === 'sale' ? 'sales' : 'purchases'];
  const openDoc = (id?: string) =>
    ws.open({ type: 'invoice', direction, ...(id ? { id } : {}) }, win.companyId);
  const columns: Column<InvoiceSummary>[] = [
    {
      key: 'number',
      label: 'Nömrə',
      render: (i) => (
        <button type="button" className="link" onClick={() => openDoc(i.id)}>
          {i.number}
        </button>
      ),
    },
    { key: 'date', label: 'Tarix', render: (i) => day(i.date) },
    {
      key: 'partner',
      label: direction === 'sale' ? 'Alıcı' : 'Təchizatçı',
      className: 'wide',
      render: (i) => (
        <div className="two-line">
          <strong title={i.partnerName}>{i.partnerName}</strong>
          <small>VÖEN {i.partnerTaxId}</small>
        </div>
      ),
    },
    { key: 'net', label: 'Əsas məbləğ', align: 'end', render: (i) => <Amount value={i.net} /> },
    { key: 'vat', label: 'ƏDV', align: 'end', render: (i) => <Amount value={i.vat} /> },
    { key: 'total', label: 'Cəmi', align: 'end', render: (i) => <Amount value={i.total} strong /> },
    {
      key: 'remaining',
      label: direction === 'sale' ? 'Alınacaq' : 'Ödəniləcək',
      align: 'end',
      render: (i) => (i.status === 'posted' ? <Amount value={i.remaining} /> : '—'),
    },
    { key: 'status', label: 'Vəziyyət', render: (i) => <Status status={i.status} /> },
  ];
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      count={rows.length}
      onRefresh={result.reload}
      onFilter={range.apply}
      actions={
        <div className="split-button">
          <button type="button" className="button primary" onClick={() => openDoc()}>
            <Plus size={15} />
            Yeni qaimə
          </button>
          <button
            type="button"
            className="button primary caret"
            aria-label="Başqa əlavə üsulları"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            <ChevronDown size={14} />
          </button>
          {menu && (
            <div
              className="menu"
              role="menu"
              onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => (setMenu(false), openDoc())}
                autoFocus
              >
                <Plus size={14} /> Əl ilə daxil et
              </button>
              <button type="button" role="menuitem" disabled>
                <FileSpreadsheet size={14} /> Excel-dən idxal
                <small>növbəti mərhələdə</small>
              </button>
              <button type="button" role="menuitem" disabled>
                <Radio size={14} /> DVX-dən canlı
                <small>rəsmi giriş təsdiqlənməyib</small>
              </button>
            </div>
          )}
        </div>
      }
      filters={
        <>
          <RangeFields range={range} />
          <SearchField value={search} onChange={setSearch} placeholder="Nömrə, kontragent, VÖEN" />
          <span className="currency">AZN</span>
        </>
      }
      notices={result.error && <Notice>{result.error}</Notice>}
    >
      <DataTable
        label={page.title}
        rows={rows}
        columns={columns}
        rowKey={(i) => i.id}
        onOpen={(i) => openDoc(i.id)}
        rowClass={(i) => (i.status === 'cancelled' ? 'cancelled' : '')}
        empty={
          <Empty title={search ? 'Axtarışa uyğun qaimə yoxdur' : 'Bu dövrdə qaimə yoxdur'}>
            <p>Dövrü dəyişin və ya yeni qaimə yaradın.</p>
            <button type="button" className="button secondary" onClick={() => openDoc()}>
              <Plus size={15} /> Qaimə yarat
            </button>
          </Empty>
        }
        footer={
          <tr>
            <td colSpan={3}>Uçotdakı qaimələr üzrə cəmi</td>
            <td className="num">
              <Amount value={addAmounts(posted.map((i) => i.net))} />
            </td>
            <td className="num">
              <Amount value={addAmounts(posted.map((i) => i.vat))} />
            </td>
            <td className="num">
              <Amount value={addAmounts(posted.map((i) => i.total))} strong />
            </td>
            <td className="num">
              <Amount value={addAmounts(posted.map((i) => i.remaining))} />
            </td>
            <td />
          </tr>
        }
      />
    </ModuleFrame>
  );
}
