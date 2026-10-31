/**
 * Audit 2 (period end and reports): each test proves one defect found by the chief accountant's
 * review. Made-up names and numbers only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClosingView, DeclarationView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;
const run = (f: F, cmd: object) => f.exec(cmd as never);
const close = (f: F, month: string) =>
  run(f, { type: 'closing.post', companyId: f.companyId, month, acknowledged: true });
const view = (f: F, month: string) =>
  f.query<ClosingView>({ type: 'closing', companyId: f.companyId, month });
const declaration = (f: F, kind: string, period: string) =>
  f.query<DeclarationView>({ type: 'declaration', companyId: f.companyId, kind, period });
const figures = (v: DeclarationView, key: string) => {
  for (const s of v.sections) {
    const r = s.rows.find((x) => x.key === key);
    if (r) return r.values;
  }
  throw new Error(`row ${key} not found`);
};
/** Signed (debit − credit) balance of an account family up to a date, in qəpik. */
const balance = (f: F, account: string, date = '2026-12-31') =>
  String(
    f.db.get(
      `SELECT COALESCE(SUM(a),0) AS b FROM (
         SELECT amount AS a FROM postings WHERE company_id=?1 AND (dt_account=?2 OR dt_account LIKE ?2||'.%') AND date<=?3
         UNION ALL
         SELECT -amount FROM postings WHERE company_id=?1 AND (kt_account=?2 OR kt_account LIKE ?2||'.%') AND date<=?3)`,
      f.companyId,
      account,
      date,
    )!.b,
  );

test('D1: profit tax — a hand entry on 901 reversed by a counter entry is taken as booked tax', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  const customer = f.partner('Bərk Yük MMC', '1700000101');
  const cs = f.contract(customer, 'S-77', 'sale');
  const service = f.item('incomeType', 'Xidmət satışı');
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  const vatTax = f.catalog().items.find((i) => i.role === 'vatTax')!.id;
  const L = f.line;
  f.operation('2026-12-03', [L('211.01', [customer, cs, ''], '601', [service, '0'], '1000')]);
  f.operation('2026-12-04', [L('721', [fees], '211.01', [customer, cs, ''], '400')]);
  // The accountant books an estimate by hand, then reverses it with a counter entry (not storno).
  f.operation('2026-12-05', [L('901', [], '521.04', [vatTax], '500')]);
  f.operation('2026-12-06', [L('521.04', [vatTax], '901', [], '500')]);
  close(f, '2026-12');
  // Profit 600 × 20% = 120: 901 nets to 120 for the year, 521.04 owes 120.
  assert.equal(figures(declaration(f, 'profitTax', '2026'), 't:tax')[0], '120.00');
  assert.equal(balance(f, '521.04'), '-12000');
  assert.equal(balance(f, '343'), '-48000');
});

/** A truck whose depreciation is booked to 202 (allowed), and 202 then moved to 701. */
test('D2: profit tax — book depreciation routed through 202 → 701 is deducted twice', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  const supplier = f.partner('Avto Təchizat MMC', '1700000111');
  const customer = f.partner('Daşıma Sifarişçi MMC', '1700000112');
  const cp = f.contract(supplier, 'A-9', 'purchase');
  const cs = f.contract(customer, 'S-9', 'sale');
  const truck = f.product('Volvo FH yük maşını', 'ədəd', 'asset');
  f.invoice('purchase', '2026-10-05', supplier, cp, [
    { productId: truck, quantity: '1', price: '60000', vatRate: 'exempt' },
  ]);
  const asset = run(f, {
    type: 'fixedAsset.save',
    companyId: f.companyId,
    name: 'Volvo FH',
    group: 'transport',
    archived: false,
  }).id!;
  const dep = f.item('expenseItem', 'Amortizasiya');
  const group = f.item('productGroup', 'Əsas nomenklatura qrupu');
  run(f, {
    type: 'asset.save',
    companyId: f.companyId,
    kind: 'commission',
    date: '2026-10-15',
    lines: [
      {
        assetId: asset,
        productId: truck,
        quantity: '1',
        lifeMonths: 60,
        expenseAccount: '202',
        expenseSk: [dep],
      },
    ],
  });
  const service = f.item('incomeType', 'Xidmət satışı');
  const L = f.line;
  f.operation('2026-10-20', [L('211.01', [customer, cs, ''], '601', [service, '0'], '10000')]);
  close(f, '2026-10');
  close(f, '2026-11'); // November depreciation 1 000: Dt 202 / Kt 112
  assert.equal(balance(f, '202', '2026-11-30'), '100000');
  // The service's cost: 202 → 701 (the depreciation becomes cost of sales).
  f.operation('2026-12-20', [L('701', [group, dep], '202', [dep], '1000')]);
  close(f, '2026-12');
  const v = declaration(f, 'profitTax', '2026');
  const k = (key: string) => figures(v, key)[0];
  assert.equal(k('e:taxDepreciation'), '15000.00');
  assert.equal(k('e:books'), '1000.00');
  // The 1 000 in 701 is book depreciation: it must come off (VM 114 replaces it).
  assert.equal(k('e:depreciation'), '-1000.00');
  assert.equal(k('e:deductible'), '0.00');
});

test('OK: cancelling December and closing it again gives the same books', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  const customer = f.partner('Qərb Logistika MMC', '1700000121');
  const cs = f.contract(customer, 'S-5', 'sale');
  const service = f.item('incomeType', 'Xidmət satışı');
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  const L = f.line;
  f.operation('2026-12-03', [L('211.01', [customer, cs, ''], '601', [service, '0'], '2500')]);
  f.operation('2026-12-04', [L('721', [fees], '211.01', [customer, cs, ''], '700')]);
  close(f, '2026-12');
  const snap = () => ['341', '343', '521.04', '801', '901', '601', '721'].map((a) => balance(f, a));
  const before = snap();
  const p = view(f, '2026-12').posted!;
  run(f, {
    type: 'closing.cancel',
    companyId: f.companyId,
    id: p.id,
    version: p.version,
    reason: 'yoxlama',
  });
  assert.deepEqual(
    ['341', '343', '521.04', '901'].map((a) => balance(f, a)),
    ['0', '0', '0', '0'],
  );
  close(f, '2026-12');
  assert.deepEqual(snap(), before);
  assert.deepEqual(before.slice(0, 3), ['0', '-144000', '-36000']);
});

test('OK: payroll 2026 brackets on 3 000 and 9 000', async () => {
  const { payrollFor, parseRates, rates2026 } = await import('../../src/domain/payroll.js');
  const r = parseRates(rates2026);
  const a = payrollFor(300000n, r);
  assert.deepEqual(
    [a.incomeTax, a.dsmfEmployee, a.unemploymentEmployee, a.medicalEmployee, a.dsmfEmployer],
    [12500n, 28600n, 1500n, 5250n, 46400n],
  );
  const b = payrollFor(900000n, r);
  // 625 + 14% × 1 000; employer 44 + 15% × 7 800 + 11% × 1 000
  assert.deepEqual([b.incomeTax, b.dsmfEmployer], [76500n, 132400n]);
  const c = payrollFor(200000n, r); // relief 200: (2 000 − 200) × 3%
  assert.equal(c.incomeTax, 5400n);
});
