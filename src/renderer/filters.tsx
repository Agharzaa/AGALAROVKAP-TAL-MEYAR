import { useState } from 'react';
import { Search, X } from './icons';
import { shiftMonth, startOfYear, today } from './format';
import { useCatalog } from './catalog';
import { DateInput, MonthInput } from './ui';
import { useWindow } from './workspace';
import { searchKey } from '../domain/values';

export interface Range {
  from: string;
  to: string;
}
/** Draft dates are edited freely; the query only changes when the filter is applied. */
export function useRange(initial: Range = { from: startOfYear(), to: today() }) {
  const [draft, setDraft] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const [error, setError] = useState('');
  return {
    draft,
    setDraft,
    applied,
    error,
    apply() {
      if (!draft.from || !draft.to) setError('Tarix aralığını doldurun.');
      else if (draft.from > draft.to) setError('Başlanğıc tarix son tarixdən sonra ola bilməz.');
      else {
        setError('');
        setApplied({ ...draft });
      }
    },
    /** Sets and applies a whole range at once (the period steps). */
    set(range: Range) {
      setError('');
      setDraft(range);
      setApplied(range);
    },
  };
}

export type PeriodKind = 'month' | 'quarter' | 'year';
const unitMonths: Record<PeriodKind, number> = { month: 1, quarter: 3, year: 12 };
const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** The month, quarter or year holding the ISO day `anchor`. */
export function periodOf(kind: PeriodKind, anchor: string): Range {
  const y = anchor.slice(0, 4);
  const m = Number(anchor.slice(5, 7));
  const first = kind === 'month' ? m : kind === 'quarter' ? m - ((m - 1) % 3) : 1;
  const start = `${y}-${String(first).padStart(2, '0')}`;
  return { from: `${start}-01`, to: monthEnd(shiftMonth(start, unitMonths[kind] - 1)) };
}

/** Whether the range is exactly one month, quarter or year (checked from the longest). */
export function kindOf(range: Range): PeriodKind | null {
  for (const kind of ['year', 'quarter', 'month'] as const) {
    const p = periodOf(kind, range.from);
    if (p.from === range.from && p.to === range.to) return kind;
  }
  return null;
}

/** 1C's period steps: this month, quarter or year, and ‹ › to the previous or next one. */
export function PeriodSteps({ range }: { range: ReturnType<typeof useRange> }) {
  const kind = kindOf(range.applied);
  const anchor = range.applied.to < today() ? range.applied.to : today();
  const step = (delta: number) =>
    kind &&
    range.set(
      periodOf(kind, `${shiftMonth(range.applied.from.slice(0, 7), delta * unitMonths[kind])}-01`),
    );
  return (
    <div className="segmented period-steps" role="group" aria-label="Dövr seçimi">
      <button type="button" aria-label="Əvvəlki dövr" disabled={!kind} onClick={() => step(-1)}>
        ‹
      </button>
      {(
        [
          ['month', 'Ay'],
          ['quarter', 'Rüb'],
          ['year', 'İl'],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          type="button"
          aria-pressed={kind === k}
          onClick={() => range.set(periodOf(k, kind === k ? range.applied.from : anchor))}
        >
          {label}
        </button>
      ))}
      <button type="button" aria-label="Növbəti dövr" disabled={!kind} onClick={() => step(1)}>
        ›
      </button>
    </div>
  );
}

export function RangeFields({ range }: { range: ReturnType<typeof useRange> }) {
  return (
    <>
      <label className="filter-dates">
        <span>Dövr</span>
        <DateInput
          aria-label="Başlanğıc tarix"
          value={range.draft.from}
          onChange={(from) => range.setDraft((d) => ({ ...d, from }))}
        />
        <span aria-hidden="true">–</span>
        <DateInput
          aria-label="Son tarix"
          value={range.draft.to}
          onChange={(to) => range.setDraft((d) => ({ ...d, to }))}
        />
      </label>
      <button type="submit" className="button tonal">
        Göstər
      </button>
      {range.error && (
        <span className="filter-error" role="alert">
          {range.error}
        </span>
      )}
    </>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search">
      <Search size={15} aria-hidden="true" />
      <input
        aria-label="Axtar"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" aria-label="Axtarışı təmizlə" onClick={() => onChange('')}>
          <X size={13} />
        </button>
      )}
    </label>
  );
}

export const matches = (query: string, ...fields: string[]) => {
  const q = searchKey(query.trim());
  return !q || fields.some((f) => searchKey(f).includes(q));
};

/** The "Ay" filter of month pages: the Azerbaijani month field, the company's closed months marked. */
export function MonthFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (ym: string) => void;
}) {
  const { company } = useCatalog(useWindow().companyId);
  return (
    <div className="filter-text">
      <span aria-hidden="true">Ay</span>
      <MonthInput value={value} onChange={onChange} closedThrough={company?.closedThrough} />
    </div>
  );
}
