import { RefreshCw } from './icons';
import { useContext, type FormEvent, type ReactNode } from 'react';
import { WindowContext, useWorkspace } from './workspace';
import { useCatalog } from './catalog';

/**
 * One form: command bar, an optional filter strip, notices and the work area. It sits inside a
 * child window (App.tsx, Desktop), whose caption carries the title and window controls.
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
      {/* 1C form layout: the window caption names the form, so the form opens with its
          command bar (actions on the left), and what it shows is summed up on the right. */}
      <header className="module-heading">
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
        <div className="module-title">
          <h1>
            <span className="sr-only">{title}</span>
            {count !== undefined && (
              <span className="count" title="Sətir sayı">
                {count.toLocaleString('az-AZ')}
              </span>
            )}
          </h1>
          {(hint || foreign) && (
            <p>
              {foreign ? <b className="company-flag">{company.name}</b> : null}
              {foreign && hint ? ', ' : null}
              {hint}
            </p>
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
