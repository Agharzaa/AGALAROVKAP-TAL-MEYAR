/**
 * Independent chief-accountant audit of 0.9.33. "audit:" tests show a defect and fail until it is
 * fixed; "ok:" tests are the scenarios worked out by hand that were found right.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClosingView, DeclarationView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;
const close = (f: F, month: string) =>
  f.exec({ type: 'closing.post', companyId: f.companyId, month, acknowledged: true });
const closeYear = (f: F, year: number) => {
  for (let m = 1; m <= 12; m++) close(f, `${year}-${String(m).padStart(2, '0')}`);
};
const view = (f: F, month: string) =>
  f.query<ClosingView>({ type: 'closing', companyId: f.companyId, month });
const step = (f: F, month: string, key: string) =>
  view(f, month)
    .steps.find((s) => s.key === key)!
    .postings.map((p) => [p.dt, p.kt, p.amount]);
const vat = (f: F, month: string) => step(f, month, 'vat');
const bal = (f: F, account: string, s2?: string) =>
  f.db.get(
    `SELECT COALESCE(SUM(debit-credit),0) AS b FROM registers WHERE company_id=? AND account=?${s2 ? ' AND s2=?' : ''}`,
    f.companyId,
    account,
    ...(s2 ? [s2] : []),
  )!.b as bigint;
const decl = (f: F, kind: string, period: string) =>
  f.query<DeclarationView>({ type: 'declaration', companyId: f.companyId, kind, period });
const fig = (d: DeclarationView, key: string) =>
  d.sections.flatMap((s) => s.rows).find((r) => r.key === key)?.values[0];
const rate = (f: F, date: string, usd: string) =>
  f.exec({
    type: 'rates.save',
    companyId: f.companyId,
    source: 'manual',
    date,
    rates: [{ currency: 'USD', rate: usd }],
  } as never);

let hash = 3000;
function dvx(f: F, docs: object[]) {
  f.exec({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: f.companyId,
    direction: 'purchase',
    report: 'invoices',
    source: 'file',
    fileName: `d${++hash}.xlsx`,
    fileHash: String(hash).padStart(64, '0'),
    documents: docs.map((d, i) => ({
      row: i + 2,
      number: '',
      date: '',
      taxId: '',
      name: 'K',
      sellerTaxId: '',
      buyerTaxId: '',
      sellerName: '',
      buyerName: '',
      kind: 'Əsas',
      status: 'Təsdiqləndi',
      refNumber: '',
      net: '0.00',
      vat: '0.00',
      total: '',
      base18: '',
      base0: '',
      baseExempt: '',
      baseNontaxable: '',
      excise: '',
      roadTax: '',
      note: '',
      ...d,
    })),
  } as never);
}

function setup(t: Parameters<typeof fixture>[0], today = '2027-03-01') {
  const f = fixture(t, ':memory:', today);
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Təsisçi', '', 'individual');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const bank = f.bankAccount(kapital, 'AZ12AIIB38060019441234567890', '223.01', 'AZN', 'K');
  const deposit = f.bankAccount(kapital, 'AZ77AIIB38060019449999999999', '224.04', 'AZN', 'D');
  const sup = f.partner('Təkər MMC', '1700000012');
  const con = f.contract(sup, 'P-1', 'purchase');
  const cus = f.partner('Alıcı MMC', '1700000001');
  const scon = f.contract(cus, 'S-1', 'sale');
  const svc = f.product('Xidmət', 'ədəd', 'service');
  const item = f.item('expenseItem', 'Bank xidmətləri');
  f.operation('2026-01-05', [
    f.line('223.01', [bank], '301', [founder, capital], '100000'),
    f.line('224.04', [deposit], '301', [founder, capital], '20000'),
  ]);
  const buy = (date: string, eq: string, price = '5000') =>
    f.invoice(
      'purchase',
      date,
      sup,
      con,
      [{ productId: svc, quantity: '1', price, expenseItemId: item }],
      eq ? { eqNumber: eq } : {},
    );
  const ok = (eq: string, date: string, net = '5000.00', v = '900.00') =>
    dvx(f, [{ number: eq, date, taxId: '1700000012', net, vat: v }]);
  const pay = (
    date: string,
    from: string,
    amount: string,
    dir: 'in' | 'out' = 'out',
    inv?: string,
  ) =>
    f.bank(dir, date, from, [
      f.bankLine('531.01', [sup, con, ...(inv ? [`invoice:${inv}`] : [])], amount),
    ]);
  return {
    f,
    kapital,
    founder,
    capital,
    bank,
    deposit,
    sup,
    con,
    cus,
    scon,
    svc,
    item,
    buy,
    ok,
    pay,
  };
}

// ---------------------------------------------------------------------------------------------
// Defects

test('audit: the card by levels shows nothing for an account without subkonto (341, 801, 222.01 …)', (t) => {
  const s = setup(t);
  const { f } = s;
  f.invoice('sale', '2026-01-10', s.cus, s.scon, [{ productId: s.svc, price: '1000' }]);
  close(f, '2026-01');
  const c = f.card('341', '2026-01-01', '2026-01-31');
  assert.equal(c.turnKt, '1000.00', 'the totals know the movement');
  assert.equal(c.lines.length, 1);
  assert.equal(
    c.tree.filter((n) => n.kind === 'move').length,
    1,
    'the closing entry must be listed in the default view of the card',
  );
});

test('audit: the card by levels opened on a full key (a trial balance row, a bank account) is empty', (t) => {
  const s = setup(t);
  const { f } = s;
  const c = f.card('223.01', '2026-01-01', '2026-01-31', [s.bank]);
  assert.equal(c.turnDt, '100000.00');
  assert.equal(c.lines.length, 1);
  assert.equal(c.tree.filter((n) => n.kind === 'move').length, 1);
});

test('audit: VAT refunded to the deposit and paid again from it goes to an advance, not to the invoice', (t) => {
  const s = setup(t);
  const { f } = s;
  const inv = s.buy('2026-01-05', 'MT1');
  s.ok('MT1', '2026-01-05');
  s.pay('2026-01-10', s.bank, '5000');
  s.pay('2026-01-10', s.deposit, '900');
  close(f, '2026-01');
  // February: 900 comes back to the deposit: 900 / 5 900 of the VAT is taken back.
  s.pay('2026-02-08', s.deposit, '900', 'in', inv.id);
  assert.deepEqual(vat(f, '2026-02'), [['521.01', '241', '-137.29']]);
  close(f, '2026-02');
  // March: the same 900 is paid again from the deposit, no invoice chosen.
  const again = s.pay('2026-03-05', s.deposit, '900');
  const lines = f.db.all(
    'SELECT p.dt_account AS a, p.dt_s3 AS d FROM postings p JOIN entries e ON e.id=p.entry_id WHERE e.source_id=?',
    again.id,
  );
  assert.deepEqual(
    lines.map((l) => [l.a, l.d]),
    [['531.01', `invoice:${inv.id}`]],
    'the invoice owes exactly this 900 again',
  );
  assert.deepEqual(vat(f, '2026-03'), [['521.01', '241', '137.29']]);
});

test('audit: an invoice typed with the number of a confirmed e-qaimə in the box is not linked, its VAT waits', (t) => {
  const s = setup(t);
  const { f } = s;
  // QERARLAR 2026-10-15 §13: a hand-typed invoice with the same e-qaimə number is linked to it.
  s.ok('MT9', '2026-01-05');
  s.buy('2026-01-05', 'MT9');
  s.pay('2026-01-10', s.bank, '5900');
  assert.equal(
    f.home().warnings.filter((w) => w.kind === 'eqWaiting').length,
    0,
    'the e-qaimə is booked: "uçota alınmayıb" is a false signal',
  );
  assert.deepEqual(vat(f, '2026-01'), [['521.01', '241', '900.00']]);
});

test('audit: a bank overdraft stays negative in line 22 instead of line 50 (QERARLAR 2026-10-29 mərhələ 10 §3)', (t) => {
  const s = setup(t);
  const { f } = s;
  f.bank('out', '2026-01-11', s.deposit, [f.bankLine('721', [s.item], '20100')]); // 224.04: −100
  const d = decl(f, 'balanceSheet', '2026');
  assert.equal(fig(d, 'b:50'), '100.00', 'the credit balance of a bank account is a liability');
  assert.equal(fig(d, 'b:22'), '100000.00');
});

test('audit: the ƏDV return lists a currency invoice’s VAT in currency beside the AZN offset', (t) => {
  const s = setup(t);
  const { f } = s;
  const p = f.partner('USD Təchizat MMC', '1700000099');
  const c = f.contract(p, 'F-1', 'purchase', 'USD');
  const usd = f.bankAccount(s.kapital, 'AZ12AIIB38060019441234567891', '223.02', 'USD', 'U');
  rate(f, '2026-01-10', '1.7000');
  rate(f, '2026-01-31', '1.7000');
  f.bank('in', '2026-01-10', usd, [f.bankLine('301', [s.founder, s.capital], '5000')]);
  f.invoice(
    'purchase',
    '2026-01-20',
    p,
    c,
    [{ productId: s.svc, price: '1000', expenseItemId: s.item }],
    { rate: '1.7000', eqNumber: 'U1' },
  );
  dvx(f, [
    { number: 'U1', date: '2026-01-20', taxId: '1700000099', net: '1700.00', vat: '306.00' },
  ]);
  f.bank('out', '2026-01-25', usd, [f.bankLine('531.02', [p, c], '1180')], { rate: '1.7000' });
  assert.deepEqual(vat(f, '2026-01'), [['521.01', '241', '306.00']]);
  close(f, '2026-01');
  const row = decl(f, 'vat', '2026-01').appendices[0]!.rows[0]!;
  assert.deepEqual(
    row.slice(5),
    ['306.00', '306.00'],
    '"Qaimənin ƏDV-si" is 306,00 AZN, not 180 USD',
  );
});

test('audit: 222.02 left open with two banks in opposite directions gives no signal', (t) => {
  const s = setup(t);
  const { f } = s;
  const a = f.contract(s.kapital, 'V-1', 'other');
  const other = f.partner('Paşa Bank ASC', '1700000044');
  const b = f.contract(other, 'V-2', 'other');
  f.bank('out', '2026-01-15', s.bank, [f.bankLine('222.02', [s.kapital, a], '100')]);
  f.bank('in', '2026-01-16', s.bank, [f.bankLine('222.02', [other, b], '100')]);
  assert.equal(
    f.home().warnings.filter((w) => w.kind === 'transit' && w.account === '222.02').length,
    1,
    'Dt 100 on one bank and Kt 100 on another are two open legs, not zero',
  );
});

// ---------------------------------------------------------------------------------------------
// Scenarios found right

test('ok: partial VAT shares across months add up to the invoice VAT, no kopeck drift', (t) => {
  const s = setup(t);
  const { f } = s;
  const inv = s.buy('2026-01-05', 'MT1', '10.01'); // 10,01 + 1,80 = 11,81
  s.ok('MT1', '2026-01-05', '10.01', '1.80');
  s.pay('2026-01-10', s.bank, '3.33'); // 1,80 × 3,33 / 11,81 = 0,5075 → 0,51
  assert.deepEqual(vat(f, '2026-01'), [['521.01', '241', '0.51']]);
  close(f, '2026-01');
  s.pay('2026-02-10', s.bank, '3.33'); // cumulative 1,0150 → 1,02
  assert.deepEqual(vat(f, '2026-02'), [['521.01', '241', '0.51']]);
  close(f, '2026-02');
  s.pay('2026-03-10', s.bank, '5.15'); // the rest
  assert.deepEqual(vat(f, '2026-03'), [['521.01', '241', '0.78']]);
  close(f, '2026-03');
  assert.equal(bal(f, '241', `invoice:${inv.id}`), 0n);
});

test('ok: one payment over invoices, overpayment to an advance, a later invoice, its cancel, re-close', (t) => {
  const s = setup(t);
  const { f } = s;
  const box = f.cashbox();
  const c = f.cash('in', '2026-01-02', box, [f.bankLine('301', [s.founder, s.capital], '100')]);
  f.cash('out', '2026-01-03', box, [f.bankLine('721', [s.item], '100')]);
  assert.throws(() =>
    f.exec({
      type: 'cash.cancel',
      companyId: f.companyId,
      id: c.id,
      version: c.version!,
      reason: 'x',
    }),
  );
  s.buy('2026-01-05', 'A1', '100');
  s.buy('2026-01-06', 'A2', '200');
  s.ok('A1', '2026-01-05', '100.00', '18.00');
  s.ok('A2', '2026-01-06', '200.00', '36.00');
  const adv = s.pay('2026-01-10', s.bank, '400'); // 118 + 236 + advance 46
  assert.equal(bal(f, '243.01'), 4600n);
  assert.equal(bal(f, '531.01'), 0n);
  const i3 = s.buy('2026-01-20', 'A3', '100');
  s.ok('A3', '2026-01-20', '100.00', '18.00');
  // 46 / 118 × 18 = 7,02.
  assert.ok(vat(f, '2026-01').some((p) => p[2] === '7.02'));
  assert.throws(
    () =>
      f.bank('out', '2026-01-10', s.bank, [f.bankLine('531.01', [s.sup, s.con], '360')], {
        id: adv.id,
        version: adv.version!,
      }),
    /əvəzləşdirilib/,
  );
  const version = Number(f.db.get('SELECT version FROM invoices WHERE id=?', i3.id)!.version);
  f.exec({ type: 'invoice.cancel', companyId: f.companyId, id: i3.id, version, reason: 'x' });
  assert.equal(bal(f, '243.01'), 4600n, 'the advance is back');
  close(f, '2026-01');
  assert.equal(bal(f, '241'), 0n);
  const closed = view(f, '2026-01').posted!;
  f.exec({
    type: 'closing.cancel',
    companyId: f.companyId,
    id: closed.id,
    version: closed.version,
    reason: 'r',
  });
  assert.equal(bal(f, '721'), 40000n);
  close(f, '2026-01');
  assert.deepEqual(
    [bal(f, '721'), bal(f, '801'), bal(f, '341'), bal(f, '241')],
    [0n, 0n, 40000n, 0n],
  );
});

test('ok: a USD purchase — paid part, month-end revaluation, an advance at its own rate', (t) => {
  const s = setup(t);
  const { f } = s;
  const usd = f.bankAccount(s.kapital, 'AZ12AIIB38060019441234567891', '223.02', 'USD', 'U');
  const p = f.partner('ACME Ltd', '', 'foreign');
  const c = f.contract(p, 'F-1', 'purchase', 'USD');
  rate(f, '2026-01-10', '1.7000');
  rate(f, '2026-01-31', '1.7100');
  rate(f, '2026-02-15', '1.7200');
  rate(f, '2026-02-28', '1.7300');
  rate(f, '2026-03-31', '1.7300');
  f.bank('in', '2026-01-10', usd, [f.bankLine('301', [s.founder, s.capital], '5000')]);
  f.invoice(
    'purchase',
    '2026-01-20',
    p,
    c,
    [{ productId: s.svc, price: '1000', expenseItemId: s.item }],
    {
      rate: '1.7000',
    },
  );
  // 5 000 × 0,01 = 50,00; 1 180 × 0,01 = 11,80.
  assert.deepEqual(step(f, '2026-01', 'revaluation'), [
    ['223.02', '611', '50.00'],
    ['731', '531.02', '11.80'],
  ]);
  close(f, '2026-01');
  f.bank('out', '2026-02-15', usd, [f.bankLine('531.02', [p, c], '590')]);
  // 4 410 × 1,73 = 7 629,30 − (8 550 − 1 014,80) = 94,10; 590 × 1,73 = 1 020,70 − 1 003,00 = 17,70.
  assert.deepEqual(step(f, '2026-02', 'revaluation'), [
    ['223.02', '611', '94.10'],
    ['731', '531.02', '17.70'],
  ]);
  close(f, '2026-02');
  // 590 pays the rest, 110 is an advance at 1,73; the invoice at 1,74 takes 100 of it at 1,73.
  f.bank('out', '2026-03-05', usd, [f.bankLine('531.02', [p, c], '700')], { rate: '1.7300' });
  f.invoice(
    'purchase',
    '2026-03-10',
    p,
    c,
    [{ productId: s.svc, price: '100', expenseItemId: s.item, vatRate: 'exempt' }],
    { rate: '1.7400' },
  );
  close(f, '2026-03');
  assert.equal(bal(f, '243.02'), 1730n);
  assert.equal(bal(f, '531.02'), 0n);
});

test('ok: payroll brackets, VAT of an asset sale, profit tax loss, statements tie after a year', (t) => {
  const s = setup(t);
  const { f } = s;
  const pay = (m: string) =>
    f.exec({
      type: 'payroll.save',
      companyId: f.companyId,
      month: m,
      lines: f.query<object[]>({ type: 'payrollFill', companyId: f.companyId, month: m }),
    } as never);
  const expense = [f.item('expenseItem', 'Əmək haqqı')];
  for (const [name, salary] of [
    ['A', '3333.33'],
    ['B', '199.99'],
  ] as const)
    f.exec({
      type: 'employee.save',
      companyId: f.companyId,
      name,
      archived: false,
      hired: '2026-01-01',
      salary,
      expenseAccount: '721',
      expenseSk: expense,
    } as never);
  pay('2026-01');
  assert.deepEqual(
    f.db
      .all(
        'SELECT income_tax a, dsmf_employee b, dsmf_employer c, unemployment_employee d, medical_employee e, net n FROM payroll_lines ORDER BY gross DESC',
      )
      .map((r) => [r.a, r.b, r.c, r.d, r.e, r.n]),
    [
      // 75 + 83,33; 6 + 313,33; 44 + 470; 16,67; 50 + 4,17.
      [15833n, 31933n, 51400n, 1667n, 5417n, 278483n],
      // Up to 2 500 the first 200 are free; 3% of 199,99; 22%; 0,5%; 2%.
      [0n, 600n, 4400n, 100n, 400n, 18899n],
    ],
  );
  const truck = f.product('Maşın', 'ədəd', 'asset');
  f.invoice('purchase', '2026-01-20', s.sup, s.con, [
    { productId: truck, price: '60000', vatRate: 'exempt' },
  ]);
  const a = f.exec({
    type: 'fixedAsset.save',
    companyId: f.companyId,
    name: 'Maşın',
    group: 'transport',
    archived: false,
  } as never).id!;
  f.exec({
    type: 'asset.save',
    companyId: f.companyId,
    kind: 'commission',
    date: '2026-01-25',
    lines: [
      {
        assetId: a,
        productId: truck,
        quantity: '1',
        lifeMonths: 60,
        expenseAccount: '721',
        expenseSk: [f.item('expenseItem', 'Amortizasiya')],
      },
    ],
  } as never);
  pay('2026-02');
  close(f, '2026-01');
  close(f, '2026-02');
  assert.deepEqual([bal(f, '111'), bal(f, '112')], [6000000n, -100000n]);
  f.invoice('sale', '2026-03-10', s.cus, s.scon, [
    { productId: truck, price: '50000', assetId: a },
  ]);
  const v = decl(f, 'vat', '2026-03');
  assert.deepEqual([fig(v, 's:18'), fig(v, 'v:accrued')], ['50000.00', '9000.00']);
  for (let m = 3; m <= 12; m++) {
    const month = `2026-${String(m).padStart(2, '0')}`;
    pay(month);
    close(f, month);
  }
  assert.deepEqual([bal(f, '341'), bal(f, '801'), bal(f, '901'), bal(f, '111')], [0n, 0n, 0n, 0n]);
  const tax = decl(f, 'profitTax', '2026');
  assert.equal(fig(tax, 't:taxable'), '60005.92'); // 50 000 − 50 005,92 − 60 000
  assert.equal(fig(tax, 't:tax'), '0.00');
  assert.equal(bal(f, '343'), 6000592n);
  const sheet = decl(f, 'balanceSheet', '2026');
  assert.equal(fig(sheet, 'b:assets'), fig(sheet, 'b:total'));
  assert.equal(fig(decl(f, 'cashFlowStatement', '2026'), 'f:closing'), fig(sheet, 'b:22'));
});

test('ok: profit tax over three years — tax, last year’s tax paid, a loss used', (t) => {
  const s = setup(t, '2029-02-01');
  const { f } = s;
  const sell = (date: string, price: string) =>
    f.invoice('sale', date, s.cus, s.scon, [{ productId: s.svc, price, vatRate: 'exempt' }]);
  sell('2026-01-10', '1000');
  closeYear(f, 2026);
  assert.equal(bal(f, '521.04'), -20000n);
  assert.equal(bal(f, '343'), -80000n);
  // February 2027: last year's tax is paid; the year itself loses 3 000.
  const kind = f.item('paymentKind', 'Vergi (haqq)');
  f.bank('out', '2027-02-10', s.bank, [f.bankLine('521.04', [kind], '200')]);
  f.bank('out', '2027-02-11', s.bank, [f.bankLine('721', [s.item], '3000')]);
  closeYear(f, 2027);
  const y2 = decl(f, 'profitTax', '2027');
  assert.deepEqual([fig(y2, 't:tax'), fig(y2, 't:paid')], ['0.00', '0.00']);
  sell('2028-03-10', '5000');
  closeYear(f, 2028);
  const y3 = decl(f, 'profitTax', '2028');
  assert.deepEqual(
    [fig(y3, 't:losses'), fig(y3, 't:base'), fig(y3, 't:tax')],
    ['3000.00 / 3000.00', '2000.00', '400.00'],
  );
  assert.equal(bal(f, '521.04'), -40000n);
});
