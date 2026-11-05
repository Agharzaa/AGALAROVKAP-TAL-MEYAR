/**
 * Audit 3 (developer / security, boundaries). Every test states the CORRECT behaviour; a failing
 * test is a confirmed defect. Made-up data only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { readSheet, SheetError } from '../../src/renderer/sheet-reader.js';
import { maskPath, shapeOf } from '../../src/main/dvx-api-policy.js';

const dom = new JSDOM('');
(globalThis as { DOMParser?: unknown }).DOMParser = dom.window.DOMParser;

/** A tiny stored .xlsx (no compression, CRC left at zero: the reader does not look at it). */
function zip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const names = Object.keys(files);
  for (const n of names) {
    const raw = enc.encode(files[n]!);
    const name = enc.encode(n);
    const l = new DataView(new ArrayBuffer(30));
    l.setUint32(0, 0x04034b50, true);
    l.setUint32(18, raw.length, true);
    l.setUint32(22, raw.length, true);
    l.setUint16(26, name.length, true);
    parts.push(new Uint8Array(l.buffer), name, raw);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint32(20, raw.length, true);
    c.setUint32(24, raw.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + raw.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, names.length, true);
  e.setUint16(10, names.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
const sheet = (body: string) =>
  zip({
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`,
  });
const cell = (ref: string) => `<c r="${ref}" t="inlineStr"><is><t>x</t></is></c>`;

test('audit: a row number beyond Excel’s limit is refused, not allocated', async () => {
  const bytes = sheet(`<row r="2000000">${cell('A2000000')}</row>`);
  await assert.rejects(readSheet('a.xlsx', bytes), SheetError);
});

test('audit: a column beyond Excel’s limit (XFD) is refused, not allocated', async () => {
  const bytes = sheet(`<row r="1">${cell('ZZZZ1')}</row>`);
  await assert.rejects(readSheet('a.xlsx', bytes), SheetError);
});

test('audit: a sheet whose XML does not parse is refused, not read as fewer rows', async () => {
  const bytes = zip({
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cell('A1')}</row><row r="2"><c r="A2" t="inlineStr"><is><t>A & B</t></is></c></row></sheetData></worksheet>`,
  });
  await assert.rejects(readSheet('a.xlsx', bytes), SheetError);
});

test('audit: a zip whose central directory points outside the file is a SheetError', async () => {
  const good = sheet(`<row r="1">${cell('A1')}</row>`);
  const bad = good.slice();
  const view = new DataView(bad.buffer);
  view.setUint32(bad.length - 22 + 16, bad.length + 100, true);
  await assert.rejects(readSheet('a.xlsx', bad), SheetError);
});

test('audit: DVX diagnostics keep no name under a key that only contains a code word', () => {
  const text = JSON.stringify(
    shapeOf({
      privateEntrepreneurName: 'Ağalarov',
      communityName: 'Sumqayıt',
      resourceOwner: 'Məmmədov',
    }),
  );
  for (const secret of ['Ağalarov', 'Sumqayıt', 'Məmmədov'])
    assert.equal(text.includes(secret), false, `${secret} in the diagnostics file: ${text}`);
});

test('audit: a broken percent escape in a portal path does not break the masking', () => {
  assert.doesNotThrow(() => maskPath('https://new.e-taxes.gov.az/api/po/a/100%zz'));
});

// ---- source inspection: these run only inside Electron or a real time zone --------------------
const source = (file: string) => readFileSync(file, 'utf8');

test('audit: document history and the audit list show local time, not the UTC of the stored moment', () => {
  for (const file of [
    'src/renderer/pages/bank-editor.tsx',
    'src/renderer/pages/cash.tsx',
    'src/renderer/pages/invoice-editor.tsx',
    'src/renderer/pages/operation-editor.tsx',
    'src/renderer/pages/settings.tsx',
    'src/renderer/pages/rates.tsx',
  ])
    assert.doesNotMatch(
      source(file),
      /\.(at|loadedAt)\.slice\(0, 10\)/,
      `${file} cuts a UTC timestamp: in Baku it is 4 hours behind, the day wrong until 04:00`,
    );
});

test('audit: a new contract’s default date is the local day', () => {
  assert.doesNotMatch(
    source('src/renderer/pages/partners.tsx'),
    /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/,
  );
});

test('audit: the note of a settled e-qaimə conflict carries the local day', () => {
  assert.doesNotMatch(source('src/application/eqaime.ts'), /clock\.now\(\)\.slice\(0, 10\)/);
});

test('audit: the update handlers exist before the page that calls them is loaded', () => {
  const text = source('src/main/window.ts');
  const load = text.indexOf('await window.loadFile');
  const handler = text.indexOf("handle('meyar:update-state'");
  assert.ok(load > 0 && handler > 0);
  assert.ok(handler < load, 'App.tsx calls updateState on mount: "No handler registered"');
});

test('audit: a crashed renderer is not left as a blank window', () => {
  assert.match(source('src/main/window.ts'), /render-process-gone/);
});

test('audit: engines names a Node that has node:sqlite with backup (22.16 or later)', () => {
  const engines = (JSON.parse(source('package.json')) as { engines: { node: string } }).engines;
  const [major, minor] = /(\d+)\.(\d+)/.exec(engines.node)!.slice(1).map(Number) as [
    number,
    number,
  ];
  assert.ok(major > 22 || (major === 22 && minor >= 16), engines.node);
});

test('audit: two pushes cannot publish their releases out of order', () => {
  assert.match(source('.github/workflows/windows.yml'), /^concurrency:/m);
});
