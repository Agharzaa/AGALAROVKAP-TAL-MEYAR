/**
 * Searchable pickers for accounts and subkonto values. Typing filters (i/ı/İ alike, account
 * codes by prefix), arrows move, Enter picks, Escape closes. Large catalogs stay fast: at most
 * 60 matches are drawn at a time.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { subkontoLabel, vatRates, type SubkontoKind } from '../domain/chart';
import { searchKey } from '../domain/values';
import type { Catalog, DocumentRef } from '../contracts/queries';
import { api } from './api';

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

export function Picker({
  value,
  options,
  onChange,
  placeholder = 'Seçin',
  ariaLabel,
  emptyLabel,
  invalid,
  disabled,
  onSearch,
  autoFocus,
  className = '',
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  /** Shown for the empty value (e.g. "bu sənəd"); when given, the empty value is selectable. */
  emptyLabel?: string;
  invalid?: boolean;
  disabled?: boolean;
  onSearch?: (text: string) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);
  const shown = selected ? selected.label : value ? value : (emptyLabel ?? '');
  const matches = useMemo(() => {
    const q = searchKey(text.trim());
    const list = q
      ? options.filter(
          (o) =>
            searchKey(`${o.label} ${o.hint ?? ''}`).includes(q) || o.value.startsWith(text.trim()),
        )
      : options;
    // The empty choice ("Bu sənəd", "Bütün…") is offered only while nothing is typed or when the
    // typed text names it, so Enter after typing never picks it by accident.
    const offerEmpty = emptyLabel !== undefined && (!q || searchKey(emptyLabel).includes(q));
    const withEmpty = offerEmpty ? [{ value: '', label: emptyLabel }, ...list] : list;
    return withEmpty.slice(0, 60);
  }, [options, text, emptyLabel]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const pick = (o: Option) => {
    onChange(o.value);
    setOpen(false);
    setText('');
  };
  return (
    <div
      ref={box}
      className={`picker${invalid ? ' invalid' : ''}${disabled ? ' disabled' : ''} ${className}`}
    >
      <input
        ref={input}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={shown || placeholder}
        title={
          selected ? `${selected.label}${selected.hint ? ` · ${selected.hint}` : ''}` : undefined
        }
        value={open ? text : shown}
        onFocus={() => {
          setOpen(true);
          setText('');
          setActive(0);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
          onSearch?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            const o = matches[active];
            if (o) pick(o);
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
            setText('');
          } else if (e.key === 'Tab' && open && text) {
            const o = matches[active];
            if (o) pick(o);
          }
        }}
        onBlur={() => {
          // Leaving the field without picking keeps the previous value.
          setTimeout(() => {
            if (!box.current?.contains(document.activeElement)) {
              setOpen(false);
              setText('');
            }
          }, 0);
        }}
      />
      <ChevronDown size={13} className="picker-caret" aria-hidden="true" />
      {open && !disabled && (
        <ul id={listId} role="listbox" className="picker-list">
          {matches.length === 0 && <li className="picker-empty">Uyğun nəticə yoxdur</li>}
          {matches.map((o, i) => (
            <li
              key={o.value || '∅'}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{o.label}</span>
              {o.hint && <small>{o.hint}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function accountOptions(catalog: Catalog, filter?: (code: string) => boolean): Option[] {
  return catalog.accounts
    .filter((a) => a.postable && !a.archived && (!filter || filter(a.code)))
    .map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }));
}

export function AccountPicker({
  catalog,
  value,
  onChange,
  ariaLabel,
  invalid,
  disabled,
  autoFocus,
}: {
  catalog: Catalog;
  value: string;
  onChange: (code: string) => void;
  ariaLabel: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const options = useMemo(() => accountOptions(catalog), [catalog]);
  const current = catalog.accounts.find((a) => a.code === value);
  return (
    <Picker
      className="account-picker"
      ariaLabel={ariaLabel}
      value={value}
      options={
        current && !options.some((o) => o.value === value)
          ? [...options, { value, label: `${value} ${current.name}` }]
          : options
      }
      onChange={onChange}
      placeholder="Hesab"
      {...(invalid !== undefined ? { invalid } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(autoFocus !== undefined ? { autoFocus } : {})}
    />
  );
}

const contractKindLabel = {
  sale: 'satış',
  purchase: 'alış',
  loan: 'kredit',
  other: 'digər',
} as const;

/** Options of one subkonto kind; contracts are those of the partner in the slot before. */
export function subkontoOptions(
  catalog: Catalog,
  kind: SubkontoKind,
  account: string,
  partnerId: string,
): Option[] {
  switch (kind) {
    case 'partner':
      return catalog.partners
        .filter((p) => !p.archived)
        .map((p) => ({ value: p.id, label: p.name, ...(p.taxId ? { hint: p.taxId } : {}) }));
    case 'contract':
      return catalog.contracts
        .filter((c) => !c.archived && c.partnerId === partnerId)
        .map((c) => ({
          value: c.id,
          label: `№${c.number} · ${contractKindLabel[c.kind]}`,
          hint: c.currency !== 'AZN' ? c.currency : c.date.split('-').reverse().join('.'),
        }));
    case 'bankAccount':
      return catalog.bankAccounts
        .filter((b) => !b.archived && b.account === account)
        .map((b) => ({ value: b.id, label: b.name, hint: `${b.iban} · ${b.currency}` }));
    case 'product':
      return catalog.products
        .filter((p) => !p.archived)
        .map((p) => ({
          value: p.id,
          label: p.name,
          hint: [p.code, p.unit].filter(Boolean).join(' · '),
        }));
    case 'employee':
      return catalog.employees
        .filter((e) => !e.archived)
        .map((e) => ({ value: e.id, label: e.name, ...(e.position ? { hint: e.position } : {}) }));
    case 'vatRate':
      return vatRates.map((v) => ({ value: v.id, label: v.name }));
    case 'document':
      return [];
    default:
      return catalog.items
        .filter((i) => i.kind === kind && !i.archived)
        .map((i) => ({ value: i.id, label: i.name }));
  }
}

/** Settlement documents are searched on the server; the empty value means "this document". */
function DocumentPicker({
  companyId,
  value,
  onChange,
  ariaLabel,
  invalid,
}: {
  companyId: string;
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  invalid?: boolean;
}) {
  const [options, setOptions] = useState<Option[]>([]);
  const [search, setSearch] = useState('');
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api
        .query<DocumentRef[]>({ type: 'documents', companyId, search })
        .then((list) => live && setOptions(list.map((d) => ({ value: d.value, label: d.label }))))
        .catch(() => undefined);
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [companyId, search]);
  return (
    <Picker
      ariaLabel={ariaLabel}
      value={value}
      options={options}
      onChange={onChange}
      emptyLabel="Bu sənəd"
      onSearch={setSearch}
      {...(invalid !== undefined ? { invalid } : {})}
    />
  );
}

/** All subkonto pickers of one side of a posting, in the account's order. */
export function SubkontoFields({
  catalog,
  companyId,
  account,
  values,
  onChange,
  side,
  errorIndex,
}: {
  catalog: Catalog;
  companyId: string;
  account: string;
  values: string[];
  onChange: (values: string[]) => void;
  side: string;
  errorIndex?: number;
}) {
  const acc = catalog.accounts.find((a) => a.code === account);
  if (!acc || !acc.subkonto.length) return <span className="no-subkonto">—</span>;
  return (
    <div className="subkonto-fields">
      {acc.subkonto.map((kind, i) => {
        const set = (v: string) => {
          const next = acc.subkonto.map((_, j) => (j === i ? v : (values[j] ?? '')));
          // A new partner invalidates the contract chosen for the previous one.
          if (kind === 'partner' && acc.subkonto[i + 1] === 'contract' && v !== values[i])
            next[i + 1] = '';
          onChange(next);
        };
        const label = `${side} ${account} · ${subkontoLabel[kind]}`;
        if (kind === 'document')
          return (
            <DocumentPicker
              key={kind}
              companyId={companyId}
              value={values[i] ?? ''}
              onChange={set}
              ariaLabel={label}
              {...(errorIndex === i ? { invalid: true } : {})}
            />
          );
        return (
          <Picker
            key={kind}
            ariaLabel={label}
            placeholder={subkontoLabel[kind]}
            value={values[i] ?? ''}
            options={subkontoOptions(
              catalog,
              kind,
              account,
              values[acc.subkonto.indexOf('partner')] ?? '',
            )}
            onChange={set}
            {...(errorIndex === i ? { invalid: true } : {})}
          />
        );
      })}
    </div>
  );
}
