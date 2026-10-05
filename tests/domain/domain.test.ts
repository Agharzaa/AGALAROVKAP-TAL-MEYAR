import test from 'node:test';
import assert from 'node:assert/strict';
import {
  displayMinor,
  formatMinor,
  parseMoney,
  percentOf,
  roundHalfAwayFromZero,
} from '../../src/domain/money.js';
import {
  lineAmount,
  parsePrice,
  parseQty,
  toBaseQty,
  formatQty,
} from '../../src/domain/quantity.js';
import { Chart, baseChart, newSubAccount } from '../../src/domain/accounts.js';
import {
  postInvoice,
  postPayment,
  reverse,
  checkEntry,
  type InvoiceDoc,
} from '../../src/domain/posting.js';
import { issueCost } from '../../src/domain/stock.js';
import { numberKey, parseDate, parseTaxId } from '../../src/domain/values.js';
import { DomainError } from '../../src/domain/errors.js';

const chart = new Chart(baseChart);
const sides = (lines: { account: string; debit: bigint; credit: bigint }[]) =>
  lines.map((l) => [l.account, formatMinor(l.debit), formatMinor(l.credit)]);

test('money parses exact qəpik and never rounds silently', () => {
  assert.equal(parseMoney('118'), 11800n);
  assert.equal(parseMoney('1 250,5'), 125050n);
  assert.equal(parseMoney('0.01'), 1n);
  for (const bad of ['1.005', '-1', '1e3', '', 'abc', '12,3,4'])
    assert.throws(() => parseMoney(bad), DomainError, bad);
  assert.throws(() => parseMoney(1 as unknown as string), /mətn/);
  assert.throws(() => parseMoney('1000000000000'), /həddi/);
  assert.equal(formatMinor(-1205n), '-12.05');
  assert.equal(displayMinor(123456789n), '1 234 567,89');
  assert.equal(percentOf(10000n, 1800), 1800n);
  assert.equal(percentOf(1n, 1800), 0n);
  assert.equal(percentOf(3n, 1800), 1n); // 0.54 → 1
  assert.equal(roundHalfAwayFromZero(-5n, 10n), -1n);
});

test('quantities keep 6 decimals, prices 4, and a line rounds once to qəpik', () => {
  assert.equal(parseQty('2'), 2_000_000n);
  assert.equal(parseQty('0,000001'), 1n);
  assert.throws(() => parseQty('0'), /sıfırdan/);
  assert.throws(() => parseQty('1.0000001'), /6 onluq/);
  assert.equal(parsePrice('12.3456'), 123_456n);
  assert.throws(() => parsePrice('1.00001'), /4 onluq/);
  assert.equal(lineAmount(parseQty('3'), parsePrice('0.3333')), 100n); // 0.9999 → 1.00
  assert.equal(lineAmount(parseQty('1'), parsePrice('0.005')), 1n); // half away from zero
  assert.throws(() => lineAmount(parseQty('1'), parsePrice('0.0001')), /0,01/);
  // Acceptance 3: 2 boxes × 12 = 24 base units.
  assert.equal(formatQty(toBaseQty(parseQty('2'), parseQty('12'))), '24');
  assert.throws(() => toBaseQty(parseQty('0.000001'), parseQty('0.5')), /dəqiqliyini/);
});

test('values: dates, VÖEN and normalized document numbers', () => {
  assert.equal(parseDate('2026-02-28'), '2026-02-28');
  assert.throws(() => parseDate('2026-02-30'), /təqvimdə/);
  assert.throws(() => parseDate('26-02-01'), /düzgün/);
  assert.equal(parseTaxId('0123456789'), '0123456789');
  assert.throws(() => parseTaxId('123'), /10 rəqəm/);
  assert.equal(numberKey(' mt 0001 '), 'MT0001');
  assert.equal(numberKey('inv-1'), 'INV-1');
  assert.equal(numberKey('İNV-1'), 'INV-1');
  assert.equal(numberKey('ınv-1'), 'INV-1');
});

const purchase = (lines: InvoiceDoc['lines']): InvoiceDoc => ({
  direction: 'purchase',
  number: 'P-1',
  partnerId: 'p1',
  partnerName: 'Təchizatçı',
  lines,
});

test('acceptance 1: goods 100 + VAT 18 → Dt 205 100, Dt 241 18, Kt 531 118', () => {
  const lines = postInvoice(
    chart,
    purchase([
      {
        kind: 'stock',
        description: 'Mal',
        account: '205',
        productId: 'pr',
        warehouseId: 'w',
        quantity: parseQty('10'),
        net: 10000n,
        vat: 1800n,
      },
    ]),
  );
  assert.deepEqual(sides(lines), [
    ['205', '100.00', '0.00'],
    ['241', '18.00', '0.00'],
    ['531', '0.00', '118.00'],
  ]);
  assert.equal(lines[2]!.partnerId, 'p1');
  assert.equal(lines[0]!.quantity, 10_000_000n);
});

test('acceptance 2: choosing 201 on the line debits 201, not 205', () => {
  const lines = postInvoice(
    chart,
    purchase([
      {
        kind: 'stock',
        description: 'Kağız',
        account: '201',
        productId: 'pr',
        warehouseId: 'w',
        quantity: parseQty('1'),
        net: 5000n,
        vat: 0n,
      },
    ]),
  );
  assert.deepEqual(sides(lines), [
    ['201', '50.00', '0.00'],
    ['531', '0.00', '50.00'],
  ]);
});

test('services require an expense item on 721; wrong families and missing analytics are refused', () => {
  const service = {
    kind: 'service' as const,
    description: 'Rabitə',
    account: '721',
    expenseItemId: 'telecom',
    net: 2000n,
    vat: 360n,
  };
  assert.deepEqual(sides(postInvoice(chart, purchase([service]))), [
    ['721', '20.00', '0.00'],
    ['241', '3.60', '0.00'],
    ['531', '0.00', '23.60'],
  ]);
  assert.throws(
    () => postInvoice(chart, purchase([{ ...service, expenseItemId: undefined }])),
    /xərc maddəsi/,
  );
  assert.throws(() => postInvoice(chart, purchase([{ ...service, account: '205' }])), /721/);
  assert.throws(
    () => postInvoice(chart, purchase([{ ...service, kind: 'stock', account: '205' }])),
    /nomenklatura/,
  );
  assert.throws(() => postInvoice(chart, purchase([])), /ən azı bir/);
  assert.throws(() => postInvoice(chart, purchase([{ ...service, net: 0n }])), /sıfırdan/);
});

test('sale posts receivable, revenue, VAT and cost of goods from the supplied cost', () => {
  const lines = postInvoice(
    chart,
    {
      direction: 'sale',
      number: 'S-1',
      partnerId: 'c1',
      partnerName: 'Alıcı',
      lines: [
        {
          kind: 'stock',
          description: 'Mal',
          account: '601',
          stockAccount: '205',
          productId: 'pr',
          warehouseId: 'w',
          quantity: parseQty('4'),
          net: 10000n,
          vat: 1800n,
        },
        { kind: 'service', description: 'Çatdırılma', account: '601', net: 500n, vat: 90n },
      ],
    },
    new Map([[0, 6000n]]),
  );
  assert.deepEqual(sides(lines), [
    ['211', '123.90', '0.00'],
    ['601', '0.00', '100.00'],
    ['701', '60.00', '0.00'],
    ['205', '0.00', '60.00'],
    ['601', '0.00', '5.00'],
    ['545', '0.00', '18.90'],
  ]);
  assert.equal(lines[3]!.quantity, -4_000_000n);
  assert.throws(
    () =>
      postInvoice(chart, {
        direction: 'sale',
        number: 'S-2',
        partnerId: 'c1',
        partnerName: 'Alıcı',
        lines: [
          {
            kind: 'stock',
            description: 'Avadanlıq',
            account: '601',
            stockAccount: '113',
            productId: 'pr',
            warehouseId: 'w',
            quantity: 1n,
            net: 1n,
            vat: 0n,
          },
        ],
      }),
    /205 və ya 201/,
  );
});

test('payments and reversal mirror each other', () => {
  const inbound = postPayment(chart, {
    direction: 'in',
    bankAccount: '223',
    reference: 'B1',
    partnerId: 'c1',
    partnerName: 'Alıcı',
    amount: 11800n,
    memo: '',
  });
  assert.deepEqual(sides(inbound), [
    ['223', '118.00', '0.00'],
    ['211', '0.00', '118.00'],
  ]);
  const deposit = postPayment(chart, {
    direction: 'in',
    bankAccount: '224.04',
    reference: 'B2',
    partnerId: 'c1',
    partnerName: 'Alıcı',
    amount: 1800n,
    memo: '',
  });
  assert.equal(deposit[0]!.account, '224.04');
  const outbound = postPayment(chart, {
    direction: 'out',
    bankAccount: '223',
    reference: 'B3',
    partnerId: 's1',
    partnerName: 'Təchizatçı',
    amount: 500n,
    memo: '',
  });
  assert.deepEqual(sides(outbound), [
    ['531', '5.00', '0.00'],
    ['223', '0.00', '5.00'],
  ]);
  assert.deepEqual(sides(reverse(inbound)), [
    ['223', '0.00', '118.00'],
    ['211', '118.00', '0.00'],
  ]);
  assert.throws(
    () =>
      postPayment(chart, {
        ...{ direction: 'in', reference: 'x', partnerId: 'c', partnerName: 'c', memo: '' },
        bankAccount: '211',
        amount: 1n,
      } as never),
    /223/,
  );
});

test('entries must balance, use postable accounts and carry required analytics', () => {
  assert.throws(
    () =>
      checkEntry(chart, [
        { account: '223', debit: 100n, credit: 0n, memo: '' },
        { account: '211', debit: 0n, credit: 99n, partnerId: 'p', memo: '' },
      ]),
    /bərabər deyil/,
  );
  assert.throws(
    () =>
      checkEntry(chart, [
        { account: '223', debit: 100n, credit: 0n, memo: '' },
        { account: '211', debit: 0n, credit: 100n, memo: '' },
      ]),
    /analitika/,
  );
  assert.throws(
    () => checkEntry(chart, [{ account: '223', debit: 1n, credit: 1n, memo: '' }]),
    /yalnız debet/,
  );
  // A group with sub-accounts is not postable.
  const sub = newSubAccount(
    chart.get('205'),
    '205.01',
    'Tikinti malları',
    new Set(chart.all().map((a) => a.code)),
  );
  const extended = new Chart([...baseChart, sub]);
  assert.equal(extended.postable('205'), false);
  assert.equal(extended.postable('205.01'), true);
  assert.deepEqual(sub.analytics, ['warehouse', 'product']);
  assert.throws(
    () =>
      postInvoice(
        extended,
        purchase([
          {
            kind: 'stock',
            description: '',
            account: '205',
            productId: 'p',
            warehouseId: 'w',
            quantity: 1n,
            net: 1n,
            vat: 0n,
          },
        ]),
      ),
    /subhesab seçin/,
  );
  assert.throws(() => newSubAccount(chart.get('205'), '201.01', 'x', new Set()), /205.01/);
  assert.throws(() => newSubAccount(chart.get('205'), '205.1', 'x', new Set()), /formatında/);
  assert.throws(() => newSubAccount(undefined, '999.01', 'x', new Set()), /tapılmadı/);
});

test('acceptance 11: 10×10 + 10×20, issue 4 → average cost 60; full issue clears the value', () => {
  const balance = { quantity: parseQty('20'), value: 30000n };
  assert.equal(issueCost(balance, parseQty('4'), 'Mal'), 6000n);
  assert.equal(issueCost({ quantity: parseQty('3'), value: 1000n }, parseQty('1'), 'Mal'), 333n);
  assert.equal(issueCost({ quantity: parseQty('3'), value: 1000n }, parseQty('3'), 'Mal'), 1000n);
  assert.throws(() => issueCost(balance, parseQty('21'), 'Mal'), /kifayət qədər/);
});
