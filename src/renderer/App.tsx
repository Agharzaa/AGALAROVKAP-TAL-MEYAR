import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import type { CompanyView, IntegrityView } from '../contracts/queries';
import { searchKey } from '../domain/values';
import { api } from './api';
import { useCatalog } from './catalog';
import { useMutation, useQuery } from './hooks';
import { pages, ribbon, viewTitle, type RibbonAction } from './pages';
import { Confirm, Field, Modal, Notice } from './ui';
import {
  WindowContext,
  WorkspaceProvider,
  monthOf,
  useWorkspace,
  type Page,
  type View,
  type Win,
} from './workspace';
import { HomePage } from './pages/home';
import { OperationsPage } from './pages/operations';
import { OperationEditor } from './pages/operation-editor';
import { TrialPage } from './pages/trial';
import { CardPage } from './pages/card';
import { AccountsPage } from './pages/accounts';
import { PartnersPage } from './pages/partners';
import { BankAccountsPage, EmployeesPage, ListsPage, ProductsPage } from './pages/catalogs';
import { AuditPage, SettingsPage } from './pages/settings';

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
      <div className="startup">
        <CompanyForm
          first
          onCreated={(id) => {
            setInitial(id);
            void load();
          }}
        />
      </div>
    );
  return (
    <WorkspaceProvider initialCompany={initial || companies[0]!.id}>
      <Shell companies={companies} reloadCompanies={load} />
    </WorkspaceProvider>
  );
}

function CompanyForm({
  first = false,
  onCreated,
  onCancel,
}: {
  first?: boolean;
  onCreated: (id: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [vatPayer, setVatPayer] = useState(true);
  const m = useMutation();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await m.run({ type: 'company.create', name, taxId, vatPayer });
    if (r) onCreated(r.id);
  };
  return (
    <form
      className={first ? 'onboarding' : 'dialog-form'}
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      {first && (
        <header>
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <h1>Meyar-a xoş gəlmisiniz</h1>
          <p>
            Uçotu aparacağınız şirkəti daxil edin. Hesab planı, subkontolar və əsas siyahılar
            avtomatik yaradılacaq.
          </p>
        </header>
      )}
      <Field label="Şirkətin adı">
        <input
          autoFocus
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="VÖEN" hint="10 rəqəm">
        <input
          required
          inputMode="numeric"
          maxLength={10}
          value={taxId}
          onChange={(e) => setTaxId(e.target.value)}
        />
      </Field>
      <label className="check">
        <input type="checkbox" checked={vatPayer} onChange={(e) => setVatPayer(e.target.checked)} />{' '}
        ƏDV ödəyicisidir
      </label>
      {m.error && <Notice>{m.error.message}</Notice>}
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="button secondary" onClick={onCancel}>
            Ləğv et
          </button>
        )}
        <button type="submit" className="button primary" disabled={m.busy}>
          {m.busy ? 'Yaradılır…' : 'Şirkəti yarat'}
        </button>
      </div>
    </form>
  );
}

const monthNames = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'İyun',
  'İyul',
  'Avqust',
  'Sentyabr',
  'Oktyabr',
  'Noyabr',
  'Dekabr',
];

function PeriodSwitch() {
  const ws = useWorkspace();
  const [y, m] = ws.period.from.split('-').map(Number) as [number, number];
  const shift = (d: number) => {
    const date = new Date(Date.UTC(y, m - 1 + d, 1));
    ws.setPeriod(monthOf(date.toISOString().slice(0, 10)));
  };
  return (
    <div className="period-switch" role="group" aria-label="İş dövrü">
      <button
        type="button"
        className="icon-button"
        aria-label="Əvvəlki ay"
        onClick={() => shift(-1)}
      >
        <ChevronLeft size={14} />
      </button>
      <span title="Hesabatların və yeni sənədlərin standart dövrü">
        Dövr: {monthNames[m - 1]} {y}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label="Növbəti ay"
        onClick={() => shift(1)}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

interface SearchHit {
  label: string;
  hint: string;
  view: View;
}

function QuickSearch() {
  const ws = useWorkspace();
  const { catalog } = useCatalog(ws.companyId);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const hits = useMemo((): SearchHit[] => {
    const q = searchKey(text.trim());
    if (!q) return [];
    const out: SearchHit[] = [];
    for (const [page, meta] of Object.entries(pages) as [Page, (typeof pages)[Page]][])
      if (searchKey(meta.title).includes(q))
        out.push({ label: meta.title, hint: 'Bölmə', view: { type: 'page', page } });
    if ('yeni əməliyyat'.includes(q) || q.startsWith('yeni'))
      out.push({ label: 'Yeni əl ilə əməliyyat', hint: 'Əmr', view: { type: 'operation' } });
    for (const a of catalog?.accounts ?? [])
      if (a.code.startsWith(text.trim()) || searchKey(a.name).includes(q))
        out.push({
          label: `${a.code} ${a.name}`,
          hint: 'Hesab kartı',
          view: { type: 'accountCard', account: a.code },
        });
    for (const p of catalog?.partners ?? [])
      if (searchKey(p.name).includes(q) || p.taxId.startsWith(text.trim()))
        out.push({
          label: p.name,
          hint: `Kontragent ${p.taxId}`,
          view: { type: 'page', page: 'partners' },
        });
    return out.slice(0, 12);
  }, [text, catalog]);
  const go = (h: SearchHit) => {
    ws.open(h.view);
    setText('');
    setOpen(false);
    input.current?.blur();
  };
  return (
    <div className="quick-search">
      <Search size={14} aria-hidden="true" />
      <input
        ref={input}
        aria-label="Axtarış və əmrlər"
        placeholder="Nə etmək istəyirsiniz? Hesab, kontragent, bölmə…"
        value={text}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && hits[active]) {
            e.preventDefault();
            go(hits[active]);
          } else if (e.key === 'Escape') {
            setText('');
            input.current?.blur();
          }
        }}
      />
      <kbd>Ctrl+K</kbd>
      {open && hits.length > 0 && (
        <ul className="quick-results" role="listbox" aria-label="Nəticələr">
          {hits.map((h, i) => (
            <li
              key={`${h.label}${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                go(h);
              }}
            >
              <span>{h.label}</span>
              <small>{h.hint}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Shell({
  companies,
  reloadCompanies,
}: {
  companies: CompanyView[];
  reloadCompanies: () => Promise<void>;
}) {
  const ws = useWorkspace();
  const [tab, setTab] = useState(0);
  const [message, setMessage] = useState<{
    kind: 'info' | 'error' | 'success';
    text: string;
  } | null>(null);
  const [newCompany, setNewCompany] = useState(false);
  const company = companies.find((c) => c.id === ws.companyId) ?? companies[0]!;
  const integrity = useQuery<IntegrityView>({ type: 'integrity', companyId: company.id });
  const act = async (a: RibbonAction, label: string) => {
    if (a.kind === 'view') ws.open(a.view);
    else if (a.kind === 'soon')
      setMessage({ kind: 'info', text: `"${label}" ${a.stage}də bu təmələ köçürüləcək.` });
    else {
      try {
        const file = await api.backup();
        if (file) setMessage({ kind: 'success', text: `Ehtiyat nüsxə saxlanıldı: ${file}` });
      } catch (e) {
        setMessage({ kind: 'error', text: (e as Error).message });
      }
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault();
        ws.open({ type: 'operation' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws]);
  const active = ws.windows.find((w) => w.id === ws.activeId);
  return (
    <div className="shell">
      <header className="titlebar">
        <strong className="brand">
          <span className="brand-mark small" aria-hidden="true">
            M
          </span>
          Meyar
        </strong>
        <label className="company-switch">
          <span className="sr-only">Şirkət</span>
          <select
            value={company.id}
            onChange={(e) => {
              if (e.target.value === '__new') setNewCompany(true);
              else ws.setCompany(e.target.value);
            }}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.taxId}
              </option>
            ))}
            <option value="__new">+ Yeni şirkət…</option>
          </select>
        </label>
        <PeriodSwitch />
        <QuickSearch />
      </header>
      <nav className="ribbon-tabs" aria-label="Lent menyu">
        {ribbon.map((r, i) => (
          <button
            key={r.tab}
            type="button"
            aria-pressed={tab === i}
            className={tab === i ? 'active' : ''}
            onClick={() => setTab(i)}
          >
            {r.tab}
          </button>
        ))}
      </nav>
      <section className="ribbon" aria-label="Alətlər lenti">
        {ribbon[tab]!.groups.map((g) => (
          <div key={g.name} className="ribbon-group">
            <div className="ribbon-buttons">
              {g.buttons
                .filter((b) => b.size === 'large')
                .map((b) => (
                  <button
                    key={b.label}
                    type="button"
                    className={`ribbon-large${b.action.kind === 'soon' ? ' soon' : ''}`}
                    onClick={() => void act(b.action, b.label)}
                  >
                    <b.icon size={24} strokeWidth={1.5} aria-hidden="true" />
                    <span>{b.label}</span>
                  </button>
                ))}
              {g.buttons.some((b) => b.size === 'small') && (
                <div className="ribbon-small-stack">
                  {g.buttons
                    .filter((b) => b.size === 'small')
                    .map((b) => (
                      <button
                        key={b.label}
                        type="button"
                        className={`ribbon-small${b.action.kind === 'soon' ? ' soon' : ''}`}
                        title={
                          b.action.kind === 'soon'
                            ? `Növbəti mərhələ: ${b.action.stage}`
                            : undefined
                        }
                        onClick={() => void act(b.action, b.label)}
                      >
                        <b.icon size={14} strokeWidth={1.6} aria-hidden="true" />
                        {b.label}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <span className="ribbon-group-name">{g.name}</span>
          </div>
        ))}
      </section>
      <div className="window-tabs" role="tablist" aria-label="Açıq pəncərələr">
        <button
          type="button"
          role="tab"
          aria-selected={ws.activeId === 'home'}
          className={ws.activeId === 'home' ? 'active' : ''}
          onClick={() => ws.focus('home')}
        >
          Başlanğıc
        </button>
        {ws.windows.map((w) => (
          <span key={w.id} className={`window-tab${ws.activeId === w.id ? ' active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={ws.activeId === w.id}
              onClick={() => ws.focus(w.id)}
              title={viewTitle(w.view, w.label)}
            >
              {w.dirty && <i className="dirty-dot" aria-label="Saxlanmayıb" />}
              {viewTitle(w.view, w.label)}
            </button>
            <button
              type="button"
              className="tab-close"
              aria-label={`Bağla: ${viewTitle(w.view, w.label)}`}
              onClick={() => ws.close(w.id)}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      {message && (
        <div className="shell-message">
          <Notice kind={message.kind} onClose={() => setMessage(null)}>
            {message.text}
          </Notice>
        </div>
      )}
      <main className="workspace">
        <div className="pane" hidden={ws.activeId !== 'home'}>
          <HomePage
            integrity={integrity.data}
            integrityLoading={integrity.loading}
            onRecheck={integrity.reload}
          />
        </div>
        {ws.windows.map((w) => (
          <div key={w.id} className="pane" hidden={ws.activeId !== w.id}>
            <WindowContext.Provider value={w}>
              <Routed win={w} />
            </WindowContext.Provider>
          </div>
        ))}
      </main>
      <footer className="statusbar">
        <span>
          {company.closedThrough
            ? `Bağlı dövr: ${company.closedThrough.split('-').reverse().join('.')}-dək`
            : 'Dövr bağlanmayıb'}
        </span>
        <span className={integrity.data && !integrity.data.ok ? 'bad' : ''}>
          {integrity.loading && !integrity.data
            ? 'Baza yoxlanılır…'
            : integrity.data
              ? integrity.data.ok
                ? `Baza yoxlanıldı: tarazdır (${integrity.data.postings.toLocaleString('az-AZ')} yazılış)`
                : 'Bazada uyğunsuzluq var — Başlanğıc səhifəsinə baxın'
              : ''}
        </span>
        <span className="statusbar-keys">
          {active ? viewTitle(active.view, active.label) : 'Başlanğıc'} · Ctrl+N yeni əməliyyat ·
          Ctrl+K axtarış · Ctrl+S saxla
        </span>
      </footer>
      {ws.pendingClose && (
        <Confirm
          title="Saxlanmamış dəyişikliklər"
          confirmLabel="Saxlamadan bağla"
          destructive
          onConfirm={() => ws.resolveClose(true)}
          onCancel={() => ws.resolveClose(false)}
        >
          <p>
            “{viewTitle(ws.pendingClose.view, ws.pendingClose.label)}” pəncərəsində saxlanmamış
            dəyişikliklər var.
          </p>
        </Confirm>
      )}
      {newCompany && (
        <Modal title="Yeni şirkət" onClose={() => setNewCompany(false)} size="small">
          <CompanyForm
            onCancel={() => setNewCompany(false)}
            onCreated={(id) => {
              setNewCompany(false);
              void reloadCompanies().then(() => ws.setCompany(id));
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function Routed({ win }: { win: Win }) {
  const v = win.view;
  switch (v.type) {
    case 'operation':
      return <OperationEditor {...(v.id ? { id: v.id } : {})} />;
    case 'accountCard':
      return <CardPage initial={v} />;
    case 'page':
      switch (v.page) {
        case 'operations':
          return <OperationsPage />;
        case 'trial':
          return <TrialPage />;
        case 'card':
          return <CardPage />;
        case 'accounts':
          return <AccountsPage />;
        case 'partners':
          return <PartnersPage />;
        case 'bankAccounts':
          return <BankAccountsPage />;
        case 'products':
          return <ProductsPage />;
        case 'employees':
          return <EmployeesPage />;
        case 'lists':
          return <ListsPage />;
        case 'audit':
          return <AuditPage />;
        case 'settings':
          return <SettingsPage />;
        case 'home':
          return null;
      }
  }
}
