import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CornerDownLeft,
  FileInput,
  FileOutput,
  Search,
  X,
} from 'lucide-react';
import type { InvoiceSummary, PaymentView } from '../contracts/queries';
import { api } from './api';
import { day, money } from './format';
import { searchKey } from '../domain/values';
import { footerPages, navigation, pages } from './pages';
import type { Page, View } from './workspace';

type Item = {
  key: string;
  title: string;
  detail: string;
  view: View;
  icon: 'page' | 'sale' | 'purchase' | 'in' | 'out';
};
const fold = searchKey;

/** Ctrl+K: jump to any module, invoice (number, partner, VÖEN) or bank document. Read-only. */
export function QuickOpen({
  companyId,
  onOpen,
  onClose,
}: {
  companyId: string;
  onOpen: (view: View) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [docs, setDocs] = useState<Item[]>([]);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    let live = true;
    const all = { from: '2000-01-01', to: '2099-12-31' };
    Promise.all([
      api.query<InvoiceSummary[]>({ type: 'invoices', companyId, direction: 'sale', ...all }),
      api.query<InvoiceSummary[]>({ type: 'invoices', companyId, direction: 'purchase', ...all }),
      api.query<PaymentView[]>({ type: 'payments', companyId, direction: 'in', ...all }),
      api.query<PaymentView[]>({ type: 'payments', companyId, direction: 'out', ...all }),
    ])
      .then(([sales, purchases, incoming, outgoing]) => {
        if (!live) return;
        const invoices = [...sales, ...purchases].map((i): Item => ({
          key: i.id,
          title: i.number,
          detail: `${i.direction === 'sale' ? 'Satış' : 'Alış'} qaiməsi · ${i.partnerName} · VÖEN ${i.partnerTaxId} · ${day(i.date)} · ${money(i.total)} AZN`,
          view: { type: 'invoice', direction: i.direction, id: i.id },
          icon: i.direction,
        }));
        const payments = [...incoming, ...outgoing].map((p): Item => ({
          key: p.id,
          title: p.reference,
          detail: `${p.direction === 'in' ? 'Daxilolma' : 'Ödəniş'} · ${p.partnerName} · ${day(p.date)} · ${money(p.amount)} AZN`,
          view: { type: 'payment', direction: p.direction, id: p.id },
          icon: p.direction,
        }));
        setDocs([...invoices, ...payments]);
      })
      .catch(() => setDocs([]));
    return () => {
      live = false;
    };
  }, [companyId]);
  const modules = useMemo(
    () =>
      [...navigation.flatMap((g) => g.items), ...footerPages].map((p: Page): Item => ({
        key: p,
        title: pages[p].title,
        detail: pages[p].hint,
        view: { type: 'page', page: p },
        icon: 'page',
      })),
    [],
  );
  const q = fold(query.trim());
  const items = q
    ? [
        ...modules.filter((m) => fold(`${m.title} ${m.detail}`).includes(q)).slice(0, 5),
        ...docs.filter((d) => fold(`${d.title} ${d.detail}`).includes(q)).slice(0, 12),
      ]
    : modules.slice(0, 9);
  const selected = Math.min(cursor, Math.max(items.length - 1, 0));
  const choose = (item?: Item) => {
    if (!item) return;
    onClose();
    onOpen(item.view);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[selected]);
    }
  };
  const Icon = {
    page: Search,
    sale: FileOutput,
    purchase: FileInput,
    in: ArrowDownLeft,
    out: ArrowUpRight,
  };
  return (
    <dialog
      ref={ref}
      className="quick-open"
      aria-label="Tez keçid"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="quick-search">
        <Search size={17} aria-hidden="true" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="quick-results"
          aria-activedescendant={items.length ? `quick-${selected}` : undefined}
          aria-label="Bölmə, qaimə və ya bank sənədi"
          placeholder="Bölmə, qaimə nömrəsi, kontragent, VÖEN…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={keys}
        />
        <button type="button" className="icon-button" aria-label="Bağla" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <ul id="quick-results" role="listbox" aria-label="Nəticələr">
        {items.map((item, i) => {
          const I = Icon[item.icon];
          return (
            <li
              key={`${item.icon}-${item.key}`}
              id={`quick-${i}`}
              role="option"
              aria-selected={i === selected}
              onMouseEnter={() => setCursor(i)}
              onClick={() => choose(item)}
            >
              <span className="quick-icon" aria-hidden="true">
                <I size={14} />
              </span>
              <span className="two-line">
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              {i === selected && (
                <CornerDownLeft size={14} aria-hidden="true" className="quick-enter" />
              )}
            </li>
          );
        })}
        {items.length === 0 && <li className="quick-none">Uyğun nəticə yoxdur.</li>}
      </ul>
    </dialog>
  );
}
