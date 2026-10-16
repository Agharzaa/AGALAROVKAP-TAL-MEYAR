/**
 * DVX e-qaimə reports (stage 4a; docs/MERHELE-4-EQAIME.md §2, §5).
 *
 * `readEqTable` turns the rows of an e-taxes.gov.az export into e-qaimə documents. Two reports
 * are read: "Qaimələr üzrə" (one row per e-qaimə: totals and VAT bases) and "Mallar üzrə" (one
 * row per goods line, the e-qaimə repeated on each). The header row is found by the words DVX
 * prints, so the column order does not matter.
 *
 * The column words come from the DVX export read by Meyar ERP v1.17 and are NOT yet checked
 * against a current real file (§11 sual 1): whatever is not recognised is reported, never
 * guessed. Statuses are normalised strictly — an unrecognised status is `unknown`, never
 * "accepted" (QERARLAR 2026-10-15, mərhələ 4 §6).
 */
import { formatMinor, type Minor } from './money.js';
import { readStatementAmount, readStatementDate } from './statement.js';
import { numberKey } from './values.js';

export type EqDirection = 'sale' | 'purchase';
export type EqReport = 'invoices' | 'goods';
export type EqKind = 'main' | 'correction' | 'return' | 'advance' | 'other';
export type EqStatus = 'accepted' | 'pending' | 'cancelled' | 'corrected' | 'rejected' | 'unknown';

/** A goods line as DVX printed it; amounts are canonical decimals (minor units as text). */
export interface EqLine {
  code: string;
  name: string;
  unit: string;
  quantity: string;
  price: string;
  net: string;
  vat: string;
  /** "18", "0", "exempt", "nontaxable" or "" when the report does not say. */
  vatRate: string;
}

export interface EqDocumentInput {
  /** 1-based sheet row (the first row of the e-qaimə in a goods report). */
  row: number;
  number: string;
  date: string;
  /** VÖEN of the other side when the report prints one column. */
  taxId: string;
  name: string;
  /** Both sides, when the report prints them: they prove the file's direction. */
  sellerTaxId: string;
  buyerTaxId: string;
  sellerName: string;
  buyerName: string;
  kind: string;
  status: string;
  /** The e-qaimə a correction refers to. */
  refNumber: string;
  net: string;
  vat: string;
  total: string;
  base18: string;
  base0: string;
  baseExempt: string;
  baseNontaxable: string;
  excise: string;
  roadTax: string;
  note: string;
  /** Goods report only. */
  lines?: EqLine[];
}

export interface EqReadResult {
  report?: EqReport;
  documents: EqDocumentInput[];
  problems: { row: number; message: string }[];
  /** Recognised columns, for the preview. */
  columns: Partial<Record<Column, string>>;
  /** Direction named in the title block or sheet ("Gələnlər" / "Göndərilənlər"). */
  directionHint?: EqDirection;
  from?: string;
  to?: string;
}

type Column =
  | 'kind'
  | 'series'
  | 'number'
  | 'date'
  | 'taxId'
  | 'name'
  | 'sellerTaxId'
  | 'buyerTaxId'
  | 'sellerName'
  | 'buyerName'
  | 'status'
  | 'refNumber'
  | 'net'
  | 'vat'
  | 'total'
  | 'base18'
  | 'base0'
  | 'baseExempt'
  | 'baseNontaxable'
  | 'excise'
  | 'roadTax'
  | 'note'
  | 'extraNote'
  | 'goodsCode'
  | 'goodsName'
  | 'unit'
  | 'quantity'
  | 'price'
  | 'lineNet'
  | 'lineVat'
  | 'vatRate'
  | 'advance';

/**
 * Folds a header or label to plain Latin lower case: ə→e, ö→o, ü→u, ğ→g, ç→c, ş→s, every i → i,
 * punctuation → space. DVX exports and their re-saves do not always keep the letters.
 */
export function foldKey(text: string): string {
  return text
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .replace(/ə/g, 'e')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ğ/g, 'g')
    .replace(/ç/g, 'c')
    .replace(/ş/g, 's')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

const headerWords: Record<Column, string[]> = {
  kind: ['qaimə/akt növləri', 'qaimə növü', 'qaimənin növü', 'sənədin növü', 'növü', 'növ'],
  series: ['seriya', 'qaimə seriyası', 'seriyası'],
  number: [
    'nömrə',
    'nömrəsi',
    'qaimə nömrəsi',
    'qaimənin nömrəsi',
    'seriya və nömrə',
    'seriya və nömrəsi',
    'e-qaimə nömrəsi',
  ],
  date: ['tarix', 'qaimə tarixi', 'qaimənin tarixi', 'təqdim edilmə tarixi', 'tarixi'],
  taxId: ['vöen', 'vergi ödəyicisinin vöen-i', 'vergi ödəyicisinin eyniləşdirmə nömrəsi'],
  name: ['adı', 'ad', 'vergi ödəyicisinin adı', 'kontragent', 'təşkilatın adı'],
  sellerTaxId: [
    'satıcının vöen-i',
    'satıcının vöeni',
    'satıcı vöen',
    'göndərənin vöen-i',
    'göndərən vöen',
  ],
  buyerTaxId: [
    'alıcının vöen-i',
    'alıcının vöeni',
    'alıcı vöen',
    'qəbul edənin vöen-i',
    'qəbul edən vöen',
  ],
  sellerName: ['satıcının adı', 'satıcı', 'göndərənin adı'],
  buyerName: ['alıcının adı', 'alıcı', 'qəbul edənin adı'],
  status: ['vəziyyəti', 'vəziyyət', 'status', 'statusu', 'qaimənin vəziyyəti'],
  refNumber: [
    'düzəliş edilən qaimə',
    'düzəliş edilən qaimənin nömrəsi',
    'əsas qaimənin nömrəsi',
    'əsas qaimə',
    'istinad qaimə',
  ],
  net: [
    'malın ədv-siz ümumi dəyəri',
    'malların ədv-siz ümumi dəyəri',
    'ədv-siz ümumi dəyəri',
    'ədv-siz məbləğ',
    'ədv-siz cəmi',
  ],
  vat: ['malın ədv məbləği', 'malların ədv məbləği', 'ədv məbləği', 'ədv'],
  total: ['yekun məbləğ', 'yekun', 'ümumi məbləğ', 'cəmi məbləğ', 'ödəniləcək məbləğ'],
  base18: ['ədv-yə cəlb edilən', 'ədv-yə cəlb olunan', '18% dərəcə ilə ədv-yə cəlb edilən'],
  base0: ['ədv-yə 0 dərəcə ilə cəlb edilən', 'ədv-yə "0" dərəcə ilə cəlb edilən', '0 dərəcə'],
  baseExempt: ['ədv-dən azad olan', 'ədv-dən azad edilən', 'ədv-dən azad'],
  baseNontaxable: ['ədv-yə cəlb edilməyən', 'ədv-yə cəlb olunmayan'],
  excise: ['aksiz məbləği', 'aksiz'],
  roadTax: ['yol vergisi', 'yol vergisinin məbləği'],
  note: ['əsas qeyd', 'qeyd'],
  extraNote: ['əlavə qeyd'],
  goodsCode: ['malın kodu', 'məhsulun kodu', 'mal kodu', 'kodu', 'kod'],
  goodsName: ['malın adı', 'məhsulun adı', 'malın (işin, xidmətin) adı', 'mal adı'],
  unit: ['ölçü vahidi', 'vahid'],
  quantity: ['miqdarı', 'miqdar', 'həcmi'],
  price: ['vahidin qiyməti', 'qiyməti', 'qiymət', 'vahid qiyməti'],
  lineNet: ['malın dəyəri', 'malın ümumi dəyəri', 'dəyəri', 'cəmi'],
  lineVat: ['ədv məbləği (sətir)', 'sətir ədv'],
  vatRate: ['ədv dərəcəsi', 'ədv-nin dərəcəsi', 'dərəcə'],
  // Read only so that they are not taken for the e-qaimə's own number or amount.
  advance: ['avans nömrəsi', 'avans seriyası', 'avans seriası', 'avans məbləği'],
};

const folded = Object.fromEntries(
  Object.entries(headerWords).map(([c, words]) => [c, words.map(foldKey)]),
) as Record<Column, string[]>;

/**
 * Best column for a header cell: an exact match wins over a prefix, a prefix over a substring;
 * among equals the longer word (the more specific header) wins, so "ƏDV-yə cəlb edilməyən" is
 * never read as "ƏDV-yə cəlb edilən".
 */
function matchColumn(cell: string): Column | undefined {
  const text = foldKey(cell);
  if (!text) return undefined;
  let best: { column: Column; score: number } | undefined;
  for (const [column, words] of Object.entries(folded) as [Column, string[]][])
    for (const word of words) {
      const short = word.length <= 4;
      const level =
        text === word
          ? 3
          : text.startsWith(`${word} `) || (!short && text.startsWith(word))
            ? 2
            : !short && text.includes(word)
              ? 1
              : 0;
      const score = level * 1000 + word.length;
      if (level && (!best || score > best.score)) best = { column, score };
    }
  return best?.column;
}

function findHeader(rows: readonly string[][]) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const map = new Map<Column, number>();
    rows[i]!.forEach((cell, c) => {
      const column = matchColumn(String(cell ?? ''));
      if (column && !map.has(column)) map.set(column, c);
    });
    const hasNumber = map.has('number');
    const hasTax = map.has('taxId') || map.has('sellerTaxId') || map.has('buyerTaxId');
    if (hasNumber && hasTax && map.has('date')) return { index: i, map };
  }
  return undefined;
}

/** "Gələnlər" / "Göndərilənlər" in the title block or sheet name. */
export function directionFromText(text: string): EqDirection | undefined {
  const t = foldKey(text);
  const sale = /\b(gonderilen(ler)?|gonderdiklerim|gonderilmis|satis)\b/.test(t);
  const purchase = /\b(gelen(ler)?|daxil olan(lar)?|alis)\b/.test(t);
  return sale === purchase ? undefined : sale ? 'sale' : 'purchase';
}

/** DVX status text → status. Order matters: "ləğv edildi" beats any "təsdiq" in the same text. */
export function eqStatus(text: string): EqStatus {
  const t = foldKey(text);
  if (!t) return 'unknown';
  if (/\blegv\b/.test(t)) return 'cancelled';
  if (/\bimtina\b/.test(t) || /\brədd\b/.test(t) || /\bredd\b/.test(t)) return 'rejected';
  if (/\bduzelis\b/.test(t)) return 'corrected';
  if (/\b(gozl|gonderil|qaralama|baxilir|imzalanmayib)/.test(t)) return 'pending';
  if (/\btesdiq(lendi|lenib|lenmis)\b/.test(t)) return 'accepted';
  return 'unknown';
}

/** "Qaimə/Akt növləri" → kind. An empty cell is an ordinary e-qaimə. */
export function eqKind(text: string): EqKind {
  const t = foldKey(text);
  if (!t) return 'main';
  if (/\bduzelis/.test(t)) return 'correction';
  if (/\bqaytar/.test(t)) return 'return';
  if (/\bavans/.test(t)) return 'advance';
  if (/\b(esas|adi|standart|qaime|akt|faktura|elektron)\b/.test(t)) return 'main';
  return 'other';
}

/** One e-qaimə number as printed: the series joined in front unless already there. */
export function eqNumber(series: string, number: string): string {
  const s = series.replace(/\s+/g, '').toUpperCase();
  const n = number.replace(/\s+/g, '').toUpperCase();
  return s && !numberKey(n).startsWith(numberKey(s)) ? `${s}${n}` : n;
}

const cell = (row: readonly string[], i: number | undefined) =>
  i === undefined ? '' : String(row[i] ?? '').trim();

/** Amount cell → canonical decimal; empty stays empty, unreadable throws. */
function amount(text: string, what: string): string {
  if (!text) return '';
  const a = readStatementAmount(text);
  if (!a) throw new Error(`${what} oxunmadı: “${text}”`);
  return formatMinor(a.negative ? -a.amount : a.amount);
}

/** A decimal with up to `scale` places, as printed ("1 234,5678" → "1234.5678"). */
function decimal(text: string, scale: number, what: string): string {
  let t = text.replace(/[\s ']/g, '');
  if (!t) return '';
  const comma = t.lastIndexOf(',');
  const dot = t.lastIndexOf('.');
  if (comma >= 0 && dot >= 0)
    t = comma > dot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (comma >= 0) t = t.replace(',', '.');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) throw new Error(`${what} oxunmadı: “${text}”`);
  const frac = (m[2] ?? '').replace(/0+$/, '');
  if (frac.length > scale) throw new Error(`${what}: ən çox ${scale} onluq: “${text}”`);
  return frac ? `${m[1]}.${frac}` : m[1]!;
}

function vatRateOf(text: string): string {
  const t = foldKey(text);
  if (!t) return '';
  if (/\bazad\b/.test(t)) return 'exempt';
  if (/\bcelb (edilmeyen|olunmayan)\b/.test(t)) return 'nontaxable';
  if (/^18\b|^18%/.test(t) || t === '0 18') return '18';
  if (/^0\b|^0%/.test(t)) return '0';
  return text.trim();
}

const add = (a: string, b: string): string => formatMinor(minorOf(a) + minorOf(b));

/**
 * Reads a DVX report. `title` is the sheet name and file name: the direction may be printed
 * there rather than above the table.
 */
export function readEqTable(rows: readonly string[][], title = ''): EqReadResult {
  const header = findHeader(rows);
  const titleText = [title, ...rows.slice(0, header?.index ?? 10).map((r) => r.join(' '))].join(
    ' ',
  );
  const directionHint = directionFromText(titleText);
  if (!header)
    return {
      documents: [],
      problems: [
        {
          row: 0,
          message:
            'DVX hesabatının başlıq sətri tapılmadı (Nömrə, Tarix və VÖEN sütunları gözlənilir).',
        },
      ],
      columns: {},
      ...(directionHint ? { directionHint } : {}),
    };
  const { index, map } = header;
  const columns: Partial<Record<Column, string>> = {};
  for (const [c, i] of map) columns[c] = cell(rows[index]!, i);
  const report: EqReport = map.has('goodsName') && map.has('quantity') ? 'goods' : 'invoices';
  const problems: { row: number; message: string }[] = [];
  const byKey = new Map<string, EqDocumentInput>();
  const order: EqDocumentInput[] = [];
  const get = (row: readonly string[], c: Column) => cell(row, map.get(c));
  // Goods report: an e-qaimə with a line that cannot be read is not loaded at all — without that
  // line it would be a smaller e-qaimə than DVX's, and could be booked so.
  const broken = new Set<string>();

  for (let r = index + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const sheetRow = r + 1;
    if (!row.some((c) => String(c ?? '').trim())) continue;
    const number = eqNumber(get(row, 'series'), get(row, 'number'));
    // Totals ("Cəmi", "Yekun") and notes under the table carry no number.
    if (!number || /^(cemi|yekun|cem|total)/.test(foldKey(number))) continue;
    try {
      const dateText = get(row, 'date');
      const date = readStatementDate(dateText);
      if (!date) throw new Error(`tarix oxunmadı: “${dateText}”`);
      const tax = (c: Column) => get(row, c).replace(/\D/g, '');
      const sellerTaxId = tax('sellerTaxId');
      const buyerTaxId = tax('buyerTaxId');
      const taxId = tax('taxId');
      for (const [v, what] of [
        [taxId, 'VÖEN'],
        [sellerTaxId, 'satıcının VÖEN-i'],
        [buyerTaxId, 'alıcının VÖEN-i'],
      ] as const)
        if (v && v.length !== 10) throw new Error(`${what} 10 rəqəm deyil: “${v}”`);
      const note = [get(row, 'note'), get(row, 'extraNote')].filter(Boolean).join(' · ');
      let line: EqLine | undefined;
      if (report === 'goods') {
        const net = amount(get(row, 'lineNet') || get(row, 'net'), 'Malın dəyəri');
        const vat = amount(get(row, 'lineVat') || get(row, 'vat'), 'ƏDV');
        line = {
          code: get(row, 'goodsCode'),
          name: get(row, 'goodsName'),
          unit: get(row, 'unit'),
          quantity: decimal(get(row, 'quantity'), 6, 'Miqdar'),
          price: decimal(get(row, 'price'), 8, 'Qiymət'),
          net: net || '0.00',
          vat: vat || '0.00',
          vatRate: vatRateOf(get(row, 'vatRate')),
        };
        if (!line.name) throw new Error('malın adı yoxdur');
      }
      const key = `${sellerTaxId || buyerTaxId || taxId}|${numberKey(number)}|${sellerTaxId}|${buyerTaxId}`;
      const existing = byKey.get(key);
      if (existing && line) {
        existing.lines!.push(line);
        existing.net = add(existing.net, line.net);
        existing.vat = add(existing.vat, line.vat);
        existing.total = add(existing.net, existing.vat);
        continue;
      }
      if (existing) throw new Error(`e-qaimə ${number} faylda ikinci dəfədir`);
      const doc: EqDocumentInput = {
        row: sheetRow,
        number,
        date,
        taxId,
        name: get(row, 'name'),
        sellerTaxId,
        buyerTaxId,
        sellerName: get(row, 'sellerName'),
        buyerName: get(row, 'buyerName'),
        kind: get(row, 'kind'),
        status: get(row, 'status'),
        refNumber: eqNumber('', get(row, 'refNumber')),
        net: line ? line.net : amount(get(row, 'net'), 'ƏDV-siz məbləğ'),
        vat: line ? line.vat : amount(get(row, 'vat'), 'ƏDV'),
        total: '',
        base18: line ? '' : amount(get(row, 'base18'), 'ƏDV-yə cəlb edilən'),
        base0: line ? '' : amount(get(row, 'base0'), '0 dərəcə'),
        baseExempt: line ? '' : amount(get(row, 'baseExempt'), 'ƏDV-dən azad'),
        baseNontaxable: line ? '' : amount(get(row, 'baseNontaxable'), 'ƏDV-yə cəlb edilməyən'),
        excise: amount(get(row, 'excise'), 'Aksiz'),
        roadTax: amount(get(row, 'roadTax'), 'Yol vergisi'),
        note,
        ...(line ? { lines: [line] } : {}),
      };
      doc.total = line
        ? add(doc.net, doc.vat)
        : amount(get(row, 'total'), 'Yekun məbləğ') || add(doc.net, doc.vat);
      if (!doc.net && !line) throw new Error('ƏDV-siz məbləğ yoxdur');
      byKey.set(key, doc);
      order.push(doc);
    } catch (e) {
      problems.push({ row: sheetRow, message: (e as Error).message });
      if (report === 'goods') broken.add(numberKey(number));
    }
  }
  const documents = order.filter((d) => {
    if (!broken.has(numberKey(d.number))) return true;
    problems.push({
      row: d.row,
      message: `e-qaimə ${d.number}: mal sətri oxunmadı — e-qaimə yüklənmir (bütün sətirləri ilə gəlməlidir)`,
    });
    return false;
  });
  const dates = documents.map((d) => d.date).sort();
  return {
    report,
    documents,
    problems,
    columns,
    ...(directionHint ? { directionHint } : {}),
    ...(dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : {}),
  };
}

/** Minor units of a canonical decimal ("" → 0). */
export function minorOf(text: string): Minor {
  if (!text) return 0n;
  const negative = text.startsWith('-');
  const [w, f = ''] = text.replace('-', '').split('.');
  const v = BigInt(w!) * 100n + BigInt((f + '00').slice(0, 2));
  return negative ? -v : v;
}
