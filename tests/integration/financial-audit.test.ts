/**
 * Stage 10 audit (an independent reviewer): every defect found has its failing `audit:` test
 * here first, then the fix (PROJECT_STATE.md "Mərhələ 10 auditi").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeclarationKind, DeclarationView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;
const view = (f: F, kind: DeclarationKind, period: string) =>
  f.query<DeclarationView>({ type: 'declaration', companyId: f.companyId, kind, period });
const figures = (v: DeclarationView, key: string) => {
  for (const s of v.sections) {
    const r = s.rows.find((x) => x.key === key);
    if (r) return r.values;
  }
  throw new Error(`row ${key} not found`);
};

/** A company with 100 000 in the bank, a truck bought for 50 000 and in service from 01.03.2026. */
function truck(f: F) {
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Təsisçi', '', 'individual');
  const dealer = f.partner('Avto MMC', '1700000011');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const cd = f.contract(dealer, 'A-1', 'purchase');
  const cs = f.contract(customer, 'S-1', 'sale');
  const bank = f.bankAccount(kapital, 'AZ12AIIB38060019441234567890');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  f.bank('in', '2026-01-15', bank, [f.bankLine('301', [founder, capital], '100000')]);
  const product = f.product('Mercedes Actros', 'ədəd', 'asset');
  const bought = f.invoice('purchase', '2026-02-20', dealer, cd, [
    { productId: product, quantity: '1', price: '50000', vatRate: 'exempt' },
  ]);
  const asset = f.exec({
    type: 'fixedAsset.save',
    companyId: f.companyId,
    name: 'Mercedes Actros',
    group: 'transport',
    archived: false,
  } as never).id!;
  f.exec({
    type: 'asset.save',
    companyId: f.companyId,
    kind: 'commission',
    date: '2026-03-01',
    lines: [
      {
        assetId: asset,
        productId: product,
        quantity: '1',
        lifeMonths: 60,
        expenseAccount: '701',
        expenseSk: [
          f.item('productGroup', 'Əsas nomenklatura qrupu'),
          f.item('expenseItem', 'Amortizasiya'),
        ],
      },
    ],
  } as never);
  return { bank, dealer, customer, cd, cs, product, asset, bought };
}

test('audit: a fixed asset sold before any depreciation is investing (the invoice credits 111 only)', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  const { bank, customer, cs, product, asset } = truck(f);
  // Sold in the month it went into service: no 112 to debit, the sale's entry is Dt 731 / Kt 111.
  f.invoice('sale', '2026-03-20', customer, cs, [
    { productId: product, quantity: '1', price: '45000', vatRate: 'exempt', assetId: asset },
  ]);
  f.bank('in', '2026-03-25', bank, [f.bankLine('211.01', [customer, cs], '45000')]);
  const v = view(f, 'cashFlowStatement', '2026');
  assert.equal(figures(v, 'f:i:sell')[0], '45000.00');
  assert.equal(figures(v, 'f:o:sales')[0], '0.00');
});

test('audit: an invoice corrected from a fixed asset to a service is no longer investing', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  const { bank } = truck(f);
  const dealer = f.partner('Ofis MMC', '1700000012');
  const cd = f.contract(dealer, 'O-1', 'purchase');
  const office = f.product('Ofis avadanlığı', 'ədəd', 'asset');
  const service = f.product('Ofis xidməti', 'ay', 'service');
  const fees = f.item('expenseItem', 'Ofis xərcləri');
  // Booked to 113 by mistake, then corrected to the service it was: its storno still debits 113.
  const wrong = f.invoice('purchase', '2026-04-01', dealer, cd, [
    { productId: office, quantity: '1', price: '2000', vatRate: 'exempt' },
  ]);
  f.invoice(
    'purchase',
    '2026-04-01',
    dealer,
    cd,
    [{ productId: service, quantity: '1', price: '2000', vatRate: 'exempt', expenseItemId: fees }],
    { id: wrong.id, version: 1 } as never,
  );
  f.bank('out', '2026-04-10', bank, [f.bankLine('531.01', [dealer, cd], '2000')]);
  const v = view(f, 'cashFlowStatement', '2026');
  // The truck (50 000) is not paid yet: 2 000 is the corrected service, operating.
  assert.equal(figures(v, 'f:i:buy')[0], '0.00');
  assert.equal(figures(v, 'f:o:goods')[0], '-2000.00');
});

test('audit: income booked straight against 343 is the year’s profit in equity, its 343 side unclassified', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  const { bank } = truck(f);
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  // A past year's error corrected through 343 into this year's income (Dt 343 / Kt 611), and a
  // bank fee: the M/Z counts the 611, so the equity's profit must too.
  f.operation('2026-03-02', [
    f.line('343', [], '611', [f.item('incomeType', 'Xidmət satışı')], '100'),
  ]);
  f.bank('out', '2026-03-05', bank, [f.bankLine('721', [fees], '50')]);
  const income = view(f, 'incomeStatement', '2026');
  assert.equal(figures(income, 'i:net')[0], '50.00');
  const v = view(f, 'equityStatement', '2026');
  assert.equal(figures(v, 'e:2026:profit')[4], '50.00');
  assert.equal(figures(v, 'e:2026:other')[4], '-100.00');
  assert.equal(figures(v, 'e:2026:close')[4], '-50.00');
  assert.ok(!v.checks.some((c) => /M\/Z-nin xalis mənfəətindən/.test(c.text)));
  assert.ok(v.checks.some((c) => /təsnif olunmamış dəyişiklik var \(343 ↔ 611\)/.test(c.text)));
  const sheet = view(f, 'balanceSheet', '2026');
  assert.deepEqual(
    ['c:equity', 'c:profit'].map((k) => figures(sheet, k)[0]),
    ['0.00', '0.00'],
  );
});
