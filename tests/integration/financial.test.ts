/**
 * Stage 10 — the annual financial statements (docs/MERHELE-10-MALIYYE-HESABATLARI.md §7, §8;
 * QERARLAR 2026-10-29 mərhələ 10).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ordinal } from '../../src/application/financial.js';
import type { DeclarationView, ProfitLossView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';
import { declaration, figures } from './declarations.test.js';

type F = ReturnType<typeof fixture>;
const close = (f: F, month: string) =>
  f.exec({ type: 'closing.post', companyId: f.companyId, month, acknowledged: true } as never);
const closeThrough = (f: F, last: number, year = 2026) => {
  for (let m = 1; m <= last; m++) close(f, `${year}-${String(m).padStart(2, '0')}`);
};
/** The two columns of a row: this year's end and the year before. */
const at = (f: F, key: string, year = '2026') => figures(declaration(f, 'balanceSheet', year), key);

/**
 * The §8 example: capital 10 000, a bank loan 20 000, a truck of 50 000 (60 months, 701) paid
 * 30 000, a service sold for 120 000 and paid 100 000, a service bought for 40 000 and paid
 * 35 000, interest 1 000 — all of 2026, the company's first year in Meyar.
 */
export function example(f: F) {
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Təsisçi', '', 'individual');
  const dealer = f.partner('Avto MMC', '1700000011');
  const office = f.partner('Ofis Xidmət MMC', '1700000012');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const loan = f.contract(kapital, 'K-1', 'loan');
  const cd = f.contract(dealer, 'A-1', 'purchase');
  const co = f.contract(office, 'O-1', 'purchase');
  const cs = f.contract(customer, 'S-1', 'sale');
  const bank = f.bankAccount(kapital, 'AZ12AIIB38060019441234567890');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const B = f.bankLine;
  f.bank('in', '2026-01-15', bank, [B('301', [founder, capital], '10000')]);
  f.bank('in', '2026-02-01', bank, [B('501', [kapital, loan], '20000')]);
  const truck = f.product('Mercedes Actros', 'ədəd', 'asset');
  f.invoice('purchase', '2026-02-20', dealer, cd, [
    { productId: truck, quantity: '1', price: '50000', vatRate: 'exempt' },
  ]);
  const actros = f.exec({
    type: 'fixedAsset.save',
    companyId: f.companyId,
    name: 'Mercedes Actros',
    group: 'transport',
    archived: false,
  } as never).id!;
  f.exec({
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
  } as never);
  f.bank('out', '2026-02-25', bank, [B('531.01', [dealer, cd], '30000')]);
  const service = f.product('Daşıma xidməti', 'reys', 'service');
  f.invoice('sale', '2026-06-30', customer, cs, [
    { productId: service, quantity: '1', price: '120000', vatRate: '0' },
  ]);
  f.bank('in', '2026-07-15', bank, [B('211.01', [customer, cs], '100000')]);
  const admin = f.product('Ofis xidməti', 'ay', 'service');
  f.invoice('purchase', '2026-07-31', office, co, [
    {
      productId: admin,
      quantity: '1',
      price: '40000',
      vatRate: 'exempt',
      expenseItemId: f.item('expenseItem', 'Bank xidmətləri'),
    },
  ]);
  f.bank('out', '2026-08-10', bank, [B('531.01', [office, co], '35000')]);
  f.bank('out', '2026-09-30', bank, [B('751', [kapital, loan], '1000')]);
  return { kapital, founder, dealer, office, customer, loan, cd, co, cs, bank, capital };
}

test('F1: the §8 example — the balance sheet to the penny after the December closing', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  example(f);
  closeThrough(f, 12);
  const v = declaration(f, 'balanceSheet', '2026');
  const k = (key: string) => figures(v, key)[0];
  assert.deepEqual(['b:11', 'b:21', 'b:22', 'b:t1', 'b:t2', 'b:assets'].map(k), [
    '42500.03',
    '20000.00',
    '64000.00',
    '42500.03',
    '84000.00',
    '126500.03',
  ]);
  assert.deepEqual(
    ['b:30', 'b:34', 'b:t3', 'b:50', 'b:52', 'b:53', 'b:liabilities', 'b:total'].map(k),
    [
      '10000.00',
      '58200.03',
      '68200.03',
      '20000.00',
      '13300.00',
      '25000.00',
      '58300.00',
      '126500.03',
    ],
  );
  // Every line of the form is there, an empty one with 0; the year before is all zero.
  assert.equal(k('b:12'), '0.00');
  assert.equal(figures(v, 'b:assets')[1], '0.00');
  assert.equal(v.sections[0]!.columns[0], 'Hesabat dövrü (31.12.2026)');
  // The sources: the accounts behind a line, the card of the one account.
  const line = (key: string) => v.sections.flatMap((s) => s.rows).find((r) => r.key === key)!;
  assert.equal(line('b:11').source, '111, 112');
  assert.equal(line('b:22').account, '223');
  assert.equal(line('b:11').account, '');
  assert.match(
    v.title,
    /Agalarov Kapital MMC · VÖEN 1234567890 · Maliyyə vəziyyəti haqqında hesabat · 31 dekabr 2026/,
  );
  // Checks: all zero after the closing, nothing to warn about but the empty year before.
  assert.deepEqual(
    ['c:balance', 'c:unclosed', 'c:341', 'c:801', 'c:901', 'c:67', 'c:closed'].map(k),
    ['0.00', '0.00', '0.00', '0.00', '0.00', '0.00', 'bəli'],
  );
  assert.deepEqual(
    v.checks.map((c) => c.kind),
    ['info'],
  );
  assert.match(v.checks[0]!.text, /2025-ci il üçün uçot yoxdur/);
});

test('F1: before the December closing the result stands unclosed in 34 and the sheet still balances', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  example(f);
  // Nothing closed: no depreciation, the 6xx / 7xx balance (79 000) is line 34.
  let v = declaration(f, 'balanceSheet', '2026');
  let k = (key: string) => figures(v, key)[0];
  assert.deepEqual(
    ['b:11', 'b:34', 'b:52', 'b:assets', 'b:total', 'c:unclosed', 'c:closed'].map(k),
    ['50000.00', '79000.00', '0.00', '134000.00', '134000.00', '79000.00', 'xeyr'],
  );
  assert.ok(
    v.checks.some(
      (c) =>
        c.kind === 'warning' &&
        /dekabrı bağlanmayıb: nəticə \(79\s000,00\)|dekabrı bağlanmayıb: nəticə \(79000\.00\)/.test(
          c.text,
        ),
    ),
  );
  // January–November closed: 341 holds their result, December's depreciation is not posted yet.
  closeThrough(f, 11);
  v = declaration(f, 'balanceSheet', '2026');
  k = (key: string) => figures(v, key)[0];
  assert.deepEqual(['b:11', 'b:34', 'b:52', 'b:assets', 'b:total', 'c:unclosed', 'c:341'].map(k), [
    '43333.36',
    '72333.36',
    '0.00',
    '127333.36',
    '127333.36',
    '0.00',
    '72333.36',
  ]);
  assert.ok(v.checks.some((c) => /dekabrı bağlanmayıb/.test(c.text)));
});

test('F2: active-passive balances open by partner — a supplier overpaid to 24, a customer’s overpayment to 54', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  const { bank, office, co } = example(f);
  const other = f.partner('Başqa Alıcı MMC', '1700000002');
  const co2 = f.contract(other, 'S-2', 'sale');
  const L = f.line;
  const vatTax = f.catalog().items.find((i) => i.role === 'vatTax')!.id;
  // Booked by hand, so nothing moves to 243 / 543 on its own: the office is paid 6 000 though
  // 5 000 is owed (1 000 debit on 531), a second customer pays 700 with nothing invoiced (credit
  // on 211), 300 of VAT is paid before it is due (debit on 521.01).
  f.operation('2026-10-05', [L('531.01', [office, co, ''], '223.01', [bank], '6000')]);
  f.operation('2026-10-06', [L('223.01', [bank], '211.01', [other, co2, ''], '700')]);
  f.operation('2026-10-07', [L('521.01', [vatTax], '223.01', [bank], '300')]);
  const v = declaration(f, 'balanceSheet', '2026');
  const k = (key: string) => figures(v, key)[0];
  // 531: the dealer is still owed 20 000 (53); the office's 1 000 and the VAT's 300 are assets.
  assert.equal(k('b:53'), '20000.00');
  assert.equal(k('b:24'), '1300.00');
  assert.equal(k('b:52'), '0.00');
  // 211: the first customer owes 20 000 (21), the second's 700 is a liability.
  assert.equal(k('b:21'), '20000.00');
  assert.equal(k('b:54'), '700.00');
  assert.equal(k('b:22'), '58400.00');
  assert.equal(k('c:balance'), '0.00');
  assert.equal(k('b:assets'), '129700.00');
  const line = (key: string) => v.sections.flatMap((s) => s.rows).find((r) => r.key === key)!;
  assert.equal(line('b:24').source, '521 (Dt qalığı), 531 (Dt qalığı)');
  assert.equal(line('b:54').source, '211 (Kt qalığı)');
});

test('F3: the year before is the opening of this year; its closing is checked too', (t) => {
  const f = fixture(t, ':memory:', '2028-01-15');
  example(f);
  closeThrough(f, 12);
  const v2026 = declaration(f, 'balanceSheet', '2026');
  const v2027 = declaration(f, 'balanceSheet', '2027');
  // 2027 has nothing booked: both columns equal 2026's end.
  for (const key of ['b:11', 'b:22', 'b:34', 'b:52', 'b:total'])
    assert.deepEqual(figures(v2027, key), [figures(v2026, key)[0], figures(v2026, key)[0]]);
  assert.ok(!v2027.checks.some((c) => /uçot yoxdur/.test(c.text)));
  // A 2027 year not closed but with turnover: its warning, not the year before's.
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  const bankId = f.catalog().bankAccounts[0]!.id;
  f.bank('out', '2027-03-03', bankId, [f.bankLine('721', [fees], '50')]);
  const v = declaration(f, 'balanceSheet', '2027');
  const k = (key: string) => figures(v, key);
  assert.deepEqual(k('c:unclosed'), ['-50.00', '0.00']);
  assert.deepEqual(k('c:closed'), ['xeyr', 'bəli']);
  assert.deepEqual(k('b:34'), ['58150.03', '58200.03']);
  assert.ok(v.checks.some((c) => /2027-ci ilin dekabrı bağlanmayıb/.test(c.text)));
  assert.ok(!v.checks.some((c) => /2026-ci ilin dekabrı/.test(c.text)));
  assert.throws(() => declaration(f, 'balanceSheet', '27'), /İl düzgün deyil/);
});

test('the year’s suffix follows the last spoken numeral', () => {
  assert.deepEqual(
    ['2025', '2026', '2023', '2029', '2030', '2040', '2020', '2000', '2100'].map(ordinal),
    [
      '2025-ci',
      '2026-cı',
      '2023-cü',
      '2029-cu',
      '2030-cu',
      '2040-cı',
      '2020-ci',
      '2000-ci',
      '2100-cü',
    ],
  );
});

const rowOf = (v: DeclarationView, key: string) =>
  v.sections.flatMap((s) => s.rows).find((r) => r.key === key)!;

test('F4: the income statement (IFRS form, by function) — the §8 example, the same as the M/Z', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  example(f);
  closeThrough(f, 12);
  const v = declaration(f, 'incomeStatement', '2026');
  const k = (key: string) => figures(v, key)[0];
  assert.deepEqual(
    ['i:60', 'i:70', 'i:gross', 'i:61', 'i:71', 'i:72', 'i:73', 'i:62', 'i:operating'].map(k),
    ['120000.00', '-7499.97', '112500.03', '0.00', '0.00', '-40000.00', '0.00', '0.00', '72500.03'],
  );
  assert.deepEqual(
    ['i:63', 'i:75', 'i:64', 'i:81', 'i:before', 'i:90', 'i:net', 'i:oci', 'i:total'].map(k),
    [
      '-1000.00',
      '-1000.00',
      '0.00',
      '0.00',
      '71500.03',
      '-13300.00',
      '58200.03',
      '0.00',
      '58200.03',
    ],
  );
  assert.equal(figures(v, 'i:net')[1], '0.00');
  assert.equal(rowOf(v, 'i:60').source, '601');
  assert.equal(rowOf(v, 'i:60').account, '601');
  assert.deepEqual(v.checks, []);
  // The M/Z of stage 5d gives the same result before tax and the same net profit.
  const pl = f.query<ProfitLossView>({ type: 'profitLoss', companyId: f.companyId, year: '2026' });
  const sum = (key: string) => pl.rows.find((r) => r.key === key)!.sum;
  assert.deepEqual([sum('t:result'), sum('t:net')], [k('i:before'), k('i:net')]);
  // December open: no tax yet, a warning says so.
  const g = fixture(t, ':memory:', '2027-01-15');
  example(g);
  const open = declaration(g, 'incomeStatement', '2026');
  assert.deepEqual(
    ['i:before', 'i:90', 'i:net'].map((key) => figures(open, key)[0]),
    ['79000.00', '0.00', '79000.00'],
  );
  assert.match(open.checks[0]!.text, /2026-cı ilin dekabrı bağlanmayıb: mənfəət vergisi/);
});

test('F5: changes in equity — capital paid in, the profit, dividends, a transfer, an unclassified change', (t) => {
  const f = fixture(t, ':memory:', '2028-01-15');
  const { founder, capital, bank } = example(f);
  closeThrough(f, 12);
  let v = declaration(f, 'equityStatement', '2026');
  const k = (x: DeclarationView, key: string) => figures(x, key);
  assert.deepEqual(k(v, 'e:2026:open'), ['0.00', '0.00', '0.00', '0.00', '0.00', '0.00']);
  assert.deepEqual(k(v, 'e:2026:profit'), ['0.00', '0.00', '0.00', '0.00', '58200.03', '58200.03']);
  assert.deepEqual(k(v, 'e:2026:contrib'), [
    '10000.00',
    '0.00',
    '0.00',
    '0.00',
    '0.00',
    '10000.00',
  ]);
  assert.deepEqual(k(v, 'e:2026:close'), [
    '10000.00',
    '0.00',
    '0.00',
    '0.00',
    '58200.03',
    '68200.03',
  ]);
  assert.deepEqual(k(v, 'e:2026:change'), k(v, 'e:2026:close'));
  assert.equal(v.sections[0]!.title, 'Əvvəlki hesabat dövrü (2025)');
  assert.ok(!v.sections[1]!.rows.some((r) => r.key === 'e:2026:other'));
  assert.deepEqual(v.checks, []);
  // 2027: a dividend declared and paid, part of the profit turned into capital, a past error
  // corrected through 343 (unclassified — the accountant moves it), an expense of 200.
  const L = f.line;
  const B = f.bankLine;
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  f.operation('2027-03-01', [L('343', [], '534.01', [], '5000')]);
  f.bank('out', '2027-03-10', bank, [B('534.01', [], '5000')]);
  f.operation('2027-04-01', [L('343', [], '301', [founder, capital], '20000')]);
  f.operation('2027-05-01', [L('343', [], '223.01', [bank], '300')]);
  f.bank('out', '2027-05-02', bank, [B('721', [fees], '200')]);
  v = declaration(f, 'equityStatement', '2027');
  assert.deepEqual(k(v, 'e:2027:open'), k(v, 'e:2026:close'));
  assert.deepEqual(k(v, 'e:2027:profit'), ['0.00', '0.00', '0.00', '0.00', '-200.00', '-200.00']);
  assert.deepEqual(k(v, 'e:2027:dividends'), [
    '0.00',
    '0.00',
    '0.00',
    '0.00',
    '-5000.00',
    '-5000.00',
  ]);
  assert.deepEqual(k(v, 'e:2027:transfers'), [
    '20000.00',
    '0.00',
    '0.00',
    '0.00',
    '-20000.00',
    '0.00',
  ]);
  assert.deepEqual(k(v, 'e:2027:other'), ['0.00', '0.00', '0.00', '0.00', '-300.00', '-300.00']);
  assert.deepEqual(k(v, 'e:2027:close'), [
    '30000.00',
    '0.00',
    '0.00',
    '0.00',
    '32700.03',
    '62700.03',
  ]);
  assert.equal(rowOf(v, 'e:2027:other').source, '343 ↔ 223');
  // The closing equals the balance sheet's equity; the checks name the unclassified change only.
  const sheet = declaration(f, 'balanceSheet', '2027');
  assert.equal(figures(sheet, 'b:t3')[0], '62700.03');
  assert.equal(v.checks.length, 1);
  assert.match(
    v.checks[0]!.text,
    /2027-ci il: kapitalda təsnif olunmamış dəyişiklik var \(343 ↔ 223\)/,
  );
  const income = declaration(f, 'incomeStatement', '2027');
  assert.deepEqual(figures(income, 'i:net'), ['-200.00', '58200.03']);
});
