/**
 * Stage 4b — booking DVX e-qaimələr (docs/MERHELE-4-EQAIME.md §4, §6, §9: E5–E9, E13–E15).
 * An e-qaimə is booked only through invoice.save; an automatic invoice must post exactly what
 * the same invoice typed by hand posts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { EqDocumentInputDto } from '../../src/contracts/commands.js';
import type {
  EqDocumentDetail,
  EqInboxView,
  EqMapView,
  EqReconcileView,
  InvoiceDetail,
} from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;
type Dir = 'sale' | 'purchase';
const SUPPLIER = '1700000001';
const BUYER = '1700000002';
const TELECOM = '1700000003';
let files = 0;

const doc = (
  number: string,
  date: string,
  taxId: string,
  extra: Partial<EqDocumentInputDto> = {},
) =>
  ({
    row: 2,
    number,
    date,
    taxId,
    name: `Kontragent ${taxId}`,
    sellerTaxId: '',
    buyerTaxId: '',
    sellerName: '',
    buyerName: '',
    kind: 'Əsas',
    status: 'Təsdiqləndi',
    refNumber: '',
    net: '0.00',
    vat: '0.00',
    total: '',
    base18: '',
    base0: '',
    baseExempt: '',
    baseNontaxable: '',
    excise: '',
    roadTax: '',
    note: '',
    ...extra,
  }) satisfies EqDocumentInputDto;
const good = (
  code: string,
  name: string,
  quantity: string,
  price: string,
  net: string,
  vat: string,
) => ({
  code,
  name,
  unit: 'ədəd',
  quantity,
  price,
  net,
  vat,
  vatRate: vat === '0.00' ? 'exempt' : '18',
});
/** A "Mallar üzrə" e-qaimə: totals are the sum of its lines. */
const withGoods = (
  number: string,
  date: string,
  taxId: string,
  goods: ReturnType<typeof good>[],
) => {
  const sum = (k: 'net' | 'vat') =>
    (goods.reduce((s, g) => s + Math.round(Number(g[k]) * 100), 0) / 100).toFixed(2);
  return doc(number, date, taxId, { net: sum('net'), vat: sum('vat'), lines: goods });
};

function load(
  f: F,
  direction: Dir,
  documents: EqDocumentInputDto[],
  report: 'goods' | 'invoices' = 'goods',
) {
  return f.exec({
    type: 'eqaime.import',
    companyId: f.companyId,
    direction,
    report,
    source: 'file',
    fileName: `dvx-${++files}.xlsx`,
    fileHash: String(files).padStart(64, '0'),
    documents,
  });
}
const inbox = (f: F, direction: Dir = 'purchase') =>
  f.query<EqInboxView>({ type: 'eqInbox', companyId: f.companyId, direction, from: '', to: '' });
const byNumber = (f: F, number: string, direction: Dir = 'purchase') =>
  inbox(f, direction).documents.find((d) => d.number === number)!;
const map = (
  f: F,
  direction: Dir,
  fields: { taxId?: string; dvxCode?: string; name?: string; productId?: string } & Record<
    string,
    unknown
  >,
  mode: 'auto' | 'suggest' = 'auto',
) =>
  f.exec({
    type: 'eqMap.save',
    companyId: f.companyId,
    archived: false,
    direction,
    taxId: '',
    dvxCode: '',
    name: '',
    unit: '',
    productId: '',
    account: '',
    expenseItemId: '',
    incomeTypeId: '',
    vatTreatment: '',
    contractId: '',
    mode,
    ...fields,
  } as never);

/**
 * Postings of an invoice's current entry. Ids differ between two companies: the invoice's own
 * id is masked, every other id is replaced by the name (or number) of what it points to.
 */
function postings(f: F, invoiceId: string) {
  const names = new Map<string, string>();
  for (const t of ['products', 'items', 'partners'])
    for (const r of f.db.all(`SELECT id, name FROM ${t}`)) names.set(String(r.id), String(r.name));
  for (const r of f.db.all('SELECT id, number FROM contracts'))
    names.set(String(r.id), `müqavilə ${String(r.number)}`);
  for (const r of f.db.all('SELECT id, number FROM bank_documents'))
    names.set(String(r.id), String(r.number));
  const named = (v: string) =>
    v
      .replace(invoiceId, 'X')
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
        (id) => names.get(id) ?? '?',
      );
  return f.db
    .all(
      `SELECT p.* FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE e.source_id=? AND e.storno=0 AND e.source_version=(SELECT version FROM invoices WHERE id=?)
       ORDER BY p.line_no`,
      invoiceId,
      invoiceId,
    )
    .map((p) =>
      [
        p.dt_account,
        p.dt_s1,
        p.dt_s2,
        p.dt_s3,
        p.kt_account,
        p.kt_s1,
        p.kt_s2,
        p.kt_s3,
        p.amount,
        p.dt_qty,
        p.kt_qty,
      ]
        .map((v) => named(String(v)))
        .join(' '),
    );
}

/** The same company twice: partners, contracts and products with the same names. */
function setup(f: F) {
  const supplier = f.partner('Kağız Təchizat MMC', SUPPLIER);
  const buyer = f.partner('Alıcı MMC', BUYER);
  const telecom = f.partner('Rabitə ASC', TELECOM);
  const bankPartner = f.partner('Kapital Bank', '9900003611');
  return {
    supplier,
    buyer,
    telecom,
    supplierContract: f.contract(supplier, 'A-1', 'purchase'),
    buyerContract: f.contract(buyer, 'S-1', 'sale'),
    telecomContract: f.contract(telecom, 'R-1', 'purchase'),
    paper: f.product('Kağız A4', 'qutu', 'goods'),
    service: f.product('Rabitə xidməti', 'ay', 'service'),
    bankAccount: f.bankAccount(bankPartner, 'AZ12AIIB38060019441234567890'),
    rabite: f.item('expenseItem', 'Rabitə'),
  };
}

test('E5: a purchase booked by confirmed entries posts what the same invoice typed by hand posts', (t) => {
  const run = (auto: boolean) => {
    const f = fixture(t);
    const s = setup(f);
    // An advance to the supplier first: the invoice offsets it in both cases.
    f.bank('out', '2026-09-01', s.bankAccount, [
      f.bankLine('531.01', [s.supplier, s.supplierContract], '500'),
    ]);
    let id: string;
    if (auto) {
      map(f, 'purchase', {
        taxId: SUPPLIER,
        dvxCode: '4802',
        name: 'Kağız A4 80q',
        productId: s.paper,
      });
      const r = load(f, 'purchase', [
        withGoods('MT2609001', '2026-09-05', SUPPLIER, [
          good('4802', 'Kağız A4 80q', '10', '100', '1000.00', '180.00'),
        ]),
      ]);
      assert.equal(r.posted, 1);
      const d = byNumber(f, 'MT2609001');
      assert.deepEqual([d.bucket, d.invoiceNumber], ['auto', 'AQ-000001']);
      id = d.invoiceId;
      const inv = f.query<InvoiceDetail>({ type: 'invoice', companyId: f.companyId, id });
      assert.deepEqual([inv.eqNumber, inv.eqDocumentId, inv.total], ['MT2609001', d.id, '1180.00']);
    } else
      id = f.invoice(
        'purchase',
        '2026-09-05',
        s.supplier,
        s.supplierContract,
        [{ productId: s.paper, quantity: '10', price: '100', vatRate: '18', memo: 'Kağız A4 80q' }],
        { eqNumber: 'MT2609001' },
      ).id;
    return postings(f, id);
  };
  const auto = run(true);
  assert.deepEqual(auto, run(false));
  // Goods + VAT to offset / supplier, and the advance offset against the invoice.
  assert.deepEqual(
    auto.map((p) => p.split(' ').filter(Boolean).slice(0, 1).join()),
    ['205', '241', '531.01'],
  );
});

test('E6: a sale booked by confirmed entries: 211/601, 604.1/521.01 and FIFO as by hand', (t) => {
  const run = (auto: boolean) => {
    const f = fixture(t);
    const s = setup(f);
    f.invoice('purchase', '2026-09-01', s.supplier, s.supplierContract, [
      { productId: s.paper, quantity: '10', price: '50' },
    ]);
    let id: string;
    if (auto) {
      map(f, 'sale', { dvxCode: '4802', productId: s.paper });
      const r = load(f, 'sale', [
        withGoods('MT2609100', '2026-09-10', BUYER, [
          good('4802', 'Kağız', '4', '80', '320.00', '57.60'),
        ]),
      ]);
      assert.equal(r.posted, 1);
      id = byNumber(f, 'MT2609100', 'sale').invoiceId;
    } else
      id = f.invoice(
        'sale',
        '2026-09-10',
        s.buyer,
        s.buyerContract,
        [{ productId: s.paper, quantity: '4', price: '80', memo: 'Kağız' }],
        { eqNumber: 'MT2609100' },
      ).id;
    return postings(f, id);
  };
  const auto = run(true);
  const hand = run(false);
  assert.deepEqual(auto, hand);
  assert.ok(
    auto.some((p) => p.startsWith('701')),
    'cost of sales is posted',
  );
});

test('E7: what is not confirmed waits — new VÖEN, several contracts, suggested entries', (t) => {
  const f = fixture(t);
  const s = setup(f);
  map(f, 'purchase', { dvxCode: '4802', productId: s.paper });
  map(f, 'purchase', { taxId: SUPPLIER, dvxCode: '9999', productId: s.paper }, 'suggest');
  f.contract(s.telecom, 'R-2', 'purchase');
  const r = load(f, 'purchase', [
    // Unknown partner, but the goods code is known to any partner: a proposal with the new partner.
    withGoods('MT1', '2026-09-05', '1800000001', [
      good('4802', 'Kağız', '1', '10', '10.00', '1.80'),
    ]),
    // Unknown partner and unknown goods: nothing recognised.
    withGoods('MT2', '2026-09-05', '1800000002', [good('1', 'Nə isə', '1', '10', '10.00', '1.80')]),
    // A suggested entry is not posted by itself.
    withGoods('MT3', '2026-09-05', SUPPLIER, [good('9999', 'Toner', '1', '10', '10.00', '1.80')]),
    // Two active contracts.
    withGoods('MT4', '2026-09-05', TELECOM, [good('4802', 'Kağız', '1', '10', '10.00', '1.80')]),
  ]);
  assert.equal(r.posted, 0);
  const box = inbox(f);
  const p = (n: string) => box.documents.find((d) => d.number === n)!;
  assert.equal(p('MT1').bucket, 'proposal');
  assert.deepEqual(p('MT1').proposal!.newPartner, {
    name: 'Kontragent 1800000001',
    taxId: '1800000001',
    kind: 'legal',
  });
  assert.equal(p('MT2').bucket, 'unknown');
  assert.match(p('MT3').proposal!.reasons.join(' '), /təklif rejimindədir/);
  assert.match(p('MT4').proposal!.reasons.join(' '), /2 aktiv alış müqaviləsi var/);
  // No partner is created on its own.
  assert.equal(f.db.get("SELECT COUNT(*) AS n FROM partners WHERE tax_id LIKE '18%'")!.n, 0n);
  // The accountant picks the contract for this VÖEN once, as an auto entry: then it books.
  map(f, 'purchase', { taxId: TELECOM, contractId: s.telecomContract });
  const again = f.exec({ type: 'eqaime.apply', companyId: f.companyId, direction: 'purchase' });
  assert.equal(again.posted, 1);
  assert.equal(byNumber(f, 'MT4').bucket, 'auto');
});

test('E8: Meyar must reproduce DVX to the qəpik, or the e-qaimə waits with the difference', (t) => {
  const f = fixture(t);
  const s = setup(f);
  map(f, 'purchase', { taxId: SUPPLIER, dvxCode: '4802', productId: s.paper });
  const r = load(f, 'purchase', [
    // DVX's own price has 6 decimals: the price is derived from the amount (4 decimals) and fits.
    withGoods('MT10', '2026-09-05', SUPPLIER, [
      good('4802', 'Kağız', '3', '3.336667', '10.01', '1.80'),
    ]),
    // VAT that is not 18% of the line.
    withGoods('MT11', '2026-09-05', SUPPLIER, [
      good('4802', 'Kağız', '1', '100', '100.00', '17.00'),
    ]),
  ]);
  assert.equal(r.posted, 1);
  const inv = f.query<InvoiceDetail>({
    type: 'invoice',
    companyId: f.companyId,
    id: byNumber(f, 'MT10').invoiceId,
  });
  assert.deepEqual([inv.lines[0]!.price, inv.net, inv.vat], ['3.3367', '10.01', '1.80']);
  const waiting = byNumber(f, 'MT11');
  assert.equal(waiting.bucket, 'proposal');
  assert.match(
    waiting.proposal!.reasons.join(' '),
    /Meyar 100\.00 \/ ƏDV 18\.00 hesablayır, DVX-də 100\.00 \/ 17\.00/,
  );
});

test('E9: only totals — a service partner books by VAT bases; goods wait for their lines', (t) => {
  const f = fixture(t);
  const s = setup(f);
  // A whole-e-qaimə entry is for services only.
  assert.throws(
    () => map(f, 'purchase', { taxId: SUPPLIER, productId: s.paper }),
    /yalnız xidmətə yazılır/,
  );
  map(f, 'purchase', { taxId: TELECOM, productId: s.service, expenseItemId: s.rabite });
  const r = load(
    f,
    'purchase',
    [
      doc('MT20', '2026-09-30', TELECOM, {
        net: '80.00',
        vat: '9.00',
        total: '89.00',
        base18: '50.00',
        baseExempt: '30.00',
      }),
      doc('MT21', '2026-09-30', SUPPLIER, {
        net: '100.00',
        vat: '18.00',
        total: '118.00',
        base18: '100.00',
      }),
    ],
    'invoices',
  );
  assert.equal(r.posted, 1);
  const inv = f.query<InvoiceDetail>({
    type: 'invoice',
    companyId: f.companyId,
    id: byNumber(f, 'MT20').invoiceId,
  });
  assert.deepEqual(
    inv.lines.map((l) => [l.vatRate, l.quantity, l.price, l.net, l.vat]),
    [
      ['18', '1', '50', '50.00', '9.00'],
      ['exempt', '1', '30', '30.00', '0.00'],
    ],
  );
  assert.match(byNumber(f, 'MT21').proposal!.reasons.join(' '), /Mal sətirləri yoxdur/);
});

test('E13: an invoice typed by hand is linked, never booked a second time', (t) => {
  const f = fixture(t);
  const s = setup(f);
  map(f, 'purchase', { taxId: SUPPLIER, dvxCode: '4802', productId: s.paper });
  const same = f.invoice(
    'purchase',
    '2026-09-05',
    s.supplier,
    s.supplierContract,
    [{ productId: s.paper, quantity: '10', price: '100' }],
    { eqNumber: 'mt 2609001' },
  );
  const numberless = f.invoice('purchase', '2026-09-06', s.supplier, s.supplierContract, [
    { productId: s.paper, quantity: '2', price: '100' },
  ]);
  const entries = () => f.db.get('SELECT COUNT(*) AS n FROM entries')!.n;
  const before = entries();
  const r = load(f, 'purchase', [
    withGoods('MT2609001', '2026-09-05', SUPPLIER, [
      good('4802', 'Kağız', '10', '100', '1000.00', '180.00'),
    ]),
    withGoods('MT2609002', '2026-09-08', SUPPLIER, [
      good('4802', 'Kağız', '2', '100', '200.00', '36.00'),
    ]),
  ]);
  // The first is linked to the invoice with its number; the second is NOT booked although its
  // entry is "auto": a numberless invoice of the same partner and total exists.
  assert.equal(r.posted, 1);
  assert.equal(entries(), before);
  const first = byNumber(f, 'MT2609001');
  assert.deepEqual([first.bucket, first.invoiceId], ['posted', same.id]);
  const second = byNumber(f, 'MT2609002');
  assert.equal(second.bucket, 'proposal');
  assert.deepEqual(
    second.proposal!.candidates.map((c) => c.id),
    [numberless.id],
  );
  f.exec({
    type: 'eqaime.link',
    companyId: f.companyId,
    documentId: second.id,
    invoiceId: numberless.id,
  });
  assert.equal(entries(), before, 'linking posts nothing');
  const inv = f.query<InvoiceDetail>({
    type: 'invoice',
    companyId: f.companyId,
    id: numberless.id,
  });
  assert.deepEqual([inv.eqNumber, inv.eqDocumentId, inv.version], ['MT2609002', second.id, 1]);
  // Another partner's invoice is never linked.
  const other = f.invoice('purchase', '2026-09-08', s.telecom, s.telecomContract, [
    { productId: s.service, quantity: '1', price: '10', expenseItemId: s.rabite },
  ]);
  load(f, 'purchase', [
    withGoods('MT2609003', '2026-09-08', SUPPLIER, [good('x', 'Y', '1', '10', '10.00', '1.80')]),
  ]);
  assert.throws(
    () =>
      f.exec({
        type: 'eqaime.link',
        companyId: f.companyId,
        documentId: byNumber(f, 'MT2609003').id,
        invoiceId: other.id,
      }),
    /kontragentin VÖEN-i 1700000003/,
  );
});

test('E13: the same number with other amounts is linked and flagged', (t) => {
  const f = fixture(t);
  const s = setup(f);
  f.invoice(
    'purchase',
    '2026-09-05',
    s.supplier,
    s.supplierContract,
    [{ productId: s.paper, quantity: '10', price: '99' }],
    { eqNumber: 'MT2609001' },
  );
  load(f, 'purchase', [
    withGoods('MT2609001', '2026-09-05', SUPPLIER, [
      good('4802', 'Kağız', '10', '100', '1000.00', '180.00'),
    ]),
  ]);
  const d = byNumber(f, 'MT2609001');
  assert.equal(d.bucket, 'conflict');
  assert.match(d.conflict, /cəmi 1168\.20, DVX-də 1180\.00/);
});

test('E14: undoing an automatic booking leaves the e-qaimə to the accountant', (t) => {
  const f = fixture(t);
  const s = setup(f);
  map(f, 'purchase', { taxId: SUPPLIER, dvxCode: '4802', productId: s.paper });
  load(f, 'purchase', [
    withGoods('MT2609001', '2026-09-05', SUPPLIER, [
      good('4802', 'Kağız', '10', '100', '1000.00', '180.00'),
    ]),
  ]);
  const d = byNumber(f, 'MT2609001');
  const inv = f.query<InvoiceDetail>({ type: 'invoice', companyId: f.companyId, id: d.invoiceId });
  f.exec({
    type: 'invoice.cancel',
    companyId: f.companyId,
    id: inv.id,
    version: inv.version,
    reason: 'Geri qaytarıldı',
  });
  const back = byNumber(f, 'MT2609001');
  assert.equal(back.bucket, 'proposal');
  assert.match(back.proposal!.reasons.join(' '), /Avtomatik uçot geri qaytarılıb/);
  assert.equal(
    f.exec({ type: 'eqaime.apply', companyId: f.companyId, direction: 'purchase' }).posted,
    0,
  );
});

test('E15: one e-qaimə that cannot be booked does not stop the others', (t) => {
  const f = fixture(t);
  const s = setup(f);
  map(f, 'sale', { dvxCode: '4802', productId: s.paper });
  f.invoice('purchase', '2026-09-01', s.supplier, s.supplierContract, [
    { productId: s.paper, quantity: '5', price: '50' },
  ]);
  const r = load(f, 'sale', [
    // More than in stock.
    withGoods('MT1', '2026-09-10', BUYER, [good('4802', 'Kağız', '50', '80', '4000.00', '720.00')]),
    withGoods('MT2', '2026-09-11', BUYER, [good('4802', 'Kağız', '2', '80', '160.00', '28.80')]),
  ]);
  assert.equal(r.posted, 1);
  assert.equal(r.failed!.length, 1);
  const failed = byNumber(f, 'MT1', 'sale');
  assert.equal(failed.bucket, 'proposal');
  assert.match(failed.autoNote, /^Avtomatik uçota alınmadı: /);
  assert.equal(byNumber(f, 'MT2', 'sale').bucket, 'auto');
  // A closed period: proposed, never attempted.
  f.exec({ type: 'period.close', companyId: f.companyId, through: '2026-09-30', reason: '' });
  load(f, 'sale', [
    withGoods('MT3', '2026-09-20', BUYER, [good('4802', 'Kağız', '1', '80', '80.00', '14.40')]),
  ]);
  assert.match(byNumber(f, 'MT3', 'sale').proposal!.reasons.join(' '), /bağlanıb/);
});

test('booking by hand from the box: the invoice must be what DVX wrote, also when corrected later', (t) => {
  const f = fixture(t);
  const s = setup(f);
  load(f, 'purchase', [
    withGoods('MT2609001', '2026-09-05', SUPPLIER, [
      good('4802', 'Kağız', '10', '100', '1000.00', '180.00'),
    ]),
  ]);
  const d = byNumber(f, 'MT2609001');
  const save = (price: string, extra = {}) =>
    f.invoice(
      'purchase',
      '2026-09-05',
      s.supplier,
      s.supplierContract,
      [{ productId: s.paper, quantity: '10', price }],
      { eqNumber: 'MT2609001', eqDocumentId: d.id, ...extra },
    );
  assert.throws(
    () => save('99'),
    /e-qaimə MT2609001 ilə uyğun deyil: cəmi 1168\.20, DVX-də 1180\.00/,
  );
  const r = save('100');
  assert.equal(byNumber(f, 'MT2609001').bucket, 'posted');
  // A later correction that departs from DVX is refused.
  assert.throws(
    () =>
      f.invoice(
        'purchase',
        '2026-09-05',
        s.supplier,
        s.supplierContract,
        [{ productId: s.paper, quantity: '10', price: '101' }],
        { id: r.id, version: r.version, eqNumber: 'MT2609001' },
      ),
    /uyğun deyil/,
  );
  // DVX cancels it later: a conflict in the box; cancelling the invoice sets it aside.
  load(f, 'purchase', [
    {
      ...withGoods('MT2609001', '2026-09-05', SUPPLIER, [
        good('4802', 'Kağız', '10', '100', '1000.00', '180.00'),
      ]),
      status: 'Ləğv edildi',
    },
  ]);
  assert.equal(byNumber(f, 'MT2609001').bucket, 'conflict');
  f.exec({
    type: 'invoice.cancel',
    companyId: f.companyId,
    id: r.id,
    version: r.version!,
    reason: 'DVX-də ləğv',
  });
  const after = byNumber(f, 'MT2609001');
  assert.equal(after.bucket, 'ignored');
  assert.match(after.reason, /DVX: e-qaimə ləğv edilib/);
});

test('learning: the accountant’s booking becomes suggested entries; switched to auto, the next one books', (t) => {
  const f = fixture(t);
  const s = setup(f);
  load(
    f,
    'purchase',
    [
      withGoods('MT1', '2026-09-05', SUPPLIER, [
        good('4802', 'Kağız A4', '10', '100', '1000.00', '180.00'),
      ]),
      doc('MT2', '2026-09-30', TELECOM, { net: '50.00', vat: '9.00', base18: '50.00' }),
    ],
    'goods',
  );
  const one = byNumber(f, 'MT1');
  f.invoice(
    'purchase',
    '2026-09-05',
    s.supplier,
    s.supplierContract,
    [{ productId: s.paper, quantity: '10', price: '100' }],
    { eqNumber: 'MT1', eqDocumentId: one.id },
  );
  assert.equal(
    f.exec({ type: 'eqaime.learn', companyId: f.companyId, documentId: one.id }).learned,
    1,
  );
  // Learning twice adds nothing.
  assert.equal(
    f.exec({ type: 'eqaime.learn', companyId: f.companyId, documentId: one.id }).learned,
    0,
  );
  const two = byNumber(f, 'MT2');
  f.invoice(
    'purchase',
    '2026-09-30',
    s.telecom,
    s.telecomContract,
    [{ productId: s.service, quantity: '1', price: '50', expenseItemId: s.rabite }],
    { eqNumber: 'MT2', eqDocumentId: two.id },
  );
  assert.equal(
    f.exec({ type: 'eqaime.learn', companyId: f.companyId, documentId: two.id }).learned,
    1,
  );
  const maps = f.query<EqMapView[]>({ type: 'eqMaps', companyId: f.companyId });
  assert.deepEqual(
    maps.map((m) => [m.taxId, m.dvxCode, m.name, m.product, m.mode]),
    [
      [SUPPLIER, '4802', 'Kağız A4', 'Kağız A4', 'suggest'],
      [TELECOM, '', '', 'Rabitə xidməti', 'suggest'],
    ],
  );
  // Suggested: the next e-qaimə is a proposal prefilled with the product.
  load(f, 'purchase', [
    withGoods('MT3', '2026-09-06', SUPPLIER, [
      good('4802', 'Kağız A4', '1', '100', '100.00', '18.00'),
    ]),
  ]);
  const three = byNumber(f, 'MT3');
  assert.equal(three.bucket, 'proposal');
  assert.equal(three.proposal!.lines[0]!.productId, s.paper);
  // The accountant switches the entry to auto: it books, and the entry counts its use.
  const m = maps[0]!;
  f.exec({
    type: 'eqMap.save',
    companyId: f.companyId,
    id: m.id,
    version: m.version,
    archived: false,
    direction: 'purchase',
    taxId: m.taxId,
    dvxCode: m.dvxCode,
    name: m.name,
    unit: m.unit,
    productId: m.productId,
    account: m.account,
    expenseItemId: m.expenseItemId,
    incomeTypeId: m.incomeTypeId,
    vatTreatment: m.vatTreatment,
    contractId: m.contractId,
    mode: 'auto',
  });
  assert.equal(
    f.exec({ type: 'eqaime.apply', companyId: f.companyId, direction: 'purchase' }).posted,
    1,
  );
  assert.equal(byNumber(f, 'MT3').bucket, 'auto');
  assert.equal(f.query<EqMapView[]>({ type: 'eqMaps', companyId: f.companyId })[0]!.uses, 1);
  const detail = f.query<EqDocumentDetail>({
    type: 'eqDocument',
    companyId: f.companyId,
    id: three.id,
  });
  assert.equal(detail.bucket, 'auto');
});

// ---------------------------------------------------------------------------------------------
// Stage 4c — DVX statuses (E10, E11), DVX ↔ books, İş masası

test('E10: DVX cancels a booked e-qaimə — a conflict, never a silent storno; a paid invoice is not cancelled', (t) => {
  const f = fixture(t);
  const s = setup(f);
  map(f, 'purchase', { taxId: SUPPLIER, dvxCode: '4802', productId: s.paper });
  const e = (n: string, status = 'Təsdiqləndi') => ({
    ...withGoods(n, '2026-09-05', SUPPLIER, [
      good('4802', 'Kağız', '10', '100', '1000.00', '180.00'),
    ]),
    status,
  });
  load(f, 'purchase', [e('MT1'), e('MT2')]);
  const paid = byNumber(f, 'MT2');
  // MT2 is paid to the supplier.
  f.bank('out', '2026-09-10', s.bankAccount, [
    f.bankLine('531.01', [s.supplier, s.supplierContract, `invoice:${paid.invoiceId}`], '1180'),
  ]);
  load(f, 'purchase', [e('MT1', 'Ləğv edildi'), e('MT2', 'Ləğv edildi')]);
  const one = byNumber(f, 'MT1');
  assert.equal(one.bucket, 'conflict');
  assert.equal(byNumber(f, 'MT2').bucket, 'conflict');
  // Still in the books until the accountant cancels it.
  assert.equal(f.db.get('SELECT status FROM invoices WHERE id=?', one.invoiceId)!.status, 'posted');
  assert.ok(f.home().warnings.some((w) => w.kind === 'eqConflict' && w.eq === 'purchase'));
  const cancel = (id: string) => {
    const inv = f.query<InvoiceDetail>({ type: 'invoice', companyId: f.companyId, id });
    return f.exec({
      type: 'invoice.cancel',
      companyId: f.companyId,
      id,
      version: inv.version,
      reason: 'DVX-də ləğv edilib',
    });
  };
  cancel(one.invoiceId);
  assert.deepEqual(
    [byNumber(f, 'MT1').bucket, byNumber(f, 'MT1').reason],
    ['ignored', 'DVX: e-qaimə ləğv edilib; uçotdakı qaimə ləğv edildi'],
  );
  assert.throws(() => cancel(paid.invoiceId), /ödəniş edilib.*Əvvəlcə ödəniş sənədini düzəldin/);
});

test('E11: a correction replaces an e-qaimə not yet booked, in its place', (t) => {
  const f = fixture(t);
  const s = setup(f);
  map(f, 'purchase', { taxId: SUPPLIER, dvxCode: '4802', productId: s.paper }, 'suggest');
  load(f, 'purchase', [
    withGoods('MT1', '2026-09-05', SUPPLIER, [
      good('4802', 'Kağız', '10', '100', '1000.00', '180.00'),
    ]),
  ]);
  load(f, 'purchase', [
    {
      ...withGoods('MT9', '2026-09-08', SUPPLIER, [
        good('4802', 'Kağız', '9', '100', '900.00', '162.00'),
      ]),
      kind: 'Düzəliş qaiməsi',
      refNumber: 'MT1',
    },
  ]);
  const c = byNumber(f, 'MT9');
  assert.equal(c.bucket, 'proposal');
  assert.deepEqual([c.proposal!.corrects!.number, c.proposal!.corrects!.invoiceId], ['MT1', '']);
  assert.match(
    c.proposal!.reasons.join(' '),
    /əsas e-qaimə MT1 uçotda deyil — düzəliş onun yerinə/,
  );
  f.invoice(
    'purchase',
    '2026-09-08',
    s.supplier,
    s.supplierContract,
    [{ productId: s.paper, quantity: '9', price: '100' }],
    { eqNumber: 'MT9', eqDocumentId: c.id },
  );
  const original = byNumber(f, 'MT1');
  assert.deepEqual(
    [original.bucket, original.reason],
    ['ignored', 'DVX: düzəliş e-qaiməsi MT9 ilə əvəz olunub'],
  );
  assert.throws(
    () => f.exec({ type: 'eqaime.restore', companyId: f.companyId, documentId: original.id }),
    /geri qaytarılmır/,
  );
});

test('E11: a correction of a booked e-qaimə changes that invoice — never a second one', (t) => {
  const f = fixture(t);
  const s = setup(f);
  map(f, 'purchase', { taxId: SUPPLIER, dvxCode: '4802', productId: s.paper });
  load(f, 'purchase', [
    withGoods('MT1', '2026-09-05', SUPPLIER, [
      good('4802', 'Kağız', '10', '100', '1000.00', '180.00'),
    ]),
  ]);
  const o = byNumber(f, 'MT1');
  assert.equal(o.bucket, 'auto');
  // DVX marks the original corrected and sends the correction; even with auto entries it waits.
  load(f, 'purchase', [
    {
      ...withGoods('MT1', '2026-09-05', SUPPLIER, [
        good('4802', 'Kağız', '10', '100', '1000.00', '180.00'),
      ]),
      status: 'Düzəliş edilib',
    },
    {
      ...withGoods('MT9', '2026-09-08', SUPPLIER, [
        good('4802', 'Kağız', '9', '100', '900.00', '162.00'),
      ]),
      kind: 'Düzəliş qaiməsi',
      refNumber: 'MT1',
    },
  ]);
  assert.equal(byNumber(f, 'MT1').bucket, 'conflict');
  const c = byNumber(f, 'MT9');
  assert.equal(c.bucket, 'proposal');
  assert.deepEqual(
    [
      c.proposal!.corrects!.invoiceId,
      c.proposal!.corrects!.invoiceNumber,
      c.proposal!.corrects!.invoiceDate,
    ],
    [o.invoiceId, 'AQ-000001', '2026-09-05'],
  );
  // Booking the correction as a new invoice is refused: MT1 is in the books already.
  assert.throws(
    () =>
      f.invoice(
        'purchase',
        '2026-09-08',
        s.supplier,
        s.supplierContract,
        [{ productId: s.paper, quantity: '9', price: '100' }],
        { eqNumber: 'MT9', eqDocumentId: c.id },
      ),
    /Əsas e-qaimə MT1 başqa qaimədə uçotdadır/,
  );
  // Applied to AQ-000001 (its date stays): storno + new entry, the correction books it now.
  const inv = f.query<InvoiceDetail>({ type: 'invoice', companyId: f.companyId, id: o.invoiceId });
  f.invoice(
    'purchase',
    '2026-09-05',
    s.supplier,
    s.supplierContract,
    [{ productId: s.paper, quantity: '9', price: '100' }],
    { id: inv.id, version: inv.version, number: inv.number, eqNumber: 'MT9', eqDocumentId: c.id },
  );
  const after = f.query<InvoiceDetail>({
    type: 'invoice',
    companyId: f.companyId,
    id: o.invoiceId,
  });
  assert.deepEqual(
    [after.eqNumber, after.eqDocumentId, after.total, after.version],
    ['MT9', c.id, '1062.00', 2],
  );
  assert.equal(byNumber(f, 'MT9').bucket, 'posted');
  const was = byNumber(f, 'MT1');
  assert.deepEqual(
    [was.bucket, was.reason],
    ['ignored', 'DVX: düzəliş e-qaiməsi MT9 ilə əvəz olunub'],
  );
  assert.equal(f.db.get('SELECT COUNT(*) AS n FROM invoices')!.n, 1n);
  // DVX's VAT counts the correction, not the e-qaimə it replaced: the month agrees with the books.
  const r = f.query<EqReconcileView>({
    type: 'eqReconcile',
    companyId: f.companyId,
    direction: 'purchase',
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.deepEqual(
    r.months.map((m) => [m.dvxCount, m.dvxVat, m.bookedVat, m.difference]),
    [[1, '162.00', '162.00', '0.00']],
  );
});

test('E11: a correction of an e-qaimə booked in a closed period is left to the accountant', (t) => {
  const f = fixture(t);
  const s = setup(f);
  map(f, 'purchase', { taxId: SUPPLIER, dvxCode: '4802', productId: s.paper });
  load(f, 'purchase', [
    withGoods('MT1', '2026-08-05', SUPPLIER, [
      good('4802', 'Kağız', '10', '100', '1000.00', '180.00'),
    ]),
  ]);
  f.exec({ type: 'period.close', companyId: f.companyId, through: '2026-08-31', reason: '' });
  load(f, 'purchase', [
    {
      ...withGoods('MT9', '2026-09-08', SUPPLIER, [
        good('4802', 'Kağız', '9', '100', '900.00', '162.00'),
      ]),
      kind: 'Düzəliş qaiməsi',
      refNumber: 'MT1',
    },
  ]);
  const c = byNumber(f, 'MT9');
  assert.equal(c.bucket, 'unknown');
  assert.match(
    c.proposal!.reasons.join(' '),
    /bağlı dövrdədir: düzəlişi açıq dövrdə əl ilə əks yazılışla/,
  );
});

test('DVX ↔ books: VAT by month, e-qaimələr not booked, invoices DVX does not hold; İş masası', (t) => {
  const f = fixture(t, ':memory:', '2026-09-30');
  const s = setup(f);
  map(f, 'purchase', { taxId: SUPPLIER, dvxCode: '4802', productId: s.paper });
  load(f, 'purchase', [
    withGoods('MT1', '2026-09-05', SUPPLIER, [
      good('4802', 'Kağız', '10', '100', '1000.00', '180.00'),
    ]),
    withGoods('MT2', '2026-09-06', TELECOM, [good('1', 'Rabitə', '1', '50', '50.00', '9.00')]),
  ]);
  // Typed by hand: one with an e-qaimə number DVX does not have, one without any.
  f.invoice(
    'purchase',
    '2026-09-10',
    s.supplier,
    s.supplierContract,
    [{ productId: s.paper, quantity: '1', price: '100' }],
    { eqNumber: 'MT777' },
  );
  f.invoice('purchase', '2026-09-11', s.supplier, s.supplierContract, [
    { productId: s.paper, quantity: '1', price: '200' },
  ]);
  const r = f.query<EqReconcileView>({
    type: 'eqReconcile',
    companyId: f.companyId,
    direction: 'purchase',
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.deepEqual(r.covered, [{ from: '2026-09-05', to: '2026-09-06' }]);
  assert.deepEqual(r.months, [
    {
      month: '2026-09',
      dvxCount: 2,
      dvxNet: '1050.00',
      dvxVat: '189.00',
      bookedCount: 3,
      bookedVat: '234.00',
      difference: '-45.00',
    },
  ]);
  assert.deepEqual(
    r.notBooked.map((x) => x.number),
    ['MT2'],
  );
  // MT777 (10.09) lies outside the loaded period 05–06.09: not claimed missing yet.
  assert.deepEqual(r.notInDvx, []);
  assert.deepEqual(
    r.withoutEq.map((x) => x.total),
    ['236.00'],
  );
  // A file covering the whole month: now MT777 is missing in DVX.
  load(f, 'purchase', [
    withGoods('MT3', '2026-09-01', TELECOM, [good('1', 'Rabitə', '1', '50', '50.00', '9.00')]),
    withGoods('MT4', '2026-09-30', TELECOM, [good('1', 'Rabitə', '1', '50', '50.00', '9.00')]),
  ]);
  const again = f.query<EqReconcileView>({
    type: 'eqReconcile',
    companyId: f.companyId,
    direction: 'purchase',
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.deepEqual(again.covered, [{ from: '2026-09-01', to: '2026-09-30' }]);
  assert.deepEqual(
    again.notInDvx.map((x) => [x.number, x.eqNumber]),
    [['AQ-000002', 'MT777']],
  );
  const signals = f.home().warnings.filter((w) => w.eq === 'purchase');
  assert.deepEqual(
    signals.map((w) => w.kind),
    ['eqWaiting', 'eqVat', 'eqMissing'],
  );
  assert.match(signals[0]!.text, /3 e-qaimə DVX-də təsdiqlənib, uçota alınmayıb/);
});

// ---------------------------------------------------------------------------------------------
// Stage 4 audit (independent reviewer)

const paper10 = () => good('4802', 'Kağız', '10', '100', '1000.00', '180.00');

test('audit: an e-qaimə whose kind the goods report does not print is never booked by itself', (t) => {
  const f = fixture(t);
  const s = setup(f);
  map(f, 'purchase', { taxId: SUPPLIER, dvxCode: '4802', productId: s.paper });
  // "Mallar üzrə" prints no kind: a return or an advance e-qaimə would look like an ordinary one.
  const goodsOnly = (n: string) => ({
    ...withGoods(n, '2026-09-05', SUPPLIER, [paper10()]),
    kind: '',
  });
  assert.equal(load(f, 'purchase', [goodsOnly('MT1'), goodsOnly('MT2')]).posted, 0);
  const one = byNumber(f, 'MT1');
  assert.equal(one.bucket, 'proposal');
  assert.match(one.proposal!.reasons.join(' '), /“Qaimələr üzrə” hesabatını/);
  // The e-qaimə report says MT1 is a return: not booked as a purchase.
  const header = (n: string, kind: string) =>
    doc(n, '2026-09-05', SUPPLIER, { kind, net: '1000.00', vat: '180.00', base18: '1000.00' });
  load(f, 'purchase', [header('MT1', 'Qaytarma qaiməsi')], 'invoices');
  assert.equal(byNumber(f, 'MT1').bucket, 'unknown');
  // MT2 is an ordinary one: once the e-qaimə report says so, the confirmed entries book it.
  assert.equal(load(f, 'purchase', [header('MT2', 'Əsas')], 'invoices').posted, 1);
  assert.equal(byNumber(f, 'MT2').bucket, 'auto');
});

test('audit: linking writes an e-qaimə number only where no other invoice carries it', (t) => {
  const f = fixture(t);
  const s = setup(f);
  load(f, 'purchase', [withGoods('MT1', '2026-09-05', SUPPLIER, [paper10()])]);
  const numberless = f.invoice('purchase', '2026-09-05', s.supplier, s.supplierContract, [
    { productId: s.paper, quantity: '10', price: '100' },
  ]);
  f.invoice(
    'purchase',
    '2026-09-06',
    s.supplier,
    s.supplierContract,
    [{ productId: s.paper, quantity: '1', price: '5' }],
    { eqNumber: 'MT1' },
  );
  assert.throws(
    () =>
      f.exec({
        type: 'eqaime.link',
        companyId: f.companyId,
        documentId: byNumber(f, 'MT1').id,
        invoiceId: numberless.id,
      }),
    /MT1.*AQ-000002/,
  );
  assert.equal(f.db.get('SELECT eq_key FROM invoices WHERE id=?', numberless.id)!.eq_key, '');
});

test('audit: a correction applies to a linked invoice dated a few days from DVX, and it stays editable', (t) => {
  const f = fixture(t);
  const s = setup(f);
  const typed = f.invoice(
    'purchase',
    '2026-09-03',
    s.supplier,
    s.supplierContract,
    [{ productId: s.paper, quantity: '10', price: '100' }],
    { eqNumber: 'MT1' },
  );
  load(f, 'purchase', [withGoods('MT1', '2026-09-05', SUPPLIER, [paper10()])]);
  assert.equal(byNumber(f, 'MT1').invoiceId, typed.id);
  load(f, 'purchase', [
    {
      ...withGoods('MT9', '2026-09-20', SUPPLIER, [
        good('4802', 'Kağız', '9', '100', '900.00', '162.00'),
      ]),
      kind: 'Düzəliş qaiməsi',
      refNumber: 'MT1',
    },
  ]);
  const c = byNumber(f, 'MT9');
  assert.equal(c.proposal!.corrects!.invoiceDate, '2026-09-03');
  const apply = (memo: string) => {
    const inv = f.query<InvoiceDetail>({ type: 'invoice', companyId: f.companyId, id: typed.id });
    return f.invoice(
      'purchase',
      '2026-09-03',
      s.supplier,
      s.supplierContract,
      [{ productId: s.paper, quantity: '9', price: '100' }],
      {
        id: inv.id,
        version: inv.version,
        number: inv.number,
        eqNumber: 'MT9',
        memo,
        ...(memo ? {} : { eqDocumentId: c.id }),
      },
    );
  };
  // The form keeps the invoice's own date (03.09), as the proposal says.
  apply('');
  assert.deepEqual([byNumber(f, 'MT9').bucket, byNumber(f, 'MT9').invoiceId], ['posted', typed.id]);
  // A later correction of the same invoice (its memo) is not refused for the date.
  assert.equal(apply('Kağız, düzəlişdən sonra').version, 3);
});
