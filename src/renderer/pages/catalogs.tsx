import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import type {
  AccountView,
  AuditView,
  NamedView,
  PartnerView,
  ProductView,
} from '../../contracts/queries';
import { reloadCatalog, useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { SearchField, matches } from '../filters';
import { qty } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages } from '../pages';
import { DataTable, Empty, Field, Modal, Notice } from '../ui';
import { useWindow, useWorkspace } from '../workspace';
import { PartnerForm, ProductForm } from './quick-forms';

const analyticNames = {
  partner: 'kontragent',
  warehouse: 'anbar',
  product: 'məhsul',
  expenseItem: 'xərc maddəsi',
} as const;

export function PartnersPage() {
  const win = useWindow();
  const { catalog, error } = useCatalog(win.companyId);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<PartnerView | 'new' | null>(null);
  const rows = (catalog?.partners ?? []).filter((p) => matches(search, p.name, p.taxId));
  return (
    <ModuleFrame
      title={pages.partners.title}
      hint={pages.partners.hint}
      count={rows.length}
      actions={
        <button type="button" className="button primary" onClick={() => setEdit('new')}>
          <Plus size={15} /> Yeni kontragent
        </button>
      }
      filters={<SearchField value={search} onChange={setSearch} placeholder="Ad və ya VÖEN" />}
      notices={error && <Notice>{error}</Notice>}
    >
      <DataTable
        label={pages.partners.title}
        rows={rows}
        rowKey={(p) => p.id}
        onOpen={setEdit}
        columns={[
          {
            key: 'name',
            label: 'Adı',
            className: 'wide',
            render: (p) => (
              <button type="button" className="link" onClick={() => setEdit(p)}>
                {p.name}
              </button>
            ),
          },
          { key: 'tax', label: 'VÖEN', render: (p) => p.taxId },
        ]}
        empty={<Empty title={search ? 'Uyğun kontragent yoxdur' : 'Kontragent əlavə edilməyib'} />}
      />
      {edit && (
        <Modal
          title={edit === 'new' ? 'Yeni kontragent' : edit.name}
          onClose={() => setEdit(null)}
          size="small"
        >
          <PartnerForm
            companyId={win.companyId}
            {...(edit !== 'new' ? { existing: edit } : {})}
            onDone={async () => {
              await reloadCatalog(win.companyId);
              setEdit(null);
            }}
            onCancel={() => setEdit(null)}
          />
        </Modal>
      )}
    </ModuleFrame>
  );
}

export function ProductsPage() {
  const win = useWindow();
  const { catalog, error } = useCatalog(win.companyId);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<ProductView | 'new' | null>(null);
  const unit = (code: string) => catalog?.units.find((u) => u.code === code)?.name ?? code;
  const rows = (catalog?.products ?? []).filter((p) =>
    matches(search, p.name, p.code, p.barcode, p.group),
  );
  return (
    <ModuleFrame
      title={pages.products.title}
      hint={pages.products.hint}
      count={rows.length}
      actions={
        <button type="button" className="button primary" onClick={() => setEdit('new')}>
          <Plus size={15} /> Yeni məhsul
        </button>
      }
      filters={
        <SearchField value={search} onChange={setSearch} placeholder="Ad, kod, barkod, qrup" />
      }
      notices={error && <Notice>{error}</Notice>}
    >
      <DataTable
        label={pages.products.title}
        rows={rows}
        rowKey={(p) => p.id}
        onOpen={setEdit}
        columns={[
          { key: 'code', label: 'Kod', render: (p) => p.code },
          {
            key: 'name',
            label: 'Adı',
            className: 'wide',
            render: (p) => (
              <button type="button" className="link" onClick={() => setEdit(p)}>
                {p.name}
              </button>
            ),
          },
          { key: 'group', label: 'Qrup', render: (p) => p.group || '—' },
          { key: 'unit', label: 'Əsas vahid', render: (p) => unit(p.baseUnit) },
          {
            key: 'pack',
            label: 'Alış vahidi',
            render: (p) =>
              p.purchaseUnit === p.baseUnit
                ? unit(p.baseUnit)
                : `${unit(p.purchaseUnit)} = ${qty(p.factor)} ${unit(p.baseUnit)}`,
          },
          {
            key: 'account',
            label: 'İlkin hesab',
            render: (p) => <span className="account-code">{p.account}</span>,
          },
        ]}
        empty={<Empty title={search ? 'Uyğun məhsul yoxdur' : 'Məhsul kartı yoxdur'} />}
      />
      {edit && catalog && (
        <Modal
          title={edit === 'new' ? 'Yeni məhsul kartı' : edit.name}
          onClose={() => setEdit(null)}
        >
          <ProductForm
            companyId={win.companyId}
            catalog={catalog}
            {...(edit !== 'new' ? { existing: edit } : {})}
            onDone={async () => {
              await reloadCatalog(win.companyId);
              setEdit(null);
            }}
            onCancel={() => setEdit(null)}
          />
        </Modal>
      )}
    </ModuleFrame>
  );
}

export function AccountsPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog, error } = useCatalog(win.companyId);
  const [parent, setParent] = useState<AccountView | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const m = useMutation();
  const accounts = catalog?.accounts ?? [];
  const depth = (a: AccountView) => a.code.split('.').length - 1;
  const extendable = (a: AccountView) =>
    ['113', '201', '205', '601', '721'].includes(a.code.split('.')[0]!) && !a.archived;
  return (
    <ModuleFrame
      title={pages.accounts.title}
      hint="Subhesablar əsas hesaba birləşir; əsas hesaba birbaşa yazılış bağlanır."
      count={accounts.length}
      notices={error && <Notice>{error}</Notice>}
    >
      <DataTable
        label={pages.accounts.title}
        rows={accounts}
        rowKey={(a) => a.code}
        rowClass={(a) => (depth(a) ? `child depth-${depth(a)}` : '')}
        onOpen={(a) => ws.open({ type: 'accountCard', account: a.code }, win.companyId)}
        columns={[
          {
            key: 'code',
            label: 'Hesab',
            render: (a) => (
              <button
                type="button"
                className="link account"
                style={{ paddingLeft: depth(a) * 14 }}
                onClick={() => ws.open({ type: 'accountCard', account: a.code }, win.companyId)}
              >
                {a.code}
              </button>
            ),
          },
          { key: 'name', label: 'Adı', className: 'wide', render: (a) => a.name },
          {
            key: 'nature',
            label: 'Növ',
            render: (a) =>
              ({ active: 'Aktiv', passive: 'Passiv', 'active-passive': 'Aktiv-passiv' })[a.nature],
          },
          {
            key: 'analytics',
            label: 'Tələb olunan analitika',
            render: (a) =>
              (a.analytics.length ? a.analytics.map((k) => analyticNames[k]).join(', ') : '—') +
              (a.quantitative ? ' · miqdar' : ''),
          },
          {
            key: 'postable',
            label: 'Yazılış',
            render: (a) => (a.postable ? 'Açıq' : 'Subhesablar üzrə'),
          },
          {
            key: 'add',
            label: '',
            render: (a) =>
              extendable(a) && (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => {
                    m.clear();
                    setParent(a);
                    setCode(
                      `${a.code}.${String(accounts.filter((x) => x.parentCode === a.code).length + 1).padStart(2, '0')}`,
                    );
                    setName('');
                  }}
                >
                  <Plus size={13} /> Subhesab
                </button>
              ),
          },
        ]}
      />
      {parent && (
        <Modal
          title={`Subhesab · ${parent.code} ${parent.name}`}
          onClose={() => setParent(null)}
          size="small"
        >
          <form
            noValidate
            onSubmit={async (e: FormEvent) => {
              e.preventDefault();
              const r = await m.run({
                type: 'account.create',
                companyId: win.companyId,
                parentCode: parent.code,
                code,
                name,
              });
              if (r) {
                await reloadCatalog(win.companyId);
                setParent(null);
              }
            }}
          >
            <fieldset className="modal-body form-grid" disabled={m.busy}>
              {m.error && <Notice onClose={m.clear}>{m.error.message}</Notice>}
              <Field label="Kod" hint={`${parent.code}.01 formatında`}>
                <input autoFocus required value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <Field label="Adı">
                <input
                  required
                  maxLength={160}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <p className="modal-note">
                Subhesab əsas hesabın növünü və analitikasını götürür. Hesabatlarda {parent.code}{' '}
                hesabına birləşir; bundan sonra {parent.code} hesabına birbaşa yazılış edilmir.
              </p>
            </fieldset>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setParent(null)}>
                Geri
              </button>
              <button className="button primary" disabled={m.busy}>
                Yarat
              </button>
            </div>
          </form>
        </Modal>
      )}
    </ModuleFrame>
  );
}

export function WarehousesPage() {
  const win = useWindow();
  const { catalog, error } = useCatalog(win.companyId);
  const [edit, setEdit] = useState<NamedView | 'new' | null>(null);
  const [name, setName] = useState('');
  const m = useMutation();
  return (
    <ModuleFrame
      title={pages.warehouses.title}
      hint={pages.warehouses.hint}
      count={catalog?.warehouses.length}
      actions={
        <button
          type="button"
          className="button primary"
          onClick={() => (setName(''), m.clear(), setEdit('new'))}
        >
          <Plus size={15} /> Yeni anbar
        </button>
      }
      notices={error && <Notice>{error}</Notice>}
    >
      <DataTable
        label={pages.warehouses.title}
        rows={catalog?.warehouses ?? []}
        rowKey={(w) => w.id}
        onOpen={(w) => (setName(w.name), m.clear(), setEdit(w))}
        columns={[{ key: 'name', label: 'Adı', className: 'wide', render: (w) => w.name }]}
      />
      {edit && (
        <Modal
          title={edit === 'new' ? 'Yeni anbar' : edit.name}
          onClose={() => setEdit(null)}
          size="small"
        >
          <form
            noValidate
            onSubmit={async (e: FormEvent) => {
              e.preventDefault();
              const r = await m.run({
                type: 'warehouse.save',
                companyId: win.companyId,
                name,
                ...(edit !== 'new' ? { id: edit.id } : {}),
              });
              if (r) {
                await reloadCatalog(win.companyId);
                setEdit(null);
              }
            }}
          >
            <fieldset className="modal-body" disabled={m.busy}>
              {m.error && <Notice onClose={m.clear}>{m.error.message}</Notice>}
              <Field label="Adı">
                <input
                  autoFocus
                  required
                  maxLength={160}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            </fieldset>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setEdit(null)}>
                Geri
              </button>
              <button className="button primary" disabled={m.busy}>
                Saxla
              </button>
            </div>
          </form>
        </Modal>
      )}
    </ModuleFrame>
  );
}

export function AuditPage() {
  const win = useWindow();
  const [search, setSearch] = useState('');
  const r = useQuery<AuditView[]>({ type: 'audit', companyId: win.companyId, limit: 1000 });
  const rows = (r.data ?? []).filter((a) => matches(search, a.action, a.entity, a.detail, a.actor));
  return (
    <ModuleFrame
      title={pages.audit.title}
      hint="Son 1000 dəyişiklik"
      count={rows.length}
      onRefresh={r.reload}
      filters={
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Əməliyyat, sənəd, istifadəçi"
        />
      }
      notices={r.error && <Notice>{r.error}</Notice>}
    >
      <DataTable
        label={pages.audit.title}
        rows={rows}
        rowKey={(a) => String(a.id)}
        columns={[
          { key: 'at', label: 'Vaxt', render: (a) => new Date(a.at).toLocaleString('az-AZ') },
          { key: 'actor', label: 'İstifadəçi', render: (a) => a.actor },
          { key: 'entity', label: 'Bölmə', render: (a) => a.entity },
          { key: 'action', label: 'Əməliyyat', render: (a) => a.action },
          { key: 'detail', label: 'Təfərrüat', className: 'wide', render: (a) => a.detail },
        ]}
        empty={<Empty title="Hələ dəyişiklik yoxdur" />}
      />
    </ModuleFrame>
  );
}
