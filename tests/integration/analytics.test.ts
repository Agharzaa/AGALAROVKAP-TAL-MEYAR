/**
 * Stage 5d — reports and the dashboard (docs/MERHELE-5-AY-BAGLANISI.md §6, §8: H1–H3, A1's M/Z).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CashFlowView,
  DashboardView,
  EqReconcileView,
  ProfitLossView,
  VatSummaryView,
} from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';
import { september } from './september.js';

type F = ReturnType<typeof fixture>;

const pl = (f: F, year = '2026') =>
  f.query<ProfitLossView>({ type: 'profitLoss', companyId: f.companyId, year });
/** The September column and the year sum of every row, by label. */
const september9 = (v: ProfitLossView) => v.rows.map((r) => [r.label, r.values[8], r.sum, r.total]);
const close = (f: F, month: string, acknowledged = false) =>
  f.exec({ type: 'closing.post', companyId: f.companyId, month, acknowledged });

test('M/Z: the September example by months; the closing does not empty it (A1)', (t) => {
  const f = fixture(t);
  september(f);
  const before = pl(f);
  assert.deepEqual(before.months.slice(7, 9), ['2026-08', '2026-09']);
  const expected = [
    ['601 · Satış', '15000.00', '15000.00', false],
    ['Məhsul satışı', '15000.00', '15000.00', false],
    ['604 · Satış üzrə ƏDV', '2288.14', '2288.14', false],
    ['Xalis satış', '12711.86', '12711.86', true],
    ['701 · Satışın maya dəyəri', '7000.00', '7000.00', false],
    ['Satılmış malların maya dəyəri', '7000.00', '7000.00', false],
    ['Ümumi mənfəət (zərər)', '5711.86', '5711.86', true],
    ['721 · İnzibati xərclər', '3.00', '3.00', false],
    ['Bank xidmətləri', '3.00', '3.00', false],
    ['Əməliyyat mənfəəti (zərəri)', '5708.86', '5708.86', true],
    ['Vergiqoyulmadan əvvəl mənfəət (zərər)', '5708.86', '5708.86', true],
  ];
  assert.deepEqual(september9(before), expected);
  // Drill-down: an account row and a subkonto row lead to the account card.
  const income = before.rows.find((r) => r.label === 'Məhsul satışı')!;
  assert.deepEqual([income.account, income.level, income.sk.length], ['601', 1, 1]);
  close(f, '2026-08');
  close(f, '2026-09');
  assert.deepEqual(september9(pl(f)), expected, 'closing entries are left out');
  // The trial balance does show them: 601 has turnover on both sides and no balance.
  const tb = f.trial('2026-09-01', '2026-09-30', [], { accounts: ['601'] });
  const r601 = tb.rows.find((r) => r.key === 'a:601')!;
  assert.deepEqual([r601.turnDt, r601.turnKt, r601.closeKt], ['15000.00', '15000.00', '']);
  assert.throws(() => pl(f, '26'), /İl düzgün deyil/);
});

test('H1: cash flow by item — opening and closing reconcile with 221 + 223 + 224', (t) => {
  const f = fixture(t);
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Təsisçi', '', 'individual');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const cs = f.contract(customer, 'S-1', 'sale');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  const fromCustomers = f.item('cashFlowItem', 'Alıcılardan daxilolmalar');
  const owners = f.item('cashFlowItem', 'Təsisçilərlə əməliyyatlar');
  const own = f.item('cashFlowItem', 'Öz hesabları arasında köçürmələr');
  const bank = f.bankAccount(kapital, 'AZ12AIIB38060019441234567890');
  const box = f.cashbox();
  const B = f.bankLine;
  f.bank('in', '2026-08-20', bank, [
    B('301', [founder, capital], '1000', { cashFlowItem: owners }),
  ]);
  f.bank('in', '2026-09-02', bank, [
    B('211.01', [customer, cs], '500', { cashFlowItem: fromCustomers }),
    B('301', [founder, capital], '200', { cashFlowItem: owners }),
  ]);
  f.bank('out', '2026-09-03', bank, [B('721', [fees], '5')]);
  // Bank → cashbox through 222.01: out of the bank, into the cashbox.
  f.bank('out', '2026-09-04', bank, [B('222.01', [], '300', { cashFlowItem: own })]);
  f.cash('in', '2026-09-04', box, [B('222.01', [], '300', { cashFlowItem: own })]);
  // A manual operation on the bank account: outside the documents, shown apart.
  f.operation('2026-09-10', [f.line('721', [fees], '223.01', [bank], '2')]);
  const v = f.query<CashFlowView>({
    type: 'cashFlow',
    companyId: f.companyId,
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.deepEqual([v.opening, v.closing], ['1000.00', '1693.00']);
  assert.deepEqual(
    v.rows.map((r) => [r.kind, r.label, r.amount]),
    [
      ['in', 'Alıcılardan daxilolmalar', '500.00'],
      ['in', 'Öz hesabları arasında köçürmələr', '300.00'],
      ['in', 'Təsisçilərlə əməliyyatlar', '200.00'],
      ['out', 'Öz hesabları arasında köçürmələr', '300.00'],
      ['out', 'Maddəsiz', '5.00'],
      ['other', 'Əl ilə əməliyyatlar', '-2.00'],
    ],
  );
  assert.deepEqual(
    [v.inflow, v.outflow, v.other, v.reconciled],
    ['1000.00', '305.00', '-2.00', true],
  );
  const tb = f.trial('2026-09-01', '2026-09-30');
  const moneyClose = ['221', '223', '224']
    .map((a) => tb.rows.find((r) => r.key === `a:${a}`)?.closeDt ?? '')
    .filter(Boolean)
    .reduce((s, x) => s + Math.round(Number(x) * 100), 0);
  assert.equal(moneyClose, 169300);
});

function dvx(
  f: F,
  direction: 'sale' | 'purchase',
  number: string,
  taxId: string,
  net: string,
  vat: string,
) {
  f.exec({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: f.companyId,
    direction,
    report: 'invoices',
    source: 'file',
    fileName: `${direction}-${number}.xlsx`,
    fileHash: (direction === 'sale' ? '1' : '2').padStart(64, '0'),
    documents: [
      {
        row: 2,
        number,
        date: '2026-09-05',
        taxId,
        name: 'Kontragent',
        status: 'Təsdiqləndi',
        net,
        vat,
        base18: net,
      },
    ],
  } as never);
}

test('H2: ƏDV icmalı of the month — the same figures as DVX ↔ uçot; offset by the closing', (t) => {
  const f = fixture(t);
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Təsisçi', '', 'individual');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const supplier = f.partner('Təchizat ASC', '1700000002');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const cp = f.contract(supplier, 'P-1', 'purchase');
  const cs = f.contract(customer, 'S-1', 'sale');
  const paper = f.product('Kağız A4', 'qutu');
  const consulting = f.product('Konsaltinq', 'saat', 'service');
  const bank = f.bankAccount(kapital, 'AZ12AIIB38060019441234567890');
  const deposit = f.bankAccount(kapital, 'AZ77AIIB38060019449999999999', '224.04', 'AZN', 'ƏDV');
  f.operation('2026-08-31', [
    f.line('223.01', [bank], '301', [founder, capital], '5000'),
    f.line('224.04', [deposit], '301', [founder, capital], '500'),
  ]);
  close(f, '2026-08');
  f.invoice(
    'purchase',
    '2026-09-05',
    supplier,
    cp,
    [{ productId: paper, quantity: '10', price: '100' }],
    {
      eqNumber: 'MT0001',
    },
  );
  f.invoice(
    'sale',
    '2026-09-06',
    customer,
    cs,
    [
      { productId: consulting, quantity: '10', price: '200' },
      { productId: consulting, quantity: '1', price: '50', vatRate: 'exempt' },
    ],
    { eqNumber: 'AA0001' },
  );
  dvx(f, 'purchase', 'MT0001', '1700000002', '1000.00', '180.00');
  dvx(f, 'sale', 'AA0001', '1700000001', '2000.00', '360.00');
  const B = f.bankLine;
  f.bank('out', '2026-09-10', bank, [B('531.01', [supplier, cp], '1000')]);
  f.bank('out', '2026-09-10', deposit, [B('531.01', [supplier, cp], '180')]);
  const summary = () =>
    f.query<VatSummaryView>({ type: 'vatSummary', companyId: f.companyId, month: '2026-09' });
  const before = summary();
  assert.deepEqual(before.sales, [
    { rate: '18', label: '18%', base: '2000.00', vat: '360.00' },
    { rate: 'exempt', label: 'ƏDV-dən azad', base: '50.00', vat: '0.00' },
  ]);
  assert.deepEqual(
    [before.salesVat, before.purchaseVat, before.offset, before.waiting, before.payable],
    ['360.00', '180.00', '0.00', '180.00', '360.00'],
  );
  for (const direction of ['sale', 'purchase'] as const) {
    const r = f.query<EqReconcileView>({
      type: 'eqReconcile',
      companyId: f.companyId,
      direction,
      from: '2026-09-01',
      to: '2026-09-30',
    });
    const m = r.months.find((x) => x.month === '2026-09')!;
    const d = before.dvx.find((x) => x.direction === direction)!;
    assert.deepEqual(
      [d.dvxVat, d.bookedVat, d.difference, d.covered],
      [m.dvxVat, m.bookedVat, m.difference, true],
    );
  }
  assert.equal(before.dvx.find((x) => x.direction === 'sale')!.bookedVat, before.salesVat);
  assert.equal(before.dvx.find((x) => x.direction === 'purchase')!.bookedVat, before.purchaseVat);
  close(f, '2026-09', true);
  const after = summary();
  assert.deepEqual([after.offset, after.waiting, after.payable], ['180.00', '0.00', '180.00']);
  assert.deepEqual(after.sales, before.sales, 'the closing does not change the sales side');
});

test('H3: the dashboard reads the registers — tiles equal the trial balance and M/Z', (t) => {
  const f = fixture(t);
  const s = september(f);
  // A second customer owes, the supplier is owed: debtors and creditors per partner.
  const other = f.partner('İkinci Alıcı MMC', '1700000009');
  const c9 = f.contract(other, '9', 'sale');
  f.operation('2026-09-20', [f.line('211.01', [other, c9, ''], '601', [s.goods, '0'], '400')]);
  f.operation('2026-09-21', [
    f.line('205', [s.paper], '531.01', [s.supplier, s.c12, ''], '250', { quantity: '5' }),
  ]);
  const v = f.query<DashboardView>({ type: 'dashboard', companyId: f.companyId, month: '2026-09' });
  const tile = (k: string) => v.tiles.find((x) => x.key === k)!.value;
  const year = pl(f);
  const result = year.rows.find((r) => r.key === 't:result')!;
  assert.equal(tile('profit'), result.values[8]);
  assert.equal(tile('income'), '13111.86', 'net sales 12 711.86 + 400.00');
  const tb = f.trial('2026-09-01', '2026-09-30', ['a:211', 'a:531'], {});
  const close = (key: string, side: 'closeDt' | 'closeKt') =>
    tb.rows.find((r) => r.key === key)?.[side] || '0.00';
  const cents = (x: string) => Math.round(Number(x) * 100);
  assert.equal(
    cents(tile('money')),
    ['a:221', 'a:223', 'a:224'].reduce((sum, k) => sum + cents(close(k, 'closeDt')), 0),
  );
  assert.equal(tile('receivables'), close('a:211', 'closeDt'));
  assert.equal(tile('receivables'), '400.00');
  assert.equal(tile('payables'), close('a:531', 'closeKt'));
  assert.equal(tile('payables'), '250.00');
  assert.equal(tile('vat'), '2288.14', 'nothing offset yet');
  assert.equal(tile('eqWaiting'), '0');
  assert.equal(v.series.length, 12);
  assert.deepEqual(v.series.map((x) => x.month).slice(-2), ['2026-08', '2026-09']);
  const sep = v.series[11]!;
  assert.deepEqual(
    [sep.income, sep.profit, sep.money],
    [tile('income'), tile('profit'), tile('money')],
  );
  assert.equal(
    cents(sep.income) - cents(sep.expense),
    cents(sep.profit),
    'income − expense = profit',
  );
  assert.deepEqual([v.series[10]!.money, v.series[10]!.profit], ['43000.00', '0.00']);
});

test('audit: the dashboard counts an e-qaimə and the correction replacing it once, as İş masası does', (t) => {
  const f = fixture(t);
  const header = {
    sellerTaxId: '',
    buyerTaxId: '',
    sellerName: '',
    buyerName: '',
    name: 'Kontragent',
    status: 'Təsdiqləndi',
    total: '',
    base0: '',
    baseExempt: '',
    baseNontaxable: '',
    excise: '',
    roadTax: '',
    note: '',
  };
  f.exec({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: f.companyId,
    direction: 'purchase',
    report: 'invoices',
    source: 'file',
    fileName: 'dvx.xlsx',
    fileHash: '3'.padStart(64, '0'),
    documents: [
      {
        ...header,
        row: 2,
        number: 'MT1',
        date: '2026-09-05',
        taxId: '1700000002',
        kind: 'Əsas',
        refNumber: '',
        net: '1000.00',
        vat: '180.00',
        base18: '1000.00',
      },
      {
        ...header,
        row: 3,
        number: 'MT9',
        date: '2026-09-08',
        taxId: '1700000002',
        kind: 'Düzəliş qaiməsi',
        refNumber: 'MT1',
        net: '900.00',
        vat: '162.00',
        base18: '900.00',
      },
    ],
  });
  const home = f.home().warnings.find((w) => w.kind === 'eqWaiting')!;
  assert.match(home.text, /: 1 e-qaimə DVX-də təsdiqlənib, uçota alınmayıb/);
  const v = f.query<DashboardView>({ type: 'dashboard', companyId: f.companyId, month: '2026-09' });
  assert.equal(v.tiles.find((x) => x.key === 'eqWaiting')!.value, '1');
});
