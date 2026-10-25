/**
 * Stage 7a — fixed assets (docs/MERHELE-7-ESAS-VESAITLER.md §7): the list on a day (cost,
 * depreciation, net value, monthly amount, months left), the catalog card and the lists of
 * documents that put assets into service or enter their opening balances.
 */
import { useState } from 'react';
import { Plus, Truck } from '../icons';
import { assetGroups, type AssetGroup } from '../../domain/assets';
import type { AssetDocumentView, FixedAssetRow } from '../../contracts/queries';
import { ModuleFrame } from '../frame';
import { SearchField, matches } from '../filters';
import { addAmounts, day, today } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages } from '../pages';
import {
  Amount,
  DataTable,
  DateInput,
  Empty,
  Field,
  Modal,
  Notice,
  Status,
  type Column,
} from '../ui';
import { useWindow, useWorkspace } from '../workspace';

const groupName = (g: AssetGroup) => assetGroups.find((x) => x.id === g)?.name ?? g;

/** The catalog card of one fixed asset (new or existing). */
function AssetCard({ asset, onClose }: { asset: FixedAssetRow | 'new'; onClose: () => void }) {
  const win = useWindow();
  const m = useMutation();
  const current = asset === 'new' ? null : asset;
  const [name, setName] = useState(current?.name ?? '');
  const [inventoryNo, setInventoryNo] = useState(current?.inventoryNo ?? '');
  const [group, setGroup] = useState<AssetGroup>(current?.group ?? 'transport');
  const [plate, setPlate] = useState(current?.plate ?? '');
  const [note, setNote] = useState(current?.note ?? '');
  const [archived, setArchived] = useState(current?.archived ?? false);
  const save = async () => {
    const r = await m.run({
      type: 'fixedAsset.save',
      companyId: win.companyId,
      ...(current ? { id: current.id, version: current.version } : {}),
      name,
      inventoryNo,
      group,
      plate,
      note,
      archived,
    });
    if (r) onClose();
  };
  return (
    <Modal
      title={current ? `${current.inventoryNo} ${current.name}` : 'Yeni əsas vəsait'}
      onClose={onClose}
      size="small"
    >
      <form className="dialog-form" noValidate onSubmit={(e) => (e.preventDefault(), void save())}>
        <div className="form-grid">
          <Field label="Ad" wide>
            <input
              aria-label="Əsas vəsaitin adı"
              autoFocus
              maxLength={240}
              value={name}
              placeholder="Mercedes Actros"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="İnventar nömrəsi" hint="Boş qalsa avtomatik">
            <input
              aria-label="İnventar nömrəsi"
              maxLength={40}
              value={inventoryNo}
              placeholder="İN-000001"
              onChange={(e) => setInventoryNo(e.target.value)}
            />
          </Field>
          <Field label="Qrup">
            <select
              aria-label="Qrup"
              value={group}
              onChange={(e) => setGroup(e.target.value as AssetGroup)}
            >
              {assetGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dövlət nömrəsi / seriya">
            <input
              aria-label="Dövlət nömrəsi"
              maxLength={40}
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
            />
          </Field>
          <Field label="Qeyd" wide>
            <input
              aria-label="Qeyd"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {current && (
            <label className="check">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />{' '}
              Arxivdə
            </label>
          )}
        </div>
        {m.error && <Notice>{m.error.message}</Notice>}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Ləğv et
          </button>
          <button type="submit" className="button primary" disabled={m.busy}>
            Saxla
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function FixedAssetsPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const [date, setDate] = useState(today());
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<FixedAssetRow | 'new' | null>(null);
  const result = useQuery<FixedAssetRow[]>({ type: 'fixedAssets', companyId: win.companyId, date });
  const rows = (result.data ?? []).filter(
    (a) => !a.archived && matches(search, a.inventoryNo, a.name, a.plate),
  );
  const openDoc = (kind: 'commission' | 'opening', id?: string) =>
    ws.open({ type: 'asset', kind, ...(id ? { id } : {}) }, win.companyId);
  const columns: Column<FixedAssetRow>[] = [
    { key: 'inv', label: 'İnv. №', render: (a) => <span className="code">{a.inventoryNo}</span> },
    {
      key: 'name',
      label: 'Əsas vəsait',
      className: 'wide',
      render: (a) => (
        <button type="button" className="link" onClick={() => setEdit(a)}>
          {a.name}
        </button>
      ),
    },
    { key: 'group', label: 'Qrup', render: (a) => groupName(a.group) },
    { key: 'plate', label: 'Dövlət nömrəsi', render: (a) => a.plate || '—' },
    {
      key: 'since',
      label: 'İstismarda',
      render: (a) =>
        a.inService ? (
          <button
            type="button"
            className="link"
            onClick={() =>
              ws.open(
                { type: 'asset', kind: a.documentKind || 'commission', id: a.documentId },
                win.companyId,
              )
            }
          >
            {day(a.inService)}
          </button>
        ) : (
          <span className="muted">istismara verilməyib</span>
        ),
    },
    { key: 'cost', label: 'İlkin dəyər', align: 'end', render: (a) => <Amount value={a.cost} /> },
    {
      key: 'dep',
      label: 'Amortizasiya',
      align: 'end',
      render: (a) => <Amount value={a.depreciated} />,
    },
    {
      key: 'net',
      label: 'Qalıq dəyər',
      align: 'end',
      render: (a) => <Amount value={a.net} strong />,
    },
    { key: 'monthly', label: 'Aylıq', align: 'end', render: (a) => <Amount value={a.monthly} /> },
    {
      key: 'left',
      label: 'Qalan ay',
      align: 'end',
      render: (a) => (a.inService ? a.monthsLeft : ''),
    },
    {
      key: 'expense',
      label: 'Xərc',
      render: (a) =>
        a.expenseAccount ? (
          <span title={a.expenseNames.join(' · ')}>
            <span className="code">{a.expenseAccount}</span> {a.expenseNames.at(-1)}
          </span>
        ) : (
          ''
        ),
    },
  ];
  return (
    <ModuleFrame
      title={pages.fixedAssets.title}
      hint={pages.fixedAssets.hint}
      count={rows.length}
      onRefresh={result.reload}
      actions={
        <>
          <button type="button" className="button primary" onClick={() => setEdit('new')}>
            <Plus size={15} /> Yeni əsas vəsait
          </button>
          <button type="button" className="button secondary" onClick={() => openDoc('commission')}>
            <Truck size={15} /> İstismara ver
          </button>
          <button type="button" className="button secondary" onClick={() => openDoc('opening')}>
            Başlanğıc qalıq
          </button>
        </>
      }
      filters={
        <>
          <Field label="Tarixə">
            <DateInput value={date} onChange={setDate} aria-label="Tarixə" />
          </Field>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="İnv. №, ad, dövlət nömrəsi"
          />
        </>
      }
      notices={result.error && <Notice>{result.error}</Notice>}
    >
      <DataTable
        label={pages.fixedAssets.title}
        rows={rows}
        columns={columns}
        rowKey={(a) => a.id}
        onOpen={setEdit}
        empty={
          <Empty title={search ? 'Axtarışa uyğun əsas vəsait yoxdur' : 'Hələ əsas vəsait yoxdur'}>
            <button type="button" className="button secondary" onClick={() => setEdit('new')}>
              <Plus size={15} /> Yeni əsas vəsait
            </button>
          </Empty>
        }
        footer={
          <tr>
            <td colSpan={5}>Cəmi</td>
            <td className="num">
              <Amount value={addAmounts(rows.map((a) => a.cost))} strong />
            </td>
            <td className="num">
              <Amount value={addAmounts(rows.map((a) => a.depreciated))} strong />
            </td>
            <td className="num">
              <Amount value={addAmounts(rows.map((a) => a.net))} strong />
            </td>
            <td className="num">
              <Amount value={addAmounts(rows.map((a) => a.monthly))} strong />
            </td>
            <td colSpan={2} />
          </tr>
        }
      />
      {edit && (
        <AssetCard
          asset={edit}
          onClose={() => {
            setEdit(null);
            result.reload();
          }}
        />
      )}
    </ModuleFrame>
  );
}

/** Documents of one kind: putting into service or opening balances. */
export function AssetDocumentsPage({ kind }: { kind: 'commission' | 'opening' }) {
  const win = useWindow();
  const ws = useWorkspace();
  const page = pages[kind === 'commission' ? 'assetCommissions' : 'assetOpenings'];
  const result = useQuery<AssetDocumentView[]>({
    type: 'assetDocuments',
    companyId: win.companyId,
    kind,
  });
  const rows = result.data ?? [];
  const open = (id?: string) =>
    ws.open({ type: 'asset', kind, ...(id ? { id } : {}) }, win.companyId);
  const columns: Column<AssetDocumentView>[] = [
    { key: 'date', label: 'Tarix', render: (d) => day(d.date) },
    {
      key: 'number',
      label: 'Nömrə',
      render: (d) => (
        <button type="button" className="link" onClick={() => open(d.id)}>
          {d.number}
        </button>
      ),
    },
    {
      key: 'assets',
      label: 'Əsas vəsaitlər',
      className: 'wide',
      render: (d) => d.lines.map((l) => l.assetName).join(', '),
    },
    {
      key: 'total',
      label: 'Dəyər',
      align: 'end',
      render: (d) => <Amount value={d.total} strong />,
    },
    { key: 'status', label: 'Vəziyyət', render: (d) => <Status status={d.status} /> },
  ];
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      count={rows.length}
      onRefresh={result.reload}
      actions={
        <button type="button" className="button primary" onClick={() => open()}>
          <Plus size={15} /> {kind === 'commission' ? 'İstismara ver' : 'Başlanğıc qalıq'}
        </button>
      }
      notices={result.error && <Notice>{result.error}</Notice>}
    >
      <DataTable
        label={page.title}
        rows={rows}
        columns={columns}
        rowKey={(d) => d.id}
        onOpen={(d) => open(d.id)}
        rowClass={(d) => (d.status === 'cancelled' ? 'cancelled' : '')}
        empty={<Empty title="Hələ sənəd yoxdur" />}
      />
    </ModuleFrame>
  );
}
