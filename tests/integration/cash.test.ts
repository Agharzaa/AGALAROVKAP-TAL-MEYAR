import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CashBookView,
  CashDocumentDetail,
  CashDocumentSummary,
} from '../../src/contracts/queries.js';
import { amountInWords } from '../../src/domain/words.js';
import { fixture, type Cmd } from './fixture.js';

type F = ReturnType<typeof fixture>;
type CashCmd = Extract<Cmd, { type: 'cash.save' }>;

const detail = (f: F, id: string) =>
  f.query<CashDocumentDetail>({ type: 'cashDocument', companyId: f.companyId, id });
const postings = (f: F, id: string) =>
  detail(f, id).postings.map((p) => [
    p.dt.account,
    p.kt.account,
    p.amount,
    ...(p.dt.curAmount || p.kt.curAmount ? [`${p.dt.curAmount}|${p.kt.curAmount}`] : []),
  ]);
/** Settlement document of each posting's counter side ("invoice:…", "cash:…"). */
const documents = (f: F, id: string) =>
  detail(f, id).postings.map((p) => (p.dt.account.startsWith('221') ? p.kt.sk[2] : p.dt.sk[2]));
const resave = (f: F, id: string, patch: Partial<CashCmd>) => {
  const d = detail(f, id);
  return f.exec({
    type: 'cash.save',
    companyId: f.companyId,
    id,
    version: d.version,
    direction: d.direction,
    number: d.number,
    date: d.date,
    cashboxId: d.cashboxId,
    rate: '',
    counterpartyName: d.counterpartyName,
    basis: d.basis,
    attachment: d.attachment,
    lines: d.lines.map((l) => ({
      account: l.account,
      sk: l.sk,
      amount: l.amount,
      cashFlowItem: l.cashFlowItem,
      memo: l.memo,
    })),
    ...patch,
  });
};
const cancel = (f: F, id: string) =>
  f.exec({
    type: 'cash.cancel',
    companyId: f.companyId,
    id,
    version: detail(f, id).version,
    reason: 'səhv',
  });
const book = (f: F, cashboxId: string, from = '2026-09-01', to = '2026-09-30') =>
  f.query<CashBookView>({ type: 'cashBook', companyId: f.companyId, cashboxId, from, to });

function setup(f: F) {
  const box = f.cashbox();
  const founder = f.partner('Ağarza Ağalarov', '', 'individual');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const supplier = f.partner('Təchizat ASC', '1700000002');
  const c7 = f.contract(customer, '7', 'sale');
  const c12 = f.contract(supplier, '12', 'purchase');
  const paper = f.product('Kağız A4', 'qutu');
  const capitalIn = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const employee = f.exec({
    type: 'employee.save',
    companyId: f.companyId,
    name: 'Kassir Əliyev',
    position: '',
    fin: '',
    archived: false,
  } as never).id;
  return { box, founder, customer, supplier, c7, c12, paper, capitalIn, employee };
}

test('K1: cash orders — Dt/Kt, invoice matching, advance, accountable person, correction, cancel', (t) => {
  const f = fixture(t);
  const s = setup(f);
  const L = f.bankLine;
  // The founder brings cash; a supplier is paid, a customer pays more than it owes.
  const capital = f.cash('in', '2026-09-01', s.box, [L('301', [s.founder, s.capitalIn], '5000')], {
    counterpartyName: 'Ağarza Ağalarov',
    basis: 'Nizamnamə kapitalına qoyuluş',
  });
  assert.equal(capital.number, 'KMO-000001');
  assert.deepEqual(postings(f, capital.id), [['221.01', '301', '5000.00']]);
  const purchase = f.invoice('purchase', '2026-09-02', s.supplier, s.c12, [
    { productId: s.paper, quantity: '10', price: '100' },
  ]);
  const pay = f.cash('out', '2026-09-03', s.box, [L('531.01', [s.supplier, s.c12], '1180')]);
  assert.equal(pay.number, 'KXO-000001');
  // Cash settles the invoice as a whole: no VAT deposit in a cashbox.
  assert.deepEqual(postings(f, pay.id), [['531.01', '221.01', '1180.00']]);
  assert.deepEqual(documents(f, pay.id), [`invoice:${purchase.id}`]);
  const sale = f.invoice('sale', '2026-09-04', s.customer, s.c7, [
    { productId: s.paper, quantity: '5', price: '200' },
  ]);
  const receipt = f.cash('in', '2026-09-05', s.box, [L('211.01', [s.customer, s.c7], '1500')]);
  assert.deepEqual(postings(f, receipt.id), [
    ['221.01', '211.01', '1180.00'],
    ['221.01', '543.01', '320.00'],
  ]);
  assert.deepEqual(documents(f, receipt.id), [`invoice:${sale.id}`, `cash:${receipt.id}`]);
  // Accountable person: given 200, 50 comes back.
  const given = f.cash('out', '2026-09-06', s.box, [L('244.01', [s.employee], '200')]);
  const back = f.cash('in', '2026-09-08', s.box, [L('244.01', [s.employee], '50')]);
  assert.deepEqual(postings(f, given.id), [['244.01', '221.01', '200.00']]);
  let tb = f.trial('2026-09-01', '2026-09-30');
  assert.equal(f.row(tb, 'a:244')!.closeDt, '150.00');
  assert.equal(f.row(tb, 'a:221')!.closeDt, `${5000 - 1180 + 1500 - 200 + 50}.00`);

  // Correction: storno and a new entry; the advance grows.
  resave(f, receipt.id, { lines: [L('211.01', [s.customer, s.c7], '1600')] });
  assert.deepEqual(postings(f, receipt.id), [
    ['221.01', '211.01', '1180.00'],
    ['221.01', '543.01', '420.00'],
  ]);
  assert.equal(detail(f, receipt.id).version, 2);
  // The next invoice offsets the cash advance like a bank one.
  const sale2 = f.invoice('sale', '2026-09-10', s.customer, s.c7, [
    { productId: s.paper, quantity: '1', price: '100', vatRate: '0' },
  ]);
  tb = f.trial('2026-09-01', '2026-09-30');
  assert.equal(f.row(tb, 'a:543')!.closeKt, '320.00');
  assert.throws(() => cancel(f, receipt.id), /SF-000002|əvəzləşdirilib/);
  f.exec({
    type: 'invoice.cancel',
    companyId: f.companyId,
    id: sale2.id,
    version: 1,
    reason: 'səhv',
  });
  cancel(f, back.id);
  assert.equal(detail(f, back.id).status, 'cancelled');
  assert.deepEqual(postings(f, back.id), [['221.01', '244.01', '50.00']], 'the last posted entry');
  tb = f.trial('2026-09-01', '2026-09-30');
  assert.equal(f.row(tb, 'a:244')!.closeDt, '200.00');

  // Journal, account card and cash book agree.
  const list = f.query<CashDocumentSummary[]>({
    type: 'cashDocuments',
    companyId: f.companyId,
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.equal(list.length, 5);
  assert.equal(list.find((d) => d.id === back.id)!.status, 'cancelled');
  const b = book(f, s.box);
  assert.equal(b.opening, '0.00');
  assert.equal(b.closing, f.row(tb, 'a:221')!.closeDt);
  assert.deepEqual(
    b.days.map((d) => [d.date, d.lines.map((l) => l.number), d.closing]),
    [
      ['2026-09-01', ['KMO-000001'], '5000.00'],
      ['2026-09-03', ['KXO-000001'], '3820.00'],
      ['2026-09-05', ['KMO-000002'], '5420.00'],
      ['2026-09-06', ['KXO-000002'], '5220.00'],
    ],
    'the corrected order once, the cancelled one not at all',
  );
  assert.equal(b.days[2]!.lines[0]!.account, '211.01, 543.01');
  const card = f.card('221', '2026-09-01', '2026-09-30');
  assert.ok(card.lines.some((l) => l.sourceType === 'cash' && l.direction === 'in'));
  // Printed sum in words.
  assert.equal(detail(f, capital.id).amountWords, 'Beş min manat 00 qəpik');
});

test('K2: the cash balance is never negative on any day; closed period', (t) => {
  const f = fixture(t);
  const s = setup(f);
  const L = f.bankLine;
  const capital = (amount: string) => [L('301', [s.founder, s.capitalIn], amount)];
  const income = f.cash('in', '2026-09-10', s.box, capital('100'));
  f.cash('out', '2026-09-12', s.box, [L('244.01', [s.employee], '80')]);
  // A back-dated payment that fits on its own day but leaves the 12th short.
  assert.throws(
    () => f.cash('out', '2026-09-11', s.box, [L('244.01', [s.employee], '30')]),
    /Kassa qalığı 12\.09\.2026 tarixində mənfi olur: -10\.00 AZN/,
  );
  assert.throws(
    () => f.cash('out', '2026-09-09', s.box, [L('244.01', [s.employee], '1')]),
    /09\.09\.2026 tarixində mənfi/,
  );
  // Taking the receipt back, or moving it past the payment, is refused the same way.
  assert.throws(() => cancel(f, income.id), /12\.09\.2026 tarixində mənfi/);
  assert.throws(() => resave(f, income.id, { date: '2026-09-13' }), /12\.09\.2026/);
  assert.throws(() => resave(f, income.id, { lines: capital('70') }), /mənfi olur: -10\.00/);
  resave(f, income.id, { lines: capital('80') });
  assert.equal(book(f, s.box).closing, '0.00');
  // Nothing was half-saved by the refused commands.
  assert.equal(
    f.query<CashDocumentSummary[]>({
      type: 'cashDocuments',
      companyId: f.companyId,
      from: '2026-09-01',
      to: '2026-09-30',
    }).length,
    2,
  );
  f.exec({ type: 'period.close', companyId: f.companyId, through: '2026-09-30', reason: '' });
  assert.throws(() => f.cash('in', '2026-09-20', s.box, capital('10')), /bağlanıb/);
  assert.throws(() => cancel(f, income.id), /bağlanıb/);
  f.cash('in', '2026-10-01', s.box, capital('10'));
});

test('K3: cash from the bank through 222.01 — two documents, 222.01 back to zero', (t) => {
  const f = fixture(t);
  const s = setup(f);
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const acc = f.bankAccount(kapital, 'AZ12AIIB38060019441234567890');
  f.bank('in', '2026-09-01', acc, [f.bankLine('301', [s.founder, s.capitalIn], '5000')]);
  f.bank('out', '2026-09-10', acc, [f.bankLine('222.01', [], '1000')], {
    purpose: 'Kassaya nağd pul',
  });
  let tb = f.trial('2026-09-01', '2026-09-30');
  assert.equal(f.row(tb, 'a:222')!.closeDt, '1000.00', 'in transit: a control signal');
  f.cash('in', '2026-09-10', s.box, [f.bankLine('222.01', [], '1000')], {
    basis: 'Bankdan nağd pul',
  });
  tb = f.trial('2026-09-01', '2026-09-30', ['a:221', 'a:221.01', 'a:223', 'a:223.01']);
  assert.equal(f.row(tb, 'a:222')!.closeDt, '');
  assert.equal(f.row(tb, `a:221.01|${s.box}`)!.closeDt, '1000.00');
  assert.equal(f.row(tb, `a:223.01|${acc}`)!.closeDt, '4000.00');
  // Back to the bank.
  f.cash('out', '2026-09-15', s.box, [f.bankLine('222.01', [], '400')]);
  f.bank('in', '2026-09-15', acc, [f.bankLine('222.01', [], '400')]);
  tb = f.trial('2026-09-01', '2026-09-30');
  assert.equal(f.row(tb, 'a:222')!.closeDt, '');
  assert.equal(book(f, s.box).closing, '600.00');
  // A line on the cashbox itself is refused.
  assert.throws(
    () => f.cash('in', '2026-09-16', s.box, [f.bankLine('221.01', [s.box], '1')]),
    /kassanın özüdür/,
  );
});

test('cashboxes: own catalog bound to a 221 account; a currency cashbox posts in its currency', (t) => {
  const f = fixture(t);
  const s = setup(f);
  const save = (name: string, account: string, currency: string, extra: object = {}) =>
    f.exec({
      type: 'cashbox.save',
      companyId: f.companyId,
      name,
      account,
      currency,
      archived: false,
      ...extra,
    });
  assert.throws(() => save('Valyuta', '221.04', 'AZN'), /valyuta kassasıdır/);
  assert.throws(() => save('Valyuta', '221.01', 'USD'), /221\.04/);
  assert.throws(() => save('Əsas kassa', '221.01', 'AZN'), /artıq var/);
  const usd = save('Valyuta kassası', '221.04', 'USD').id;
  const order = f.cash(
    'in',
    '2026-09-01',
    usd,
    [f.bankLine('301', [s.founder, s.capitalIn], '100')],
    {
      rate: '1.7',
    },
  );
  assert.deepEqual(postings(f, order.id), [['221.04', '301', '170.00', '100.00|']]);
  assert.throws(
    () =>
      f.cash('out', '2026-09-02', usd, [f.bankLine('244.02', [s.employee], '101')], {
        rate: '1.7',
      }),
    /-1\.00 USD/,
  );
  assert.throws(
    () => f.cash('in', '2026-09-01', s.box, capitalLine(f, s), { rate: '1.7' }),
    /Manat kassasında məzənnə yazılmır/,
  );
  // Used: the account and currency stay.
  const row = f.catalog().cashboxes.find((b) => b.id === usd)!;
  assert.throws(
    () => save('Valyuta kassası', '221.04', 'EUR', { id: usd, version: row.version }),
    /dəyişdirilmir/,
  );
  // A manual operation on 221.01 must use a cashbox of 221.01.
  assert.throws(
    () =>
      f.operation('2026-09-03', [f.line('221.01', [usd], '301', [s.founder, s.capitalIn], '1')]),
    /221\.04 hesabına bağlıdır/,
  );
  assert.deepEqual(
    f.catalog().cashboxes.map((b) => [b.name, b.account, b.currency]),
    [
      ['Əsas kassa', '221.01', 'AZN'],
      ['Valyuta kassası', '221.04', 'USD'],
    ],
  );
  assert.equal(f.catalog().items.filter((i) => (i.kind as string) === 'cashbox').length, 0);
});

const capitalLine = (f: F, s: ReturnType<typeof setup>) => [
  f.bankLine('301', [s.founder, s.capitalIn], '1'),
];

test('amount in words', () => {
  assert.equal(amountInWords(123450n), 'Min iki yüz otuz dörd manat 50 qəpik');
  assert.equal(amountInWords(100n), 'Bir manat 00 qəpik');
  assert.equal(amountInWords(11_500_000_07n), 'On bir milyon beş yüz min manat 07 qəpik');
  assert.equal(amountInWords(5n), 'Sıfır manat 05 qəpik');
  assert.equal(amountInWords(10000n, 'USD'), 'Yüz ABŞ dolları 00 sent');
});
