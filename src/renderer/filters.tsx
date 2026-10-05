import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { startOfYear, today } from './format';
import { DateInput } from './ui';
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
  };
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
