/**
 * Stage 7a — fixed assets: the catalog, putting into service (113 → 111) and opening balances
 * (docs/MERHELE-7-ESAS-VESAITLER.md §4.1, §8: Ə1, Ə6; QERARLAR 2026-10-26).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from '../../src/infrastructure/sqlite/db.js';
import { migrations } from '../../src/infrastructure/sqlite/schema.js';
import type {
  ClosingView,
  DepreciationSchedule,
  FixedAssetRow,
} from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;
/** Commands with their defaults left out, as the window sends them. */
const run = (f: F, cmd: object) => f.exec(cmd as never);

/** Balance (Dt − Kt, qəpik) of an account, of one subkonto value when given. */
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
const asset = (f: F, name: string, extra: object = {}) =>
  run(f, {
    type: 'fixedAsset.save',
    companyId: f.companyId,
    name,
    group: 'transport',
    archived: false,
    ...extra,
  });
const list = (f: F, date = '2026-12-31') =>
  f.query<FixedAssetRow[]>({ type: 'fixedAssets', companyId: f.companyId, date });

/** A truck bought for 50 000 + 18% VAT on 12.10.2026: Dt 113 / Kt 531.01. */
function bought(f: F) {
  const supplier = f.partner('Avto MMC', '1700000011');
  const contract = f.contract(supplier, 'A-1', 'purchase');
  const truck = f.product('Mercedes Actros', 'ədəd', 'asset');
  f.invoice('purchase', '2026-10-12', supplier, contract, [
    { productId: truck, quantity: '1', price: '50000' },
  ]);
  return truck;
}
const commission = (f: F, lines: object[], extra: object = {}) =>
  run(f, {
    type: 'asset.save',
    companyId: f.companyId,
    kind: 'commission',
    date: '2026-10-15',
    lines,
    ...extra,
  });

test('Ə1: a new company keeps 111 / 112 by fixed asset; the catalog numbers assets by itself', (t) => {
  const f = fixture(t);
  const chart = f.catalog().accounts;
  const a111 = chart.find((a) => a.code === '111')!;
  assert.deepEqual([a111.subkonto, a111.quantitative], [['fixedAsset'], false]);
  assert.deepEqual(chart.find((a) => a.code === '112')!.subkonto, ['fixedAsset']);
  assert.deepEqual(chart.find((a) => a.code === '113')!.subkonto, ['product']);
  const first = asset(f, 'Mercedes Actros', { plate: '10-AB-123' });
  const second = asset(f, 'Noutbuk', { group: 'computers' });
  const rows = f.catalog().fixedAssets;
  assert.deepEqual(
    rows.map((r) => [r.inventoryNo, r.name, r.group, r.plate]),
    [
      ['İN-000001', 'Mercedes Actros', 'transport', '10-AB-123'],
      ['İN-000002', 'Noutbuk', 'computers', ''],
    ],
  );
  assert.ok(first.id && second.id);
  assert.throws(
    () => asset(f, 'Başqa', { inventoryNo: 'İN-000001' }),
    /Bu inventar nömrəsi ilə əsas vəsait artıq var/,
  );
  // The seeded expense item for depreciation is there.
  assert.ok(f.item('expenseItem', 'Amortizasiya'));
});

test('Ə1: putting into service moves the cost from 113 to 111; 113 cannot go below zero', (t) => {
  const f = fixture(t);
  const truck = bought(f);
  assert.equal(balance(f, '113', truck), 5_000_000n);
  const actros = asset(f, 'Mercedes Actros').id;
  const group = f.item('productGroup', 'Əsas nomenklatura qrupu');
  const depreciation = f.item('expenseItem', 'Amortizasiya');
  const line = {
    assetId: actros,
    productId: truck,
    quantity: '1',
    lifeMonths: 60,
    expenseAccount: '701',
    expenseSk: [group, depreciation],
  };
  // More than 113 holds.
  assert.throws(() => commission(f, [{ ...line, quantity: '2' }]), /113.*qalığı.*1/);
  const doc = commission(f, [line]);
  assert.equal(doc.number, 'ƏV-000001');
  assert.equal(balance(f, '113', truck), 0n);
  assert.equal(balance(f, '111', actros), 5_000_000n);
  const [row] = list(f);
  assert.deepEqual(
    [row!.inventoryNo, row!.cost, row!.depreciated, row!.net, row!.monthly, row!.monthsLeft],
    ['İN-000001', '50000.00', '0.00', '50000.00', '833.33', 60],
  );
  assert.equal(row!.inService, '2026-10-15');
  // The same asset cannot be put into service twice.
  const other = f.product('Ehtiyat maşın', 'ədəd', 'asset');
  assert.throws(
    () => commission(f, [{ ...line, productId: other }], { date: '2026-10-20' }),
    /artıq istismardadır/,
  );
  // An expense account without an expense item, or not an expense account at all, is refused.
  const van = asset(f, 'Ford Transit').id;
  assert.throws(
    () => commission(f, [{ ...line, assetId: van, expenseAccount: '211.01', expenseSk: [] }]),
    /xərc hesabı/,
  );
  // Cancelling gives the cost back to 113.
  run(f, {
    type: 'asset.cancel',
    companyId: f.companyId,
    id: doc.id,
    version: doc.version!,
    reason: 'səhv',
  });
  assert.equal(balance(f, '113', truck), 5_000_000n);
  assert.equal(balance(f, '111', actros), 0n);
  assert.equal(list(f)[0]!.inService, '');
});

test('Ə1: part of a purchase — two trucks from one invoice line, the cost split by quantity', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Avto MMC', '1700000011');
  const contract = f.contract(supplier, 'A-1', 'purchase');
  const trucks = f.product('Actros (2 ədəd)', 'ədəd', 'asset');
  f.invoice('purchase', '2026-10-12', supplier, contract, [
    { productId: trucks, quantity: '3', price: '33333.33' },
  ]);
  const group = f.item('productGroup', 'Əsas nomenklatura qrupu');
  const item = f.item('expenseItem', 'Amortizasiya');
  const terms = { lifeMonths: 60, expenseAccount: '701', expenseSk: [group, item] };
  const a = asset(f, 'Actros 1').id;
  const b = asset(f, 'Actros 2').id;
  const c = asset(f, 'Actros 3').id;
  commission(f, [
    { assetId: a, productId: trucks, quantity: '1', ...terms },
    { assetId: b, productId: trucks, quantity: '1', ...terms },
  ]);
  commission(f, [{ assetId: c, productId: trucks, quantity: '1', ...terms }], {
    date: '2026-10-20',
  });
  // 99 999,99 in all: the last one takes what is left, nothing stays on 113.
  assert.deepEqual(
    [balance(f, '111', a), balance(f, '111', b), balance(f, '111', c), balance(f, '113', trucks)],
    [3_333_333n, 3_333_333n, 3_333_333n, 0n],
  );
});

test('Ə6: an opening balance — cost, depreciation so far and the months left', (t) => {
  const f = fixture(t);
  const truck = asset(f, 'Kamaz (2022)').id;
  const item = f.item('expenseItem', 'Amortizasiya');
  const doc = run(f, {
    type: 'asset.save',
    companyId: f.companyId,
    kind: 'opening',
    date: '2026-09-30',
    lines: [
      {
        assetId: truck,
        cost: '30000',
        accumulated: '12000',
        lifeMonths: 60,
        remainingMonths: 24,
        expenseAccount: '721',
        expenseSk: [item],
        counterAccount: '343',
        counterSk: [],
      },
    ],
  });
  assert.equal(doc.number, 'ƏB-000001');
  assert.equal(balance(f, '111', truck), 3_000_000n);
  assert.equal(balance(f, '112', truck), -1_200_000n);
  const [row] = list(f, '2026-09-30');
  assert.deepEqual(
    [row!.cost, row!.depreciated, row!.net, row!.monthly, row!.monthsLeft],
    ['30000.00', '12000.00', '18000.00', '750.00', 24],
  );
  // Depreciation so far cannot exceed the cost.
  const other = asset(f, 'Qazel').id;
  assert.throws(
    () =>
      run(f, {
        type: 'asset.save',
        companyId: f.companyId,
        kind: 'opening',
        date: '2026-09-30',
        lines: [
          {
            assetId: other,
            cost: '1000',
            accumulated: '1500',
            lifeMonths: 60,
            remainingMonths: 1,
            expenseAccount: '721',
            expenseSk: [item],
            counterAccount: '343',
            counterSk: [],
          },
        ],
      }),
    /yığılmış amortizasiya/,
  );
});

test('schema v14 → v15: 111 / 112 move to fixed assets unless they already carry postings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-v14-'));
  const path = join(dir, 'm.sqlite');
  const raw = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  for (const m of migrations.filter((x) => x.version <= 14)) raw.exec(m.sql);
  raw.exec(`PRAGMA user_version=14;
INSERT INTO companies(id,name,tax_id,created_at) VALUES('a','a','1000000001','2026-10-01'),('b','b','1000000002','2026-10-01');
INSERT INTO accounts VALUES('a','111','111',NULL,'active','["product"]',1,0,1,0),('a','112','112',NULL,'passive','["product"]',0,0,1,0),
  ('b','111','111',NULL,'active','["product"]',1,0,1,0),('b','112','112',NULL,'passive','["product"]',0,0,1,0);
INSERT INTO items(id,company_id,kind,name) VALUES('x','b','expenseItem','Amortizasiya');
INSERT INTO registers VALUES('a','111','p','','','2026-09',100,0,1,0,0,0);`);
  raw.close();
  const db = new Db(path);
  const acc = (c: string, code: string) =>
    db.get('SELECT subkonto,quantitative FROM accounts WHERE company_id=? AND code=?', c, code)!;
  assert.deepEqual([acc('a', '111').subkonto, acc('a', '111').quantitative], ['["product"]', 1n]);
  assert.equal(acc('a', '112').subkonto, '["product"]');
  assert.deepEqual(
    [acc('b', '111').subkonto, acc('b', '111').quantitative],
    ['["fixedAsset"]', 0n],
  );
  assert.equal(acc('b', '112').subkonto, '["fixedAsset"]');
  const role = (c: string, r: string) =>
    db.all('SELECT id,name FROM items WHERE company_id=? AND role=?', c, r).map((x) => x.name);
  assert.deepEqual(role('a', 'depreciation'), ['Amortizasiya']);
  assert.deepEqual(role('b', 'depreciation'), ['Amortizasiya']);
  assert.equal(
    db.get("SELECT id FROM items WHERE company_id='b' AND role='depreciation'")!.id,
    'x',
    'the element the accountant already had gets the role',
  );
  assert.deepEqual(role('b', 'assetDisposal'), ['Əsas vəsaitlərin silinməsi']);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// Stage 7b — depreciation in the month closing (§4.2, §5; Ə2, Ə3)

const closingView = (f: F, month: string) =>
  f.query<ClosingView>({ type: 'closing', companyId: f.companyId, month });
const closeMonth = (f: F, month: string) =>
  run(f, { type: 'closing.post', companyId: f.companyId, month, acknowledged: true });
const cancelMonth = (f: F, month: string) => {
  const p = closingView(f, month).posted!;
  return run(f, {
    type: 'closing.cancel',
    companyId: f.companyId,
    id: p.id,
    version: p.version,
    reason: 'yoxlama',
  });
};
/** The Actros of §9: 50 000, in service from 15.10.2026, 60 months to 701 "Amortizasiya". */
function inService(f: F) {
  const truck = bought(f);
  const actros = asset(f, 'Mercedes Actros').id;
  commission(f, [
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
  ]);
  return actros;
}

test('Ə2: the month closing depreciates from the month after; 701 goes to 801 with it', (t) => {
  const f = fixture(t);
  const actros = inService(f);
  const october = closingView(f, '2026-10').steps.find((s) => s.key === 'depreciation')!;
  assert.equal(october.state, 'empty');
  closeMonth(f, '2026-10');
  assert.equal(balance(f, '112', actros), 0n);
  const plan = closingView(f, '2026-11').steps.find((s) => s.key === 'depreciation')!;
  assert.equal(plan.title, 'Əsas vəsaitlərin amortizasiyası');
  assert.deepEqual(
    plan.postings.map((p) => [p.dt, p.kt, p.ktSk, p.amount]),
    [['701', '112', [actros], '833.33']],
  );
  assert.match(plan.summary, /1 əsas vəsait · 833,33/);
  closeMonth(f, '2026-11');
  assert.equal(balance(f, '112', actros), -83_333n);
  // 701 was closed into 801 by the same closing.
  assert.equal(balance(f, '701'), 0n);
  const [row] = list(f, '2026-11-30');
  assert.deepEqual([row!.depreciated, row!.net, row!.monthsLeft], ['833.33', '49166.67', 59]);
});

test('Ə3: cancelling the closing takes the depreciation back; closing again posts the same', (t) => {
  const f = fixture(t);
  const actros = inService(f);
  closeMonth(f, '2026-10');
  closeMonth(f, '2026-11');
  cancelMonth(f, '2026-11');
  assert.equal(balance(f, '112', actros), 0n);
  assert.equal(list(f, '2026-11-30')[0]!.monthsLeft, 60);
  closeMonth(f, '2026-11');
  assert.equal(balance(f, '112', actros), -83_333n);
});

test('7b: an opening balance depreciates over its months left; nothing beyond cost − salvage', (t) => {
  const f = fixture(t);
  const kamaz = asset(f, 'Kamaz').id;
  const item = f.item('expenseItem', 'Amortizasiya');
  run(f, {
    type: 'asset.save',
    companyId: f.companyId,
    kind: 'opening',
    date: '2026-09-30',
    lines: [
      {
        assetId: kamaz,
        cost: '1000',
        accumulated: '900',
        salvage: '50',
        lifeMonths: 60,
        remainingMonths: 2,
        expenseAccount: '721',
        expenseSk: [item],
        counterAccount: '343',
      },
    ],
  });
  closeMonth(f, '2026-09');
  closeMonth(f, '2026-10');
  closeMonth(f, '2026-11');
  // 50 left to depreciate over two months: 25 + 25, then nothing (salvage 50 stays).
  assert.equal(balance(f, '112', kamaz), -95_000n);
  const december = closingView(f, '2026-12').steps.find((s) => s.key === 'depreciation')!;
  assert.deepEqual(december.postings, []);
});

test('7b: a month closed without depreciation is made up in the next one, with a note', (t) => {
  const f = fixture(t);
  const actros = inService(f);
  // November closed by the period lock alone (before 7b, or by hand).
  run(f, { type: 'period.close', companyId: f.companyId, through: '2026-11-30' });
  const plan = closingView(f, '2026-12').steps.find((s) => s.key === 'depreciation')!;
  assert.deepEqual(
    plan.postings.map((p) => p.amount),
    ['1666.66'],
  );
  assert.match(plan.notes.join(' '), /əvvəlki aylardan.*833,33/);
  assert.equal(balance(f, '112', actros), 0n);
});

test('7b: an archived expense item stops the closing; a 113 balance left for months is a warning', (t) => {
  const f = fixture(t);
  inService(f);
  // Another purchase waits on 113 since October.
  const supplier = f.partner('Avadanlıq MMC', '1700000012');
  const contract = f.contract(supplier, 'B-1', 'purchase');
  const lift = f.product('Yük qaldırıcı', 'ədəd', 'asset');
  f.invoice('purchase', '2026-08-03', supplier, contract, [
    { productId: lift, quantity: '1', price: '7000' },
  ]);
  const w = closingView(f, '2026-11').warnings.map((s) => s.text);
  assert.ok(
    w.some((t) => /113.*Yük qaldırıcı.*istismara verilməyib/.test(t)),
    w.join('\n'),
  );
  const item = f.catalog().items.find((i) => i.name === 'Amortizasiya')!;
  run(f, {
    type: 'item.save',
    companyId: f.companyId,
    id: item.id,
    version: item.version,
    kind: 'expenseItem',
    name: item.name,
    archived: true,
  });
  const blocking = closingView(f, '2026-11').blocking.map((s) => s.text);
  assert.ok(
    blocking.some((t) => /Mercedes Actros.*arxivdədir/.test(t)),
    blocking.join('\n'),
  );
});

test('7b: the depreciation schedule — posted months, then the forecast of the open ones', (t) => {
  const f = fixture(t);
  const actros = inService(f);
  closeMonth(f, '2026-10');
  closeMonth(f, '2026-11');
  const s = f.query<DepreciationSchedule>({
    type: 'depreciationSchedule',
    companyId: f.companyId,
    year: 2026,
  });
  assert.equal(s.months.length, 12);
  const [row] = s.rows;
  assert.equal(row!.assetId, actros);
  assert.deepEqual(
    row!.cells.slice(9).map((c) => [c.amount, c.forecast]),
    [
      ['0.00', false],
      ['833.33', false],
      ['833.33', true],
    ],
  );
  assert.equal(row!.total, '1666.66');
  assert.equal(s.totals[10], '833.33');
  const next = f.query<DepreciationSchedule>({
    type: 'depreciationSchedule',
    companyId: f.companyId,
    year: 2031,
  });
  assert.deepEqual(
    next.rows[0]!.cells.slice(8, 11).map((c) => c.amount),
    ['833.33', '833.53', '0.00'],
  );
});
