/**
 * Load test: 5 years of a busy company — 500 000 postings (1 000 000 journal sides) over 2 000
 * partners, 4 000 contracts, 20 bank accounts and 1 000 products. Every report must answer
 * within its budget: a trial balance and its drill-down under one second.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../../src/infrastructure/sqlite/db.js';
import { Ledger } from '../../src/application/ledger.js';
import type { AccountCard, IntegrityView, TrialBalance } from '../../src/contracts/queries.js';

const POSTINGS = Number(process.env.MEYAR_PERF_POSTINGS ?? 500_000);

test(`reports stay within budget on ${POSTINGS} postings`, { timeout: 600_000 }, (t) => {
  // MEYAR_PERF_DB keeps the generated database between runs (for tuning); default is a temp file.
  const keep = process.env.MEYAR_PERF_DB;
  const dir = keep ? '' : mkdtempSync(join(tmpdir(), 'meyar-perf-'));
  const file = keep ?? join(dir, 'perf.sqlite');
  const reuse = !!keep && existsSync(file);
  const db = new Db(file);
  t.after(() => {
    db.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const ledger = new Ledger(db, { now: () => '2026-10-07T00:00:00Z', today: () => '2026-10-07' });
  let companyId: string;
  let banks: string[];
  if (reuse) {
    companyId = String(db.get('SELECT id FROM companies')!.id);
    banks = db
      .all('SELECT id FROM bank_accounts WHERE company_id=?', companyId)
      .map((r) => String(r.id));
  } else ({ companyId, banks } = generate(db, ledger));
  const time = <T>(label: string, budget: number, fn: () => T): T => {
    const s = performance.now();
    const result = fn();
    const ms = Math.round(performance.now() - s);
    console.log(`  ${label}: ${ms} ms (hədd ${budget} ms)`);
    assert.ok(ms <= budget, `${label}: ${ms} ms > ${budget} ms`);
    return result;
  };
  const q = (x: object) => ledger.query({ companyId, ...x });
  const year = time(
    'DBC, il, hesablar',
    1000,
    () => q({ type: 'trialBalance', from: '2025-01-01', to: '2025-12-31' }) as TrialBalance,
  );
  assert.equal(year.totals.turnDt, year.totals.turnKt);
  assert.equal(year.totals.closeDt, year.totals.closeKt);
  time('DBC, ay ortası (qismən ay)', 1000, () =>
    q({ type: 'trialBalance', from: '2025-03-10', to: '2025-06-20' }),
  );
  time('DBC, 211.01 kontragentlər üzrə açılmış', 1000, () =>
    q({
      type: 'trialBalance',
      from: '2025-01-01',
      to: '2025-12-31',
      expand: ['a:211', 'a:211.01'],
    }),
  );
  time('DBC, 223.01 bank hesabları', 1000, () =>
    q({
      type: 'trialBalance',
      from: '2025-01-01',
      to: '2025-12-31',
      expand: ['a:223', 'a:223.01'],
    }),
  );
  const card = time(
    'Hesab kartı, bir bank hesabı, ay',
    1000,
    () =>
      q({
        type: 'accountCard',
        account: '223.01',
        sk: [banks[1]!],
        from: '2025-05-01',
        to: '2025-05-31',
      }) as AccountCard,
  );
  assert.ok(card.lines.length > 0);
  time('İş masası', 1500, () => q({ type: 'home' }));
  const check = time('Bütövlük yoxlaması', 20000, () => q({ type: 'integrity' }) as IntegrityView);
  assert.equal(check.ok, true, check.problems.join());
});

function generate(db: Db, ledger: Ledger): { companyId: string; banks: string[] } {
  const ctx = { actor: 'perf', correlationId: 'perf' };
  let n = 0;
  const exec = (c: object) =>
    ledger.execute({ key: `perf-${String(++n).padStart(8, '0')}`, ...c }, ctx) as { id: string };
  const companyId = exec({
    type: 'company.create',
    name: 'Perf MMC',
    taxId: '1000000001',
    vatPayer: true,
  }).id;
  const ids = (sql: string, ...p: string[]) => db.all(sql, ...p).map((r) => String(r.id));
  // Catalogs straight into the tables: the commands are covered by the integration tests.
  const insertMany = (count: number, fn: (i: number) => void) =>
    db.write(() => {
      for (let i = 0; i < count; i++) fn(i);
    });
  insertMany(2000, (i) =>
    db.run(
      "INSERT INTO partners(id,company_id,name,tax_id,kind) VALUES(?,?,?,?,'legal')",
      randomUUID(),
      companyId,
      `Kontragent ${i}`,
      String(2000000000 + i),
    ),
  );
  const partners = ids('SELECT id FROM partners WHERE company_id=?', companyId);
  insertMany(4000, (i) =>
    db.run(
      "INSERT INTO contracts(id,company_id,partner_id,number,number_key,date,kind) VALUES(?,?,?,?,?,'2021-01-01','sale')",
      randomUUID(),
      companyId,
      partners[i % 2000]!,
      `${i}`,
      `${i}`,
    ),
  );
  const contracts = db
    .all('SELECT id,partner_id FROM contracts WHERE company_id=?', companyId)
    .map((r) => [String(r.partner_id), String(r.id)] as const);
  insertMany(20, (i) =>
    db.run(
      "INSERT INTO bank_accounts(id,company_id,bank_id,iban,currency,account,name) VALUES(?,?,?,?,'AZN','223.01',?)",
      randomUUID(),
      companyId,
      partners[i]!,
      `AZ00PERF${String(i).padStart(20, '0')}`,
      `Bank ${i}`,
    ),
  );
  const banks = ids('SELECT id FROM bank_accounts WHERE company_id=?', companyId);
  insertMany(1000, (i) =>
    db.run(
      "INSERT INTO products(id,company_id,name,unit,kind) VALUES(?,?,?,'ədəd','goods')",
      randomUUID(),
      companyId,
      `Məhsul ${i}`,
    ),
  );
  const products = ids('SELECT id FROM products WHERE company_id=?', companyId);
  const income = ids(
    "SELECT id FROM items WHERE company_id=? AND kind='incomeType'",
    companyId,
  )[0]!;
  const fee = ids("SELECT id FROM items WHERE company_id=? AND kind='expenseItem'", companyId)[0]!;

  const started = performance.now();
  const entry = db.raw.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,1,0,?,?)');
  const posting = db.raw.prepare(
    `INSERT INTO postings(entry_id,line_no,company_id,date,dt_account,dt_s1,dt_s2,dt_s3,kt_account,kt_s1,kt_s2,kt_s3,amount,dt_qty,kt_qty)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const days = 5 * 365;
  const dayOf = (i: number) => {
    const d = new Date(Date.UTC(2021, 9, 1) + Math.floor((i / POSTINGS) * days) * 86_400_000);
    return d.toISOString().slice(0, 10);
  };
  let done = 0;
  let sale = { p: '', c: '', e: '', amount: 0 };
  while (done < POSTINGS) {
    db.write(() => {
      for (let k = 0; k < 10_000 && done < POSTINGS; k++, done++) {
        const date = dayOf(done);
        const e = randomUUID();
        entry.run(e, companyId, date, 'operation', e, `P${done}`, date, 'perf');
        const [p, c] = contracts[done % contracts.length]!;
        const bank = banks[done % banks.length]!;
        const amount = 1000 + (done % 97) * 13;
        switch (done % 4) {
          case 0: // sale
            posting.run(
              e,
              1,
              companyId,
              date,
              '211.01',
              p,
              c,
              `operation:${e}`,
              '601',
              income,
              '18',
              '',
              amount,
              0,
              0,
            );
            sale = { p, c, e, amount };
            break;
          case 1: // the customer pays that sale in full (its 211 key closes to zero)
            posting.run(
              e,
              1,
              companyId,
              date,
              '223.01',
              bank,
              '',
              '',
              '211.01',
              sale.p,
              sale.c,
              `operation:${sale.e}`,
              sale.amount,
              0,
              0,
            );
            break;
          case 2: // purchase of goods
            posting.run(
              e,
              1,
              companyId,
              date,
              '205',
              products[done % products.length]!,
              '',
              '',
              '531.01',
              p,
              c,
              `operation:${e}`,
              amount,
              1_000_000,
              0,
            );
            break;
          default: // bank fee
            posting.run(
              e,
              1,
              companyId,
              date,
              '721',
              fee,
              '',
              '',
              '223.01',
              bank,
              '',
              '',
              50,
              0,
              0,
            );
        }
      }
    });
  }
  const loadMs = Math.round(performance.now() - started);
  console.log(`  ${POSTINGS} yazılış yükləndi: ${loadMs} ms`);
  return { companyId, banks };
}
