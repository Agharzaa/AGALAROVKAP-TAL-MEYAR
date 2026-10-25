/**
 * Independent audit of stage 7 (fixed assets, 0.8.0–0.8.2): every test here failed before its
 * fix. Findings and fixes — PROJECT_STATE.md, "Audit of stage 7".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  DepreciationSchedule,
  FixedAssetRow,
  VatSummaryView,
} from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;
const run = (f: F, cmd: object) => f.exec(cmd as never);
const balance = (f: F, account: string, s1?: string) =>
  BigInt(
    String(
      f.db.get(
        `SELECT COALESCE(SUM(debit-credit),0) AS b FROM registers WHERE company_id=? AND account=?${s1 ? ' AND s1=?' : ''}`,
        f.companyId,
        account,
        ...(s1 ? [s1] : []),
      )!.b,
    ),
  );
const asset = (f: F, name: string) =>
  run(f, {
    type: 'fixedAsset.save',
    companyId: f.companyId,
    name,
    group: 'transport',
    archived: false,
  }).id!;
const closeMonth = (f: F, month: string) =>
  run(f, { type: 'closing.post', companyId: f.companyId, month, acknowledged: true });

/** The Actros of §9: bought 12.10.2026 for 50 000 + VAT, in service 15.10.2026, 60 months. */
function inService(f: F) {
  const supplier = f.partner('Avto MMC', '1700000011');
  const contract = f.contract(supplier, 'A-1', 'purchase');
  const truck = f.product('Mercedes Actros', 'ədəd', 'asset');
  const purchase = f.invoice('purchase', '2026-10-12', supplier, contract, [
    { productId: truck, quantity: '1', price: '50000' },
  ]);
  const actros = asset(f, 'Mercedes Actros');
  const doc = run(f, {
    type: 'asset.save',
    companyId: f.companyId,
    kind: 'commission',
    date: '2026-10-15',
    lines: [
      {
        assetId: actros,
        productId: truck,
        quantity: '1',
        lifeMonths: 60,
        expenseAccount: '701',
        expenseSk: [
          f.item('productGroup', 'Əsas nomenklatura qrupu'),
          f.item('expenseItem', 'Amortizasiya'),
        ],
      },
    ],
  });
  return { actros, truck, doc, purchase, supplier, contract };
}
const buyer = (f: F) => {
  const b = f.partner('Alıcı MMC', '1700000021');
  return { b, c: f.contract(b, 'S-1', 'sale') };
};

test('audit: the VAT of a fixed-asset sale (Dt 611 / Kt 521.01) is in the VAT summary', (t) => {
  const f = fixture(t);
  const { actros, truck } = inService(f);
  const { b, c } = buyer(f);
  f.invoice('sale', '2026-10-25', b, c, [
    { productId: truck, assetId: actros, quantity: '1', price: '40000' },
  ]);
  assert.equal(balance(f, '521.01'), -720_000n);
  const v = f.query<VatSummaryView>({
    type: 'vatSummary',
    companyId: f.companyId,
    month: '2026-10',
  });
  assert.deepEqual(v.sales, [{ rate: '18', label: '18%', base: '40000.00', vat: '7200.00' }]);
  assert.equal(v.salesVat, '7200.00');
  assert.equal(v.payable, '7200.00');
});

test('audit: one fixed asset on two lines of a sale invoice is not written off twice', (t) => {
  const f = fixture(t);
  const { actros, truck } = inService(f);
  const { b, c } = buyer(f);
  const line = { productId: truck, assetId: actros, quantity: '1', price: '20000' };
  assert.throws(
    () => f.invoice('sale', '2026-10-25', b, c, [line, line]),
    /ikinci dəfədir|iki dəfə/,
  );
  assert.equal(balance(f, '111', actros), 5_000_000n);
  assert.equal(balance(f, '731'), 0n);
});

test('audit: a sale line of a fixed asset is not booked by manual postings (no write-off)', (t) => {
  const f = fixture(t);
  const { actros, truck } = inService(f);
  const { b, c } = buyer(f);
  const income = f.item('incomeType', 'Əsas vəsaitin satışı');
  assert.throws(
    () =>
      f.invoice(
        'sale',
        '2026-10-25',
        b,
        c,
        [{ productId: truck, assetId: actros, quantity: '1', price: '40000' }],
        { postings: [f.line('211.01', [b, c, ''], '611', [income], '40000')] },
      ),
    /əl ilə/,
  );
  assert.equal(balance(f, '111', actros), 5_000_000n);
});

test('audit: the commission of a sold or disposed asset is neither cancelled nor corrected', (t) => {
  const f = fixture(t);
  const { actros, truck, doc } = inService(f);
  const { b, c } = buyer(f);
  const sale = f.invoice('sale', '2026-10-25', b, c, [
    { productId: truck, assetId: actros, quantity: '1', price: '40000' },
  ]);
  assert.throws(
    () =>
      run(f, {
        type: 'asset.cancel',
        companyId: f.companyId,
        id: doc.id,
        version: doc.version,
        reason: 'səhv',
      }),
    /satılıb|silinib/,
  );
  assert.throws(
    () =>
      run(f, {
        type: 'asset.save',
        companyId: f.companyId,
        kind: 'commission',
        id: doc.id,
        version: doc.version,
        date: '2026-10-20',
        lines: [
          {
            assetId: actros,
            productId: truck,
            quantity: '1',
            lifeMonths: 36,
            expenseAccount: '701',
            expenseSk: [
              f.item('productGroup', 'Əsas nomenklatura qrupu'),
              f.item('expenseItem', 'Amortizasiya'),
            ],
          },
        ],
      }),
    /satılıb|silinib/,
  );
  assert.deepEqual([balance(f, '111', actros), balance(f, '113', truck)], [0n, 0n]);
  // Once the sale is cancelled, the commission can go.
  run(f, {
    type: 'invoice.cancel',
    companyId: f.companyId,
    id: sale.id,
    version: sale.version,
    reason: 'səhv',
  });
  run(f, {
    type: 'asset.cancel',
    companyId: f.companyId,
    id: doc.id,
    version: doc.version,
    reason: 'səhv',
  });
  assert.deepEqual([balance(f, '111', actros), balance(f, '113', truck)], [0n, 5_000_000n]);
});

test('audit: a disposal document blocks cancelling the commission too', (t) => {
  const f = fixture(t);
  const { actros, doc } = inService(f);
  run(f, {
    type: 'asset.save',
    companyId: f.companyId,
    kind: 'disposal',
    date: '2026-10-28',
    lines: [{ assetId: actros }],
  });
  assert.throws(
    () =>
      run(f, {
        type: 'asset.cancel',
        companyId: f.companyId,
        id: doc.id,
        version: doc.version,
        reason: 'səhv',
      }),
    /silinib/,
  );
  assert.deepEqual([balance(f, '111', actros), balance(f, '731')], [0n, 5_000_000n]);
});

test('audit: a purchase whose 113 went into service keeps its amount (no 113 left at zero quantity)', (t) => {
  const f = fixture(t);
  const { truck, purchase, supplier, contract } = inService(f);
  assert.throws(
    () =>
      f.invoice(
        'purchase',
        '2026-10-12',
        supplier,
        contract,
        [{ productId: truck, quantity: '1', price: '40000' }],
        { id: purchase.id, version: purchase.version },
      ),
    /istismara verilib/,
  );
  assert.equal(balance(f, '113', truck), 0n);
  // A change that leaves the asset line alone is still accepted.
  const other = f.product('Kağız', 'ədəd', 'material');
  f.invoice(
    'purchase',
    '2026-10-12',
    supplier,
    contract,
    [
      { productId: truck, quantity: '1', price: '50000' },
      { productId: other, quantity: '1', price: '10' },
    ],
    { id: purchase.id, version: purchase.version },
  );
  assert.equal(balance(f, '113', truck), 0n);
});

test('audit: the schedule forecasts nothing for an asset after its sale', (t) => {
  const f = fixture(t);
  const { actros, truck } = inService(f);
  closeMonth(f, '2026-10');
  const { b, c } = buyer(f);
  f.invoice('sale', '2026-11-10', b, c, [
    { productId: truck, assetId: actros, quantity: '1', price: '40000' },
  ]);
  const s = f.query<DepreciationSchedule>({
    type: 'depreciationSchedule',
    companyId: f.companyId,
    year: 2026,
  });
  assert.deepEqual(
    s.rows[0]!.cells.slice(9).map((x) => x.amount),
    ['0.00', '0.00', '0.00'],
  );
  assert.equal(s.total, '0.00');
});

test('audit: months left count the depreciation made up for a month closed without it', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  const { actros } = inService(f);
  closeMonth(f, '2026-10');
  // November locked by the period alone, then December closed: two months in one posting.
  run(f, { type: 'period.close', companyId: f.companyId, through: '2026-11-30' });
  closeMonth(f, '2026-12');
  assert.equal(balance(f, '112', actros), -166_666n);
  const [row] = f.query<FixedAssetRow[]>({
    type: 'fixedAssets',
    companyId: f.companyId,
    date: '2026-12-31',
  });
  assert.deepEqual([row!.depreciated, row!.monthsLeft], ['1666.66', 58]);
});

test('audit: selling an asset of a company whose 111 is still by nomenclature says why', (t) => {
  const f = fixture(t);
  // 111 kept by nomenclature (a database whose 111 had postings before v15).
  f.db.run(
    `UPDATE accounts SET subkonto='["product"]', quantitative=1 WHERE company_id=? AND code='111'`,
    f.companyId,
  );
  const truck = f.product('Mercedes Actros', 'ədəd', 'asset');
  const actros = asset(f, 'Mercedes Actros');
  const { b, c } = buyer(f);
  assert.throws(
    () =>
      f.invoice('sale', '2026-10-25', b, c, [
        { productId: truck, assetId: actros, quantity: '1', price: '40000' },
      ]),
    /subkontosu "Əsas vəsait" deyil.*dəyişdirilmir/,
  );
});
