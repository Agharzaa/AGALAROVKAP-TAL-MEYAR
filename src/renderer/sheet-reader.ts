/**
 * Reads the first sheet of a bank's export into rows of text, without external libraries:
 * CSV/TXT directly, XLSX by unzipping it (DecompressionStream) and reading the sheet XML.
 * Old binary .xls files are not readable here; the user re-saves them as .xlsx or .csv.
 */
import { readCsv } from '../domain/statement.js';

export class SheetError extends Error {}

/** Azerbaijani Latin letters outside ASCII (cp1254 has all of them but ə). */
const AZ_LETTERS = /[əƏşŞçÇğĞıİöÖüÜ]/;
const NOT_AZ_LATIN = /[^\x00-\x7fəƏşŞçÇğĞıİöÖüÜ]/;
/**
 * How much a decoding looks like real text: words of one script count for it; words mixing
 * Latin and Cyrillic letters, or Latin words with letters Azerbaijani does not use ("Ïëàòåæ"
 * is Russian read as cp1254), count against it.
 */
function textScore(text: string, cyrillic: boolean): number {
  let score = 0;
  for (const word of text.match(/\p{L}+/gu) ?? []) {
    if (cyrillic) {
      if (/[Ѐ-ӿ]/.test(word)) score += /[A-Za-z]/.test(word) ? -1 : 1;
    } else if (NOT_AZ_LATIN.test(word)) score -= 1;
    else if (AZ_LETTERS.test(word)) score += 1;
  }
  return score;
}

function decodeText(bytes: Uint8Array): string {
  // Excel's "Unicode Text" export is UTF-16 with a byte order mark.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('�')) return utf8;
  // Older Azerbaijani bank exports use the Turkish (ə→?) or Cyrillic code pages. Every high
  // byte is a Cyrillic letter in cp1251, so the share of Cyrillic letters proves nothing: the
  // decoding whose words look like words wins.
  const tr = new TextDecoder('windows-1254').decode(bytes);
  const ru = new TextDecoder('windows-1251').decode(bytes);
  return textScore(ru, true) > textScore(tr, false) ? ru : tr;
}

/** An .xlsx bigger than this when unpacked is refused (a bank statement is a few MB). */
const MAX_UNPACKED = 100 * 1024 * 1024;
/** A part that packs better than this is padding, not a sheet (real sheets pack ~10–30:1). */
const MAX_RATIO = 200;
const tooBig = () =>
  new SheetError('Excel faylı açılanda çox böyükdür (zip bombası ola bilər) — oxunmur.');

interface ZipEntry {
  name: string;
  method: number;
  offset: number;
  size: number;
  /** The unpacked size the archive declares (it may lie: inflating counts again). */
  unpacked: number;
}
function zipEntries(bytes: Uint8Array): ZipEntry[] {
  try {
    return readZipDirectory(bytes);
  } catch (e) {
    // An offset outside the file: the bytes are not what the directory says.
    if (e instanceof RangeError) throw new SheetError('Excel faylı zədələnib.');
    throw e;
  }
}
function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new SheetError('Fayl Excel (.xlsx) deyil.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new SheetError('Excel faylı zədələnib.');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const unpacked = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extra = view.getUint16(p + 30, true);
    const comment = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    total += unpacked;
    if (total > MAX_UNPACKED) throw tooBig();
    entries.push({ name, method, size, unpacked, offset: local + 30 + localName + localExtra });
    p += 46 + nameLength + extra + comment;
  }
  return entries;
}
async function unzip(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const raw = bytes.subarray(entry.offset, entry.offset + entry.size);
  if (entry.method === 0) return new TextDecoder().decode(raw);
  if (entry.method !== 8) throw new SheetError('Excel faylının sıxılma üsulu tanınmadı.');
  // Inflate at most what a real sheet of this packed size can hold, whatever the archive says.
  const limit = Math.min(MAX_UNPACKED, Math.max(entry.size * MAX_RATIO, 1024 * 1024));
  if (entry.unpacked > limit) throw tooBig();
  const reader = new Blob([raw.slice()])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(out);
}

const columnIndex = (ref: string) =>
  [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Elements by local name, with or without a namespace prefix ("x:row" of OpenXML SDK files). */
const byName = (node: Document | Element, local: string) => [
  ...node.getElementsByTagNameNS('*', local),
];
/** Excel writes characters XML cannot hold as "_xHHHH_" ("_x000D_" is a carriage return). */
const unescapeExcel = (text: string) =>
  text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
const textOf = (node: Element) =>
  unescapeExcel(
    byName(node, 't')
      .map((t) => t.textContent ?? '')
      .join(''),
  );

const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;

async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const entries = zipEntries(bytes);
  const find = (name: string) => entries.find((e) => e.name === name);
  const xml = (text: string) => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    // A sheet that does not parse is refused: read on, it would be a statement with fewer rows.
    if (doc.getElementsByTagName('parsererror').length)
      throw new SheetError('Excel faylı zədələnib.');
    return doc;
  };
  // The first sheet in workbook order, resolved through the workbook relationships.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = find('xl/workbook.xml');
  const rels = find('xl/_rels/workbook.xml.rels');
  if (workbook && rels) {
    const first = byName(xml(await unzip(bytes, workbook)), 'sheet')[0];
    const rid =
      first?.getAttribute('r:id') ??
      first?.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      );
    const target = byName(xml(await unzip(bytes, rels)), 'Relationship')
      .find((r) => r.getAttribute('Id') === rid)
      ?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }
  const sheet =
    find(sheetPath) ?? entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
  if (!sheet) throw new SheetError('Excel faylında vərəq tapılmadı.');
  const sharedEntry = find('xl/sharedStrings.xml');
  const shared = sharedEntry ? byName(xml(await unzip(bytes, sharedEntry)), 'si').map(textOf) : [];
  const rows: string[][] = [];
  for (const row of byName(xml(await unzip(bytes, sheet)), 'row')) {
    const index = Number(row.getAttribute('r') ?? rows.length + 1) - 1;
    // Excel's own limits: the numbers come from the file and size the arrays below.
    if (!Number.isInteger(index) || index < 0 || index >= MAX_ROWS)
      throw new SheetError('Excel faylı zədələnib.');
    const cells: string[] = [];
    for (const c of byName(row, 'c')) {
      const type = c.getAttribute('t');
      const v = byName(c, 'v')[0]?.textContent ?? '';
      const text = type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? textOf(c) : v;
      const ref = c.getAttribute('r');
      const column = ref ? columnIndex(ref) : cells.length;
      if (column >= MAX_COLUMNS) throw new SheetError('Excel faylı zədələnib.');
      cells[column] = text;
    }
    rows[index] = Array.from(cells, (x) => x ?? '');
  }
  return Array.from(rows, (r) => r ?? []);
}

export async function readSheet(name: string, bytes: Uint8Array): Promise<string[][]> {
  const lower = name.toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (lower.endsWith('.xlsx') || isZip) return readXlsx(bytes);
  if (lower.endsWith('.xls') || (bytes[0] === 0xd0 && bytes[1] === 0xcf))
    throw new SheetError(
      'Köhnə .xls formatı oxunmur. Faylı Excel-də açıb “.xlsx” və ya “CSV” kimi saxlayın.',
    );
  return readCsv(decodeText(bytes));
}
