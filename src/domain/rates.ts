/**
 * Official AMB (Central Bank of Azerbaijan) exchange rates (stage 5b; QERARLAR 2026-10-17 §4).
 * cbar.az publishes one XML file a day, https://www.cbar.az/currencies/DD.MM.YYYY.xml:
 *
 *   <ValCurs Date="17.10.2026" …>
 *     <ValType Type="Xarici valyutalar">
 *       <Valute Code="USD"><Nominal>1</Nominal><Name>1 ABŞ dolları</Name><Value>1.7</Value></Valute>
 *
 * A rate is kept per one unit with 4 decimals; a nominal of 100 (e.g. 100 JPY) is divided out.
 * Only the currencies Meyar keeps accounts in are read.
 */
import { currencies, type CurrencyCode } from './chart.js';
import { DomainError } from './errors.js';
import { roundHalfAwayFromZero } from './money.js';
import { PRICE_SCALE } from './quantity.js';

export interface AmbFile {
  /** ISO date the file is for. */
  date: string;
  rates: { currency: CurrencyCode; /** per one unit, PRICE_SCALE */ rate: bigint }[];
}

export const ambUrl = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-');
  return `https://www.cbar.az/currencies/${d}.${m}.${y}.xml`;
};

/** "1.7" / "0,0123" / "1.70250" → value × 10^scale, exactly (no float). */
function decimal(text: string, scale: number): bigint {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) throw new DomainError(`AMB faylında rəqəm oxunmadı: "${text}".`);
  const [w, f = ''] = t.split('.');
  return (
    BigInt(w! + f.padEnd(scale, '0').slice(0, scale)) +
    (f.length > scale && Number(f[scale]) >= 5 ? 1n : 0n)
  );
}

export function parseAmbXml(xml: string): AmbFile {
  const head = /<ValCurs\b[^>]*\bDate="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!head) throw new DomainError('Bu fayl AMB-nin məzənnə faylı deyil (ValCurs Date yoxdur).');
  const date = `${head[3]}-${head[2]}-${head[1]}`;
  const known = new Set<string>(currencies);
  const rates: AmbFile['rates'] = [];
  for (const m of xml.matchAll(/<Valute\b[^>]*\bCode="([A-Z]{3})"[^>]*>([\s\S]*?)<\/Valute>/g)) {
    const code = m[1]!;
    if (!known.has(code)) continue;
    const nominal = /<Nominal>\s*([\d.,]+)/.exec(m[2]!)?.[1];
    const value = /<Value>\s*([\d.,]+)\s*<\/Value>/.exec(m[2]!)?.[1];
    if (!nominal || !value) continue;
    // value / nominal with 4 decimals: both read with 8 decimals, then divided and rounded.
    const v = decimal(value, 8);
    const n = decimal(nominal, 8);
    if (n <= 0n || v <= 0n) continue;
    const rate = roundHalfAwayFromZero(v * PRICE_SCALE, n);
    if (rate > 0n) rates.push({ currency: code as CurrencyCode, rate });
  }
  if (!rates.length)
    throw new DomainError(
      `AMB faylında (${head[1]}.${head[2]}.${head[3]}) valyuta məzənnəsi tapılmadı.`,
    );
  return { date, rates };
}

/** Last day of a "YYYY-MM" month, ISO. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}
