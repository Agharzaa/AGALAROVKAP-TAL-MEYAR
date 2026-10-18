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
import type {
  AccountCard,
  CashFlowView,
  ClosingView,
  DashboardView,
  IntegrityView,
  ProfitLossView,
  TrialBalance,
} from '../../src/contracts/queries.js';

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
    // On CI the numbers are also annotations: readable on the run page without signing in.
    if (process.env.GITHUB_ACTIONS)
      console.log(
        `::${ms <= budget ? 'notice' : 'error'} title=Yük testi::${label}: ${ms} ms (hədd ${budget} ms)`,
      );
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
  // A sales invoice on a product with a long history: FIFO and the advance lookup read the
  // journal through the account + subkonto indexes, so posting stays fast.
  const product = String(
    db.get(
      "SELECT dt_s1 AS p FROM postings WHERE company_id=? AND dt_account='205' GROUP BY dt_s1 ORDER BY COUNT(*) DESC LIMIT 1",
      companyId,
    )!.p,
  );
  const contract = db.get(
    'SELECT id,partner_id FROM contracts WHERE company_id=? LIMIT 1',
    companyId,
  )!;
  const sale = time('Satış qaiməsi (FIFO, avans)', 300, () =>
    ledger.execute(
      {
        key: `perf-invoice-${Date.now()}`,
        type: 'invoice.save',
        companyId,
        direction: 'sale',
        date: '2026-10-01',
        partnerId: String(contract.partner_id),
        contractId: String(contract.id),
        lines: [{ productId: product, quantity: '3', price: '100', vatRate: '18' }],
      },
      { actor: 'perf', correlationId: 'perf' },
    ),
  );
  assert.ok((sale as { id: string }).id);
  // The customer pays more than the invoice: matched to it, the rest is an advance.
  const receipt = time('Bank daxilolması (qaimələrə bölgü, avans)', 300, () =>
    ledger.execute(
      {
        key: `perf-bank-${Date.now()}`,
        type: 'bank.save',
        companyId,
        direction: 'in',
        date: '2026-10-02',
        bankAccountId: banks[0]!,
        lines: [
          {
            account: '211.01',
            sk: [String(contract.partner_id), String(contract.id)],
            amount: '1000',
          },
        ],
      },
      { actor: 'perf', correlationId: 'perf' },
    ),
  );
  assert.ok((receipt as { id: string }).id);
  // A busy month on one account: 5 000 statement rows, half of them from known partners. The
  // stamp keeps a reused perf database (MEYAR_PERF_DB) from treating them as already loaded.
  const stamp = Date.now();
  const iban = String(db.get('SELECT iban FROM bank_accounts WHERE id=?', banks[0]!)!.iban);
  const taxIds = db
    .all('SELECT tax_id FROM partners WHERE company_id=? LIMIT 200', companyId)
    .map((r) => String(r.tax_id));
  const rows = Array.from({ length: 5000 }, (_, i) => ({
    row: i + 2,
    date: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
    direction: i % 2 ? 'out' : 'in',
    amount: `${100 + (i % 977)}.${String(i % 100).padStart(2, '0')}`,
    reference: `PT-${i}-${stamp}`,
    counterparty: `Kontragent ${i % 400}`,
    counterpartyTaxId: i % 2 ? '' : taxIds[i % taxIds.length]!,
    counterpartyIban: '',
    purpose: i % 7 ? `Müqavilə üzrə ödəniş ${i}` : 'Hesabın aparılmasına görə komissiya',
  }));
  // An "auto" rule for bank fees: every seventh row is posted at import, one by one.
  const fee = String(
    db.get(
      "SELECT id FROM items WHERE company_id=? AND kind='expenseItem' ORDER BY rowid LIMIT 1",
      companyId,
    )!.id,
  );
  ledger.execute(
    {
      key: `perf-rule-${stamp}`,
      type: 'rule.save',
      companyId,
      name: 'Komissiya',
      direction: 'out',
      terms: ['komissiya'],
      lines: [{ account: '721', sk: [fee] }],
      mode: 'auto',
    },
    { actor: 'perf', correlationId: 'perf' },
  );
  const loaded = time('Çıxarışın yüklənməsi (5 000 sətir, ~700 avtomatik uçot)', 10000, () =>
    ledger.execute(
      {
        key: `perf-statement-${Date.now()}`,
        type: 'statement.import',
        companyId,
        iban,
        fileName: 'perf.xlsx',
        fileHash: 'b'.repeat(64),
        lines: rows,
      },
      { actor: 'perf', correlationId: 'perf' },
    ),
  ) as { id: string; added: number; posted: number; failed: unknown[] };
  assert.equal(loaded.added, 5000);
  // Odd rows are payments; every seventh row a fee: rows 0, 7, 14… that are also odd.
  assert.equal(loaded.posted, rows.filter((r, i) => r.direction === 'out' && i % 7 === 0).length);
  assert.deepEqual(loaded.failed, []);
  const opened = time('Çıxarışın açılması (təkliflər, qalıqlar)', 3000, () =>
    q({ type: 'statement', id: loaded.id }),
  ) as { lines: unknown[] };
  assert.equal(opened.lines.length, 5000);

  // E19: 5 000 e-qaimələr with 50 000 goods lines ("Mallar üzrə"), then the box opens. The
  // first 400 partners get a purchase contract and the goods codes 0–9 confirmed (auto) map
  // entries: their 1 200 e-qaimələr (i % 2000 < 400) are booked as invoices during the load.
  const stamp2 = Date.now();
  db.write(() => {
    const partnerRows = db.all(
      "SELECT id FROM partners WHERE company_id=? AND tax_id BETWEEN '2000000000' AND '2000000399'",
      companyId,
    );
    for (const p of partnerRows)
      db.run(
        "INSERT INTO contracts(id,company_id,partner_id,number,number_key,date,kind) VALUES(?,?,?,?,?,'2021-01-01','purchase')",
        randomUUID(),
        companyId,
        String(p.id),
        `P-${stamp2}`,
        `P-${stamp2}`,
      );
  });
  const goodsProducts = db
    .all('SELECT id FROM products WHERE company_id=? ORDER BY rowid LIMIT 10', companyId)
    .map((r) => String(r.id));
  goodsProducts.forEach((productId, j) =>
    ledger.execute(
      {
        key: `perf-map-${stamp2}-${j}`,
        type: 'eqMap.save',
        companyId,
        direction: 'purchase',
        dvxCode: `${j}`,
        productId,
        mode: 'auto',
      },
      { actor: 'perf', correlationId: 'perf' },
    ),
  );
  const goods = () =>
    Array.from({ length: 10 }, (_, j) => ({
      code: `${j}`,
      name: `Mal ${j}`,
      unit: 'ədəd',
      quantity: '2',
      price: '5',
      net: '10.00',
      vat: '1.80',
      vatRate: '18',
    }));
  const eqDocs = Array.from({ length: 5000 }, (_, i) => ({
    row: i + 2,
    number: `MT${String(2600000 + i)}`,
    date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
    taxId: String(2000000000 + (i % 2000)),
    kind: 'Əsas',
    status: 'Təsdiqləndi',
    net: '100.00',
    vat: '18.00',
    lines: goods(),
  }));
  const eqLoaded = time(
    'E-qaimələrin yüklənməsi (5 000 e-qaimə, 50 000 mal sətri, 1 200 avtomatik qaimə)',
    // The GitHub Windows runner writes ~6× slower than a desk PC (measured 14.7 s there, 2.3 s on a
    // PC): 20 s on CI only, 10 s everywhere else (decision of 16.10.2026).
    process.env.GITHUB_ACTIONS ? 20000 : 10000,
    () =>
      ledger.execute(
        {
          key: `perf-eq-${Date.now()}`,
          type: 'eqaime.import',
          directionConfirmed: true,
          companyId,
          direction: 'purchase',
          report: 'goods',
          fileName: 'mallar.xlsx',
          fileHash: 'c'.repeat(64),
          documents: eqDocs,
        },
        { actor: 'perf', correlationId: 'perf' },
      ),
  ) as { added: number; rejected: unknown[]; posted: number; failed: unknown[] };
  assert.deepEqual([eqLoaded.added, eqLoaded.rejected], [5000, []]);
  assert.deepEqual([eqLoaded.posted, eqLoaded.failed], [1200, []]);
  const eqBox = time('E-qaimə qutusunun açılması (5 000)', 3000, () =>
    q({ type: 'eqInbox', direction: 'purchase', from: '', to: '' }),
  ) as { documents: unknown[] };
  assert.equal(eqBox.documents.length, 5000);
  // İş masası now also reads the e-qaimə boxes (conflicts, waiting, VAT by month).
  time('İş masası (e-qaimə siqnalları ilə)', 1500, () => q({ type: 'home' }));
  const reconciled = time('DVX ↔ uçot, bir ay (5 000 e-qaimə)', 3000, () =>
    q({ type: 'eqReconcile', direction: 'purchase', from: '2026-09-01', to: '2026-09-30' }),
  ) as { months: unknown[] };
  assert.equal(reconciled.months.length, 1);
  // K5: 500 cash orders, one command each (the negative-cash guard runs on every save), then the
  // cash book of the year and the order journal. An order costs what a manual operation costs
  // on this base (~2 ms on a PC); the budget is 20 ms an order, on the CI runner too.
  const box = String(db.get('SELECT id FROM cashboxes WHERE company_id=?', companyId)!.id);
  const founder = String(
    db.get('SELECT id FROM partners WHERE company_id=? LIMIT 1', companyId)!.id,
  );
  const item = (kind: string) =>
    String(
      db.get('SELECT id FROM items WHERE company_id=? AND kind=? LIMIT 1', companyId, kind)!.id,
    );
  const capitalIn = item('capitalChange');
  const expense = item('expenseItem');
  const stamp3 = Date.now();
  time('Kassa orderləri (500, hər biri ayrıca, mənfi qalıq yoxlaması ilə)', 10000, () => {
    for (let i = 0; i < 500; i++) {
      const incoming = i % 2 === 0;
      ledger.execute(
        {
          key: `perf-cash-${stamp3}-${i}`,
          type: 'cash.save',
          companyId,
          direction: incoming ? 'in' : 'out',
          date: `2026-${String((Math.floor(i / 2) % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
          cashboxId: box,
          lines: [
            incoming
              ? {
                  account: '301',
                  sk: [founder, capitalIn],
                  amount: '100',
                  cashFlowItem: '',
                  memo: '',
                }
              : { account: '721', sk: [expense], amount: '40', cashFlowItem: '', memo: '' },
          ],
        },
        { actor: 'perf', correlationId: 'perf' },
      );
    }
  });
  const cashYear = time('Kassa kitabı, il (500 order)', 1500, () =>
    q({ type: 'cashBook', cashboxId: box, from: '2026-01-01', to: '2026-12-31' }),
  ) as { closing: string };
  assert.equal(cashYear.closing, '15000.00');
  time('Kassa sənədləri jurnalı, il', 1500, () =>
    q({ type: 'cashDocuments', from: '2026-01-01', to: '2026-12-31' }),
  );
  // V2 on the large base: every currency account and key of the year, at the month-end rate.
  ledger.execute(
    {
      key: `perf-rates-${Date.now()}`,
      type: 'rates.save',
      companyId,
      date: '2026-12-31',
      source: 'manual',
      rates: ['USD', 'EUR', 'GBP', 'RUB', 'TRY', 'CNY', 'CHF', 'AED'].map((currency) => ({
        currency,
        rate: '1.7',
      })),
    },
    { actor: 'perf', correlationId: 'perf' },
  );
  time('Valyuta yenidən qiymətləndirilməsi, hesablama', 3000, () =>
    q({ type: 'revaluation', month: '2026-12' }),
  );
  const check = time('Bütövlük yoxlaması', 20000, () => q({ type: 'integrity' }) as IntegrityView);
  assert.equal(check.ok, true, check.problems.join());
  // P1 (5c): September closed on the large base — checks, FIFO of 1 000 products, the VAT of the
  // month's 1 200 e-qaimə invoices, 6xx / 7xx → 801 → 341 and the lock, in one transaction. The
  // months before are locked by hand (a reused MEYAR_PERF_DB keeps its closing: skipped).
  if (!db.get("SELECT 1 FROM month_closings WHERE company_id=? AND month='2026-09'", companyId)) {
    const ctx = { actor: 'perf', correlationId: 'perf' };
    ledger.execute(
      { key: `perf-lock-${Date.now()}`, type: 'period.close', companyId, through: '2026-08-31' },
      ctx,
    );
    const preview = time(
      'Ay bağlanışı, baxış (bütün addımlar)',
      10000,
      () => q({ type: 'closing', month: '2026-09' }) as ClosingView,
    );
    assert.deepEqual(preview.blocking, []);
    const closed = time('Ay bağlanışı (FIFO, ƏDV, 801, 341, kilid)', 10000, () =>
      ledger.execute(
        {
          key: `perf-closing-${Date.now()}`,
          type: 'closing.post',
          companyId,
          month: '2026-09',
          acknowledged: true,
        },
        ctx,
      ),
    ) as { number: string };
    assert.equal(closed.number, 'AB-2026-09');
    const after = q({ type: 'closing', month: '2026-09' }) as ClosingView;
    assert.equal(after.profit, preview.profit);
  }
  // P1 (5d): M/Z of a year, the dashboard, the cash flow of a year and the VAT summary.
  const plYear = time(
    'Mənfəət və zərər, il',
    1000,
    () => q({ type: 'profitLoss', year: '2026' }) as ProfitLossView,
  );
  assert.ok(plYear.rows.length > 1);
  const panel = time(
    'İdarə paneli',
    1500,
    () => q({ type: 'dashboard', month: '2026-09' }) as DashboardView,
  );
  assert.equal(panel.series.length, 12);
  const flow = time(
    'Pul vəsaitlərinin hərəkəti, il',
    3000,
    () => q({ type: 'cashFlow', from: '2026-01-01', to: '2026-12-31' }) as CashFlowView,
  );
  assert.equal(flow.reconciled, true);
  time('ƏDV icmalı, ay', 1500, () => q({ type: 'vatSummary', month: '2026-09' }));
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
