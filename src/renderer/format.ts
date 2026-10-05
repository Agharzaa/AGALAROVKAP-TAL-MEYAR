import { displayMinor, parseMoney } from '../domain/money';

/** Canonical "1234.50" → "1 234,50". Invalid input is shown as given, never guessed. */
export function money(value: string): string {
  const negative = value.startsWith('-');
  try {
    const minor = parseMoney(negative ? value.slice(1) : value);
    return displayMinor(negative ? -minor : minor);
  } catch {
    return value;
  }
}
export function isZero(value: string): boolean {
  return /^-?0+(\.0+)?$/.test(value);
}
export function isNegative(value: string): boolean {
  return value.startsWith('-') && !isZero(value);
}
/** "2026-01-31" → "31.01.2026". */
export function day(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('.') : value;
}
/** Quantities: "1234.5" → "1 234,5". */
export function qty(value: string | undefined): string {
  if (!value) return '';
  const [whole = '', fraction] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction ? `,${fraction}` : ''}`;
}
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function startOfYear(): string {
  return `${today().slice(0, 4)}-01-01`;
}

/** Exact sum of canonical amounts ("12.30"), returned canonical. */
export function addAmounts(values: readonly string[]): string {
  let total = 0n;
  for (const v of values) {
    const m = /^(-?)(\d+)\.(\d{2})$/.exec(v);
    if (!m) continue;
    const n = BigInt(m[2]!) * 100n + BigInt(m[3]!);
    total += m[1] ? -n : n;
  }
  const negative = total < 0n;
  const abs = negative ? -total : total;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** Canonical "1234.50" as typed in an Azerbaijani field: "1234,50". */
export function toField(value: string | undefined): string {
  return (value ?? '').replace('.', ',');
}

const months = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avqust',
  'sentyabr',
  'oktyabr',
  'noyabr',
  'dekabr',
];
const weekdays = [
  'bazar',
  'bazar ertəsi',
  'çərşənbə axşamı',
  'çərşənbə',
  'cümə axşamı',
  'cümə',
  'şənbə',
];
/** "2026-10-05" → "5 oktyabr 2026, bazar ertəsi" — independent of the system ICU data. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const weekday = weekdays[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${d} ${months[m - 1]} ${y}, ${weekday}`;
}
