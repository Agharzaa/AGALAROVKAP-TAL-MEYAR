import { useEffect, useState, type FormEvent } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus, Search, X } from 'lucide-react';
import type { CompanyView } from '../contracts/queries';
import { api } from './api';
import { useMutation } from './hooks';
import { footerPages, navigation, pages, viewTitle } from './pages';
import { QuickOpen } from './quick-open';
import { Confirm, Field, Modal, Notice } from './ui';
import {
  WindowContext,
  WorkspaceProvider,
  useWorkspace,
  type Page,
  type View,
  type Win,
} from './workspace';
import { InvoiceList } from './pages/invoices';
import { InvoiceEditor } from './pages/invoice-editor';
import { PaymentList } from './pages/payments';
import { PaymentEditor } from './pages/payment-editor';
import {
  AccountCardPage,
  JournalPage,
  PartnerBalancesPage,
  StockPage,
  TrialBalancePage,
} from './pages/reports';
import {
  AccountsPage,
  AuditPage,
  PartnersPage,
  ProductsPage,
  WarehousesPage,
} from './pages/catalogs';
import { Home, Onboarding, SettingsPage } from './pages/home';

export default function App() {
  const [companies, setCompanies] = useState<CompanyView[] | null>(null);
  const [error, setError] = useState('');
  const [initial, setInitial] = useState('');
  const load = () =>
    api
      .query<CompanyView[]>({ type: 'companies' })
      .then((list) => {
        setCompanies(list);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  if (error)
    return (
      <div className="startup">
        <Notice>{error}</Notice>
        <button type="button" className="button primary" onClick={() => void load()}>
          Yenidən yoxla
        </button>
      </div>
    );
  if (!companies)
    return (
      <div className="startup" aria-busy="true">
        <span className="brand-mark" aria-hidden="true">
          M
        </span>
        <p>Uçot bazası açılır…</p>
      </div>
    );
  if (!companies.length)
    return (
      <Onboarding
        onCreated={(id) => {
          setInitial(id);
          void load();
        }}
      />
    );
  return (
    <WorkspaceProvider initialCompany={initial || companies[0]!.id}>
      <Shell companies={companies} reloadCompanies={load} />
    </WorkspaceProvider>
  );
}

function useNarrow() {
  const query = '(max-width: 1180px)';
  const [narrow, setNarrow] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query);
    const update = () => setNarrow(m.matches);
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, []);
  return narrow;
}

function Shell({
  companies,
  reloadCompanies,
}: {
  companies: CompanyView[];
  reloadCompanies: () => Promise<void>;
}) {
  const ws = useWorkspace();
  const narrow = useNarrow();
  const [rail, setRail] = useState<'auto' | 'open' | 'closed'>('auto');
  const railOpen = rail === 'open' || (rail === 'auto' && !narrow);
  const [quick, setQuick] = useState(false);
  const [newCompany, setNewCompany] = useState(false);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuick(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const active = ws.windows.find((w) => w.id === ws.activeId);
  const activePage =
    active?.view.type === 'page' ? active.view.page : ws.activeId === 'home' ? 'home' : undefined;
  const nav = (page: Page) => (
    <button
      key={page}
      type="button"
      className={`nav-item${activePage === page ? ' active' : ''}`}
      aria-current={activePage === page ? 'page' : undefined}
      title={pages[page].title}
      onClick={() => ws.open({ type: 'page', page })}
    >
      {(() => {
        const I = pages[page].icon;
        return <I size={16} aria-hidden="true" />;
      })()}
      <span className="nav-label">{pages[page].title}</span>
    </button>
  );
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? '';
  return (
    <div className={`shell ${railOpen ? 'rail-open' : 'rail-closed'}`}>
      <aside className="sidebar" aria-label="Naviqasiya">
        <div className="sidebar-top">
          <div className="brand-row">
            <button
              type="button"
              className="brand"
              onClick={() => ws.open({ type: 'page', page: 'home' })}
              aria-label="Meyar · iş masası"
            >
              <span className="brand-mark" aria-hidden="true">
                M
              </span>
              <span className="brand-name">Meyar</span>
            </button>
            <button
              type="button"
              className="icon-button rail-toggle"
              aria-label={railOpen ? 'Menyunu yığ' : 'Menyunu aç'}
              title={railOpen ? 'Menyunu yığ' : 'Menyunu aç'}
              onClick={() => setRail(railOpen ? 'closed' : 'open')}
            >
              {railOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
          </div>
          <div className="company">
            <select
              aria-label="Aktiv şirkət"
              value={ws.companyId}
              onChange={(e) => ws.setCompany(e.target.value)}
              title={companyName(ws.companyId)}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              aria-label="Yeni şirkət"
              title="Yeni şirkət"
              onClick={() => setNewCompany(true)}
            >
              <Plus size={15} />
            </button>
          </div>
          <span className="company-tax">
            VÖEN {companies.find((c) => c.id === ws.companyId)?.taxId}
          </span>
        </div>
        <nav className="nav" aria-label="Bölmələr">
          {navigation.map((group, i) => (
            <div
              className="nav-group"
              key={i}
              role={group.heading ? 'group' : undefined}
              aria-label={group.heading}
            >
              {group.heading && (
                <h2 className="nav-heading" aria-hidden="true">
                  {group.heading}
                </h2>
              )}
              {group.items.map(nav)}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">{footerPages.map(nav)}</div>
      </aside>
      <div className="main">
        <div className="strip">
          <div className="tabs" role="tablist" aria-label="Açıq pəncərələr">
            <Tab
              id="home"
              label="İş masası"
              active={ws.activeId === 'home'}
              onSelect={() => ws.focus('home')}
            />
            {ws.windows.map((w) => (
              <Tab
                key={w.id}
                id={w.id}
                label={viewTitle(w.view, w.label)}
                company={w.companyId !== ws.companyId ? companyName(w.companyId) : undefined}
                dirty={w.dirty}
                active={ws.activeId === w.id}
                onSelect={() => ws.focus(w.id)}
                onClose={() => ws.close(w.id)}
              />
            ))}
          </div>
          <button
            type="button"
            className="quick-button"
            onClick={() => setQuick(true)}
            aria-keyshortcuts="Control+K"
          >
            <Search size={14} aria-hidden="true" /> Tez keçid <kbd>Ctrl K</kbd>
          </button>
        </div>
        <div className="panes">
          <div
            className="pane home-pane"
            role="tabpanel"
            id="pane-home"
            hidden={ws.activeId !== 'home'}
          >
            <Home key={ws.companyId} />
          </div>
          {ws.windows.map((w) => (
            <div
              key={w.id}
              className={`pane${w.restored ? ' restored' : ''}`}
              role="tabpanel"
              id={`pane-${w.id}`}
              hidden={ws.activeId !== w.id}
            >
              <WindowContext.Provider value={w}>
                <WindowBody win={w} />
              </WindowContext.Provider>
            </div>
          ))}
        </div>
      </div>
      {quick && (
        <QuickOpen
          companyId={ws.companyId}
          onOpen={(view) => ws.open(view)}
          onClose={() => setQuick(false)}
        />
      )}
      {ws.pendingClose && (
        <Confirm
          title="Saxlanmamış dəyişikliklər"
          confirmLabel="Saxlamadan bağla"
          destructive
          onCancel={() => ws.resolveClose(false)}
          onConfirm={() => ws.resolveClose(true)}
        >
          <p>
            «{viewTitle(ws.pendingClose.view, ws.pendingClose.label)}» pəncərəsində uçota alınmamış
            dəyişikliklər var. Bağlasanız, onlar itəcək.
          </p>
        </Confirm>
      )}
      {newCompany && (
        <NewCompany
          onClose={() => setNewCompany(false)}
          onCreated={async (id) => {
            await reloadCompanies();
            ws.setCompany(id);
            setNewCompany(false);
          }}
        />
      )}
    </div>
  );
}

function Tab({
  id,
  label,
  company,
  dirty,
  active,
  onSelect,
  onClose,
}: {
  id: string;
  label: string;
  company?: string;
  dirty?: boolean;
  active: boolean;
  onSelect: () => void;
  onClose?: () => void;
}) {
  return (
    <div className={`tab${active ? ' active' : ''}`}>
      <button
        type="button"
        role="tab"
        id={`tab-${id}`}
        aria-selected={active}
        aria-controls={`pane-${id}`}
        title={company ? `${label} · ${company}` : label}
        onClick={onSelect}
        onAuxClick={(e) => e.button === 1 && onClose?.()}
      >
        {dirty && (
          <span className="dirty" aria-label="saxlanmayıb">
            ●
          </span>
        )}
        <span className="tab-label">{label}</span>
        {company && <span className="tab-company">{company}</span>}
      </button>
      {onClose && (
        <button
          type="button"
          className="tab-close"
          aria-label={`${label} pəncərəsini bağla`}
          onClick={onClose}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function WindowBody({ win }: { win: Win }) {
  const v: View = win.view;
  switch (v.type) {
    case 'invoice':
      return <InvoiceEditor direction={v.direction} {...(v.id ? { id: v.id } : {})} />;
    case 'payment':
      return <PaymentEditor direction={v.direction} {...(v.id ? { id: v.id } : {})} />;
    case 'accountCard':
      return (
        <AccountCardPage account={v.account} {...(v.partnerId ? { partnerId: v.partnerId } : {})} />
      );
    case 'page':
      switch (v.page) {
        case 'purchases':
          return <InvoiceList direction="purchase" />;
        case 'sales':
          return <InvoiceList direction="sale" />;
        case 'bankIn':
          return <PaymentList direction="in" />;
        case 'bankOut':
          return <PaymentList direction="out" />;
        case 'trial':
          return <TrialBalancePage />;
        case 'journal':
          return <JournalPage />;
        case 'receivables':
          return <PartnerBalancesPage side="receivable" />;
        case 'payables':
          return <PartnerBalancesPage side="payable" />;
        case 'stock':
          return <StockPage />;
        case 'products':
          return <ProductsPage />;
        case 'partners':
          return <PartnersPage />;
        case 'accounts':
          return <AccountsPage />;
        case 'warehouses':
          return <WarehousesPage />;
        case 'audit':
          return <AuditPage />;
        case 'settings':
          return <SettingsPage />;
        case 'home':
          return <Home />;
      }
  }
}

function NewCompany({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const m = useMutation();
  return (
    <Modal title="Yeni şirkət" onClose={onClose} size="small">
      <form
        noValidate
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          const r = await m.run({ type: 'company.create', name, taxId });
          if (r) await onCreated(r.id);
        }}
      >
        <fieldset className="modal-body form-grid" disabled={m.busy}>
          {m.error && <Notice onClose={m.clear}>{m.error.message}</Notice>}
          <Field label="Şirkətin adı" wide>
            <input
              autoFocus
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="VÖEN" wide hint="10 rəqəm">
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{10}"
              maxLength={10}
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
            />
          </Field>
        </fieldset>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Geri
          </button>
          <button className="button primary" disabled={m.busy}>
            Yarat
          </button>
        </div>
      </form>
    </Modal>
  );
}
