/**
 * Audit 2 (money: bank, cash, statements, advances). Each test states the expected accounting
 * result; a failing test is a confirmed defect. Made-up names, VÖENs and IBANs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { depositPaid } from '../../src/application/money.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;

const balance = (f: F, account: string, document: string) =>
  f.db.get(
    `SELECT COALESCE(SUM(a),0) AS a, COALESCE(SUM(c),0) AS c FROM (
       SELECT amount AS a, dt_cur AS c FROM postings WHERE dt_account=? AND dt_s3=?
       UNION ALL SELECT -amount, -kt_cur FROM postings WHERE kt_account=? AND kt_s3=?)`,
    account,
    document,
    account,
    document,
  )!;
const accountBalance = (f: F, account: string) =>
  f.db.get(
    `SELECT COALESCE(SUM(a),0) AS a FROM (
       SELECT amount AS a FROM postings WHERE dt_account=?
       UNION ALL SELECT -amount FROM postings WHERE kt_account=?)`,
    account,
    account,
  )!.a as bigint;

function base(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t);
  const bankP = f.partner('Sınaq Bank ASC', '9900000071');
  const founder = f.partner('Sınaq Təsisçi', '', 'individual');
  const capitalIn = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const current = f.bankAccount(bankP, 'AZ21TEST00000000000000000021', '223.01', 'AZN', 'Cari');
  const deposit = f.bankAccount(bankP, 'AZ22TEST00000000000000000022', '224.04', 'AZN', 'ƏDV');
  f.bank('in', '2026-09-30', current, [f.bankLine('301', [founder, capitalIn], '50000')]);
  f.bank('in', '2026-09-30', deposit, [f.bankLine('301', [founder, capitalIn], '5000')]);
  const supplier = f.partner('Sınaq Daşıyıcı MMC', '1700000771');
  const contract = f.contract(supplier, 'P-77', 'purchase');
  const good = f.product('Sınaq malı', 'ədəd');
  const buy = (date: string) =>
    f.invoice('purchase', date, supplier, contract, [
      { productId: good, quantity: '10', price: '100' },
    ]); // 1 000 + 180 VAT
  const paidVat = (id: string) =>
    depositPaid(f.db, f.companyId, 'out', '531.01', supplier, contract, `invoice:${id}`);
  return { f, bankP, current, deposit, supplier, contract, good, buy, paidVat };
}

test('A2-1: a VAT-deposit advance is offset only against VAT, never against the net of an invoice', (t) => {
  const { f, current, deposit, supplier, contract, buy, paidVat } = base(t);
  // Prepayments for two future invoices: VAT of both (2 × 180) from the deposit, the rest from
  // the current account.
  f.bank('out', '2026-10-01', deposit, [f.bankLine('531.01', [supplier, contract], '360')]);
  f.bank('out', '2026-10-02', current, [f.bankLine('531.01', [supplier, contract], '2000')]);
  const a = buy('2026-10-05');
  const b = buy('2026-10-06');
  // Each invoice's VAT (180) is paid through the deposit; the deposit money is not net.
  assert.equal(paidVat(a.id), 18000n, 'invoice A: VAT paid through the deposit');
  assert.equal(paidVat(b.id), 18000n, 'invoice B: VAT paid through the deposit');
});

test('A2-2: the advance of a current-account document is not VAT just because another line had the "VAT payment" item', (t) => {
  const { f, current, supplier, contract, buy, paidVat } = base(t);
  const vatItem = String(
    f.db.get(
      "SELECT id FROM items WHERE company_id=? AND kind='cashFlowItem' AND role='vatPayment'",
      f.companyId,
    )!.id,
  );
  const a = buy('2026-10-05');
  // One payment order: VAT of A with the "VAT payment" item, and 2 000 for A's net and an advance.
  f.bank('out', '2026-10-06', current, [
    f.bankLine('531.01', [supplier, contract], '180', { cashFlowItem: vatItem }),
    f.bankLine('531.01', [supplier, contract], '2000'),
  ]);
  assert.equal(paidVat(a.id), 18000n, 'A: its VAT was paid');
  const b = buy('2026-10-07');
  // B is offset by the 1 000 net advance; none of its VAT reached the supplier's deposit.
  assert.equal(balance(f, '531.01', `invoice:${b.id}`).a, -18000n, 'B: 180 still owed');
  assert.equal(paidVat(b.id), 0n, 'B: nothing of its VAT was paid through the deposit');
});

test('A2-3: a currency invoice still owed in currency offsets a later-typed earlier advance', (t) => {
  const f = fixture(t);
  const bankP = f.partner('Sınaq Bank ASC', '9900000071');
  const eur = f.bankAccount(bankP, 'AZ23TEST00000000000000000023', '223.02', 'EUR', 'EUR');
  const customer = f.partner('Foreign Freight GmbH', '', 'foreign');
  const c = f.contract(customer, 'EX-1', 'sale', 'EUR');
  const service = f.product('Beynəlxalq daşıma', 'reys', 'service');
  const inv = f.invoice(
    'sale',
    '2026-10-05',
    customer,
    c,
    [{ productId: service, quantity: '1', price: '1000', vatRate: '0' }],
    { rate: '1.9000' },
  ); // 1 000 EUR = 1 900.00 AZN
  // 990 EUR arrive when the rate has risen: 1 900.80 AZN — 10 EUR still owed.
  f.bank('in', '2026-10-10', eur, [f.bankLine('211.02', [customer, c], '990')], {
    rate: '1.9200',
  });
  assert.equal(balance(f, '211.02', `invoice:${inv.id}`).c, 1000n, '10.00 EUR still owed');
  // The statement brings an earlier 10 EUR prepayment, typed after the invoice.
  f.bank('in', '2026-10-02', eur, [f.bankLine('211.02', [customer, c], '10')], {
    rate: '1.9000',
  });
  assert.equal(
    balance(f, '211.02', `invoice:${inv.id}`).c,
    0n,
    'the invoice offsets the 10 EUR advance like any other later-typed prepayment',
  );
});

test('A2-4: a currency purchase through 222.02 closes to zero after the month revaluation', (t) => {
  const f = fixture(t);
  const bankP = f.partner('Sınaq Bank ASC', '9900000071');
  const founder = f.partner('Sınaq Təsisçi', '', 'individual');
  const capitalIn = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const azn = f.bankAccount(bankP, 'AZ24TEST00000000000000000024', '223.01', 'AZN', 'AZN');
  const usd = f.bankAccount(bankP, 'AZ25TEST00000000000000000025', '223.02', 'USD', 'USD');
  const fx = f.contract(bankP, 'FX-1', 'other', 'USD');
  f.bank('in', '2026-09-30', azn, [f.bankLine('301', [founder, capitalIn], '10000')]);
  f.exec({
    type: 'rates.save',
    companyId: f.companyId,
    date: '2026-10-15',
    source: 'manual',
    rates: [{ currency: 'USD', rate: '1.7000' }],
  });
  // QERARLAR: Dt 222.02 / Kt 223.01 → Dt 223.02 / Kt 222.02, difference Dt 731 / Kt 222.02.
  f.bank('out', '2026-10-15', azn, [f.bankLine('222.02', [bankP, fx, ''], '1705')]);
  f.bank('in', '2026-10-15', usd, [f.bankLine('222.02', [bankP, fx, ''], '1000')], {
    rate: '1.7000',
  });
  try {
    f.exec({ type: 'revaluation.post', companyId: f.companyId, month: '2026-10' });
  } catch {
    /* nothing to revalue on currency accounts */
  }
  const warned = f.home().warnings.some((w) => w.text.includes('222.02'));
  assert.ok(
    accountBalance(f, '222.02') === 0n || warned,
    `222.02 keeps ${accountBalance(f, '222.02')} qəpik with no posting and no signal`,
  );
});

test('A2-3 control: the same case at an unchanged rate is offset (only the AZN filter differs)', (t) => {
  const f = fixture(t);
  const bankP = f.partner('Sınaq Bank ASC', '9900000071');
  const eur = f.bankAccount(bankP, 'AZ23TEST00000000000000000023', '223.02', 'EUR', 'EUR');
  const customer = f.partner('Foreign Freight GmbH', '', 'foreign');
  const c = f.contract(customer, 'EX-1', 'sale', 'EUR');
  const service = f.product('Beynəlxalq daşıma', 'reys', 'service');
  const inv = f.invoice(
    'sale',
    '2026-10-05',
    customer,
    c,
    [{ productId: service, quantity: '1', price: '1000', vatRate: '0' }],
    { rate: '1.9000' },
  );
  f.bank('in', '2026-10-10', eur, [f.bankLine('211.02', [customer, c], '990')], {
    rate: '1.9000',
  });
  f.bank('in', '2026-10-02', eur, [f.bankLine('211.02', [customer, c], '10')], {
    rate: '1.9000',
  });
  assert.equal(balance(f, '211.02', `invoice:${inv.id}`).c, 0n);
});
