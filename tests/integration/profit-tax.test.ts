/**
 * Stage 9d — the profit tax return and its posting by the December closing
 * (docs/MERHELE-9-VERGI-BEYANNAMELERI.md §5.4, §7, §8: V6, V7; QERARLAR 2026-10-28 mərhələ 9 §6–§8).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from '../../src/infrastructure/sqlite/db.js';
import { migrations } from '../../src/infrastructure/sqlite/schema.js';
import type { ClosingView, ProfitLossView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';
import { declaration, figures } from './declarations.test.js';

type F = ReturnType<typeof fixture>;
const run = (f: F, cmd: object) => f.exec(cmd as never);
const close = (f: F, month: string) =>
  run(f, { type: 'closing.post', companyId: f.companyId, month, acknowledged: true });
const amount = (f: F, key: string, year = '2026') =>
  figures(declaration(f, 'profitTax', year), key)[0];
/** An expense item the profit tax does not deduct (stage 9d). */
function notDeductible(f: F, name: string) {
  const item = f.catalog().items.find((i) => i.kind === 'expenseItem' && i.name === name);
  return run(f, {
    type: 'item.save',
    companyId: f.companyId,
    ...(item ? { id: item.id, version: item.version } : {}),
    kind: 'expenseItem',
    name,
    archived: false,
    taxDeductible: false,
  }).id!;
}

/**
 * The §8 example: a truck of 50 000 in service from 01.03.2026 (60 months, 701), sales 120 000
 * without VAT, other expenses 72 000,03, a fine of 500 not deducted, an advance of 3 000 paid.
 */
function example(f: F) {
  const supplier = f.partner('Avto MMC', '1700000011');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const cp = f.contract(supplier, 'A-1', 'purchase');
  const cs = f.contract(customer, 'S-1', 'sale');
  const truck = f.product('Mercedes Actros', 'ədəd', 'asset');
  f.invoice('purchase', '2026-02-20', supplier, cp, [
    { productId: truck, quantity: '1', price: '50000', vatRate: 'exempt' },
  ]);
  const actros = run(f, {
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
  const L = f.line;
  const service = f.item('incomeType', 'Xidmət satışı');
  const rent = f.item('expenseItem', 'Bank xidmətləri');
  const fine = notDeductible(f, 'Cərimələr');
  f.operation('2026-06-30', [L('211.01', [customer, cs, ''], '601', [service, '0'], '120000')]);
  f.operation('2026-07-31', [L('721', [rent], '211.01', [customer, cs, ''], '72000.03')]);
  f.operation('2026-08-15', [L('731', [fine], '211.01', [customer, cs, ''], '500')]);
  const vatTax = f.catalog().items.find((i) => i.role === 'vatTax')!.id;
  f.operation('2026-09-20', [L('521.04', [vatTax], '211.01', [customer, cs, ''], '3000')]);
}

test('V6, V7: the §8 example — the return, the December closing posts 901 / 521.04 and 901 → 341', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  example(f);
  for (let m = 2; m <= 11; m++) close(f, `2026-${String(m).padStart(2, '0')}`);
  // Before December: April–November depreciation 8 × 833,33.
  const plan = f.query<ClosingView>({ type: 'closing', companyId: f.companyId, month: '2026-12' });
  const step = (key: string) => plan.steps.find((s) => s.key === key)!;
  assert.deepEqual(
    step('profitTax').postings.map((p) => [p.dt, p.kt, p.amount]),
    [
      ['901', '521.04', '7099.99'],
      ['341', '901', '7099.99'],
    ],
  );
  assert.match(step('profitTax').summary, /7\s099,99/);
  assert.deepEqual(
    step('year').postings.map((p) => [p.dt, p.kt, p.amount]),
    [['341', '343', '32900.01']],
  );
  close(f, '2026-12');

  const v = declaration(f, 'profitTax', '2026');
  const k = (key: string) => figures(v, key)[0];
  assert.equal(k('i:601'), '120000.00');
  assert.equal(k('i:total'), '120000.00');
  assert.equal(k('e:books'), '80000.00');
  assert.equal(k('e:depreciation'), '-7499.97');
  assert.equal(k('e:deductible'), '72000.03');
  assert.equal(k('e:taxDepreciation'), '12500.00');
  assert.equal(k('t:taxable'), '35499.97');
  assert.equal(k('t:base'), '35499.97');
  assert.equal(k('t:rate'), '20%');
  assert.equal(k('t:tax'), '7099.99');
  assert.equal(k('t:paid'), '3000.00');
  assert.equal(k('t:payable'), '4099.99');
  assert.ok(
    v.sections[1]!.rows.some((r) => r.label === 'çıxılır: Cərimələr' && r.values[0] === '-500.00'),
  );
  assert.ok(!v.checks.some((c) => /bağlanmayıb/.test(c.text)));

  // M/Z: the result before tax, the tax and the net profit.
  const pl = f.query<ProfitLossView>({ type: 'profitLoss', companyId: f.companyId, year: '2026' });
  const sum = (key: string) => pl.rows.find((r) => r.key === key)!.sum;
  assert.deepEqual(
    [sum('t:result'), sum('a:901'), sum('t:net')],
    ['40000.00', '7099.99', '32900.01'],
  );

  // Cancelling December takes the tax back; closing again posts it again.
  const posted = f.query<ClosingView>({
    type: 'closing',
    companyId: f.companyId,
    month: '2026-12',
  }).posted!;
  run(f, {
    type: 'closing.cancel',
    companyId: f.companyId,
    id: posted.id,
    version: posted.version,
    reason: 'yoxlama',
  });
  const net901 = () =>
    f.db.get(
      "SELECT COALESCE(SUM(debit-credit),0) AS b FROM registers WHERE company_id=? AND account='901'",
      f.companyId,
    )!.b;
  assert.equal(net901(), 0n);
  assert.equal(
    f
      .query<ProfitLossView>({ type: 'profitLoss', companyId: f.companyId, year: '2026' })
      .rows.some((r) => r.key === 'a:901'),
    false,
    'storno leaves no tax',
  );
  close(f, '2026-12');
  assert.equal(net901(), 0n);
  assert.equal(
    f.db.get(
      "SELECT COALESCE(SUM(credit-debit),0) AS b FROM registers WHERE company_id=? AND account='521.04'",
      f.companyId,
    )!.b,
    409_999n,
  );
});

test('V6: a loss is carried to the next years; the accountant’s losses and adjustments', (t) => {
  const f = fixture(t);
  const customer = f.partner('Alıcı MMC', '1700000001');
  const cs = f.contract(customer, 'S-1', 'sale');
  const service = f.item('incomeType', 'Xidmət satışı');
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  const L = f.line;
  f.operation('2026-05-10', [L('721', [fees], '211.01', [customer, cs, ''], '10000')]);
  f.operation('2027-05-10', [L('211.01', [customer, cs, ''], '601', [service, '0'], '30000')]);
  assert.equal(figures(declaration(f, 'profitTax', '2026'), 't:taxable')[0], '10000.00');
  assert.equal(
    declaration(f, 'profitTax', '2026').sections[2]!.rows.find((r) => r.key === 't:taxable')!.label,
    'Zərər (növbəti illərə keçir)',
  );
  assert.equal(amount(f, 't:tax', '2026'), '0.00');
  // 2027: 30 000 − the loss of 2026 → 20 000 × 20%.
  assert.equal(amount(f, 't:losses', '2027'), '10000.00 / 10000.00');
  assert.equal(amount(f, 't:tax', '2027'), '4000.00');
  // The accountant: 5 000 of losses from before Meyar and a +1 000 adjustment.
  run(f, {
    type: 'taxYear.save',
    companyId: f.companyId,
    year: '2027',
    rates: {},
    losses: '5000',
    adjustments: [{ label: 'Limitdən artıq təmsilçilik xərci', amount: '1000' }],
  });
  assert.equal(amount(f, 't:taxable', '2027'), '31000.00');
  assert.equal(amount(f, 't:base', '2027'), '16000.00');
  assert.equal(amount(f, 't:tax', '2027'), '3200.00');
  // A loss older than five years is not used: 2033 does not see 2026's.
  f.operation('2033-05-10', [L('211.01', [customer, cs, ''], '601', [service, '0'], '1000')]);
  assert.equal(amount(f, 't:losses', '2033'), '0.00 / 0.00');
});

test('V6: schema v23 → v24 — expense items are deductible until marked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-v23-'));
  const path = join(dir, 'm.sqlite');
  const raw = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  for (const m of migrations.filter((x) => x.version <= 23)) raw.exec(m.sql);
  raw.exec(`PRAGMA user_version=23;
INSERT INTO companies(id,name,tax_id,created_at) VALUES('a','a','1000000001','2026-10-01');
INSERT INTO items(id,company_id,kind,name) VALUES('x','a','expenseItem','Cərimələr');`);
  raw.close();
  const db = new Db(path);
  assert.equal(db.get("SELECT tax_deductible FROM items WHERE id='x'")!.tax_deductible, 1n);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
