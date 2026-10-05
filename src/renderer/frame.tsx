import { Maximize2, Minimize2, Minus, RefreshCw, X } from 'lucide-react';
import { useContext, type FormEvent, type ReactNode } from 'react';
import { WindowContext, useWorkspace } from './workspace';
import { useCatalog } from './catalog';

/** Internal window controls: minimize to the desk, restore/maximize inside the app, close. */
export function WindowControls() {
  const win = useContext(WindowContext);
  const ws = useWorkspace();
  if (!win) return null;
  return (
    <div className="window-controls">
      <button
        type="button"
        className="icon-button"
        aria-label="Pəncərəni yığ"
        title="Yığ"
        onClick={ws.minimize}
      >
        <Minus size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={win.restored ? 'Pəncərəni böyüt' : 'Pəncərəni kiçilt'}
        title={win.restored ? 'Böyüt' : 'Kiçilt'}
        onClick={() => ws.toggleRestore(win.id)}
      >
        {win.restored ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
      </button>
      <button
        type="button"
        className="icon-button close"
        aria-label="Pəncərəni bağla"
        title="Bağla"
        onClick={() => ws.close(win.id)}
      >
        <X size={16} />
      </button>
    </div>
  );
}

/**
 * One module window: heading, a compact filter strip (7% of the height) and the work area
 * (93%). Notices float over the content so they never push the table.
 */
export function ModuleFrame({
  title,
  hint,
  count,
  actions,
  filters,
  onFilter,
  notices,
  onRefresh,
  children,
}: {
  title: string;
  hint?: string;
  count?: number;
  actions?: ReactNode;
  filters?: ReactNode;
  onFilter?: () => void;
  notices?: ReactNode;
  onRefresh?: () => void;
  children: ReactNode;
}) {
  const win = useContext(WindowContext);
  const { company } = useCatalog(win?.companyId);
  const ws = useWorkspace();
  const foreign = win && company && win.companyId !== ws.companyId;
  return (
    <section className="module" aria-label={title}>
      <header className="module-heading">
        <div className="module-title">
          <div className="title-line">
            <h1>{title}</h1>
            {count !== undefined && <span className="count">{count.toLocaleString('az-AZ')}</span>}
          </div>
          <p>
            {foreign ? <b className="company-flag">{company.name}</b> : null}
            {foreign && hint ? ' · ' : null}
            {hint}
          </p>
        </div>
        <div className="module-actions">
          {actions}
          {onRefresh && (
            <button
              type="button"
              className="icon-button"
              aria-label="Yenilə"
              title="Yenilə"
              onClick={onRefresh}
            >
              <RefreshCw size={15} />
            </button>
          )}
        </div>
        <WindowControls />
      </header>
      {notices && <div className="module-notices">{notices}</div>}
      <div className={`module-body${filters ? ' with-filters' : ''}`}>
        {filters && (
          <form
            noValidate
            className="filter-bar"
            aria-label="Filtr"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              onFilter?.();
            }}
          >
            {filters}
          </form>
        )}
        <div className="module-content">{children}</div>
      </div>
    </section>
  );
}
