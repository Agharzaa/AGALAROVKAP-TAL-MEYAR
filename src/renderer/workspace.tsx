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
  | 'operations'
  | 'sales'
  | 'purchases'
  | 'trial'
  | 'card'
  | 'accounts'
  | 'partners'
  | 'bankAccounts'
  | 'products'
  | 'employees'
  | 'lists'
  | 'audit'
  | 'settings';
export type View =
  | { type: 'page'; page: Page }
  | { type: 'operation'; id?: string }
  | { type: 'invoice'; direction: 'sale' | 'purchase'; id?: string }
  | { type: 'accountCard'; account: string; sk?: string[]; from?: string; to?: string };
export interface Win {
  id: string;
  companyId: string;
  view: View;
  /** Human title of the document once known (e.g. its number). */
  label?: string;
  dirty: boolean;
}

/**
 * 1C-like window layout (MDI): every open section or document is a child window on the work
 * area, with its own position, size and state. Kept apart from the windows themselves so moving a
 * window never re-renders the pages inside the others.
 */
export interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type WinState = 'normal' | 'maximized' | 'minimized';
export interface WinLayout {
  geom: Geom;
  state: WinState;
  /** State to return to when a minimized window is shown again. */
  prev: 'normal' | 'maximized';
}
interface Mdi {
  layout: Record<string, WinLayout>;
  /** Bottom to top. */
  order: string[];
}
export interface Layout extends Mdi {
  place: (id: string, geom: Geom) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  cascade: () => void;
  tile: () => void;
  closeAll: () => void;
  /** Shows the work area itself (Başlanğıc): every window is minimized. */
  showDesktop: () => void;
  setDesktop: (size: { w: number; h: number }) => void;
}
const LayoutContext = createContext<Layout | null>(null);
export function useLayout(): Layout {
  const value = useContext(LayoutContext);
  if (!value) throw new Error('Workspace provider missing');
  return value;
}

/** Size and state remembered per kind of window (all invoices, the sales list…), like 1C. */
const MEMORY = 'meyar.windows.v2';
type Memory = Record<string, { w: number; h: number; max: boolean }>;
const kindOf = (v: View) => (v.type === 'page' ? `page:${v.page}` : v.type);
function readMemory(): Memory {
  try {
    const raw = window.localStorage.getItem(MEMORY);
    return raw ? (JSON.parse(raw) as Memory) : {};
  } catch {
    return {};
  }
}
function remember(view: View, l: WinLayout) {
  try {
    const m = readMemory();
    m[kindOf(view)] = { w: l.geom.w, h: l.geom.h, max: l.state === 'maximized' };
    window.localStorage.setItem(MEMORY, JSON.stringify(m));
  } catch {
    /* storage unavailable: layout is simply not remembered */
  }
}
const CASCADE = 26;

/** Working period (month) used as the default range of reports and new documents. */
export interface Period {
  from: string;
  to: string;
}
interface Workspace {
  companyId: string;
  period: Period;
  setPeriod: (p: Period) => void;
  setCompany: (id: string) => void;
  windows: Win[];
  activeId: string;
  open: (view: View, companyId?: string) => void;
  /** Brings a window to the front (restoring it if minimized); 'home' shows the work area. */
  focus: (id: string) => void;
  close: (id: string) => void;
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
const reusable = (v: View) => !((v.type === 'operation' || v.type === 'invoice') && !v.id);

let sequence = 0;
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** First and last day of the month containing `iso`. */
export function monthOf(iso: string): Period {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}
export function WorkspaceProvider({
  initialCompany,
  children,
}: {
  initialCompany: string;
  children: ReactNode;
}) {
  const [companyId, setCompanyId] = useState(initialCompany);
  const [period, setPeriod] = useState<Period>(() => monthOf(todayIso()));
  const [windows, setWindows] = useState<Win[]>([]);
  const [activeId, setActiveId] = useState('home');
  const [pendingClose, setPendingClose] = useState<Win | null>(null);
  const [mdi, setMdiState] = useState<Mdi>({ layout: {}, order: [] });
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  // Several layout changes can happen in one event (close all, open then focus), so the latest
  // layout is kept in a ref and every change builds on it.
  const mdiRef = useRef(mdi);
  const desktop = useRef({ w: 1200, h: 680 });
  const anyDirty = windows.some((w) => w.dirty);
  useEffect(() => {
    try {
      api.setDirty(anyDirty);
    } catch {
      /* no bridge in previews */
    }
  }, [anyDirty]);

  const setMdi = useCallback((next: Mdi) => {
    mdiRef.current = next;
    setMdiState(next);
  }, []);
  /** Top window that is not minimized, or the work area itself. */
  const topOf = (m: Mdi) =>
    [...m.order].reverse().find((id) => m.layout[id]?.state !== 'minimized') ?? 'home';
  const raise = useCallback(
    (id: string) => {
      const m = mdiRef.current;
      const l = m.layout[id];
      if (!l) return;
      setMdi({
        layout: l.state === 'minimized' ? { ...m.layout, [id]: { ...l, state: l.prev } } : m.layout,
        order: [...m.order.filter((x) => x !== id), id],
      });
      setActiveId(id);
    },
    [setMdi],
  );

  const open = useCallback(
    (view: View, company?: string) => {
      const target = company ?? companyId;
      if (view.type === 'page' && view.page === 'home') {
        const m = mdiRef.current;
        const layout = { ...m.layout };
        for (const id of m.order) {
          const l = layout[id]!;
          if (l.state !== 'minimized') layout[id] = { ...l, state: 'minimized', prev: l.state };
        }
        setMdi({ ...m, layout });
        setActiveId('home');
        return;
      }
      const existing = reusable(view)
        ? windowsRef.current.find((w) => w.companyId === target && sameView(w.view, view))
        : undefined;
      if (existing) {
        raise(existing.id);
        return;
      }
      const id = `w${++sequence}`;
      const m = mdiRef.current;
      const { w: dw, h: dh } = desktop.current;
      const saved = readMemory()[kindOf(view)];
      const w = Math.max(360, Math.min(saved?.w ?? Math.min(1180, dw - 48), dw));
      const h = Math.max(220, Math.min(saved?.h ?? dh - 32, dh));
      const step = m.order.filter((x) => m.layout[x]?.state !== 'minimized').length % 8;
      const x = Math.max(0, Math.min(8 + step * CASCADE, dw - w));
      const y = Math.max(0, Math.min(8 + step * CASCADE, dh - h));
      // Lists and reports fill the work area (like tabs); documents open as windows over them,
      // as in 1C. What the user last chose for a kind of window wins.
      const state: WinLayout['prev'] = (saved ? saved.max : view.type === 'page')
        ? 'maximized'
        : 'normal';
      windowsRef.current = [...windowsRef.current, { id, companyId: target, view, dirty: false }];
      setWindows(windowsRef.current);
      setMdi({
        layout: { ...m.layout, [id]: { geom: { x, y, w, h }, state, prev: state } },
        order: [...m.order, id],
      });
      setActiveId(id);
    },
    [companyId, raise, setMdi],
  );
  const remove = useCallback(
    (id: string) => {
      windowsRef.current = windowsRef.current.filter((w) => w.id !== id);
      setWindows(windowsRef.current);
      const m = mdiRef.current;
      const layout = { ...m.layout };
      delete layout[id];
      const next = { layout, order: m.order.filter((x) => x !== id) };
      setMdi(next);
      setActiveId(topOf(next));
    },
    [setMdi],
  );
  const close = useCallback(
    (id: string) => {
      const w = windowsRef.current.find((x) => x.id === id);
      if (!w) return;
      if (w.dirty) {
        raise(id);
        setPendingClose(w);
      } else remove(id);
    },
    [remove, raise],
  );
  const update = (id: string, patch: Partial<Win>) =>
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const value: Workspace = {
    companyId,
    period,
    setPeriod,
    setCompany: setCompanyId,
    windows,
    activeId,
    open,
    focus: (id) => (id === 'home' ? open({ type: 'page', page: 'home' }) : raise(id)),
    close,
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

  const patch = (id: string, change: (l: WinLayout) => WinLayout) => {
    const m = mdiRef.current;
    const l = m.layout[id];
    if (!l) return null;
    const next = change(l);
    setMdi({ ...m, layout: { ...m.layout, [id]: next } });
    return next;
  };
  const viewOf = (id: string) => windowsRef.current.find((w) => w.id === id)?.view;
  const arrange = (place: (i: number, n: number, d: { w: number; h: number }) => Geom) => {
    const m = mdiRef.current;
    const visible = m.order.filter((id) => m.layout[id]?.state !== 'minimized');
    const layout = { ...m.layout };
    visible.forEach((id, i) => {
      layout[id] = {
        geom: place(i, visible.length, desktop.current),
        state: 'normal',
        prev: 'normal',
      };
    });
    setMdi({ ...m, layout });
  };
  const layoutValue: Layout = {
    ...mdi,
    place: (id, geom) => {
      const l = patch(id, (x) => ({ ...x, geom, state: 'normal', prev: 'normal' }));
      const v = viewOf(id);
      if (l && v) remember(v, l);
    },
    minimize: (id) => {
      patch(id, (l) => (l.state === 'minimized' ? l : { ...l, state: 'minimized', prev: l.state }));
      setActiveId(topOf(mdiRef.current));
    },
    toggleMaximize: (id) => {
      const l = patch(id, (x) => {
        const state = x.state === 'maximized' ? 'normal' : 'maximized';
        return { ...x, state, prev: state };
      });
      const v = viewOf(id);
      if (l && v) remember(v, l);
      raise(id);
    },
    cascade: () =>
      arrange((i, _n, d) => {
        const w = Math.round(Math.max(360, d.w * 0.72));
        const h = Math.round(Math.max(220, d.h * 0.78));
        const step = i % 10;
        return {
          x: Math.min(8 + step * CASCADE, Math.max(0, d.w - w)),
          y: Math.min(8 + step * CASCADE, Math.max(0, d.h - h)),
          w,
          h,
        };
      }),
    tile: () =>
      arrange((i, n, d) => {
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        const row = Math.floor(i / cols);
        // The last row shares the full width, so no gap is left on the work area.
        const inRow = row === rows - 1 ? n - row * cols : cols;
        const w = Math.floor(d.w / inRow);
        const h = Math.floor(d.h / rows);
        return { x: (i - row * cols) * w, y: row * h, w, h };
      }),
    closeAll: () => {
      for (const w of [...windowsRef.current]) if (!w.dirty) remove(w.id);
      const dirty = windowsRef.current.find((w) => w.dirty);
      if (dirty) close(dirty.id);
    },
    showDesktop: () => open({ type: 'page', page: 'home' }),
    setDesktop: (size) => {
      desktop.current = size;
    },
  };
  return (
    <Context.Provider
      value={useMemo(
        () => value,
        [companyId, period, windows, activeId, pendingClose, open, close, remove],
      )}
    >
      <LayoutContext.Provider value={layoutValue}>{children}</LayoutContext.Provider>
    </Context.Provider>
  );
}
