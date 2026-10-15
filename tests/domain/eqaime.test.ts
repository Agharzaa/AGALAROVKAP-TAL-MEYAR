/**
 * DVX report reader (stage 4a, E1). The reports below are SYNTHETIC: their column words follow
 * the DVX export read by Meyar ERP v1.17; a current real (anonymised) export is still awaited
 * from the user (docs/MERHELE-4-EQAIME.md §11 sual 1) and will be added here as a fixture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  directionFromText,
  eqKind,
  eqNumber,
  eqStatus,
  foldKey,
  readEqTable,
} from '../../src/domain/eqaime.js';

export const invoicesHeader = [
  '№',
  'Qaimə/Akt növləri',
  'Seriya',
  'Nömrə',
  'Tarix',
  'VÖEN',
  'Adı',
  'Malın ƏDV-siz ümumi dəyəri',
  'Malın ƏDV məbləği',
  'Yekun məbləğ',
  'ƏDV-yə cəlb edilən',
  'ƏDV-yə cəlb edilməyən',
  'ƏDV-dən azad olan',
  'ƏDV-yə "0" dərəcə ilə cəlb edilən',
  'Aksiz məbləği',
  'Yol vergisi',
  'Vəziyyəti',
  'Əsas qeyd',
  'Əlavə qeyd',
  'Avans Seriası',
  'Avans Nömrəsi',
  'Avans Məbləği',
];

test('E1: "Qaimələr üzrə" — header found under the title block, bases kept apart', () => {
  const rows = [
    ['Elektron qaimə-fakturalar — Gələnlər — Qaimələr üzrə'],
    ['Dövr: 01.09.2026 - 30.09.2026'],
    [],
    invoicesHeader,
    // prettier-ignore
    ['1', 'Əsas', 'MT', '2609001', '05.09.2026', '1111111111', 'Gilan Tekstil MMC', '1 000,00', '180,00', '1 180,00', '1 000,00', '', '', '', '', '', 'Təsdiqləndi', 'Parça', '', '', '', ''],
    // prettier-ignore
    ['2', 'Düzəliş qaiməsi', 'MT', '2609002', '46280', '2222222222', 'Azercell', '500', '0', '500', '', '200', '300', '', '', '', 'Sistem tərəfindən təsdiqləndi', '', 'əlavə', 'AV', '12', '50'],
    // prettier-ignore
    ['3', '', '', 'mt 2609003', 'sabah', '3333333333', 'X', '10', '1,8', '11,8', '10', '', '', '', '', '', 'Gözləyir', '', '', '', '', ''],
    ['', '', '', 'Cəmi', '', '', '', '1 510,00', '181,80', '1 691,80'],
  ];
  const r = readEqTable(rows, 'Gələnlər.xlsx');
  assert.equal(r.report, 'invoices');
  assert.equal(r.directionHint, 'purchase');
  assert.deepEqual(
    r.documents.map((d) => [d.number, d.date, d.taxId, d.net, d.vat, d.total, d.base18]),
    [
      ['MT2609001', '2026-09-05', '1111111111', '1000.00', '180.00', '1180.00', '1000.00'],
      ['MT2609002', '2026-09-15', '2222222222', '500.00', '0.00', '500.00', ''],
    ],
  );
  const second = r.documents[1]!;
  assert.deepEqual(
    [second.baseNontaxable, second.baseExempt, second.kind, second.note],
    ['200.00', '300.00', 'Düzəliş qaiməsi', 'əlavə'],
  );
  assert.deepEqual(r.problems, [{ row: 7, message: 'tarix oxunmadı: “sabah”' }]);
  assert.deepEqual([r.from, r.to], ['2026-09-05', '2026-09-15']);
  // The advance columns are recognised so that they are never read as the e-qaimə's own.
  assert.equal(r.columns.number, 'Nömrə');
});

test('E1: "Mallar üzrə" — rows grouped by e-qaimə, both VÖEN columns kept', () => {
  const header = [
    'Seriya',
    'Nömrə',
    'Tarix',
    'Satıcının VÖEN-i',
    'Satıcının adı',
    'Alıcının VÖEN-i',
    'Malın kodu',
    'Malın adı',
    'Ölçü vahidi',
    'Miqdarı',
    'Vahidin qiyməti',
    'Malın ƏDV-siz ümumi dəyəri',
    'ƏDV dərəcəsi',
    'Malın ƏDV məbləği',
    'Vəziyyəti',
  ];
  const rows = [
    ['Göndərilənlər'],
    header,
    // prettier-ignore
    ['MT', '2609100', '2026-09-10', '1234567890', 'Biz', '4444444444', '2710', 'Benzin A-95', 'litr', '100,5', '1,2345', '124,07', '18%', '22,33', 'Təsdiqləndi'],
    // prettier-ignore
    ['MT', '2609100', '2026-09-10', '1234567890', 'Biz', '4444444444', '', 'Daşınma', 'xidmət', '1', '50', '50,00', 'ƏDV-dən azad', '0', 'Təsdiqləndi'],
    // prettier-ignore
    ['MT', '2609101', '2026-09-11', '1234567890', 'Biz', '5555555555', '', 'Kağız', 'ədəd', '2', '10', '20', '18', '3,6', 'Təsdiqləndi'],
  ];
  const r = readEqTable(rows);
  assert.equal(r.report, 'goods');
  assert.equal(r.directionHint, 'sale');
  assert.equal(r.documents.length, 2);
  const [a, b] = r.documents;
  assert.deepEqual(
    [a!.number, a!.sellerTaxId, a!.buyerTaxId, a!.net, a!.vat, a!.total],
    ['MT2609100', '1234567890', '4444444444', '174.07', '22.33', '196.40'],
  );
  assert.deepEqual(a!.lines, [
    {
      code: '2710',
      name: 'Benzin A-95',
      unit: 'litr',
      quantity: '100.5',
      price: '1.2345',
      net: '124.07',
      vat: '22.33',
      vatRate: '18',
    },
    {
      code: '',
      name: 'Daşınma',
      unit: 'xidmət',
      quantity: '1',
      price: '50',
      net: '50.00',
      vat: '0.00',
      vatRate: 'exempt',
    },
  ]);
  assert.equal(b!.lines!.length, 1);
});

test('E1: no header → a clear problem, nothing guessed', () => {
  const r = readEqTable([
    ['Tarix', 'Məbləğ'],
    ['01.09.2026', '5'],
  ]);
  assert.equal(r.documents.length, 0);
  assert.match(r.problems[0]!.message, /başlıq sətri tapılmadı/);
});

test('DVX status, kind and number are normalised strictly', () => {
  assert.equal(eqStatus('Təsdiqləndi'), 'accepted');
  assert.equal(eqStatus('Sistem tərəfindən təsdiqləndi'), 'accepted');
  assert.equal(eqStatus('Ləğv edildi'), 'cancelled');
  assert.equal(eqStatus('Təsdiqlənmiş qaimə ləğv edilib'), 'cancelled');
  assert.equal(eqStatus('İmtina edilib'), 'rejected');
  assert.equal(eqStatus('Düzəliş edilib'), 'corrected');
  assert.equal(eqStatus('Təsdiq gözləyir'), 'pending');
  assert.equal(eqStatus('Göndərilib'), 'pending');
  // Anything unknown is never taken for accepted.
  assert.equal(eqStatus('Arxivdə'), 'unknown');
  assert.equal(eqStatus(''), 'unknown');
  assert.equal(eqKind(''), 'main');
  assert.equal(eqKind('Əsas qaimə'), 'main');
  assert.equal(eqKind('Düzəliş qaiməsi'), 'correction');
  assert.equal(eqKind('Qaytarma qaiməsi'), 'return');
  assert.equal(eqKind('Avans qaiməsi'), 'advance');
  assert.equal(eqKind('İxrac'), 'other');
  assert.equal(eqNumber('MT', '2610007'), 'MT2610007');
  assert.equal(eqNumber('MT', 'mt 2610007'), 'MT2610007');
  assert.equal(foldKey('ƏDV-yə “0” dərəcə'), 'edv ye 0 derece');
  assert.equal(directionFromText('Gələnlər / Göndərilənlər'), undefined);
  assert.equal(directionFromText('E-qaimələr: Gələnlər'), 'purchase');
});
