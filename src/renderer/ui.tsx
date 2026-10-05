import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronUp, Inbox, X } from 'lucide-react';
import { isNegative, isZero, money } from './format';

export function Amount({ value, strong = false }: { value: string; strong?: boolean }) {
  const className = `amount${isZero(value) ? ' zero' : ''}${isNegative(value) ? ' negative' : ''}`;
  return strong ? (
    <b className={className}>{money(value)}</b>
  ) : (
    <span className={className}>{money(value)}</span>
  );
}

export function Field({
  label,
  children,
  hint,
  error,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  wide?: boolean;
}) {
  return (
    <label className={`field${wide ? ' wide' : ''}${error ? ' invalid' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? (
        <small className="field-error-text">{error}</small>
      ) : hint ? (
        <small>{hint}</small>
      ) : null}
    </label>
  );
}

export function Notice({
  kind = 'error',
  children,
  onClose,
}: {
  kind?: 'error' | 'success' | 'info';
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{children}</span>
      {onClose && (
        <button
          type="button"
          className="icon-button"
          aria-label="Bildirişi bağla"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function Status({ status }: { status: 'draft' | 'posted' | 'cancelled' }) {
  const label = { draft: 'Qaralama', posted: 'Uçotda', cancelled: 'Ləğv edilib' }[status];
  return (
    <span className={`status ${status}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        <Inbox size={22} />
      </span>
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  size = 'medium',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'small' | 'medium' | 'large';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${size}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="modal-heading">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Pəncərəni bağla"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  align?: 'end';
  className?: string;
}
const PAGE_SIZES = [25, 50, 100, 250];

/**
 * Ledger table: sticky header and totals, local horizontal scroll, keyboard-openable rows and
 * a page-size menu that opens upward from the bottom bar so it never covers the last rows.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onOpen,
  footer,
  empty,
  label,
  rowClass,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onOpen?: (row: T) => void;
  footer?: ReactNode;
  empty?: ReactNode;
  label: string;
  rowClass?: (row: T) => string;
}) {
  const [size, setSize] = useState(50);
  const [page, setPage] = useState(0);
  const [menu, setMenu] = useState(false);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * size, (current + 1) * size);
  return (
    <div className="data-table">
      <div className="table-scroll">
        <table aria-label={label}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`${c.align === 'end' ? 'num' : ''} ${c.className ?? ''}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={rowKey(row)}
                className={rowClass?.(row)}
                tabIndex={onOpen ? 0 : undefined}
                onDoubleClick={() => onOpen?.(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target === e.currentTarget && onOpen) {
                    e.preventDefault();
                    onOpen(row);
                  }
                }}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`${c.align === 'end' ? 'num' : ''} ${c.className ?? ''}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && footer && <tfoot>{footer}</tfoot>}
        </table>
        {rows.length === 0 && (empty ?? <Empty title="Məlumat yoxdur" />)}
      </div>
      <div className="table-bottom">
        <span>
          <b>{rows.length.toLocaleString('az-AZ')}</b> sətir
          {rows.length > size &&
            ` · ${current * size + 1}–${Math.min((current + 1) * size, rows.length)}`}
        </span>
        <div className="pager">
          <div className="page-size">
            <button
              type="button"
              className="page-size-button"
              aria-haspopup="listbox"
              aria-expanded={menu}
              aria-label={`Səhifədə ${size} sətir`}
              onClick={() => setMenu((m) => !m)}
            >
              {size} sətir <ChevronUp size={13} />
            </button>
            {menu && (
              <ul className="page-size-menu" role="listbox" aria-label="Səhifədə sətir sayı">
                {PAGE_SIZES.map((n) => (
                  <li key={n} role="option" aria-selected={n === size}>
                    <button
                      type="button"
                      autoFocus={n === size}
                      onClick={() => {
                        setSize(n);
                        setPage(0);
                        setMenu(false);
                      }}
                      onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}
                    >
                      {n}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Əvvəlki səhifə"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="page-number">
            {current + 1} / {pages}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Növbəti səhifə"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Confirm({
  title,
  children,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel} size="small">
      <div className="modal-body">{children}</div>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onCancel} autoFocus>
          Geri
        </button>
        <button
          type="button"
          className={`button ${destructive ? 'destructive' : 'primary'}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

const isoToText = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('.') : '';
function textToIso(text: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
/** Progressive dd.mm.yyyy mask: "05102026" becomes "05.10.2026" while typing. */
function mask(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('.');
}

/**
 * Date field in the Azerbaijani dd.mm.yyyy form regardless of the Windows locale, with a
 * calendar button. The value stays ISO (YYYY-MM-DD); an impossible date is shown as invalid
 * and never reported as a value.
 */
export function DateInput({
  value,
  onChange,
  required,
  min,
  'aria-label': ariaLabel,
  autoFocus,
}: {
  value: string;
  onChange: (iso: string) => void;
  required?: boolean;
  min?: string;
  'aria-label'?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(isoToText(value));
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (textToIso(text) !== value) setText(isoToText(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const iso = textToIso(text);
  const invalid = (text.length === 10 && !iso) || (!!iso && !!min && iso < min);
  return (
    <span className={`date-input${invalid ? ' invalid' : ''}`}>
      <input
        inputMode="numeric"
        placeholder="gg.aa.iiii"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        required={required}
        autoFocus={autoFocus}
        pattern="\d{2}\.\d{2}\.\d{4}"
        maxLength={10}
        value={text}
        onChange={(e) => {
          const next = mask(e.target.value);
          setText(next);
          const parsed = textToIso(next);
          if (parsed) onChange(parsed);
          else if (!next) onChange('');
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="date-picker"
        onClick={() => {
          try {
            picker.current?.showPicker();
          } catch {
            picker.current?.focus();
          }
        }}
      >
        <CalendarDays size={14} />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="date-native"
        value={iso ?? ''}
        min={min}
        onChange={(e) => {
          setText(isoToText(e.target.value));
          onChange(e.target.value);
        }}
      />
    </span>
  );
}
