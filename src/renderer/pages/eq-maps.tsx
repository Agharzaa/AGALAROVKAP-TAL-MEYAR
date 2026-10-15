/**
 * E-qaimə map (stage 4b; docs/MERHELE-4-EQAIME.md §6.6): how DVX goods lines — or the whole
 * e-qaimə of a VÖEN — are booked. Entries come from the accountant's own bookings ("Uyğunluq
 * kimi saxla") in suggest mode; only the accountant switches one to auto. Entries are edited
 * and archived, never deleted.
 */
import { useMemo, useState } from 'react';
import type { EqMapView } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { useMutation, useQuery } from '../hooks';
import { pages } from '../pages';
import { accountOptions, Picker, type Option } from '../picker';
import { DataTable, Empty, Field, Modal, Notice, type Column } from '../ui';
import { useWindow } from '../workspace';

const directionLabel = { purchase: 'Alış', sale: 'Satış' } as const;

export function EqMapsPage() {
  const win = useWindow();
  const page = pages.eqMaps;
  const { catalog } = useCatalog(win.companyId);
  const maps = useQuery<EqMapView[]>({ type: 'eqMaps', companyId: win.companyId });
  const [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<EqMapView | null>(null);
  const [message, setMessage] = useState('');
  const m = useMutation();
  const rows = useMemo(
    () => (maps.data ?? []).filter((x) => x.archived === archived),
    [maps.data, archived],
  );

  async function save(x: EqMapView, patch: Partial<EqMapView> = {}) {
    const v = { ...x, ...patch };
    const r = await m.run({
      type: 'eqMap.save',
      companyId: win.companyId,
      id: v.id,
      version: v.version,
      archived: v.archived,
      direction: v.direction,
      taxId: v.taxId,
      dvxCode: v.dvxCode,
      name: v.name,
      unit: v.unit,
      productId: v.productId,
      account: v.account,
      expenseItemId: v.expenseItemId,
      incomeTypeId: v.incomeTypeId,
      vatTreatment: v.vatTreatment,
      contractId: v.contractId,
      mode: v.mode,
    });
    if (r) {
      setEdit(null);
      setMessage(
        patch.mode === 'auto'
          ? 'Uyğunluq avtomatik rejimdədir: bu e-qaimələr bundan sonra özü uçota alınacaq (qutuda “Avtomatik uyğunluqları tətbiq et”).'
          : 'Uyğunluq saxlandı.',
      );
    }
  }

  const columns: Column<EqMapView>[] = [
    { key: 'dir', label: 'Növ', render: (x) => directionLabel[x.direction] },
    {
      key: 'who',
      label: 'Kontragent',
      className: 'clip',
      render: (x) =>
        x.taxId ? (
          <span title={`VÖEN ${x.taxId}`}>
            {x.partner || '—'} <small>· {x.taxId}</small>
          </span>
        ) : (
          <i>istənilən</i>
        ),
    },
    {
      key: 'dvx',
      label: 'DVX malı',
      className: 'clip',
      render: (x) =>
        x.dvxCode || x.name ? (
          <span title={x.name}>
            {x.dvxCode && <b>{x.dvxCode} </b>}
            {x.name}
          </span>
        ) : (
          <i>bütün qaimə</i>
        ),
    },
    {
      key: 'to',
      label: 'Uçotda',
      className: 'clip',
      render: (x) => (
        <span>
          {x.product || (x.contractId ? 'yalnız müqavilə' : '—')}
          {x.account && <small> · {x.account}</small>}
          {x.contractId && (
            <small>
              {' '}
              · müqavilə №{catalog?.contracts.find((c) => c.id === x.contractId)?.number}
            </small>
          )}
        </span>
      ),
    },
    {
      key: 'mode',
      label: 'Rejim',
      render: (x) => (
        <b className={`chip ${x.mode === 'auto' ? 'chip-ok' : 'chip-wait'}`}>
          {x.mode === 'auto' ? 'Avtomatik' : 'Təklif'}
        </b>
      ),
    },
    { key: 'uses', label: 'İstifadə', align: 'end', render: (x) => x.uses },
    {
      key: 'actions',
      label: 'Əməliyyat',
      className: 'nowrap',
      render: (x) =>
        x.archived ? (
          <button
            type="button"
            className="button secondary small"
            disabled={m.busy}
            onClick={() => void save(x, { archived: false })}
          >
            Bərpa et
          </button>
        ) : (
          <>
            <button
              type="button"
              className="button secondary small"
              disabled={m.busy}
              aria-label={`${x.name || x.partner}: ${x.mode === 'auto' ? 'təklif rejiminə keçir' : 'avtomatik et'}`}
              onClick={() => void save(x, { mode: x.mode === 'auto' ? 'suggest' : 'auto' })}
            >
              {x.mode === 'auto' ? 'Təklif et' : 'Avtomatik et'}
            </button>
            <button type="button" className="button secondary small" onClick={() => setEdit(x)}>
              Düzəlt
            </button>
            <button
              type="button"
              className="button secondary small"
              disabled={m.busy}
              onClick={() => void save(x, { archived: true })}
            >
              Arxivləşdir
            </button>
          </>
        ),
    },
  ];

  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      onRefresh={maps.reload}
      actions={
        <label className="filter-check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{' '}
          Arxiv
        </label>
      }
      notices={
        <>
          {m.error && !edit && <Notice onClose={m.clear}>{m.error.message}</Notice>}
          {message && (
            <Notice kind="success" onClose={() => setMessage('')}>
              {message}
            </Notice>
          )}
        </>
      }
    >
      <DataTable
        label="E-qaimə uyğunluqları"
        rows={rows}
        columns={columns}
        rowKey={(x) => x.id}
        onOpen={(x) => !x.archived && setEdit(x)}
        empty={
          <Empty title="Hələ uyğunluq yoxdur">
            <p className="doc-hint">
              E-qaiməni qutudan uçota aldıqdan sonra qaimədə “Uyğunluq kimi saxla” düyməsini basın:
              DVX-in mal kodu və adı seçdiyiniz nomenklaturaya bağlanır.
            </p>
          </Empty>
        }
      />
      {edit && catalog && (
        <MapEditor
          entry={edit}
          busy={m.busy}
          error={m.error?.message ?? ''}
          productOptions={catalog.products
            .filter((p) => !p.archived || p.id === edit.productId)
            .map((p): Option => ({ value: p.id, label: p.name, hint: p.unit }))}
          expenseOptions={catalog.items
            .filter((i) => i.kind === 'expenseItem' && !i.archived)
            .map((i): Option => ({ value: i.id, label: i.name }))}
          contractOptions={catalog.contracts
            .filter(
              (c) =>
                !c.archived &&
                c.kind === edit.direction &&
                catalog.partners.find((p) => p.id === c.partnerId)?.taxId === edit.taxId,
            )
            .map((c): Option => ({ value: c.id, label: `№${c.number}` }))}
          accounts={accountOptions(catalog)}
          onCancel={() => (setEdit(null), m.clear())}
          onSave={(patch) => void save(edit, patch)}
        />
      )}
    </ModuleFrame>
  );
}

function MapEditor({
  entry,
  busy,
  error,
  productOptions,
  expenseOptions,
  contractOptions,
  accounts,
  onCancel,
  onSave,
}: {
  entry: EqMapView;
  busy: boolean;
  error: string;
  productOptions: Option[];
  expenseOptions: Option[];
  contractOptions: Option[];
  accounts: Option[];
  onCancel: () => void;
  onSave: (patch: Partial<EqMapView>) => void;
}) {
  const [v, setV] = useState(entry);
  const header = !entry.dvxCode && !entry.name;
  return (
    <Modal
      title="E-qaimə uyğunluğu"
      subtitle={`${entry.partner || 'İstənilən kontragent'}${entry.taxId ? ` · VÖEN ${entry.taxId}` : ''} · ${header ? 'bütün qaimə' : `${entry.dvxCode} ${entry.name}`}`}
      onClose={onCancel}
    >
      <div className="modal-body">
        {!header && entry.dvxCode && (
          <Field
            label="Kontragent"
            hint="İstənilən kontragent: eyni DVX kodu kimdən gəlsə də, bu nomenklatura"
          >
            <select
              aria-label="Kontragent"
              value={v.taxId ? 'one' : 'any'}
              onChange={(e) => setV({ ...v, taxId: e.target.value === 'one' ? entry.taxId : '' })}
              disabled={!entry.taxId && !v.taxId}
            >
              {entry.taxId && <option value="one">Yalnız {entry.partner || entry.taxId}</option>}
              <option value="any">İstənilən kontragent</option>
            </select>
          </Field>
        )}
        <Field label="Nomenklatura">
          <Picker
            ariaLabel="Nomenklatura"
            value={v.productId}
            options={productOptions}
            {...(header ? { emptyLabel: 'yoxdur (yalnız müqavilə)' } : {})}
            onChange={(productId) => setV({ ...v, productId })}
          />
        </Field>
        <Field label="Hesab" hint="Boş qalsa nomenklaturanın növünə görə">
          <Picker
            ariaLabel="Hesab"
            value={v.account}
            options={accounts}
            emptyLabel="standart"
            onChange={(account) => setV({ ...v, account })}
          />
        </Field>
        <Field label="Xərc maddəsi">
          <Picker
            ariaLabel="Xərc maddəsi"
            value={v.expenseItemId}
            options={expenseOptions}
            emptyLabel="yoxdur"
            onChange={(expenseItemId) => setV({ ...v, expenseItemId })}
          />
        </Field>
        {entry.direction === 'purchase' && (
          <Field label="Alış ƏDV-si">
            <select
              aria-label="Alış ƏDV-si"
              value={v.vatTreatment}
              onChange={(e) =>
                setV({ ...v, vatTreatment: e.target.value as EqMapView['vatTreatment'] })
              }
            >
              <option value="">şirkətin standartı</option>
              <option value="offset">əvəzləşdirilir (241)</option>
              <option value="cost">maya dəyərinə daxil edilir</option>
            </select>
          </Field>
        )}
        {header && (
          <Field label="Müqavilə" hint="Kontragentin bir neçə müqaviləsi olanda">
            <Picker
              ariaLabel="Müqavilə"
              value={v.contractId}
              options={contractOptions}
              emptyLabel="yeganə aktiv müqavilə"
              onChange={(contractId) => setV({ ...v, contractId })}
            />
          </Field>
        )}
        <Field label="Rejim">
          <select
            aria-label="Rejim"
            value={v.mode}
            onChange={(e) => setV({ ...v, mode: e.target.value as EqMapView['mode'] })}
          >
            <option value="suggest">Təklif — mühasib təsdiqləyir</option>
            <option value="auto">Avtomatik — özü uçota alır</option>
          </select>
        </Field>
        {error && <Notice>{error}</Notice>}
      </div>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Geri
        </button>
        <button type="button" className="button primary" disabled={busy} onClick={() => onSave(v)}>
          Saxla
        </button>
      </div>
    </Modal>
  );
}
