/**
 * Audit 2 (developer, core integrity) — 2026-10-31. Made-up names and numbers.
 * Each test describes the expected behaviour; a failing test is a confirmed defect.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;

const keyBalance = (f: F, account: string, document: string) =>
  f.db.get(
    `SELECT COALESCE(SUM(a),0) AS a FROM (
       SELECT amount AS a FROM postings WHERE company_id=? AND dt_account=? AND dt_s3=?
       UNION ALL SELECT -amount FROM postings WHERE company_id=? AND kt_account=? AND kt_s3=?)`,
    f.companyId,
    account,
    document,
    f.companyId,
    account,
    document,
  )!.a as bigint;

function sale(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t);
  const bankP = f.partner('Nümunə Bank ASC', '9900000001');
  const acc = f.bankAccount(bankP, 'AZ11TEST00000000000000000011', '223.01', 'AZN', 'Bank');
  const customer = f.partner('Alıcı Bir MMC', '1700000101');
  const contract = f.contract(customer, 'S-1', 'sale');
  const service = f.product('Daşıma', 'reys', 'service');
  return { f, acc, customer, contract, service };
}

test('swallow: an archived product silently blocks the offset of a later-entered advance', (t) => {
  const { f, acc, customer, contract, service } = sale(t);
  const inv = f.invoice('sale', '2026-10-05', customer, contract, [
    { productId: service, price: '1000', vatRate: '0' },
  ]);
  // The service is no longer sold: archived (nothing about the posted invoice changes).
  f.exec({
    type: 'product.save',
    companyId: f.companyId,
    id: service,
    version: 1,
    code: '',
    name: 'Daşıma',
    unit: 'reys',
    kind: 'service',
    groupId: '',
    archived: true,
  });
  const r = f.bank('in', '2026-10-02', acc, [f.bankLine('211.01', [customer, contract], '1000')]);
  const owed = keyBalance(f, '211.01', `invoice:${inv.id}`);
  // Either the invoice offsets the advance, or the user is told why it did not.
  assert.ok(
    owed === 0n || !!(r as { warning?: string }).warning,
    `invoice still owes ${owed} and 543 keeps the advance, with no warning: the DomainError ` +
      `"nomenklatura arxivdədir" from normalize() was swallowed by offsetLaterAdvances' catch {}`,
  );
});

test('swallow: an archived contract silently blocks the offset as well', (t) => {
  const { f, acc, customer, contract, service } = sale(t);
  const inv = f.invoice('sale', '2026-10-05', customer, contract, [
    { productId: service, price: '1000', vatRate: '0' },
  ]);
  f.exec({
    type: 'contract.save',
    companyId: f.companyId,
    id: contract,
    version: 1,
    partnerId: customer,
    number: 'S-1',
    date: '2026-01-01',
    kind: 'sale',
    currency: 'AZN',
    note: '',
    archived: true,
  });
  // A payment for an archived contract is still accepted by the bank document …
  let r: { warning?: string } | undefined;
  try {
    r = f.bank('in', '2026-10-02', acc, [f.bankLine('211.01', [customer, contract], '1000')]);
  } catch {
    return; // the bank refuses an archived contract: nothing hidden
  }
  const owed = keyBalance(f, '211.01', `invoice:${inv.id}`);
  assert.ok(owed === 0n || !!r?.warning, `invoice still owes ${owed}, no warning`);
});

test('perf: one early advance re-builds every later owed invoice of the partner', (t) => {
  const { f, acc, customer, contract, service } = sale(t);
  const N = 150;
  for (let i = 0; i < N; i++)
    f.invoice('sale', `2026-10-${String(5 + (i % 20)).padStart(2, '0')}`, customer, contract, [
      { productId: service, price: '100', vatRate: '0' },
    ]);
  const t0 = performance.now();
  // A 1.00 AZN advance: only the first invoice can use it; the other N-1 are rebuilt for nothing.
  f.bank('in', '2026-10-02', acc, [f.bankLine('211.01', [customer, contract], '1')]);
  const withOffset = performance.now() - t0;
  const t1 = performance.now();
  f.bank('in', '2026-10-30', acc, [f.bankLine('211.01', [customer, contract], '1')]);
  const plain = performance.now() - t1;
  const reposted = f.db.get(
    'SELECT COUNT(*) AS n FROM invoices WHERE company_id=? AND version>1',
    f.companyId,
  )!.n;
  console.log(
    `perf: ${N} owed invoices — early advance bank save ${withOffset.toFixed(0)} ms, ` +
      `late one ${plain.toFixed(0)} ms, invoices reposted ${String(reposted)}`,
  );
  assert.ok(withOffset < 10 * Math.max(plain, 20), 'bank save cost grows with owed invoices');
});

test('invariant: registers equal postings and every version has history after offsets', (t) => {
  const { f, acc, customer, contract, service } = sale(t);
  const invs = [5, 6, 7].map((d) =>
    f.invoice('sale', `2026-10-0${d}`, customer, contract, [
      { productId: service, price: '400', vatRate: '0' },
    ]),
  );
  f.bank('in', '2026-10-02', acc, [f.bankLine('211.01', [customer, contract], '1000')]);
  const diff = f.db.all(
    `SELECT r.account, r.d, p.d AS pd FROM
       (SELECT account, SUM(debit)-SUM(credit) AS d FROM registers WHERE company_id=? GROUP BY account) r
     LEFT JOIN (SELECT a, SUM(x) AS d FROM (
        SELECT dt_account AS a, amount AS x FROM postings WHERE company_id=?
        UNION ALL SELECT kt_account, -amount FROM postings WHERE company_id=?) GROUP BY a) p ON p.a=r.account
     WHERE r.d<>COALESCE(p.d,0)`,
    f.companyId,
    f.companyId,
    f.companyId,
  );
  assert.deepEqual(diff, []);
  for (const inv of invs) {
    const v = Number(f.db.get('SELECT version FROM invoices WHERE id=?', inv.id)!.version);
    const hist = f.db.all(
      "SELECT version FROM document_history WHERE doc_type='invoice' AND doc_id=? ORDER BY version",
      inv.id,
    );
    assert.deepEqual(
      hist.map((h) => Number(h.version)),
      Array.from({ length: v }, (_, i) => i + 1),
    );
  }
  // 400 + 400 + 200 offset, the third invoice still owes 200.
  assert.equal(keyBalance(f, '211.01', `invoice:${invs[2]!.id}`), 20000n);
});
