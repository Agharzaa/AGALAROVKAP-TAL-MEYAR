/**
 * Reads the first sheet of a bank's export into rows of text, without external libraries:
 * CSV/TXT directly, XLSX by unzipping it (DecompressionStream) and reading the sheet XML.
 * Old binary .xls files are not readable here; the user re-saves them as .xlsx or .csv.
 */
import { readCsv } from '../domain/statement';

export class SheetError extends Error {}

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('�')) return utf8;
  // Older Azerbaijani bank exports use the Turkish (ə→?) or Cyrillic code pages.
  const tr = new TextDecoder('windows-1254').decode(bytes);
  const ru = new TextDecoder('windows-1251').decode(bytes);
  const cyrillic = (ru.match(/[Ѐ-ӿ]/g) ?? []).length;
  return cyrillic > ru.length / 20 ? ru : tr;
}

interface ZipEntry {
  name: string;
  method: number;
  offset: number;
  size: number;
}
function zipEntries(bytes: Uint8Array): ZipEntry[] {
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
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new SheetError('Excel faylı zədələnib.');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const extra = view.getUint16(p + 30, true);
    const comment = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    entries.push({ name, method, size, offset: local + 30 + localName + localExtra });
    p += 46 + nameLength + extra + comment;
  }
  return entries;
}
async function unzip(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const raw = bytes.subarray(entry.offset, entry.offset + entry.size);
  if (entry.method === 0) return new TextDecoder().decode(raw);
  if (entry.method !== 8) throw new SheetError('Excel faylının sıxılma üsulu tanınmadı.');
  const stream = new Blob([raw.slice()])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const columnIndex = (ref: string) =>
  [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const entries = zipEntries(bytes);
  const find = (name: string) => entries.find((e) => e.name === name);
  const xml = (text: string) => new DOMParser().parseFromString(text, 'application/xml');
  // The first sheet in workbook order, resolved through the workbook relationships.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = find('xl/workbook.xml');
  const rels = find('xl/_rels/workbook.xml.rels');
  if (workbook && rels) {
    const first = xml(await unzip(bytes, workbook)).getElementsByTagName('sheet')[0];
    const rid =
      first?.getAttribute('r:id') ??
      first?.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      );
    const target = [...xml(await unzip(bytes, rels)).getElementsByTagName('Relationship')]
      .find((r) => r.getAttribute('Id') === rid)
      ?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }
  const sheet =
    find(sheetPath) ?? entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
  if (!sheet) throw new SheetError('Excel faylında vərəq tapılmadı.');
  const sharedEntry = find('xl/sharedStrings.xml');
  const shared = sharedEntry
    ? [...xml(await unzip(bytes, sharedEntry)).getElementsByTagName('si')].map((si) =>
        [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''),
      )
    : [];
  const rows: string[][] = [];
  for (const row of xml(await unzip(bytes, sheet)).getElementsByTagName('row')) {
    const index = Number(row.getAttribute('r') ?? rows.length + 1) - 1;
    const cells: string[] = [];
    for (const c of row.getElementsByTagName('c')) {
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const text =
        type === 's'
          ? (shared[Number(v)] ?? '')
          : type === 'inlineStr'
            ? [...c.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('')
            : v;
      const ref = c.getAttribute('r');
      cells[ref ? columnIndex(ref) : cells.length] = text;
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
