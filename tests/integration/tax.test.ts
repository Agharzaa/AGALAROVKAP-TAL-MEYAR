/**
 * Stage 9c — tax depreciation from the fixed-asset documents and the year's parameters
 * (docs/MERHELE-9-VERGI-BEYANNAMELERI.md §5.3, §7: V5; QERARLAR 2026-10-28 mərhələ 9 §5).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from '../../src/infrastructure/sqlite/db.js';
import { migrations } from '../../src/infrastructure/sqlite/schema.js';
import type { AssetDocumentDetail } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';
import { declaration, figures } from './declarations.test.js';

type F = ReturnType<typeof fixture>;
const run = (f: F, cmd: object) => f.exec(cmd as never);
const asset = (f: F, name: string, group = 'transport') =>
  run(f, { type: 'fixedAsset.save', companyId: f.companyId, name, group, archived: false }).id!;
const opening = (f: F, lines: object[]) =>
  run(f, {
    type: 'asset.save',
    companyId: f.companyId,
    kind: 'opening',
    date: '2026-01-01',
    lines: lines.map((l) => ({
      lifeMonths: 60,
      remainingMonths: 48,
      expenseAccount: '721',
      expenseSk: [f.item('expenseItem', 'Amortizasiya')],
      counterAccount: '343',
      counterSk: [],
      ...l,
    })),
  });
/** Every category's figures of a row, the total last. */
const row = (f: F, key: string, year = '2026') =>
  figures(declaration(f, 'taxDepreciation', year), key);

test('V5: opening balances with and without a tax residual; the year’s parameters; a closed year', (t) => {
  const f = fixture(t);
  const kamaz = asset(f, 'Kamaz');
  const laptop = asset(f, 'Noutbuk', 'computers');
  const old = asset(f, 'Köhnə qazel');
  const doc = opening(f, [
    { assetId: kamaz, cost: '60000', accumulated: '10000', taxResidual: '45000' },
    { assetId: laptop, cost: '1000', accumulated: '0' },
    { assetId: old, cost: '5000', accumulated: '4000', remainingMonths: 12 },
  ]);
  const detail = f.query<AssetDocumentDetail>({
    type: 'assetDocument',
    companyId: f.companyId,
    id: doc.id,
  });
  assert.deepEqual(
    detail.lines.map((l) => l.taxResidual),
    ['45000.00', '', ''],
  );
  // The old van leaves in January (nothing was due to depreciate yet).
  run(f, {
    type: 'asset.save',
    companyId: f.companyId,
    kind: 'disposal',
    date: '2026-01-20',
    lines: [{ assetId: old }],
  });
  // Columns: buildings, machinery, computers, transport, other, total.
  assert.deepEqual(row(f, 't:added'), ['0.00', '0.00', '1000.00', '46000.00', '0.00', '47000.00']);
  assert.deepEqual(row(f, 't:removed').slice(3), ['1000.00', '0.00', '1000.00']);
  assert.deepEqual(row(f, 't:base').slice(2, 4), ['1000.00', '45000.00']);
  // 45 000 × 25% = 11 250; 1 000 × 25% = 250.
  assert.deepEqual(row(f, 't:depreciation').slice(2), ['250.00', '11250.00', '0.00', '11500.00']);
  assert.deepEqual(row(f, 't:closing').at(-1), '34500.00');
  const v = declaration(f, 'taxDepreciation', '2026');
  assert.deepEqual(figures(v, 't:rate').slice(0, 5), ['7%', '20%', '25%', '25%', '20%']);
  assert.ok(v.checks.some((c) => /vergi qalıq dəyəri yazılmayıb.*Noutbuk/.test(c.text)));
  assert.ok(v.checks.some((c) => /parametrlər yazılmayıb/.test(c.text)));
  assert.equal(v.appendices[0]!.rows.length, 3);
  assert.equal(v.params!.saved, false);

  // The accountant takes 20% for transport and the small business coefficient 1,5: 30%.
  const save = (extra: object = {}) =>
    run(f, {
      type: 'taxYear.save',
      companyId: f.companyId,
      year: '2026',
      rates: { transport: '20' },
      coefficient: '1,5',
      ...extra,
    });
  save();
  assert.deepEqual(row(f, 't:depreciation').slice(2, 4), ['375.00', '13500.00']);
  const saved = declaration(f, 'taxDepreciation', '2026');
  assert.deepEqual(figures(saved, 't:rate').slice(2, 4), ['37,5%', '30%']);
  assert.deepEqual(
    [saved.params!.saved, saved.params!.coefficient, saved.params!.rates[3]!.rate],
    [true, '1,5', '20'],
  );
  // 2027 starts from what 2026 left: Kamaz 31 500 at 25%.
  assert.equal(row(f, 't:depreciation', '2027')[3], '7875.00');
  assert.throws(() => save({ rates: { transport: '30' } }), /25%-dən çox ola bilməz/);
  assert.throws(() => save({ coefficient: '3' }), /Əmsal/);
  f.db.run("UPDATE companies SET closed_through='2026-12-31' WHERE id=?", f.companyId);
  assert.equal(declaration(f, 'taxDepreciation', '2026').params!.locked, true);
  assert.throws(() => save(), /il bağlanıb/);
});

test('V5: schema v22 → v23 — tax years and the tax residual of an opening line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-v22-'));
  const path = join(dir, 'm.sqlite');
  const raw = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  for (const m of migrations.filter((x) => x.version <= 22)) raw.exec(m.sql);
  raw.exec('PRAGMA user_version=22;');
  raw.close();
  const db = new Db(path);
  assert.equal(Number(db.get('PRAGMA user_version')!.user_version), migrations.at(-1)!.version);
  assert.ok(db.all('PRAGMA table_info(asset_lines)').some((c) => c.name === 'tax_residual'));
  assert.equal(Number(db.get('SELECT COUNT(*) AS n FROM tax_years')!.n), 0);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
