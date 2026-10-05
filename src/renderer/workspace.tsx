import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';

export type Page =
  | 'home'
  | 'purchases'
  | 'sales'
  | 'bankIn'
  | 'bankOut'
  | 'trial'
  | 'journal'
  | 'receivables'
  | 'payables'
  | 'stock'
  | 'products'
  | 'partners'
  | 'accounts'
  | 'warehouses'
  | 'audit'
  | 'settings';
export type View =
  | { type: 'page'; page: Page }
  | { type: 'invoice'; direction: 'purchase' | 'sale'; id?: string }
  | { type: 'payment'; direction: 'in' | 'out'; id?: string }
  | { type: 'accountCard'; account: string; partnerId?: string };
export interface Win {
  id: string;
  companyId: string;
  view: View;
  /** Human title of the document once known (e.g. its number). */
  label?: string;
  dirty: boolean;
  restored: boolean;
}

interface Workspace {
  companyId: string;
  setCompany: (id: string) => void;
  windows: Win[];
  activeId: string;
  open: (view: View, companyId?: string) => void;
  focus: (id: string) => void;
  close: (id: string) => void;
  minimize: () => void;
  toggleRestore: (id: string) => void;
  setDirty: (id: string, dirty: boolean) => void;
  setLabel: (id: string, label: string) => void;
  /** Replaces a "new document" window's view once the document has an id. */
  retarget: (id: string, view: View) => void;
  pendingClose: Win | null;
  resolveClose: (discard: boolean) => void;
}
const Context = createContext<Workspace | null>(null);
export function useWorkspace(): Workspace {
  const value = useContext(Context);
  if (!value) throw new Error('Workspace provider missing');
  return value;
}
/** The window a component lives in, so it can mark itself dirty or close itself. */
export const WindowContext = createContext<Win | null>(null);
export function useWindow(): Win {
  const value = useContext(WindowContext);
  if (!value) throw new Error('Window context missing');
  return value;
}

const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);
/** New documents may be opened several times; everything else is focused if already open. */
const reusable = (v: View) => !((v.type === 'invoice' || v.type === 'payment') && !v.id);

let sequence = 0;
export function WorkspaceProvider({
  initialCompany,
  children,
}: {
  initialCompany: string;
  children: ReactNode;
}) {
  const [companyId, setCompanyId] = useState(initialCompany);
  const [windows, setWindows] = useState<Win[]>([]);
  const [activeId, setActiveId] = useState('home');
  const [pendingClose, setPendingClose] = useState<Win | null>(null);
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const anyDirty = windows.some((w) => w.dirty);
  useEffect(() => {
    try {
      api.setDirty(anyDirty);
    } catch {
      /* no bridge in previews */
    }
  }, [anyDirty]);

  const open = useCallback(
    (view: View, company?: string) => {
      const target = company ?? companyId;
      if (view.type === 'page' && view.page === 'home') {
        setActiveId('home');
        return;
      }
      const existing = reusable(view)
        ? windowsRef.current.find((w) => w.companyId === target && sameView(w.view, view))
        : undefined;
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const id = `w${++sequence}`;
      setWindows((ws) => [...ws, { id, companyId: target, view, dirty: false, restored: false }]);
      setActiveId(id);
    },
    [companyId],
  );
  const remove = useCallback((id: string) => {
    setWindows((ws) => {
      const next = ws.filter((w) => w.id !== id);
      setActiveId((active) => (active === id ? (next.at(-1)?.id ?? 'home') : active));
      return next;
    });
  }, []);
  const close = useCallback(
    (id: string) => {
      const w = windowsRef.current.find((x) => x.id === id);
      if (!w) return;
      if (w.dirty) setPendingClose(w);
      else remove(id);
    },
    [remove],
  );
  const update = (id: string, patch: Partial<Win>) =>
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const value: Workspace = {
    companyId,
    setCompany: setCompanyId,
    windows,
    activeId,
    open,
    focus: setActiveId,
    close,
    minimize: () => setActiveId('home'),
    toggleRestore: (id) =>
      setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, restored: !w.restored } : w))),
    setDirty: (id, dirty) => {
      if (windowsRef.current.find((w) => w.id === id)?.dirty !== dirty) update(id, { dirty });
    },
    setLabel: (id, label) => {
      if (windowsRef.current.find((w) => w.id === id)?.label !== label) update(id, { label });
    },
    retarget: (id, view) => update(id, { view }),
    pendingClose,
    resolveClose: (discard) => {
      if (discard && pendingClose) remove(pendingClose.id);
      setPendingClose(null);
    },
  };
  return (
    <Context.Provider
      value={useMemo(
        () => value,
        [companyId, windows, activeId, pendingClose, open, close, remove],
      )}
    >
      {children}
    </Context.Provider>
  );
}
