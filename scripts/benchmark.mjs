// Seeds N posted invoices through the real command path and times the main list queries.
// Usage: node scripts/benchmark.mjs [count] (after `npm run build:node`)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Db } from '../dist/node/src/infrastructure/sqlite/db.js';
import { Ledger } from '../dist/node/src/application/ledger.js';

const count = Number(process.argv[2] ?? 100_000);
const dir = mkdtempSync(join(tmpdir(), 'meyar-bench-'));
const db = new Db(join(dir, 'bench.sqlite'));
db.raw.exec('PRAGMA synchronous=OFF'); // seeding speed only; the app runs with FULL
const ledger = new Ledger(db);
const ctx = { actor: 'bench', correlationId: 'bench' };
let k = 0;
const run = (c) => ledger.execute({ key: `bench-${String(++k).padStart(9, '0')}`, ...c }, ctx);
const companyId = run({ type: 'company.create', name: 'Benchmark MMC', taxId: '1500000009' }).id;
const partners = Array.from(
  { length: 200 },
  (_, i) =>
    run({ type: 'partner.save', companyId, name: `Kontragent ${i}`, taxId: String(1700000000 + i) })
      .id,
);
const telecom = ledger.query({ type: 'catalog', companyId }).expenseItems[0].id;
const started = performance.now();
for (let i = 0; i < count; i++) {
  const day = new Date(Date.UTC(2026, 0, 1) + Math.floor((i / count) * 364) * 86400000)
    .toISOString()
    .slice(0, 10);
  run({
    type: 'invoice.save',
    companyId,
    mode: 'post',
    direction: i % 2 ? 'purchase' : 'sale',
    number: `B-${i}`,
    date: day,
    partnerId: partners[i % partners.length],
    note: '',
    lines: [
      i % 2
        ? {
            kind: 'service',
            description: 'Xidmət',
            account: '721',
            expenseItemId: telecom,
            net: '100.00',
            vat: '18.00',
          }
        : { kind: 'service', description: 'Xidmət', account: '601', net: '100.00', vat: '18.00' },
    ],
  });
  if (i && i % 10000 === 0)
    console.log(`seeded ${i} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}
db.raw.exec('PRAGMA synchronous=FULL; ANALYZE;');
const time = (label, q) => {
  const t = performance.now();
  const result = ledger.query(q);
  const ms = performance.now() - t;
  console.log(
    `${label}: ${ms.toFixed(0)} ms (${Array.isArray(result) ? result.length : (result.rows?.length ?? 1)} rows)`,
  );
  return ms;
};
const range = { from: '2026-01-01', to: '2026-12-31' };
const results = {
  salesYear: time('Sales list, whole year', {
    type: 'invoices',
    companyId,
    direction: 'sale',
    ...range,
  }),
  salesMonth: time('Sales list, one month', {
    type: 'invoices',
    companyId,
    direction: 'sale',
    from: '2026-03-01',
    to: '2026-03-31',
  }),
  trial: time('Trial balance, year', { type: 'trialBalance', companyId, ...range, rollup: false }),
  balances: time('Partner balances', { type: 'partnerBalances', companyId, asOf: '2026-12-31' }),
  dashboard: time('Desk', { type: 'dashboard', companyId, asOf: '2026-12-31' }),
};
console.log(JSON.stringify({ count, ...results }));
db.close();
rmSync(dir, { recursive: true, force: true });
