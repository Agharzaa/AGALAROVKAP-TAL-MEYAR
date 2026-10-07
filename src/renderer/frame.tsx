import { RefreshCw } from 'lucide-react';
import { useContext, type FormEvent, type ReactNode } from 'react';
import { WindowContext, useWorkspace } from './workspace';
import { useCatalog } from './catalog';

/**
 * One module window: title line with actions, an optional filter strip, notices and the work
 * area. It sits inside a child window (App.tsx, Desktop), which carries the window controls.
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
  hint?: string | undefined;
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
          <h1>
            {title}
            {count !== undefined && <span className="count">{count.toLocaleString('az-AZ')}</span>}
          </h1>
          {(hint || foreign) && (
            <p>
              {foreign ? <b className="company-flag">{company.name}</b> : null}
              {foreign && hint ? ' · ' : null}
              {hint}
            </p>
          )}
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
      </header>
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
      {notices && <div className="module-notices">{notices}</div>}
      <div className="module-content">{children}</div>
    </section>
  );
}
