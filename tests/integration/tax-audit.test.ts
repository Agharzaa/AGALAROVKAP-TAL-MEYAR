/**
 * Stage 9 audit (independent, 29.10.2026, 0.9.9): the defects found in the profit tax and the tax
 * depreciation of 0.9.5–0.9.8, each first as a failing test (docs/MERHELE-9-VERGI-BEYANNAMELERI.md
 * §5.3, §5.4; PROJECT_STATE.md "Mərhələ 9 auditi").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { declaration, figures, september } from './declarations.test.js';

type F = ReturnType<typeof fixture>;
const run = (f: F, cmd: object) => f.exec(cmd as never);
const close = (f: F, month: string) =>
  run(f, { type: 'closing.post', companyId: f.companyId, month, acknowledged: true });
const amount = (f: F, key: string, year = '2026') =>
  figures(declaration(f, 'profitTax', year), key)[0];

/** A customer, its contract and the income type of a service. */
function sales(f: F) {
  const customer = f.partner('Alıcı MMC', '1700000001');
  const cs = f.contract(customer, 'S-1', 'sale');
  return { customer, cs, service: f.item('incomeType', 'Xidmət satışı') };
}

/** A truck of 50 000 put into service on 01.03.2026, its depreciation under `expenseItem`. */
function truck(f: F, expenseItem: string) {
  const supplier = f.partner('Avto MMC', '1700000011');
  const cp = f.contract(supplier, 'A-1', 'purchase');
  const product = f.product('Mercedes Actros', 'ədəd', 'asset');
  f.invoice('purchase', '2026-02-20', supplier, cp, [
    { productId: product, quantity: '1', price: '50000', vatRate: 'exempt' },
  ]);
  const assetId = run(f, {
    type: 'fixedAsset.save',
    companyId: f.companyId,
    name: 'Mercedes Actros',
    group: 'transport',
    archived: false,
  }).id!;
  run(f, {
    type: 'asset.save',
    companyId: f.companyId,
    kind: 'commission',
    date: '2026-03-01',
    lines: [
      {
        assetId,
        productId: product,
        quantity: '1',
        lifeMonths: 60,
        expenseAccount: '701',
        expenseSk: [
          f.item('productGroup', 'Əsas nomenklatura qrupu'),
          f.item('expenseItem', expenseItem),
        ],
      },
    ],
  });
}

test('audit: the books’ depreciation is excluded whatever expense item the asset posts it to', (t) => {
  const f = fixture(t, ':memory:', '2026-07-15');
  // The accountant books the truck's depreciation as a transport expense, not "Amortizasiya".
  truck(f, 'Nəqliyyat');
  for (const m of ['02', '03', '04', '05']) close(f, `2026-${m}`);
  // April and May: 2 × 833,33 in the books; the tax deducts its own 12 500 instead.
  assert.equal(amount(f, 'e:books'), '1666.66');
  assert.equal(amount(f, 'e:depreciation'), '-1666.66');
  assert.equal(amount(f, 'e:deductible'), '0.00');
  assert.equal(amount(f, 'e:taxDepreciation'), '12500.00');
});

test('audit: “paid” is this year’s advances — not last year’s tax, nor interest or sanctions', (t) => {
  const f = fixture(t, ':memory:', '2027-05-15');
  const { customer, cs, service } = sales(f);
  const L = f.line;
  f.operation('2026-06-30', [L('211.01', [customer, cs, ''], '601', [service, '0'], '10000')]);
  for (let m = 6; m <= 12; m++) close(f, `2026-${String(m).padStart(2, '0')}`);
  assert.equal(amount(f, 't:tax'), '2000.00');
  const tax = f.catalog().items.find((i) => i.role === 'vatTax')!.id;
  const interest = f.item('paymentKind', 'Faiz');
  // March 2027: 2026's tax paid, with interest for a late advance; April: the first 2027 advance.
  f.operation('2027-03-20', [
    L('521.04', [tax], '211.01', [customer, cs, ''], '2000'),
    L('521.04', [interest], '211.01', [customer, cs, ''], '35'),
  ]);
  f.operation('2027-04-20', [L('521.04', [tax], '211.01', [customer, cs, ''], '500')]);
  f.operation('2027-05-10', [L('211.01', [customer, cs, ''], '601', [service, '0'], '10000')]);
  assert.equal(amount(f, 't:tax', '2027'), '2000.00');
  assert.equal(amount(f, 't:paid', '2027'), '500.00');
  assert.equal(amount(f, 't:payable', '2027'), '1500.00');
});

test('audit: an opening balance dated 31.12 enters the next year — no tax depreciation, no loss before Meyar', (t) => {
  const f = fixture(t);
  const kamaz = run(f, {
    type: 'fixedAsset.save',
    companyId: f.companyId,
    name: 'Kamaz',
    group: 'transport',
    archived: false,
  }).id!;
  run(f, {
    type: 'asset.save',
    companyId: f.companyId,
    kind: 'opening',
    date: '2025-12-31',
    lines: [
      {
        assetId: kamaz,
        cost: '60000',
        accumulated: '10000',
        taxResidual: '45000',
        lifeMonths: 60,
        remainingMonths: 48,
        expenseAccount: '721',
        expenseSk: [f.item('expenseItem', 'Amortizasiya')],
        counterAccount: '343',
        counterSk: [],
      },
    ],
  });
  const dep = figures(declaration(f, 'taxDepreciation', '2026'), 't:depreciation');
  // The residual at 31.12.2025 is 45 000: 2026 depreciates it once, 25% → 11 250.
  assert.equal(dep.at(-1), '11250.00');
  assert.equal(figures(declaration(f, 'taxDepreciation', '2025'), 't:depreciation').at(-1), '0.00');
  assert.equal(amount(f, 't:losses'), '0.00 / 0.00');
});

test('audit: a closed year whose return no longer matches the posted tax says so', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  const { customer, cs, service } = sales(f);
  const L = f.line;
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  f.operation('2026-06-30', [L('211.01', [customer, cs, ''], '601', [service, '0'], '10000')]);
  f.operation('2026-07-31', [L('721', [fees], '211.01', [customer, cs, ''], '2000')]);
  for (let m = 6; m <= 12; m++) close(f, `2026-${String(m).padStart(2, '0')}`);
  assert.equal(amount(f, 't:tax'), '1600.00');
  assert.ok(!declaration(f, 'profitTax', '2026').checks.some((c) => /yazılıb/.test(c.text)));
  // After the year was closed the item is marked "not deductible": the figures change.
  const item = f.catalog().items.find((i) => i.id === fees)!;
  run(f, {
    type: 'item.save',
    companyId: f.companyId,
    id: item.id,
    version: item.version,
    kind: 'expenseItem',
    name: item.name,
    archived: false,
    taxDeductible: false,
  });
  const v = declaration(f, 'profitTax', '2026');
  assert.equal(figures(v, 't:tax')[0], '2000.00');
  assert.ok(
    v.checks.some((c) => c.kind === 'warning' && /1\s?600,00|1600\.00/.test(c.text)),
    JSON.stringify(v.checks),
  );
});

test('audit: an open month’s ƏDV return offsets what its closing plan will offset (plan §5.1)', (t) => {
  const f = fixture(t);
  september(f);
  const v = declaration(f, 'vat', '2026-09');
  assert.deepEqual(
    ['v:accrued', 'v:offset', 'v:payable'].map((k) => figures(v, k)[0]),
    ['360.00', '180.00', '180.00'],
  );
  const offset = v.sections[1]!.rows.find((r) => r.key === 'v:offset')!;
  assert.match(offset.source, /plan/);
  assert.ok(v.checks.some((c) => /bağlanmayıb/.test(c.text)));
});
