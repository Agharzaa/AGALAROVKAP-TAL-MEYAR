import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  BankDocumentDetail,
  BankDocumentSummary,
  InvoiceDetail,
} from '../../src/contracts/queries.js';
import { fixture, type Cmd } from './fixture.js';

type F = ReturnType<typeof fixture>;
type BankCmd = Extract<Cmd, { type: 'bank.save' }>;

const detail = (f: F, id: string) =>
  f.query<BankDocumentDetail>({ type: 'bankDocument', companyId: f.companyId, id });
const postings = (f: F, id: string) =>
  detail(f, id).postings.map((p) => [
    p.dt.account,
    p.kt.account,
    p.amount,
    ...(p.dt.curAmount || p.kt.curAmount ? [`${p.dt.curAmount}|${p.kt.curAmount}`] : []),
  ]);
/** Settlement document of each posting's counter side ("invoice:…", "bank:…"). */
const documents = (f: F, id: string) =>
  detail(f, id).postings.map((p) => (p.dt.account.startsWith('22') ? p.kt.sk[2] : p.dt.sk[2]));
const resave = (f: F, id: string, cmd: Omit<BankCmd, 'companyId' | 'type' | 'id' | 'version'>) =>
  f.exec({
    type: 'bank.save',
    companyId: f.companyId,
    id,
    version: detail(f, id).version,
    ...cmd,
  });
const cancel = (f: F, id: string) =>
  f.exec({
    type: 'bank.cancel',
    companyId: f.companyId,
    id,
    version: detail(f, id).version,
    reason: 'səhv',
  });

/**
 * The September example of docs/QERARLAR.md with bank documents instead of manual operations:
 * the receipt and the payment arrive in two parts (current account and VAT deposit) and are
 * matched to the invoices by the documents themselves.
 */
function september(f: F) {
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Ağarza Ağalarov', '', 'individual');
  const supplier = f.partner('Təchizat ASC', '1700000002');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const bankK = f.bankAccount(kapital, 'AZ12AIIB38060019441234567890', '223.01', 'AZN', 'Kapital');
  const bankP = f.bankAccount(kapital, 'AZ55PAHA40060AZNHC0101091203', '223.01', 'AZN', 'PAŞA');
  const deposit = f.bankAccount(kapital, 'AZ77AIIB38060019449999999999', '224.04', 'AZN', 'ƏDV');
  const c12 = f.contract(supplier, '12', 'purchase');
  const c7 = f.contract(customer, '7', 'sale');
  const paper = f.product('Kağız A4', 'qutu');
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  const capitalIn = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const B = f.bankLine;
  f.bank('in', '2026-08-31', bankK, [B('301', [founder, capitalIn], '30000')]);
  f.bank('in', '2026-08-31', bankP, [B('301', [founder, capitalIn], '10000')]);
  f.bank('in', '2026-08-31', deposit, [B('301', [founder, capitalIn], '3000')]);
  const purchase = f.invoice(
    'purchase',
    '2026-09-05',
    supplier,
    c12,
    [{ productId: paper, quantity: '100', price: '100' }],
    { eqNumber: 'AA001' },
  );
  const payMain = f.bank('out', '2026-09-18', bankK, [B('531.01', [supplier, c12], '10000')]);
  const payVat = f.bank('out', '2026-09-18', deposit, [B('531.01', [supplier, c12], '1800')]);
  const sale = f.invoice(
    'sale',
    '2026-09-08',
    customer,
    c7,
    [{ productId: paper, quantity: '70', price: '214.2857' }],
    { pricesIncludeVat: true },
  );
  // 18 000 paid: 18/118 to the VAT deposit, the rest to the current account (QERARLAR example).
  const receiptMain = f.bank('in', '2026-09-15', bankK, [B('211.01', [customer, c7], '15254.24')], {
    counterpartyName: 'ALICI MMC',
    counterpartyTaxId: '1700000001',
    purpose: 'SQ-000001 üzrə ödəniş',
  });
  const receiptVat = f.bank('in', '2026-09-15', deposit, [B('211.01', [customer, c7], '2745.76')]);
  f.bank('out', '2026-09-30', bankK, [B('721', [fees], '3')]);
  return {
    kapital,
    supplier,
    customer,
    c12,
    c7,
    paper,
    bankK,
    bankP,
    deposit,
    purchase,
    sale,
    payMain,
    payVat,
    receiptMain,
    receiptVat,
  };
}

test('B1/B2: September through bank documents — same ledger to the qəpik, VAT parts split', (t) => {
  const f = fixture(t);
  const s = september(f);
  const purchaseDoc = `invoice:${s.purchase.id}`;
  const saleDoc = `invoice:${s.sale.id}`;
  assert.deepEqual(postings(f, s.payMain.id), [['531.01', '223.01', '10000.00']]);
  assert.deepEqual(documents(f, s.payMain.id), [purchaseDoc]);
  assert.deepEqual(postings(f, s.payVat.id), [['531.01', '224.04', '1800.00']]);
  assert.deepEqual(documents(f, s.payVat.id), [purchaseDoc]);
  assert.deepEqual(postings(f, s.receiptMain.id), [
    ['223.01', '211.01', '12711.86'],
    ['223.01', '543.01', '2542.38'],
  ]);
  assert.deepEqual(documents(f, s.receiptMain.id), [saleDoc, `bank:${s.receiptMain.id}`]);
  assert.deepEqual(postings(f, s.receiptVat.id), [
    ['224.04', '211.01', '2288.14'],
    ['224.04', '543.01', '457.62'],
  ]);
  const d = detail(f, s.receiptMain.id);
  assert.deepEqual(
    [d.number, d.direction, d.account, d.amount, d.counterpartyTaxId, d.accounts],
    ['BD-000004', 'in', '223.01', '15254.24', '1700000001', '211.01'],
  );
  assert.equal(detail(f, s.payMain.id).number, 'BX-000001');
  const tb = f.trial('2026-09-01', '2026-09-30', ['a:223', 'a:223.01']);
  assert.deepEqual(tb.totals, {
    openDt: '43000.00',
    openKt: '43000.00',
    turnDt: '65891.14',
    turnKt: '65891.14',
    closeDt: '63288.14',
    closeKt: '63288.14',
  });
  assert.equal(f.row(tb, `a:223.01|${s.bankK}`)!.closeDt, '35251.24');
  // The sale invoice is fully paid; the advance waits for the next invoice.
  const sale = f.trial('2026-09-01', '2026-09-30', [
    'a:211',
    'a:211.01',
    `a:211.01|${s.customer}`,
    `a:211.01|${s.customer}|${s.c7}`,
  ]);
  const paid = f.row(sale, `a:211.01|${s.customer}|${s.c7}|${saleDoc}`)!;
  assert.deepEqual([paid.turnDt, paid.turnKt, paid.closeDt], ['15000.00', '15000.00', '']);
  assert.equal(f.row(sale, 'a:211')!.closeDt, '');
  // Card lines know the bank document and its direction.
  const card = f.card('223.01', '2026-09-01', '2026-09-30', [s.bankK]);
  assert.deepEqual(
    card.lines.map((l) => [l.sourceType, l.direction, l.number, l.debit, l.credit]),
    [
      ['bank', 'in', 'BD-000004', '12711.86', ''],
      ['bank', 'in', 'BD-000004', '2542.38', ''],
      ['bank', 'out', 'BX-000001', '', '10000.00'],
      ['bank', 'out', 'BX-000003', '', '3.00'],
    ],
  );
  const list = f.query<BankDocumentSummary[]>({
    type: 'bankDocuments',
    companyId: f.companyId,
    from: '2026-09-01',
    to: '2026-09-30',
    bankAccountId: s.deposit,
  });
  assert.deepEqual(
    list.map((b) => [b.number, b.amount, b.accounts]),
    [
      ['BX-000002', '1800.00', '531.01'],
      ['BD-000005', '2745.76', '211.01'],
    ],
  );
  assert.ok(f.home().documents.some((x) => x.kind === 'bankIn' && x.number === 'BD-000004'));
});

test('October: the next invoice offsets the advances of both bank documents', (t) => {
  const f = fixture(t);
  const s = september(f);
  const inv = f.invoice(
    'sale',
    '2026-10-06',
    s.customer,
    s.c7,
    [{ productId: s.paper, quantity: '10', price: '500' }],
    { pricesIncludeVat: true },
  );
  const d = f.query<InvoiceDetail>({ type: 'invoice', companyId: f.companyId, id: inv.id });
  const offsets = d.postings.filter((p) => p.dt.account === '543.01');
  assert.deepEqual(
    offsets.map((p) => [p.dt.sk[2], p.amount]).sort(),
    [
      [`bank:${s.receiptMain.id}`, '2542.38'],
      [`bank:${s.receiptVat.id}`, '457.62'],
    ].sort(),
  );
  assert.equal(f.home().warnings.length, 0);
  // The rest of the October invoice: 5 000 − 3 000. Its VAT part (762.71) is still open, of which
  // the advance from the deposit covered 457.62; a deposit payment settles the remaining 305.09.
  const vatPay = f.bank('in', '2026-10-10', s.deposit, [
    f.bankLine('211.01', [s.customer, s.c7], '400'),
  ]);
  assert.deepEqual(postings(f, vatPay.id), [
    ['224.04', '211.01', '305.09'],
    ['224.04', '543.01', '94.91'],
  ]);
});

test('B4: one payment, two lines — loan principal and interest', (t) => {
  const f = fixture(t);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const acc = f.bankAccount(bank, 'AZ12AIIB38060019441234567890');
  const loan = f.contract(bank, 'K-1', 'loan');
  f.bank('in', '2026-09-01', acc, [f.bankLine('501', [bank, loan], '10000')]);
  const pay = f.bank('out', '2026-09-30', acc, [
    f.bankLine('501', [bank, loan], '1000'),
    f.bankLine('751', [bank, loan], '85.50', { memo: 'Sentyabr faizi' }),
  ]);
  assert.deepEqual(postings(f, pay.id), [
    ['501', '223.01', '1000.00'],
    ['751', '223.01', '85.50'],
  ]);
  const d = detail(f, pay.id);
  assert.deepEqual([d.amount, d.accounts], ['1085.50', '501, 751']);
  assert.equal(d.postings[1]!.memo, 'Sentyabr faizi');
  assert.equal(d.lines[0]!.skNames.join(' · '), 'Kapital Bank ASC · Müqavilə №K-1 · kredit');
});

test('B5: own accounts — out through 222.01, in from it; 222.01 closes at zero', (t) => {
  const f = fixture(t);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const a = f.bankAccount(bank, 'AZ12AIIB38060019441234567890', '223.01', 'AZN', 'A');
  const b = f.bankAccount(bank, 'AZ55PAHA40060AZNHC0101091203', '223.01', 'AZN', 'B');
  const founder = f.partner('Təsisçi', '', 'individual');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  f.bank('in', '2026-09-01', a, [f.bankLine('301', [founder, capital], '1000')]);
  f.bank('out', '2026-09-10', a, [f.bankLine('222.01', [], '400')]);
  const mid = f.trial('2026-09-01', '2026-09-10');
  assert.equal(mid.rows.find((r) => r.account === '222')!.closeDt, '400.00');
  f.bank('in', '2026-09-11', b, [f.bankLine('222.01', [], '400')]);
  const tb = f.trial('2026-09-01', '2026-09-30', ['a:223', 'a:223.01']);
  assert.equal(tb.rows.find((r) => r.account === '222')!.closeDt, '');
  assert.equal(f.row(tb, `a:223.01|${a}`)!.closeDt, '600.00');
  assert.equal(f.row(tb, `a:223.01|${b}`)!.closeDt, '400.00');
});

test('B6: currency account — USD receipts matched in dollars, advance in dollars', (t) => {
  const f = fixture(t);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const usd = f.bankAccount(bank, 'AZ12AIIB38060019449999999901', '223.02', 'USD', 'USD');
  const customer = f.partner('Foreign Ltd', '', 'foreign');
  const c = f.contract(customer, 'EXP-1', 'sale', 'USD');
  const service = f.product('Konsaltinq', 'saat', 'service');
  const inv = f.invoice(
    'sale',
    '2026-09-01',
    customer,
    c,
    [{ productId: service, quantity: '10', price: '100', vatRate: '0' }],
    { rate: '1.7000' },
  );
  const first = f.bank('in', '2026-09-10', usd, [f.bankLine('211.02', [customer, c], '600')], {
    rate: '1.7100',
  });
  assert.deepEqual(postings(f, first.id), [['223.02', '211.02', '1026.00', '600.00|600.00']]);
  assert.deepEqual(documents(f, first.id), [`invoice:${inv.id}`]);
  const second = f.bank('in', '2026-09-20', usd, [f.bankLine('211.02', [customer, c], '500')], {
    rate: '1.7000',
  });
  assert.deepEqual(postings(f, second.id), [
    ['223.02', '211.02', '680.00', '400.00|400.00'],
    ['223.02', '543.02', '170.00', '100.00|100.00'],
  ]);
  assert.equal(detail(f, second.id).amountAzn, '850.00');
  // The rate difference of the invoice stays on 211.02 until month-end revaluation (stage 5).
  const tb = f.trial('2026-09-01', '2026-09-30');
  assert.equal(tb.rows.find((r) => r.account === '211')!.closeKt, '6.00');
  // A dollar account cannot settle a manat contract automatically.
  const local = f.partner('Yerli MMC', '1700000009');
  const lc = f.contract(local, 'L-1', 'sale');
  assert.throws(
    () =>
      f.bank('in', '2026-09-21', usd, [f.bankLine('211.01', [local, lc], '10')], { rate: '1.7' }),
    /bank hesabının valyutası \(USD\) müqavilənin valyutasından \(AZN\) fərqlidir/,
  );
  assert.throws(
    () => f.bank('in', '2026-09-21', usd, [f.bankLine('211.02', [customer, c], '10')]),
    /USD məzənnəsi/,
  );
});

test('B7: an advance already used by an invoice is not taken back', (t) => {
  const f = fixture(t);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const acc = f.bankAccount(bank, 'AZ12AIIB38060019441234567890');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const c = f.contract(customer, '1', 'sale');
  const service = f.product('Xidmət', 'ay', 'service');
  const B = (amount: string) => [f.bankLine('211.01', [customer, c], amount)];
  const receipt = f.bank('in', '2026-09-01', acc, B('1000'));
  assert.deepEqual(postings(f, receipt.id), [['223.01', '543.01', '1000.00']]);
  const inv = f.invoice('sale', '2026-09-05', customer, c, [
    { productId: service, price: '600', vatRate: '0' },
  ]);
  const base = { direction: 'in' as const, number: '', date: '2026-09-01', bankAccountId: acc };
  const common = {
    rate: '',
    bankReference: '',
    counterpartyName: '',
    counterpartyTaxId: '',
    purpose: '',
  };
  assert.throws(
    () => resave(f, receipt.id, { ...base, ...common, lines: B('500') }),
    /SQ-000001 əvəzləşdirilib; dəyişiklik avansı 100\.00 AZN mənfiyə salardı/,
  );
  assert.throws(() => cancel(f, receipt.id), /SQ-000001 əvəzləşdirilib/);
  // Within what is left, a correction is fine; the invoice stays settled.
  resave(f, receipt.id, { ...base, ...common, lines: B('800') });
  assert.deepEqual(postings(f, receipt.id), [['223.01', '543.01', '800.00']]);
  const tb = f.trial('2026-09-01', '2026-09-30');
  assert.equal(tb.rows.find((r) => r.account === '543')!.closeKt, '200.00');
  assert.equal(tb.rows.find((r) => r.account === '211')!.closeDt, '');
  // Once the invoice is cancelled the receipt can be cancelled too.
  f.exec({
    type: 'invoice.cancel',
    companyId: f.companyId,
    id: inv.id,
    version: 1,
    reason: 'səhv',
  });
  cancel(f, receipt.id);
  assert.equal(detail(f, receipt.id).status, 'cancelled');
  assert.equal(f.trial('2026-09-01', '2026-09-30').totals.closeDt, '0.00');
});

test('correction re-matches without counting itself; unchanged save keeps the version', (t) => {
  const f = fixture(t);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const acc = f.bankAccount(bank, 'AZ12AIIB38060019441234567890');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const c = f.contract(customer, '1', 'sale');
  const service = f.product('Xidmət', 'ay', 'service');
  const a = f.invoice('sale', '2026-09-01', customer, c, [
    { productId: service, price: '100', vatRate: '0' },
  ]);
  const b = f.invoice('sale', '2026-09-02', customer, c, [
    { productId: service, price: '50', vatRate: '0' },
  ]);
  // An invoice dated after the receipt is not settled by it.
  f.invoice('sale', '2026-09-20', customer, c, [{ productId: service, price: '70', vatRate: '0' }]);
  const cmd = {
    direction: 'in' as const,
    number: '',
    date: '2026-09-10',
    bankAccountId: acc,
    rate: '',
    bankReference: 'PT-77',
    counterpartyName: '',
    counterpartyTaxId: '',
    purpose: '',
    lines: [f.bankLine('211.01', [customer, c], '120')],
  };
  const r = f.bank('in', cmd.date, acc, cmd.lines, cmd);
  assert.deepEqual(documents(f, r.id), [`invoice:${a.id}`, `invoice:${b.id}`]);
  assert.deepEqual(
    postings(f, r.id).map((p) => p[2]),
    ['100.00', '20.00'],
  );
  assert.equal(resave(f, r.id, cmd).version, 1, 'nothing changed');
  resave(f, r.id, { ...cmd, lines: [f.bankLine('211.01', [customer, c], '170')] });
  assert.deepEqual(
    postings(f, r.id).map((p) => [p[1], p[2]]),
    [
      ['211.01', '100.00'],
      ['211.01', '50.00'],
      ['543.01', '20.00'],
    ],
  );
  assert.equal(detail(f, r.id).version, 2);
  // An explicit settlement document is posted as entered, even to a later invoice.
  const explicit = f.bank('in', '2026-09-11', acc, [
    f.bankLine('211.01', [customer, c, `invoice:${a.id}`], '5'),
  ]);
  assert.deepEqual(documents(f, explicit.id), [`invoice:${a.id}`]);
  assert.match(
    f
      .query<{ action: string; detail: string }[]>({ type: 'audit', companyId: f.companyId })
      .map((x) => `${x.action} ${x.detail}`)
      .join('\n'),
    /Düzəliş edildi \(storno \+ yeni yazılış\) BD-000001/,
  );
});

test('B8 and checks: closed period, wrong lines, archived bank account', (t) => {
  const f = fixture(t);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const acc = f.bankAccount(bank, 'AZ12AIIB38060019441234567890');
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  const r = f.bank('out', '2026-09-10', acc, [f.bankLine('721', [fees], '3')]);
  f.exec({ type: 'period.close', companyId: f.companyId, through: '2026-09-30', reason: '' });
  assert.throws(
    () => f.bank('out', '2026-09-15', acc, [f.bankLine('721', [fees], '3')]),
    /2026-09-30 tarixinədək bağlanıb/,
  );
  assert.throws(() => cancel(f, r.id), /bağlanıb/);
  const ok = (lines: Parameters<F['bank']>[3], date = '2026-10-01') =>
    f.bank('out', date, acc, lines);
  assert.throws(() => ok([f.bankLine('721', [], '3')]), /subkonto 1 seçilməyib|tapılmadı/);
  assert.throws(() => ok([f.bankLine('721', [fees], '0')]), /müsbət olmalıdır/);
  assert.throws(() => ok([f.bankLine('721', [fees], '-5')]), /müsbət ədəd yazın/);
  assert.throws(() => ok([f.bankLine('223.01', [acc], '5')]), /bank hesabının özüdür/);
  assert.throws(() => ok([f.bankLine('205', ['x'], '5')]), /miqdar uçotu olan hesabdır/);
  assert.throws(() => ok([f.bankLine('211', [], '5')]), /subhesab seçin/);
  assert.throws(() => ok([]), /Sorğu düzgün deyil: lines/);
  assert.throws(
    () => f.bank('out', '2026-10-01', acc, [f.bankLine('721', [fees], '3')], { rate: '1.7' }),
    /Manat hesabında məzənnə yazılmır/,
  );
  f.exec({
    type: 'bankAccount.save',
    companyId: f.companyId,
    id: acc,
    version: 1,
    bankId: bank,
    iban: 'AZ12AIIB38060019441234567890',
    currency: 'AZN',
    account: '223.01',
    name: '',
    archived: true,
  });
  assert.throws(() => ok([f.bankLine('721', [fees], '3')]), /Bank hesabı arxivdədir/);
});

test('currency exchange: AZN account to a currency counter account needs the currency amount', (t) => {
  const f = fixture(t);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const azn = f.bankAccount(bank, 'AZ12AIIB38060019441234567890');
  const sell = f.contract(bank, 'FX-1', 'other', 'USD');
  const line = f.bankLine('222.04', [bank, sell, ''], '1700');
  assert.throws(() => f.bank('in', '2026-09-01', azn, [line]), /USD məbləğini yazın/);
  const r = f.bank('in', '2026-09-01', azn, [{ ...line, curAmount: '1000' }]);
  assert.deepEqual(postings(f, r.id), [['223.01', '222.04', '1700.00', '|1000.00']]);
});
