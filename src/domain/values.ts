/** Input-boundary value rules shared by every command. */
import { DomainError } from './errors.js';

/** ISO calendar date YYYY-MM-DD within 2000–2099; impossible dates (31.02) are refused. */
export function parseDate(value: unknown, field = 'Tarix'): string {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value))
    throw new DomainError(`${field} düzgün deyil (İİİİ-AA-GG, 2000–2099).`, field);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value)
    throw new DomainError(`${field} təqvimdə yoxdur.`, field);
  return value;
}

/** VÖEN: exactly 10 digits; leading zeros are significant. */
export function parseTaxId(value: unknown, field = 'VÖEN'): string {
  if (typeof value !== 'string') throw new DomainError(`${field} yazılmayıb.`, field);
  const text = value.replace(/\s/g, '');
  if (!/^\d{10}$/.test(text))
    throw new DomainError(`${field} 10 rəqəmdən ibarət olmalıdır.`, field);
  return text;
}

export function parseText(value: unknown, field: string, max = 240, required = true): string {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new DomainError(`${field} düzgün deyil.`, field);
  const text = value.trim().replace(/\s+/g, ' ');
  if (required && !text) throw new DomainError(`${field} doldurulmalıdır.`, field);
  if (text.length > max) throw new DomainError(`${field} ən çox ${max} simvol ola bilər.`, field);
  return text;
}

/**
 * Document numbers are compared in a normalized form: whitespace removed and upper case, with
 * every form of the letter i (i, ı, İ, I) folded to "I" so Azerbaijani and Latin keyboards agree.
 * "mt 0001", "MT0001" and "mt0001" are the same document number; so are "inv-1" and "İNV-1".
 */
export function numberKey(number: string): string {
  return number.replace(/\s+/g, '').replace(/[iıİ]/g, 'I').toUpperCase();
}

/** Case-insensitive search key that treats i/ı/İ/I alike. */
export function searchKey(text: string): string {
  return text.replace(/[İI]/g, 'i').replace(/ı/g, 'i').toLowerCase();
}
