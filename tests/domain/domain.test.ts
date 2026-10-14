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
import { issueCost } from '../../src/domain/stock.js';
import { numberKey, parseDate, parseTaxId } from '../../src/domain/values.js';
import { DomainError } from '../../src/domain/errors.js';
import { Chart, baseChart, checkSubkonto, newAccount } from '../../src/domain/chart.js';
import {
  allocateAdvances,
  AZN_RATE,
  aznAmounts,
  fifoCost,
  lineAmounts,
  sliceValue,
  toAzn,
} from '../../src/domain/invoice.js';
import { checkPostings, storno, type Posting } from '../../src/domain/posting.js';
import { allocatePayment, openPart, splitProportionally } from '../../src/domain/bank.js';
import { readStatementTable, statementAddsUp } from '../../src/domain/statement.js';

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

test('acceptance 11: 10×10 + 10×20, issue 4 → average cost 60; full issue clears the value', () => {
  const balance = { quantity: parseQty('20'), value: 30000n };
  assert.equal(issueCost(balance, parseQty('4'), 'Mal'), 6000n);
  assert.equal(issueCost({ quantity: parseQty('3'), value: 1000n }, parseQty('1'), 'Mal'), 333n);
  assert.equal(issueCost({ quantity: parseQty('3'), value: 1000n }, parseQty('3'), 'Mal'), 1000n);
  assert.throws(() => issueCost(balance, parseQty('21'), 'Mal'), /kifayət qədər/);
});

test('bank statement amounts and dates are read the way banks print them', async () => {
  const { readStatementAmount, readStatementDate, classifyStatementLine } =
    await import('../../src/domain/statement.js');
  const a = (v: string) => {
    const r = readStatementAmount(v);
    return r ? `${r.negative ? '-' : ''}${formatMinor(r.amount)}` : undefined;
  };
  assert.equal(a('1 234,56'), '1234.56');
  assert.equal(a('1.234,56'), '1234.56');
  assert.equal(a('1,234.56'), '1234.56');
  assert.equal(a('17 000,0000'), '17000.00');
  assert.equal(a('-50.00'), '-50.00');
  assert.equal(a('(50,00)'), '-50.00');
  assert.equal(a('12,345'), '12345.00');
  assert.equal(a('0,005'), '0.01');
  assert.equal(a('1 500 AZN'), '1500.00');
  assert.equal(a('abc'), undefined);
  assert.equal(readStatementDate('31.01.2026'), '2026-01-31');
  assert.equal(readStatementDate('31/01/26'), '2026-01-31');
  assert.equal(readStatementDate('2026-01-31 10:15'), '2026-01-31');
  assert.equal(readStatementDate('46053'), '2026-01-31');
  assert.equal(readStatementDate('31.02.2026'), undefined);

  const ctx = {
    companyTaxId: '1234567890',
    partnersByTaxId: new Map([['1700000001', { id: 'p1', name: 'Alıcı' }]]),
    partnersByName: new Map(),
  };
  const kind = (direction: 'in' | 'out', purpose: string, taxId = '', counterparty = '') =>
    classifyStatementLine({ direction, purpose, counterpartyTaxId: taxId, counterparty }, ctx).kind;
  // A supplier's "vergi hesab-fakturası" or "ƏDV daxil" is still a settlement.
  assert.equal(
    kind('out', 'Elektron vergi hesab-fakturası üzrə, ƏDV daxil', '1700000001'),
    'settlement',
  );
  assert.equal(kind('out', 'Mənfəət vergisi'), 'tax');
  assert.equal(kind('out', 'Ödəniş', '', 'Azərbaycan Respublikası Dövlət Xəzinədarlığı'), 'tax');
  assert.equal(kind('out', 'Yanvar ayı üzrə əmək haqqı'), 'salary');
  assert.equal(kind('in', 'Nizamnamə kapitalına ödəniş', '1700000001'), 'capital');
  assert.equal(kind('out', 'Artıq ödənilmiş məbləğin qaytarılması', '1700000001'), 'refund');
  assert.equal(kind('out', 'ƏDV depozit hesabına köçürmə'), 'transfer');
  assert.equal(kind('in', 'x', '1234567890'), 'transfer');
});

const chart = new Chart(baseChart);
const P = (
  dt: string,
  dtSk: string[],
  kt: string,
  ktSk: string[],
  amount: bigint,
  extra: Partial<Posting> = {},
): Posting => ({
  dt: { account: dt, sk: dtSk },
  kt: { account: kt, sk: ktSk },
  amount,
  memo: '',
  ...extra,
});

test('chart: agreed accounts and subkonto, groups are not postable', () => {
  assert.deepEqual(chart.get('211')!.subkonto, ['partner', 'contract', 'document']);
  assert.deepEqual(chart.get('531')!.subkonto, ['partner', 'contract', 'document']);
  assert.deepEqual(chart.get('601')!.subkonto, ['incomeType', 'vatRate']);
  assert.deepEqual(chart.get('604.1')!.subkonto, ['vatRate']);
  assert.deepEqual(chart.get('501')!.subkonto, ['partner', 'contract']);
  assert.deepEqual(chart.get('543.01')!.subkonto, ['partner', 'contract', 'document']);
  assert.deepEqual(chart.get('243.02')!.subkonto, ['partner', 'contract', 'document']);
  assert.deepEqual(chart.get('701')!.subkonto, ['productGroup', 'expenseItem']);
  assert.deepEqual(chart.get('521.13')!.subkonto, ['partner', 'contract', 'document']);
  assert.equal(chart.get('211.02')!.currency, true);
  assert.equal(chart.get('211.01')!.currency, false);
  assert.deepEqual(chart.get('205')!.subkonto, ['product']);
  assert.equal(chart.get('205')!.quantitative, true);
  assert.equal(chart.get('223.02')!.currency, true);
  assert.equal(chart.get('223.01')!.currency, false);
  for (const group of ['211', '222', '223', '224', '243', '521', '522', '531', '534', '543', '604'])
    assert.equal(chart.postable(group), false, group);
  assert.throws(() => chart.require('223', 'x'), /subhesab seçin/);
  assert.throws(() => chart.require('999', 'x'), /hesab planında yoxdur/);
});

test('chart: new accounts inherit from the parent; subkonto rules', () => {
  const sub = newAccount(chart, { code: '721.01', name: 'Bank xərcləri' });
  assert.deepEqual([sub.parentCode, sub.nature, sub.subkonto], ['721', 'active', ['expenseItem']]);
  assert.throws(() => newAccount(chart, { code: '721', name: 'x' }), /artıq var/);
  assert.throws(() => newAccount(chart, { code: '72', name: 'x' }), /3 rəqəmlə/);
  assert.throws(() => newAccount(chart, { code: '999.01', name: 'x' }), /Əvvəlcə 999/);
  assert.throws(() => newAccount(chart, { code: '999', name: 'x' }), /növünü seçin/);
  assert.throws(() => checkSubkonto(['contract', 'partner']), /kontragentdən dərhal sonra/);
  assert.throws(() => checkSubkonto(['partner', 'contract', 'document', 'vatRate']), /ən çox 3/);
});

test('postings: subkonto count, quantity and currency rules; storno negates everything', () => {
  checkPostings(chart, [P('211.01', ['p', 'c', 'd'], '601', ['inc', '18'], 1000n)]);
  assert.throws(
    () => checkPostings(chart, [P('211.01', ['p', 'c'], '601', ['inc', '18'], 1000n)]),
    /3 subkonto/,
  );
  assert.throws(
    () => checkPostings(chart, [P('211.01', ['p', '', 'd'], '601', ['inc', '18'], 1000n)]),
    /subkonto 2 seçilməyib/,
  );
  assert.throws(
    () => checkPostings(chart, [P('205', ['x'], '531.01', ['p', 'c', 'd'], 1000n)]),
    /miqdar yazılmalıdır/,
  );
  checkPostings(chart, [
    P('205', ['x'], '531.01', ['p', 'c', 'd'], 1000n, { quantity: 5_000_000n }),
  ]);
  assert.throws(
    () => checkPostings(chart, [P('721', ['e'], '531.01', ['p', 'c', 'd'], 10n, { quantity: 1n })]),
    /miqdar uçotu aparılmır/,
  );
  assert.throws(
    () => checkPostings(chart, [P('223.02', ['b'], '543.02', ['p', 'c', 'd'], 170n)]),
    /valyuta məbləğini/,
  );
  checkPostings(chart, [
    {
      dt: { account: '223.02', sk: ['b'], currency: 'USD', curAmount: 100n },
      kt: { account: '543.02', sk: ['p', 'c', 'd'], currency: 'USD', curAmount: 100n },
      amount: 170n,
      memo: '',
    },
  ]);
  assert.throws(
    () => checkPostings(chart, [P('221.01', ['k'], '221.01', ['k'], 5n)]),
    /eyni ola bilməz/,
  );
  assert.throws(() => checkPostings(chart, [P('221.01', ['k'], '223.01', ['b'], 0n)]), /sıfır/);
  const [s] = storno([P('205', ['x'], '531.01', ['p', 'c', 'd'], 1000n, { quantity: 5n })]);
  assert.equal(s!.amount, -1000n);
  assert.equal(s!.quantity, -5n);
  checkPostings(chart, [s!]);
});

test('invoice lines: VAT on top or inside, per-line rounding, AZN conversion', () => {
  const q = (v: string) => parseQty(v);
  const p = (v: string) => parsePrice(v);
  assert.deepEqual(lineAmounts(q('1'), p('100'), '18', false), {
    net: 10000n,
    vat: 1800n,
    gross: 11800n,
  });
  assert.deepEqual(lineAmounts(q('1'), p('118'), '18', true), {
    net: 10000n,
    vat: 1800n,
    gross: 11800n,
  });
  assert.deepEqual(lineAmounts(q('1'), p('15000'), '18', true), {
    net: 1271186n,
    vat: 228814n,
    gross: 1500000n,
  });
  assert.deepEqual(lineAmounts(q('3'), p('10'), 'exempt', false), {
    net: 3000n,
    vat: 0n,
    gross: 3000n,
  });
  assert.equal(toAzn(10000n, AZN_RATE), 10000n);
  assert.equal(toAzn(10000n, p('1.7')), 17000n);
  assert.equal(toAzn(3333n, p('1.7031')), 5676n, '33.33 × 1.7031 = 56.764323 → 56.76');
  const a = aznAmounts({ net: 3333n, vat: 600n, gross: 3933n }, p('1.7031'));
  assert.equal(a.net + a.vat, a.gross, 'AZN net is gross − VAT, so AZN lines always add up');
});

test('FIFO: slices of a layer add up exactly; oldest layer first; shortage is refused', () => {
  const layer = { source: 'a', quantity: 3_000_000n, value: 1000n };
  const one = 1_000_000n;
  const slices = [0n, 1n, 2n].map((i) => sliceValue(layer, i * one, (i + 1n) * one));
  assert.deepEqual(slices, [333n, 334n, 333n]);
  const layers = [
    { source: 'a', quantity: 10n * one, value: 1000n },
    { source: 'b', quantity: 10n * one, value: 2000n },
  ];
  const at = (issuedBefore: bigint, quantity: bigint, value: bigint) => ({
    layers,
    issuedBefore,
    quantity,
    value,
  });
  assert.equal(fifoCost(at(0n, 20n * one, 3000n), 4n * one, 'x'), 400n, 'oldest units first');
  // 4 units already gone: the next 11 are 6 × 1.00 + 5 × 2.00.
  assert.equal(fifoCost(at(4n * one, 16n * one, 2600n), 11n * one, 'x'), 1600n);
  // Emptying the stock takes exactly the value left, whatever the layers say.
  assert.equal(fifoCost(at(15n * one, 5n * one, 499n), 5n * one, 'x'), 499n);
  // Records out of FIFO order (the slice is worth more than what is left): average of the rest,
  // and value always stays behind the remaining units.
  assert.equal(fifoCost(at(10n * one, 10n * one, 2000n), 4n * one, 'x'), 800n, 'consistent: FIFO');
  assert.equal(fifoCost(at(10n * one, 10n * one, 700n), 4n * one, 'x'), 280n);
  assert.equal(fifoCost(at(10n * one, 10n * one, 700n), 9n * one, 'x'), 630n);
  assert.throws(
    () => fifoCost(at(15n * one, 5n * one, 1000n), 6n * one, 'Qələm'),
    /qalıq 5, tələb 6/,
  );
  // A cheap unit costs at least one qəpik; the last issue settles the rest.
  const screws = {
    layers: [{ source: 's', quantity: 1000n * one, value: 100n }],
    issuedBefore: 0n,
    quantity: 1000n * one,
    value: 100n,
  };
  assert.equal(fifoCost(screws, one, 'x'), 1n);
});

test('advances: oldest first, up to the invoice; currency at the advance rate', () => {
  const adv = [
    { document: 'a', amount: 100n, currency: 0n },
    { document: 'b', amount: 500n, currency: 0n },
  ];
  assert.deepEqual(allocateAdvances(adv, 300n, null), [
    { document: 'a', amount: 100n, currency: 0n },
    { document: 'b', amount: 200n, currency: 0n },
  ]);
  assert.deepEqual(allocateAdvances(adv, 50n, null), [
    { document: 'a', amount: 50n, currency: 0n },
  ]);
  // 50 USD advance carried at 80 AZN; a 30 USD invoice takes 30 USD = 48 AZN.
  assert.deepEqual(
    allocateAdvances([{ document: 'u', amount: 8000n, currency: 5000n }], 5100n, 3000n),
    [{ document: 'u', amount: 4800n, currency: 3000n }],
  );
});

test('bank: VAT and net parts of an invoice, payment spread oldest first', () => {
  // Invoice 15 000 with VAT 2 288.14, nothing paid yet.
  const inv = { document: 'invoice:a', open: 1_500_000n, vatOpen: 228_814n };
  assert.equal(openPart(inv, 'vat'), 228_814n);
  assert.equal(openPart(inv, 'net'), 1_271_186n);
  assert.equal(openPart(inv, 'whole'), 1_500_000n);
  // Only the VAT is left open: the current account has nothing to settle.
  assert.equal(openPart({ ...inv, open: 228_814n }, 'net'), 0n);
  // VAT paid to the current account by mistake: the deposit part cannot exceed what is owed.
  assert.equal(openPart({ ...inv, open: 100_000n }, 'vat'), 100_000n);
  const r = allocatePayment(
    [inv, { document: 'invoice:b', open: 50_000n, vatOpen: 0n }],
    1_525_424n,
    'net',
  );
  assert.deepEqual(r, {
    allocations: [
      { document: 'invoice:a', amount: 1_271_186n },
      { document: 'invoice:b', amount: 50_000n },
    ],
    left: 204_238n,
  });
  assert.deepEqual(allocatePayment([], 100n, 'vat'), { allocations: [], left: 100n });
});

test('bank: proportional split always adds up to the total', () => {
  // 500 USD at 1.7 = 850 AZN: 400 + 100 → 680 + 170.
  assert.deepEqual(splitProportionally([40_000n, 10_000n], 50_000n, 85_000n), [68_000n, 17_000n]);
  // Three equal pieces of 1.00 AZN: rounding residue goes to one piece, never lost.
  const pieces = splitProportionally([1n, 1n, 1n], 3n, 100n);
  assert.equal(
    pieces.reduce((s, p) => s + p, 0n),
    100n,
  );
  assert.deepEqual(pieces, [33n, 34n, 33n]);
});

test('statement reader: title block IBAN, balances, debit/credit columns, totals ignored', () => {
  // A Kapital-like export: a title block above the table, debit and credit columns, totals below.
  const rows = [
    ['Hesabdan çıxarış'],
    ['Hesab: AZ12 AIIB 3806 0019 4412 3456 7890', '', 'Valyuta: AZN'],
    ['Dövr: 01.09.2026 - 30.09.2026'],
    ['Əvvələ qalıq:', '', '1 000,00'],
    [],
    [
      'Tarix',
      'Sənəd №',
      'Qarşı tərəf',
      'VÖEN',
      'Qarşı tərəfin hesabı',
      'Debet',
      'Kredit',
      'Təyinat',
    ],
    [
      '15.09.2026',
      'PT-77',
      'ALICI MMC',
      '1700000001',
      'AZ55PAHA40060AZNHC0101091203',
      '',
      '15 254,24',
      'SQ-000001 üzrə ödəniş',
    ],
    ['30.09.2026', '', 'KAPITAL BANK', '', '', '3,00', '', 'Hesabın aparılmasına görə komissiya'],
    ['30.09.2026', 'x', '', '', '', '', '', 'məbləğ yoxdur'],
    ['Cəmi', '', '', '', '', '3,00', '15 254,24'],
    ['Sona qalıq', '', '', '', '', '', '16 251,24'],
  ];
  const r = readStatementTable(rows);
  assert.equal(r.iban, 'AZ12AIIB38060019441234567890');
  assert.deepEqual(
    [r.opening, r.closing, r.from, r.to],
    ['1000.00', '16251.24', '2026-09-15', '2026-09-30'],
  );
  assert.deepEqual(
    r.lines.map((l) => [
      l.row,
      l.date,
      l.direction,
      l.amount,
      l.reference,
      l.counterpartyTaxId,
      l.counterpartyIban,
    ]),
    [
      [7, '2026-09-15', 'in', '15254.24', 'PT-77', '1700000001', 'AZ55PAHA40060AZNHC0101091203'],
      [8, '2026-09-30', 'out', '3.00', '', '', ''],
    ],
  );
  assert.deepEqual(r.problems, [{ row: 9, message: 'Məbləğ oxunmadı.' }]);
  assert.equal(statementAddsUp(r), true);
  assert.equal(statementAddsUp({ ...r, closing: '16000.00' }), false);
});

test('statement reader: one signed amount column, Russian headers, no IBAN, overdraft balance', () => {
  const rows = [
    ['Выписка по счету'],
    ['Входящий остаток', '-50,00'],
    ['Дата', 'Номер', 'Контрагент', 'ИНН', 'Сумма', 'Назначение'],
    ['01/10/2026', '1', 'ООО Поставщик', '1700000002', '-100.50', 'Оплата по счету'],
    ['02/10/2026', '2', 'ООО Покупатель', '', '250', 'Оплата VÖEN 1700000001'],
    ['Исходящий остаток', '99,50'],
  ];
  const r = readStatementTable(rows);
  assert.equal(r.iban, undefined);
  assert.deepEqual([r.opening, r.closing], ['-50.00', '99.50']);
  assert.deepEqual(
    r.lines.map((l) => [l.direction, l.amount, l.counterpartyTaxId]),
    [
      ['out', '100.50', '1700000002'],
      ['in', '250.00', '1700000001'],
    ],
  );
  assert.equal(statementAddsUp(r), true);
});
