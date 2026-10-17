/**
 * An amount in Azerbaijani words, as a cash order prints it ("məbləğ yazı ilə"):
 * 1 234,50 AZN → "Min iki yüz otuz dörd manat 50 qəpik".
 */
import type { Minor } from './money.js';

const ones = ['', 'bir', 'iki', 'üç', 'dörd', 'beş', 'altı', 'yeddi', 'səkkiz', 'doqquz'];
const tens = ['', 'on', 'iyirmi', 'otuz', 'qırx', 'əlli', 'altmış', 'yetmiş', 'səksən', 'doxsan'];
const scales = ['', 'min', 'milyon', 'milyard', 'trilyon'];

/** 0 < n < 1000; "bir yüz" is said "yüz". */
function triple(n: number): string[] {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  return [
    ...(h ? (h === 1 ? ['yüz'] : [ones[h]!, 'yüz']) : []),
    ...(t ? [tens[t]!] : []),
    ...(o ? [ones[o]!] : []),
  ];
}

export function integerWords(value: bigint): string {
  if (value === 0n) return 'sıfır';
  const words: string[] = [];
  let n = value < 0n ? -value : value;
  const groups: number[] = [];
  while (n > 0n) {
    groups.push(Number(n % 1000n));
    n /= 1000n;
  }
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (!g) continue;
    // "bir min" is said "min".
    if (i === 1 && g === 1) words.push('min');
    else words.push(...triple(g), ...(scales[i] ? [scales[i]!] : []));
  }
  return (value < 0n ? 'mənfi ' : '') + words.join(' ');
}

const units: Record<string, [string, string]> = {
  AZN: ['manat', 'qəpik'],
  USD: ['ABŞ dolları', 'sent'],
  EUR: ['avro', 'sent'],
  RUB: ['rubl', 'qəpik'],
  GBP: ['funt sterlinq', 'pens'],
  TRY: ['türk lirəsi', 'quruş'],
};

export function amountInWords(amount: Minor, currency = 'AZN'): string {
  const [major, minor] = units[currency] ?? [currency, '/100'];
  const abs = amount < 0n ? -amount : amount;
  const whole = integerWords(amount < 0n ? -(abs / 100n) : abs / 100n);
  const cents = String(abs % 100n).padStart(2, '0');
  const text = `${whole} ${major} ${cents} ${minor}`;
  return text.charAt(0).toLocaleUpperCase('az') + text.slice(1);
}
