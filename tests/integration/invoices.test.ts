import test from 'node:test';
import assert from 'node:assert/strict';
import type { InvoiceLineInput } from '../../src/contracts/commands.js';
import type { InvoiceDetail, InvoiceSummary } from '../../src/contracts/queries.js';
import { fixture, type Cmd } from './fixture.js';

type F = ReturnType<typeof fixture>;
type InvoiceCmd = Extract<Cmd, { type: 'invoice.save' }>;

const invoice = (
  f: F,
  direction: 'sale' | 'purchase',
  date: string,
  partnerId: string,
  contractId: string,
  lines: Partial<InvoiceLineInput>[],
  extra: Partial<InvoiceCmd> = {},
) =>
  f.exec({
    type: 'invoice.save',
    companyId: f.companyId,
    direction,
    number: '',
    date,
    partnerId,
    contractId,
    rate: '',
    pricesIncludeVat: false,
    eqSeries: '',
    eqNumber: '',
    memo: '',
    lines: lines.map((l) => ({
      productId: '',
      quantity: '1',
      price: '1',
      vatRate: '18',
      memo: '',
      ...l,
    })),
    ...extra,
  });
const detail = (f: F, id: string) =>
  f.query<InvoiceDetail>({ type: 'invoice', companyId: f.companyId, id });
const postings = (f: F, id: string) =>
  detail(f, id).postings.map((p) => [
    p.dt.account,
    p.kt.account,
    p.amount,
    ...(p.quantity ? [p.quantity] : []),
    ...(p.dt.curAmount || p.kt.curAmount ? [`${p.dt.curAmount}|${p.kt.curAmount}`] : []),
  ]);

/**
 * The September example of docs/QERARLAR.md, now with a purchase and a sale invoice instead of
 * manual operations: the ledger must come out identical to the qəpik.
 */
function september(f: F) {
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Ağarza Ağalarov', '', 'individual');
  const supplier = f.partner('Təchizat ASC', '1700000002');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const bankK = f.bankAccount(kapital, 'AZ12AIIB38060019441234567890', '223.01', 'AZN', 'Kapital');
  const bankP = f.bankAccount(kapital, 'AZ55PAHA40060AZNHC0101091203', '223.01', 'AZN', 'PAŞA');
  const deposit = f.bankAccount(kapital, 'AZ77AIIB38060019449999999999', '224.04', 'AZN', 'ƏDV');
  const c12 = f.contract(supplier, '12', 'purchase');
  const c7 = f.contract(customer, '7', 'sale');
  const paper = f.product('Kağız A4', 'qutu');
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  const capitalIn = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const L = f.line;
  f.operation('2026-08-31', [
    L('223.01', [bankK], '301', [founder, capitalIn], '30000'),
    L('223.01', [bankP], '301', [founder, capitalIn], '10000'),
    L('224.04', [deposit], '301', [founder, capitalIn], '3000'),
  ]);
  const purchase = invoice(
    f,
    'purchase',
    '2026-09-05',
    supplier,
    c12,
    [{ productId: paper, quantity: '100', price: '100' }],
    { eqSeries: 'AA', eqNumber: '001' },
  );
  const purchaseDoc = `invoice:${purchase.id}`;
  f.operation('2026-09-18', [
    L('531.01', [supplier, c12, purchaseDoc], '223.01', [bankK], '10000'),
    L('531.01', [supplier, c12, purchaseDoc], '224.04', [deposit], '1800'),
  ]);
  // 70 boxes for 15 000 with VAT: 70 × 214.2857 = 14 999.999 → 15 000.00, VAT 2 288.14.
  const sale = invoice(
    f,
    'sale',
    '2026-09-08',
    customer,
    c7,
    [{ productId: paper, quantity: '70', price: '214.2857' }],
    { pricesIncludeVat: true },
  );
  const saleDoc = `invoice:${sale.id}`;
  const receipt = f.operation('2026-09-15', [
    L('223.01', [bankK], '211.01', [customer, c7, saleDoc], '12711.86'),
    L('223.01', [bankK], '543.01', [customer, c7, ''], '2542.38'),
    L('224.04', [deposit], '211.01', [customer, c7, saleDoc], '2288.14'),
    L('224.04', [deposit], '543.01', [customer, c7, ''], '457.62'),
  ]);
  f.operation('2026-09-30', [L('721', [fees], '223.01', [bankK], '3')]);
  return { supplier, customer, c12, c7, paper, purchase, sale, saleDoc, receipt, bankK };
}

test('September through invoices: postings, FIFO cost and the trial balance to the qəpik', (t) => {
  const f = fixture(t);
  const s = september(f);
  assert.deepEqual(postings(f, s.purchase.id), [
    ['205', '531.01', '10000.00', '100'],
    ['241', '531.01', '1800.00'],
  ]);
  assert.deepEqual(postings(f, s.sale.id), [
    ['211.01', '601', '15000.00'],
    ['604.1', '521.01', '2288.14'],
    ['701', '205', '7000.00', '70'],
  ]);
  const d = detail(f, s.sale.id);
  assert.deepEqual(
    [d.number, d.net, d.vat, d.total],
    ['SQ-000001', '12711.86', '2288.14', '15000.00'],
  );
  assert.deepEqual(d.postings[1]!.kt.skNames, ['Vergi (haqq)']);
  assert.deepEqual(d.postings[2]!.dt.skNames, [
    'Əsas nomenklatura qrupu',
    'Satılmış malların maya dəyəri',
  ]);
  assert.equal(detail(f, s.purchase.id).number, 'AQ-000001');
  const tb = f.trial('2026-09-01', '2026-09-30');
  assert.deepEqual(tb.totals, {
    openDt: '43000.00',
    openKt: '43000.00',
    turnDt: '65891.14',
    turnKt: '65891.14',
    closeDt: '63288.14',
    closeKt: '63288.14',
  });
  const stock = f.row(f.trial('2026-09-01', '2026-09-30', ['a:205']), `a:205|${s.paper}`)!;
  assert.deepEqual([stock.closeDt, stock.closeQty], ['3000.00', '30']);
  const list = f.query<InvoiceSummary[]>({
    type: 'invoices',
    companyId: f.companyId,
    direction: 'purchase',
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.deepEqual(
    list.map((i) => [i.number, i.partner, i.eqNumber, i.total]),
    [['AQ-000001', 'Təchizat ASC', '001', '11800.00']],
  );
});

test('October: the next sale invoice offsets the September advance by itself', (t) => {
  const f = fixture(t);
  const s = september(f);
  assert.match(
    f
      .home()
      .warnings.map((w) => w.text)
      .join('\n'),
    /^$/,
  );
  const inv = invoice(
    f,
    'sale',
    '2026-10-06',
    s.customer,
    s.c7,
    [{ productId: s.paper, quantity: '10', price: '500' }],
    { pricesIncludeVat: true },
  );
  assert.deepEqual(postings(f, inv.id), [
    ['211.01', '601', '5000.00'],
    ['604.1', '521.01', '762.71'],
    ['701', '205', '1000.00', '10'],
    ['543.01', '211.01', '3000.00'],
  ]);
  const self = `invoice:${inv.id}`;
  const tb = f.trial('2026-10-01', '2026-10-31', [
    'a:211',
    'a:211.01',
    `a:211.01|${s.customer}`,
    `a:211.01|${s.customer}|${s.c7}`,
    'a:543',
  ]);
  assert.equal(f.row(tb, `a:211.01|${s.customer}|${s.c7}|${self}`)!.closeDt, '2000.00');
  assert.equal(f.row(tb, 'a:543')!.closeKt, '');
  assert.equal(f.home().warnings.length, 0);
  // The advance's document is the receipt operation it came from.
  assert.equal(detail(f, inv.id).postings[3]!.dt.sk[2], `operation:${s.receipt.id}`);
});

test('FIFO: oldest receipt first, partial layers, not enough stock is refused', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Təchizat ASC', '1700000002');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const cp = f.contract(supplier, '1', 'purchase');
  const cs = f.contract(customer, '1', 'sale');
  const pen = f.product('Qələm');
  invoice(f, 'purchase', '2026-09-01', supplier, cp, [
    { productId: pen, quantity: '10', price: '1' },
  ]);
  invoice(f, 'purchase', '2026-09-02', supplier, cp, [
    { productId: pen, quantity: '10', price: '2' },
  ]);
  const sale = invoice(f, 'sale', '2026-09-03', customer, cs, [
    { productId: pen, quantity: '4', price: '5' },
    { productId: pen, quantity: '11', price: '5' },
  ]);
  const cost = detail(f, sale.id)
    .postings.filter((p) => p.dt.account === '701')
    .map((p) => p.amount);
  assert.deepEqual(cost, ['4.00', '16.00'], '4 × 1; then 6 × 1 + 5 × 2');
  assert.throws(
    () =>
      invoice(f, 'sale', '2026-09-04', customer, cs, [
        { productId: pen, quantity: '6', price: '5' },
      ]),
    /kifayət qədər qalıq yoxdur \(qalıq 5, tələb 6\)/,
  );
  // Correcting the sale recomputes its cost without counting itself.
  f.exec({
    type: 'invoice.save',
    companyId: f.companyId,
    id: sale.id,
    version: 1,
    direction: 'sale',
    number: '',
    date: '2026-09-03',
    partnerId: customer,
    contractId: cs,
    rate: '',
    pricesIncludeVat: false,
    eqSeries: '',
    eqNumber: '',
    memo: '',
    lines: [{ productId: pen, quantity: '20', price: '5', vatRate: '18', memo: '' }],
  });
  const d = detail(f, sale.id);
  assert.equal(d.version, 2);
  assert.equal(d.postings.find((p) => p.dt.account === '701')!.amount, '30.00');
  const stock = f.row(f.trial('2026-09-01', '2026-09-30', ['a:205']), `a:205|${pen}`)!;
  assert.deepEqual([stock.closeDt, stock.closeQty], ['', '']);
  // Cancelling the sale brings the stock back.
  f.exec({
    type: 'invoice.cancel',
    companyId: f.companyId,
    id: sale.id,
    version: 2,
    reason: 'səhv',
  });
  const back = f.row(f.trial('2026-09-01', '2026-09-30', ['a:205']), `a:205|${pen}`)!;
  assert.deepEqual([back.closeDt, back.closeQty], ['30.00', '20']);
});

test('purchase: services to 721, VAT to cost when chosen, prices with VAT, e-qaimə once', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Rabitə MMC', '1700000005');
  const c = f.contract(supplier, 'R-1', 'purchase');
  const net = f.product('İnternet xidməti', 'ay', 'service');
  const chairs = f.product('Stul', 'ədəd', 'material');
  const comm = f.item('expenseItem', 'Rabitə');
  assert.throws(
    () => invoice(f, 'purchase', '2026-09-10', supplier, c, [{ productId: net, price: '100' }]),
    /xərc maddəsini seçin/,
  );
  const a = invoice(
    f,
    'purchase',
    '2026-09-10',
    supplier,
    c,
    [
      { productId: net, price: '118', expenseItemId: comm },
      { productId: chairs, quantity: '2', price: '59', vatTreatment: 'cost' },
    ],
    { pricesIncludeVat: true, eqSeries: 'mt', eqNumber: '2609001' },
  );
  assert.deepEqual(postings(f, a.id), [
    ['721', '531.01', '100.00'],
    ['241', '531.01', '18.00'],
    ['201', '531.01', '118.00', '2'],
  ]);
  assert.equal(detail(f, a.id).eqSeries, 'MT');
  assert.throws(
    () =>
      invoice(f, 'purchase', '2026-09-11', supplier, c, [{ productId: chairs, price: '1' }], {
        eqSeries: 'MT',
        eqNumber: '2609001',
      }),
    /artıq AQ-000001 nömrəli qaimədə/,
  );
  // Saving the same content again changes nothing.
  const again = f.exec({
    type: 'invoice.save',
    companyId: f.companyId,
    id: a.id,
    version: 1,
    direction: 'purchase',
    number: '',
    date: '2026-09-10',
    partnerId: supplier,
    contractId: c,
    rate: '',
    pricesIncludeVat: true,
    eqSeries: 'mt',
    eqNumber: '2609001',
    memo: '',
    lines: [
      { productId: net, quantity: '1', price: '118', vatRate: '18', expenseItemId: comm, memo: '' },
      {
        productId: chairs,
        quantity: '2',
        price: '59',
        vatRate: '18',
        vatTreatment: 'cost',
        memo: '',
      },
    ],
  });
  assert.equal(again.version, 1);
});

test('currency purchase: rate, currency amounts and a currency advance at its own rate', (t) => {
  const f = fixture(t);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const usd = f.bankAccount(bank, 'AZ10AIIB38060019840000000001', '223.02', 'USD', 'USD');
  const vendor = f.partner('Global Logistics LLC', '', 'foreign');
  const c = f.contract(vendor, 'GL-7', 'purchase', 'USD');
  const freight = f.product('Yükdaşıma', 'xidmət', 'service');
  const transport = f.item('expenseItem', 'Nəqliyyat');
  // 50 USD advance at 1.6000.
  f.operation('2026-09-01', [
    f.line('243.02', [vendor, c, ''], '223.02', [usd], '80', {
      dtCurAmount: '50',
      ktCurAmount: '50',
    }),
  ]);
  assert.throws(
    () =>
      invoice(f, 'purchase', '2026-09-10', vendor, c, [
        { productId: freight, price: '100', vatRate: 'nontaxable', expenseItemId: transport },
      ]),
    /USD məzənnəsi/,
  );
  const inv = invoice(
    f,
    'purchase',
    '2026-09-10',
    vendor,
    c,
    [{ productId: freight, price: '100', vatRate: 'nontaxable', expenseItemId: transport }],
    { rate: '1.7000' },
  );
  assert.deepEqual(postings(f, inv.id), [
    ['721', '531.02', '170.00', '|100.00'],
    ['531.02', '243.02', '80.00', '50.00|50.00'],
  ]);
  const d = detail(f, inv.id);
  assert.deepEqual([d.currency, d.rate, d.total, d.totalAzn], ['USD', '1.7', '100.00', '170.00']);
  const tb = f.trial('2026-09-01', '2026-09-30', [
    'a:531',
    'a:531.02',
    `a:531.02|${vendor}`,
    `a:531.02|${vendor}|${c}`,
    'a:243',
  ]);
  const doc = f.row(tb, `a:531.02|${vendor}|${c}|invoice:${inv.id}`)!;
  assert.deepEqual([doc.turnDt, doc.turnKt, doc.closeKt], ['80.00', '170.00', '90.00']);
  const contract = f.row(tb, `a:531.02|${vendor}|${c}`)!;
  assert.deepEqual([contract.currency, contract.closeCur], ['USD', '-50.00']);
  assert.equal(f.row(tb, 'a:243')!.closeDt, '');
});

test('a company that is not a VAT payer cannot charge 18%; purchases go to cost', (t) => {
  const f = fixture(t);
  const co = f.catalog().company;
  f.exec({
    type: 'company.update',
    companyId: f.companyId,
    version: co.version,
    name: co.name,
    vatPayer: false,
    purchaseVat: 'cost',
  });
  const customer = f.partner('Alıcı MMC', '1700000001');
  const c = f.contract(customer, '1', 'sale');
  const work = f.product('Məsləhət', 'saat', 'service');
  assert.throws(
    () => invoice(f, 'sale', '2026-09-10', customer, c, [{ productId: work, price: '10' }]),
    /ƏDV ödəyicisi deyil/,
  );
  const s = invoice(f, 'sale', '2026-09-10', customer, c, [
    { productId: work, price: '10', vatRate: 'nontaxable' },
  ]);
  assert.deepEqual(postings(f, s.id), [['211.01', '601', '10.00']]);
  assert.deepEqual(detail(f, s.id).postings[0]!.kt.skNames, [
    'Xidmət satışı',
    'ƏDV-yə cəlb olunmayan',
  ]);
});
