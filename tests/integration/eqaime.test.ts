/**
 * Stage 4a — DVX e-qaimə import and box (docs/MERHELE-4-EQAIME.md §5, §9: E2–E4, E12, E16).
 * Files are synthetic (see tests/domain/eqaime.test.ts); they go through the same reader the
 * window uses, then through the command.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readEqTable } from '../../src/domain/eqaime.js';
import type { EqDocumentDetail, EqImportView, EqInboxView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;
const OWN = '1234567890'; // the fixture company's VÖEN

const header = [
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
  'ƏDV-dən azad olan',
  'Vəziyyəti',
];
type Row = [
  kind: string,
  number: string,
  date: string,
  taxId: string,
  net: string,
  vat: string,
  status?: string,
];
const invoicesFile = (title: string, rows: Row[]) => [
  [title],
  header,
  ...rows.map(([kind, number, date, taxId, net, vat, status = 'Təsdiqləndi']) => [
    kind,
    'MT',
    number,
    date,
    taxId,
    `Kontragent ${taxId.slice(0, 3)}`,
    net,
    vat,
    '',
    vat === '0' ? '' : net,
    vat === '0' ? net : '',
    status,
  ]),
];

function load(f: F, direction: 'sale' | 'purchase', rows: string[][], fileName = 'qaimeler.xlsx') {
  const r = readEqTable(rows, fileName);
  return f.exec({
    type: 'eqaime.import',
    companyId: f.companyId,
    direction,
    ...(r.directionHint ? { fileDirection: r.directionHint } : {}),
    report: r.report!,
    source: 'file',
    fileName,
    fileHash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    documents: r.documents,
  });
}
const inbox = (f: F, direction: 'sale' | 'purchase' = 'purchase') =>
  f.query<EqInboxView>({ type: 'eqInbox', companyId: f.companyId, direction });
const september = () =>
  invoicesFile('Elektron qaimə-fakturalar — Gələnlər', [
    ['Əsas', '2609001', '05.09.2026', '1111111111', '1000', '180'],
    ['Əsas', '2609002', '06.09.2026', '2222222222', '500', '0'],
    ['', '2609003', '07.09.2026', '3333333333', '10', '1,8', 'Təsdiq gözləyir'],
  ]);

test('E2: a second load changes nothing; an overlapping file adds only the new e-qaimə', (t) => {
  const f = fixture(t);
  const first = load(f, 'purchase', september());
  assert.deepEqual(
    [first.added, first.updated, first.same, first.conflicts, first.rejected],
    [3, 0, 0, 0, []],
  );
  const before = f.db.all('SELECT * FROM eq_documents ORDER BY eq_key');
  const again = load(f, 'purchase', september());
  assert.deepEqual([again.added, again.updated, again.same, again.conflicts], [0, 0, 3, 0]);
  assert.deepEqual(f.db.all('SELECT * FROM eq_documents ORDER BY eq_key'), before);
  const wider = invoicesFile('Gələnlər', [
    ['Əsas', '2609001', '05.09.2026', '1111111111', '1000', '180'],
    ['Əsas', '2609004', '30.09.2026', '1111111111', '20', '3,6'],
  ]);
  const third = load(f, 'purchase', wider);
  assert.deepEqual([third.added, third.same], [1, 1]);
  const box = inbox(f);
  assert.deepEqual(box.counts, {
    proposal: 0,
    unknown: 3,
    dvx: 1,
    conflict: 0,
    auto: 0,
    posted: 0,
    ignored: 0,
  });
  assert.deepEqual(
    box.documents.map((d) => [d.number, d.bucket, d.net, d.vat, d.total]),
    [
      ['MT2609001', 'unknown', '1000.00', '180.00', '1180.00'],
      ['MT2609002', 'unknown', '500.00', '0.00', '500.00'],
      ['MT2609003', 'dvx', '10.00', '1.80', '11.80'],
      ['MT2609004', 'unknown', '20.00', '3.60', '23.60'],
    ],
  );
  const imports = f.query<EqImportView[]>({
    type: 'eqImports',
    companyId: f.companyId,
    direction: 'purchase',
  });
  assert.deepEqual(
    imports.map((i) => [i.added, i.same]),
    [
      [1, 1],
      [0, 3],
      [3, 0],
    ],
  );
  // Nothing is booked by loading.
  assert.equal(f.db.get('SELECT COUNT(*) AS n FROM invoices')!.n, 0n);
});

test('E3: a file of the other direction or of another company is refused as a whole', (t) => {
  const f = fixture(t);
  // The title says Göndərilənlər, the user chose Gələnlər.
  assert.throws(
    () =>
      load(
        f,
        'purchase',
        invoicesFile('Göndərilənlər', [['', '1', '01.09.2026', '1111111111', '5', '0']]),
      ),
    /Göndərilənlər \(satış\) hesabatıdır/,
  );
  const goods = (seller: string, buyer: string) => [
    [
      'Seriya',
      'Nömrə',
      'Tarix',
      'Satıcının VÖEN-i',
      'Alıcının VÖEN-i',
      'Malın adı',
      'Miqdarı',
      'Malın ƏDV-siz ümumi dəyəri',
      'Malın ƏDV məbləği',
      'Vəziyyəti',
    ],
    ['MT', '1', '01.09.2026', seller, buyer, 'Kağız', '1', '10', '1,8', 'Təsdiqləndi'],
  ];
  // Our VÖEN is the seller: this is a sales file, whatever the title says (no title here).
  assert.throws(() => load(f, 'purchase', goods(OWN, '1111111111')), /satış\) faylıdır/);
  assert.throws(() => load(f, 'sale', goods('1111111111', '2222222222')), /başqa şirkətindir/);
  // The e-qaimə of our own VÖEN as the other side is refused row by row.
  const own = load(
    f,
    'purchase',
    invoicesFile('Gələnlər', [
      ['', '9', '01.09.2026', OWN, '5', '0'],
      ['', '10', '01.09.2026', '1111111111', '5', '0'],
    ]),
  );
  assert.equal(own.added, 1);
  assert.match(own.rejected![0]!.message, /şirkətin öz VÖEN-idir/);
  assert.equal(f.db.get('SELECT COUNT(*) AS n FROM eq_imports')!.n, 1n);
  // The right direction loads.
  assert.equal(load(f, 'sale', goods(OWN, '1111111111')).added, 1);
  assert.equal(inbox(f, 'sale').documents[0]!.taxId, '1111111111');
});

test('E4: the same number from two suppliers is two e-qaimələr; twice in one file is refused', (t) => {
  const f = fixture(t);
  const file = invoicesFile('Gələnlər', [
    ['', '2609001', '05.09.2026', '1111111111', '100', '18'],
    ['', '2609001', '05.09.2026', '2222222222', '100', '18'],
    ['', '2609001', '05.09.2026', '1111111111', '100', '18'],
  ]);
  // The reader reports the repeated row…
  const read = readEqTable(file);
  assert.deepEqual(read.problems, [{ row: 5, message: 'e-qaimə MT2609001 faylda ikinci dəfədir' }]);
  assert.equal(load(f, 'purchase', file).added, 2);
  // …and the command refuses it on its own, whatever sends it.
  const r = f.exec({
    type: 'eqaime.import',
    companyId: f.companyId,
    direction: 'purchase',
    report: 'invoices',
    source: 'file',
    fileName: 'x.xlsx',
    fileHash: '0'.repeat(64),
    documents: [read.documents[0]!, { ...read.documents[0]!, number: 'mt 2609001', row: 9 }],
  });
  assert.deepEqual([r.added, r.same], [0, 1]);
  assert.deepEqual(r.rejected, [
    { row: 9, message: 'Sətir 9: e-qaimə MT2609001 faylda ikinci dəfədir.' },
  ]);
});

test('E12: DVX status changes are followed, with history; cancelled e-qaimələr are set aside', (t) => {
  const f = fixture(t);
  load(f, 'purchase', september());
  const next = invoicesFile('Gələnlər', [
    ['Əsas', '2609001', '05.09.2026', '1111111111', '1000', '180', 'Ləğv edildi'],
    ['Əsas', '2609002', '06.09.2026', '2222222222', '500', '0'],
    ['', '2609003', '07.09.2026', '3333333333', '10', '1,8', 'Sistem tərəfindən təsdiqləndi'],
  ]);
  const r = load(f, 'purchase', next, 'oktyabr.xlsx');
  assert.deepEqual([r.added, r.updated, r.same], [0, 2, 1]);
  const box = inbox(f);
  assert.deepEqual(
    box.documents.map((d) => [d.number, d.status, d.bucket, d.reason]),
    [
      ['MT2609001', 'cancelled', 'ignored', 'DVX: e-qaimə ləğv edilib'],
      ['MT2609002', 'accepted', 'unknown', ''],
      ['MT2609003', 'accepted', 'unknown', ''],
    ],
  );
  const id = box.documents[2]!.id;
  const detail = f.query<EqDocumentDetail>({ type: 'eqDocument', companyId: f.companyId, id });
  assert.deepEqual(
    detail.history.map((h) => [h.dvxStatus, h.fileName]),
    [
      ['Təsdiq gözləyir', 'qaimeler.xlsx'],
      ['Sistem tərəfindən təsdiqləndi', 'oktyabr.xlsx'],
    ],
  );
  // A DVX-cancelled e-qaimə cannot be brought back for booking.
  assert.throws(
    () =>
      f.exec({ type: 'eqaime.restore', companyId: f.companyId, documentId: box.documents[0]!.id }),
    /ləğv edilib; uçota alına bilməz/,
  );
  // By hand: set aside with a reason, then brought back.
  const other = box.documents[1]!.id;
  f.exec({ type: 'eqaime.ignore', companyId: f.companyId, documentId: other, reason: 'Sınaq' });
  assert.equal(inbox(f).counts.ignored, 2);
  f.exec({ type: 'eqaime.restore', companyId: f.companyId, documentId: other });
  assert.equal(inbox(f).counts.unknown, 2);
});

test('goods lines arrive once; other amounts for a known e-qaimə are a conflict, never applied', (t) => {
  const f = fixture(t);
  load(f, 'purchase', september());
  const goods = (net: string, vat: string) => [
    ['Gələnlər — Mallar üzrə'],
    [
      'Seriya',
      'Nömrə',
      'Tarix',
      'VÖEN',
      'Malın kodu',
      'Malın adı',
      'Ölçü vahidi',
      'Miqdarı',
      'Vahidin qiyməti',
      'Malın ƏDV-siz ümumi dəyəri',
      'Malın ƏDV məbləği',
      'Vəziyyəti',
    ],
    [
      'MT',
      '2609001',
      '05.09.2026',
      '1111111111',
      '5208',
      'Parça',
      'metr',
      '100',
      '6',
      '600',
      '108',
      'Təsdiqləndi',
    ],
    [
      'MT',
      '2609001',
      '05.09.2026',
      '1111111111',
      '',
      'Düymə',
      'ədəd',
      '400',
      '1',
      net,
      vat,
      'Təsdiqləndi',
    ],
  ];
  const r = load(f, 'purchase', goods('400', '72'), 'mallar.xlsx');
  assert.deepEqual([r.added, r.updated, r.same, r.conflicts], [0, 1, 0, 0]);
  const id = inbox(f).documents[0]!.id;
  const d = f.query<EqDocumentDetail>({ type: 'eqDocument', companyId: f.companyId, id });
  assert.deepEqual(
    d.lines.map((l) => [l.code, l.name, l.quantity, l.net, l.vat]),
    [
      ['5208', 'Parça', '100', '600.00', '108.00'],
      ['', 'Düymə', '400', '400.00', '72.00'],
    ],
  );
  // The VAT bases of the e-qaimə report stay as DVX printed them.
  assert.deepEqual([d.base18, d.kindText], ['1000.00', 'Əsas']);
  // Again: nothing changes.
  assert.equal(load(f, 'purchase', goods('400', '72'), 'mallar.xlsx').same, 1);
  // The same e-qaimə with other amounts: kept as it was, flagged.
  const c = load(f, 'purchase', goods('401', '72'), 'mallar-2.xlsx');
  assert.equal(c.conflicts, 1);
  const after = f.query<EqDocumentDetail>({ type: 'eqDocument', companyId: f.companyId, id });
  assert.equal(after.net, '1000.00');
  assert.equal(after.bucket, 'conflict');
  assert.match(after.conflict, /mallar-2\.xlsx: tarix 2026-09-05, ƏDV-siz 1001\.00/);
});

test('a goods report first: kind and VAT bases are completed once by the e-qaimə report', (t) => {
  const f = fixture(t);
  const goods = [
    ['Gələnlər'],
    [
      'Seriya',
      'Nömrə',
      'Tarix',
      'VÖEN',
      'Malın adı',
      'Miqdarı',
      'Malın ƏDV-siz ümumi dəyəri',
      'Malın ƏDV məbləği',
      'Vəziyyəti',
    ],
    ['MT', '2609002', '06.09.2026', '2222222222', 'Rabitə', '1', '500', '0', 'Təsdiqləndi'],
  ];
  load(f, 'purchase', goods, 'mallar.xlsx');
  const id = inbox(f).documents[0]!.id;
  assert.equal(
    f.query<EqDocumentDetail>({ type: 'eqDocument', companyId: f.companyId, id }).baseExempt,
    '0.00',
  );
  const r = load(f, 'purchase', september());
  assert.deepEqual([r.added, r.updated], [2, 1]);
  const d = f.query<EqDocumentDetail>({ type: 'eqDocument', companyId: f.companyId, id });
  assert.deepEqual([d.baseExempt, d.kindText, d.lines.length], ['500.00', 'Əsas', 1]);
});

test('E16: what DVX wrote is not changed or deleted, not even by SQL', (t) => {
  const f = fixture(t);
  load(f, 'purchase', september());
  const id = String(f.db.get('SELECT id FROM eq_documents LIMIT 1')!.id);
  assert.throws(() => f.db.run('UPDATE eq_documents SET net=1 WHERE id=?', id), /DVX-in yazdığı/);
  assert.throws(
    () => f.db.run('UPDATE eq_documents SET base_18=1 WHERE id=?', id),
    /DVX-in yazdığı/,
  );
  assert.throws(() => f.db.run('DELETE FROM eq_documents WHERE id=?', id), /silinmir/);
  assert.throws(() => f.db.run('DELETE FROM eq_imports'), /silinmir/);
  assert.throws(
    () => f.db.run('UPDATE eq_status_history SET new_status=?', 'accepted'),
    /dəyişdirilmir/,
  );
  f.db.run(`UPDATE eq_documents SET lines='[]' WHERE id=?`, id);
  assert.throws(
    () => f.db.run(`UPDATE eq_documents SET lines='[1]' WHERE id=?`, id),
    /artıq yazılıb/,
  );
  // An ignored e-qaimə always carries its reason.
  assert.throws(() => f.db.run(`UPDATE eq_documents SET state='ignored' WHERE id=?`, id), /CHECK/);
});
