/**
 * Audit 2 (boundaries / parsers). Every test here states the CORRECT behaviour; a failing test is
 * a confirmed defect. Made-up data only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import {
  readCsv,
  readStatementAmount,
  readStatementDate,
  readStatementTable,
} from '../../src/domain/statement.js';
import { readEqTable } from '../../src/domain/eqaime.js';
import { readSheet } from '../../src/renderer/sheet-reader.js';
import { workbook } from '../../src/renderer/xlsx.js';

const dom = new JSDOM('');
(globalThis as { DOMParser?: unknown }).DOMParser = dom.window.DOMParser;

// ---- a tiny zip writer for hand-made .xlsx files (stored or deflated) ----------------------
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files: Record<string, string | Uint8Array>, deflate = false): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const names = Object.keys(files);
  for (const n of names) {
    const raw =
      typeof files[n] === 'string' ? enc.encode(files[n] as string) : (files[n] as Uint8Array);
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const name = enc.encode(n);
    const l = new DataView(new ArrayBuffer(30));
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(8, deflate ? 8 : 0, true);
    l.setUint32(14, crc32(raw), true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, raw.length, true);
    l.setUint16(26, name.length, true);
    parts.push(new Uint8Array(l.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(10, deflate ? 8 : 0, true);
    c.setUint32(16, crc32(raw), true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, raw.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, names.length, true);
  e.setUint16(10, names.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const a of all) (out.set(a, p), (p += a.length));
  return out;
}

// ---- D1: CSV with a title line above a comma-separated table -------------------------------
test('D1 readCsv: separator is detected from the table, not from a title line above it', () => {
  const csv =
    'Hesab çıxarışı\n' + 'Tarix,Mədaxil,Məxaric,Təyinat\n' + '05.10.2026,150.00,,Ödəniş\n';
  const rows = readCsv(csv);
  assert.deepEqual(rows[1], ['Tarix', 'Mədaxil', 'Məxaric', 'Təyinat']);
  const read = readStatementTable(rows);
  assert.equal(read.lines.length, 1);
});

// ---- D2: rows with an amount but a date format the reader does not know are lost silently --
test('D2 readStatementTable: an operation row with an unreadable date is reported, not dropped', () => {
  const rows = [
    ['Tarix', 'Mədaxil', 'Məxaric', 'Təyinat'],
    ['2026/10/05', '', '500,00', 'İcarə haqqı'],
    ['2026.10.06', '120,00', '', 'Satış'],
  ];
  const read = readStatementTable(rows);
  assert.equal(read.lines.length + read.problems.length, 2, JSON.stringify(read));
});

test('D2b readStatementDate: ISO-like year-first dates with / or . are read', () => {
  assert.equal(readStatementDate('2026/10/05'), '2026-10-05');
  assert.equal(readStatementDate('2026.10.05'), '2026-10-05');
});

// ---- D3: dot as thousands separator without decimals ---------------------------------------
test('D3 readStatementAmount: "1.234.567" and "12.500" read like "12,500" (thousands)', () => {
  // "12,345" is already treated as thousands; the dot form must not become 12.50 or fail.
  assert.equal(readStatementAmount('12,500')?.amount, 1_250_000n);
  assert.equal(readStatementAmount('1.234.567')?.amount, 123_456_700n);
});
// Decided (not adopted from the audit): a SINGLE dot stays the decimal point. Numbers read from
// .xlsx cells and machine-made CSV files are always written with a decimal dot ("1500.000",
// "12.5"), so reading "12.500" as 12 500 would multiply such amounts by 1000. Several dots are
// unambiguous and are read as thousands (D3 above).
test('D3b readStatementAmount: a single dot is the decimal point ("12.500" is 12,50)', () => {
  assert.equal(readStatementAmount('12.500')?.amount, 1_250n);
  assert.equal(readStatementAmount('1500.000')?.amount, 150_000n);
});

// ---- D4: a reversal printed as a negative credit becomes an incoming payment ---------------
test('D4 readStatementTable: a negative amount in the credit column is not money in', () => {
  const rows = [
    ['Tarix', 'Mədaxil', 'Məxaric', 'Təyinat'],
    ['05.10.2026', '-300,00', '', 'Storno: səhv mədaxil'],
  ];
  const read = readStatementTable(rows);
  assert.ok(
    read.lines.length === 0 || read.lines[0]!.direction === 'out',
    `booked as ${JSON.stringify(read.lines[0])}`,
  );
});

// ---- D5: Unicode minus (the app's own display form) ----------------------------------------
test('D5 readStatementAmount: U+2212 minus sign is a minus', () => {
  const a = readStatementAmount('−1 234,56');
  assert.deepEqual(a, { amount: 123_456n, negative: true });
});

// ---- D6: cp1254 Azerbaijani CSV mis-decoded as cp1251 ---------------------------------------
test('D6 readSheet: a Turkish-code-page (cp1254) Azerbaijani CSV is not decoded as Cyrillic', async () => {
  const map: Record<string, number> = {
    ç: 0xe7,
    ş: 0xfe,
    ğ: 0xf0,
    ı: 0xfd,
    ö: 0xf6,
    ü: 0xfc,
    Ö: 0xd6,
    Ç: 0xc7,
    Ş: 0xde,
    İ: 0xdd,
  };
  const text =
    'Tarix;Mədaxil;Məxaric;Təyinat\r\n'.replace(/ə/g, 'e') +
    '05.10.2026;;1200,00;Işçilərin əmək haqqı, gəlir vergisi, sığorta ödənişi\r\n'.replace(
      /ə/g,
      'e',
    ) +
    '06.10.2026;;35,00;Şöbə üçün dəftərxana, çap kağızı\r\n'.replace(/ə/g, 'e');
  const bytes = Uint8Array.from([...text].map((ch) => map[ch] ?? ch.charCodeAt(0)));
  const rows = await readSheet('cixaris.csv', bytes);
  assert.match(rows[1]![3]!, /işçiler/i, rows[1]![3]);
});

// ---- D7: UTF-16 LE text export (Excel "Unicode Text") ---------------------------------------
test('D7 readSheet: a UTF-16LE (BOM FF FE) tab-separated export is read', async () => {
  const text = 'Tarix\tMədaxil\tMəxaric\tTəyinat\r\n05.10.2026\t150,00\t\tÖdəniş\r\n';
  const body = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    body[i * 2] = text.charCodeAt(i) & 0xff;
    body[i * 2 + 1] = text.charCodeAt(i) >> 8;
  }
  const bytes = new Uint8Array([0xff, 0xfe, ...body]);
  const rows = await readSheet('cixaris.txt', bytes);
  assert.equal(readStatementTable(rows).lines.length, 1, JSON.stringify(rows[0]));
});

// ---- D8: XLSX written with a namespace prefix (OpenXML SDK style) ---------------------------
test('D8 readSheet: an .xlsx whose sheet uses the "x:" namespace prefix is read', async () => {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><x:worksheet xmlns:x="${ns}"><x:sheetData>
<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Tarix</x:t></x:is></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>Mədaxil</x:t></x:is></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>Təyinat</x:t></x:is></x:c></x:row>
<x:row r="2"><x:c r="A2"><x:v>46300</x:v></x:c><x:c r="B2"><x:v>150</x:v></x:c><x:c r="C2" t="inlineStr"><x:is><x:t>Ödəniş</x:t></x:is></x:c></x:row>
</x:sheetData></x:worksheet>`;
  const rows = await readSheet('bank.xlsx', zip({ 'xl/worksheets/sheet1.xml': sheet }));
  assert.equal(rows.length, 2, 'no rows read from a prefixed sheet');
});

// ---- D9: zip bomb — no cap on the inflated size --------------------------------------------
test('D9 readSheet: a small .xlsx that inflates to a huge sheet is refused', async () => {
  // 64 MB of padding inside one row compresses to ~64 KB; the reader inflates all of it.
  const pad = 'A'.repeat(64 * 1024 * 1024);
  const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${pad}</t></is></c></row></sheetData></worksheet>`;
  const file = zip({ 'xl/worksheets/sheet1.xml': sheet }, true);
  assert.ok(file.length < 1024 * 1024);
  await assert.rejects(readSheet('bomb.xlsx', file), 'a 1000:1 archive was fully inflated');
});

// ---- D10: Excel export with a control character in a text cell -----------------------------
test('D10 workbook: a control character in a text cell does not make the sheet XML invalid', async () => {
  const bytes = workbook({
    name: 'Kontragentlər',
    header: ['Ad', 'Məbləğ'],
    rows: [['MMC "Alfa"\u0001\u001f', { money: '10.00' }]],
  });
  // Our own reader unzips the file; the XML must parse.
  const text = new TextDecoder().decode(bytes);
  const xml = text.slice(text.indexOf('<worksheet'), text.indexOf('</worksheet>') + 12);
  const doc = new dom.window.DOMParser().parseFromString(xml, 'application/xml');
  assert.equal(
    doc.getElementsByTagName('parsererror').length,
    0,
    'invalid XML: Excel refuses the file',
  );
});

test('D10b workbook: a money cell that is not a number does not write <v>NaN</v>', () => {
  const bytes = workbook({ name: 'S', header: ['M'], rows: [[{ money: '1 234,50' }]] });
  assert.ok(!new TextDecoder().decode(bytes).includes('<v>NaN</v>'), 'sheet holds <v>NaN</v>');
});

test('ok workbook: text that looks like a formula is written as inline text, not a formula', () => {
  const bytes = workbook({ name: 'S', header: ['A'], rows: [['=HYPERLINK("http://x","y")']] });
  const t = new TextDecoder().decode(bytes);
  assert.doesNotMatch(t, /<f>/);
  assert.match(t, /t="inlineStr"/);
});

// ---- D11: e-qaimə goods report — quantities ------------------------------------------------
const goodsHeader = [
  'Seriya',
  'Nömrə',
  'Tarix',
  'Satıcının VÖEN-i',
  'Malın adı',
  'Miqdarı',
  'Qiyməti',
  'Malın dəyəri',
  'ƏDV',
];
test('D11 readEqTable: a correction line with a negative quantity is read, not dropped', () => {
  const rows = [
    goodsHeader,
    ['MT', '2610000001', '05.10.2026', '1234567890', 'Kağız A4', '-2', '10,00', '-20,00', '-3,60'],
  ];
  const read = readEqTable(rows, 'Gələnlər');
  assert.equal(read.documents.length, 1, JSON.stringify(read.problems));
});

test('D11b readEqTable: "1,000" means the same in the quantity and the amount column', () => {
  const rows = [
    goodsHeader,
    ['MT', '2610000002', '05.10.2026', '1234567890', 'Vint', '1,000', '1,00', '1,000', '180,00'],
  ];
  const read = readEqTable(rows, 'Gələnlər');
  const line = read.documents[0]?.lines?.[0];
  assert.ok(line, JSON.stringify(read.problems));
  // net 1,000 is read as 1000.00; the quantity must not be 1 then.
  assert.equal(line.net, '1000.00');
  assert.equal(line.quantity, '1000');
});

// ---- D12: Excel's _xHHHH_ escapes in shared strings (a cell with a line break re-saved by Excel)
test('D12 readSheet: "_x000D_" escapes in shared strings are decoded', async () => {
  const shared = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Tarix</t></si><si><t>Kontragent</t></si><si><t xml:space="preserve">AZ77PAHA00000000000000000001_x000D_
NUMUNE LLC_x000D_
BAKI</t></si></sst>`;
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>46300</v></c><c r="B2" t="s"><v>2</v></c></row></sheetData></worksheet>`;
  const rows = await readSheet(
    'bank.xlsx',
    zip({ 'xl/worksheets/sheet1.xml': sheet, 'xl/sharedStrings.xml': shared }),
  );
  const { splitCounterparty } = await import('../../src/domain/statement.js');
  const party = splitCounterparty(rows[1]![1]!);
  assert.deepEqual(
    { name: party.name, iban: party.iban },
    { name: 'NUMUNE LLC', iban: 'AZ77PAHA00000000000000000001' },
  );
});
