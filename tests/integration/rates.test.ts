import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  BankDocumentDetail,
  CashDocumentDetail,
  RateView,
  RevaluationView,
} from '../../src/contracts/queries.js';
import { ambUrl, monthEnd, parseAmbXml } from '../../src/domain/rates.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;

/** The shape of a cbar.az daily file (made-up values). */
const AMB = `<?xml version="1.0" encoding="UTF-8"?>
<ValCurs Date="30.09.2026" Name="AZN məzənnələri" Description="Azərbaycan Respublikası Mərkəzi Bankı">
  <ValType Type="Bank metalları">
    <Valute Code="XAU"><Nominal>1 t.u.</Nominal><Name>Qızıl</Name><Value>5600.1234</Value></Valute>
  </ValType>
  <ValType Type="Xarici valyutalar">
    <Valute Code="USD"><Nominal>1</Nominal><Name>1 ABŞ dolları</Name><Value>1.71</Value></Valute>
    <Valute Code="EUR"><Nominal>1</Nominal><Name>1 Avro</Name><Value>1.98765</Value></Valute>
    <Valute Code="RUB"><Nominal>100</Nominal><Name>100 Rusiya rublu</Name><Value>2.1050</Value></Valute>
    <Valute Code="JPY"><Nominal>100</Nominal><Name>100 Yaponiya yeni</Name><Value>1.1500</Value></Valute>
  </ValType>
</ValCurs>`;

test('V1: the AMB file is read — per one unit, 4 decimals, only the currencies Meyar keeps', () => {
  const file = parseAmbXml(AMB);
  assert.equal(file.date, '2026-09-30');
  assert.deepEqual(
    file.rates.map((r) => [r.currency, r.rate]),
    [
      ['USD', 17100n],
      ['EUR', 19877n],
      ['RUB', 211n],
    ],
  );
  assert.equal(ambUrl('2026-09-30'), 'https://www.cbar.az/currencies/30.09.2026.xml');
  assert.equal(monthEnd('2026-02'), '2026-02-28');
  assert.equal(monthEnd('2028-02'), '2028-02-29');
  assert.throws(() => parseAmbXml('<html>tapılmadı</html>'), /AMB-nin məzənnə faylı deyil/);
});

const rates = (f: F, date: string, list: [string, string][], source: 'amb' | 'manual' = 'amb') =>
  f.exec({
    type: 'rates.save',
    companyId: f.companyId,
    date,
    source,
    rates: list.map(([currency, rate]) => ({ currency, rate })),
  });
const revaluation = (f: F, month: string) =>
  f.query<RevaluationView>({ type: 'revaluation', companyId: f.companyId, month });
const post = (f: F, month: string) =>
  f.exec({ type: 'revaluation.post', companyId: f.companyId, month });

test('V1: rates catalog — one per date and currency, the rate in force, documents fill it in', (t) => {
  const f = fixture(t);
  const first = rates(f, '2026-09-01', [
    ['USD', '1.7'],
    ['EUR', '1.9'],
  ]);
  assert.deepEqual([first.added, first.updated, first.same], [2, 0, 0]);
  const again = rates(f, '2026-09-01', [
    ['USD', '1.7000'],
    ['EUR', '1.9100'],
  ]);
  assert.deepEqual([again.added, again.updated, again.same], [0, 1, 1]);
  assert.throws(() => rates(f, '2026-09-02', [['XYZ', '1']]), /Valyuta tanınmır/);
  const on = (date: string) =>
    f.query<RateView | null>({ type: 'rate', companyId: f.companyId, currency: 'USD', date });
  assert.equal(on('2026-09-05')!.date, '2026-09-01');
  assert.equal(on('2026-09-05')!.rate, '1.7');
  assert.equal(on('2026-08-31'), null);
  const list = f.query<RateView[]>({
    type: 'rates',
    companyId: f.companyId,
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.equal(list.length, 2);
  // A document in dollars left without a rate takes the catalog's (the latest within a week).
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const usd = f.bankAccount(bank, 'AZ12AIIB38060019449999999901', '223.02', 'USD', 'USD');
  const founder = f.partner('Təsisçi', '', 'individual');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const doc = f.bank('in', '2026-09-04', usd, [f.bankLine('301', [founder, capital], '100')]);
  const d = f.query<BankDocumentDetail>({
    type: 'bankDocument',
    companyId: f.companyId,
    id: doc.id,
  });
  assert.deepEqual([d.rate, d.amountAzn], ['1.7', '170.00']);
  assert.throws(
    () => f.bank('in', '2026-09-20', usd, [f.bankLine('301', [founder, capital], '1')]),
    /20\.09\.2026 üçün USD məzənnəsi yoxdur/,
  );
  // Audit: every company sees the change of a shared rate.
  assert.ok(
    f.db.get(
      "SELECT 1 AS x FROM audit WHERE company_id=? AND entity='Valyuta məzənnəsi'",
      f.companyId,
    ),
  );
});

/** Dollar balances on 223.02, 211.02, 531.02, 243.02, 543.02 at 1.70, revalued at 1.71. */
function dollars(f: F) {
  rates(f, '2026-09-01', [['USD', '1.7']]);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const usd = f.bankAccount(bank, 'AZ12AIIB38060019449999999901', '223.02', 'USD', 'USD');
  const founder = f.partner('Təsisçi', '', 'individual');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const customer = f.partner('Foreign Buyer Ltd', '', 'foreign');
  const buyer2 = f.partner('Second Buyer Ltd', '', 'foreign');
  const supplier = f.partner('Foreign Supplier Ltd', '', 'foreign');
  const supplier2 = f.partner('Second Supplier Ltd', '', 'foreign');
  const cs = f.contract(customer, 'S-1', 'sale', 'USD');
  const cs2 = f.contract(buyer2, 'S-2', 'sale', 'USD');
  const cp = f.contract(supplier, 'P-1', 'purchase', 'USD');
  const cp2 = f.contract(supplier2, 'P-2', 'purchase', 'USD');
  const service = f.product('Konsaltinq', 'saat', 'service');
  const goods = f.product('Kağız A4', 'qutu');
  const B = f.bankLine;
  f.bank('in', '2026-09-01', usd, [B('301', [founder, capital], '1000')]);
  f.invoice('sale', '2026-09-02', customer, cs, [
    { productId: service, quantity: '5', price: '100', vatRate: '0' },
  ]);
  f.invoice('purchase', '2026-09-03', supplier, cp, [
    { productId: goods, quantity: '2', price: '100', vatRate: '0' },
  ]);
  f.bank('out', '2026-09-04', usd, [B('531.02', [supplier2, cp2], '100')]);
  f.bank('in', '2026-09-05', usd, [B('211.02', [buyer2, cs2], '300')]);
  return { usd, customer, supplier, cs, cp };
}

test('V2: revaluation — gain and loss on active and passive accounts, to the qəpik', (t) => {
  const f = fixture(t);
  const s = dollars(f);
  // No rate for the month's end yet: nothing is posted.
  const before = revaluation(f, '2026-09');
  assert.deepEqual(before.missingRates, ['USD']);
  assert.throws(() => post(f, '2026-09'), /30\.09\.2026 üçün AMB məzənnəsi yoxdur: USD/);
  rates(f, '2026-09-30', [['USD', '1.71']]);
  const view = revaluation(f, '2026-09');
  assert.deepEqual(
    view.proposal.map((l) => [l.account, l.curBalance, l.booked, l.value, l.difference]),
    [
      ['211.02', '500.00', '850.00', '855.00', '5.00'],
      ['223.02', '1200.00', '2040.00', '2052.00', '12.00'],
      ['243.02', '100.00', '170.00', '171.00', '1.00'],
      ['531.02', '-200.00', '-340.00', '-342.00', '-2.00'],
      ['543.02', '-300.00', '-510.00', '-513.00', '-3.00'],
    ],
  );
  assert.deepEqual([view.income, view.expense], ['18.00', '5.00']);
  const r = post(f, '2026-09');
  assert.equal(r.number, 'YQ-2026-09');
  const tb = f.trial('2026-09-01', '2026-09-30');
  assert.equal(f.row(tb, 'a:611')!.closeKt, '18.00');
  assert.equal(f.row(tb, 'a:731')!.closeDt, '5.00');
  assert.equal(f.row(tb, 'a:223')!.closeDt, '2052.00');
  assert.equal(f.row(tb, 'a:531')!.closeKt, '342.00');
  assert.equal(tb.totals.closeDt, tb.totals.closeKt);
  // The currency amounts did not move.
  const fx = {
    ...f.db.get(
      `SELECT COUNT(*) AS n, SUM(abs(p.dt_cur)+abs(p.kt_cur)) AS c FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE e.source_type='revaluation'`,
    ),
  };
  assert.deepEqual([fx.n, fx.c], [5n, 0n]);

  const after = revaluation(f, '2026-09');
  assert.equal(after.posted!.stale, false);
  assert.equal(after.posted!.income, '18.00');
  // The rate it used is not changed under it; once cancelled it can be.
  assert.throws(() => rates(f, '2026-09-30', [['USD', '1.72']]), /istifadə olunub/);
  // A later document of the month makes it stale; posting again replaces it (storno + new).
  f.bank('in', '2026-09-30', s.usd, [f.bankLine('211.02', [s.customer, s.cs], '500')], {
    rate: '1.72',
  });
  assert.equal(revaluation(f, '2026-09').posted!.stale, true);
  const again = post(f, '2026-09');
  assert.equal(again.version, 2);
  assert.equal(revaluation(f, '2026-09').posted!.stale, false);
  // 211.02: no dollars left, 5.00 of manat (860 received for 855) closed to zero.
  const tb2 = f.trial('2026-09-01', '2026-09-30', ['a:211']);
  assert.equal(f.row(tb2, 'a:211.02')?.closeDt ?? '', '');
  assert.equal(f.row(tb2, 'a:211.02')?.closeKt ?? '', '');
  const v2 = revaluation(f, '2026-09');
  f.exec({
    type: 'revaluation.cancel',
    companyId: f.companyId,
    id: v2.posted!.id,
    version: v2.posted!.version,
    reason: 'yoxlama',
  });
  assert.equal(revaluation(f, '2026-09').posted, null);
  assert.equal(f.row(f.trial('2026-09-01', '2026-09-30'), 'a:611')?.closeKt ?? '', '');
  rates(f, '2026-09-30', [['USD', '1.72']]);
  // A closed month is not revalued.
  rates(f, '2026-09-30', [['USD', '1.71']]);
  post(f, '2026-09');
  f.exec({ type: 'period.close', companyId: f.companyId, through: '2026-09-30', reason: '' });
  assert.throws(() => post(f, '2026-09'), /bağlanıb/);
  assert.equal(revaluation(f, '2026-09').closed, true);
  assert.throws(() => post(f, '2026-13'), /Ay düzgün deyil/);
});

test('K4: currency cashbox — rate from the catalog, revalued with the bank', (t) => {
  const f = fixture(t);
  rates(f, '2026-10-01', [['EUR', '1.9']]);
  rates(f, '2026-10-30', [['EUR', '1.95']]);
  const box = f.exec({
    type: 'cashbox.save',
    companyId: f.companyId,
    name: 'Avro kassası',
    account: '221.04',
    currency: 'EUR',
    archived: false,
  }).id;
  const founder = f.partner('Təsisçi', '', 'individual');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const order = f.cash('in', '2026-10-02', box, [f.bankLine('301', [founder, capital], '200')]);
  const d = f.query<CashDocumentDetail>({
    type: 'cashDocument',
    companyId: f.companyId,
    id: order.id,
  });
  assert.deepEqual([d.rate, d.amountAzn], ['1.9', '380.00']);
  // 31.10 is a Saturday in this example: the rate of the 30th is the one in force.
  const view = revaluation(f, '2026-10');
  assert.deepEqual(
    view.proposal.map((l) => [l.account, l.skNames[0], l.rateDate, l.value, l.difference]),
    [['221.04', 'Avro kassası', '2026-10-30', '390.00', '10.00']],
  );
  post(f, '2026-10');
  const book = f.query<{ closing: string; closingCur: string }>({
    type: 'cashBook',
    companyId: f.companyId,
    cashboxId: box,
    from: '2026-10-01',
    to: '2026-10-31',
  });
  assert.deepEqual([book.closing, book.closingCur], ['390.00', '200.00']);
});
