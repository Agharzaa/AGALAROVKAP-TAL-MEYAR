/**
 * Stage 9 — the figures of the tax returns (docs/MERHELE-9-VERGI-BEYANNAMELERI.md §7).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  DeclarationKind,
  DeclarationView,
  VatSummaryView,
} from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;

export const declaration = (f: F, kind: DeclarationKind, period: string) =>
  f.query<DeclarationView>({ type: 'declaration', companyId: f.companyId, kind, period });
/** The values of a row, found by its key in any section. */
export const figures = (v: DeclarationView, key: string) => {
  for (const s of v.sections) {
    const r = s.rows.find((x) => x.key === key);
    if (r) return r.values;
  }
  throw new Error(`row ${key} not found`);
};

function dvx(
  f: F,
  direction: 'sale' | 'purchase',
  number: string,
  taxId: string,
  net: string,
  vat: string,
  date = '2026-09-05',
) {
  f.exec({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: f.companyId,
    direction,
    report: 'invoices',
    source: 'file',
    fileName: `${direction}-${number}.xlsx`,
    fileHash: Buffer.from(number).toString('hex').padStart(64, '0'),
    documents: [
      {
        row: 2,
        number,
        date,
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

export function september(f: F) {
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Təsisçi', '', 'individual');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const supplier = f.partner('Təchizat ASC', '1700000002');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const exporter = f.partner('Xarici Alıcı LLC', '1700000005');
  const cp = f.contract(supplier, 'P-1', 'purchase');
  const cs = f.contract(customer, 'S-1', 'sale');
  const ce = f.contract(exporter, 'E-1', 'sale');
  const paper = f.product('Kağız A4', 'qutu');
  const consulting = f.product('Konsaltinq', 'saat', 'service');
  const bank = f.bankAccount(kapital, 'AZ12AIIB38060019441234567890');
  const deposit = f.bankAccount(kapital, 'AZ77AIIB38060019449999999999', '224.04', 'AZN', 'ƏDV');
  f.operation('2026-08-31', [
    f.line('223.01', [bank], '301', [founder, capital], '5000'),
    f.line('224.04', [deposit], '301', [founder, capital], '500'),
  ]);
  f.exec({ type: 'closing.post', companyId: f.companyId, month: '2026-08', acknowledged: false });
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
  f.invoice('sale', '2026-09-08', exporter, ce, [
    { productId: consulting, quantity: '3', price: '100', vatRate: '0' },
  ]);
  dvx(f, 'purchase', 'MT0001', '1700000002', '1000.00', '180.00');
  dvx(f, 'sale', 'AA0001', '1700000001', '2000.00', '360.00');
  const B = f.bankLine;
  f.bank('out', '2026-09-10', bank, [B('531.01', [supplier, cp], '1000')]);
  f.bank('out', '2026-09-10', deposit, [B('531.01', [supplier, cp], '180')]);
  return { bank, deposit };
}

test('V1: ƏDV return — sales by rate, accrued, offset by the closing, 521.01 reconciles', (t) => {
  const f = fixture(t);
  september(f);
  const before = declaration(f, 'vat', '2026-09');
  assert.deepEqual(figures(before, 's:18'), ['2000.00', '360.00']);
  assert.deepEqual(figures(before, 's:0'), ['300.00', '']);
  assert.deepEqual(figures(before, 's:exempt'), ['50.00', '']);
  assert.deepEqual(figures(before, 's:nontaxable'), ['0.00', '']);
  assert.deepEqual(figures(before, 's:total'), ['2350.00', '360.00']);
  assert.deepEqual(
    ['v:accrued', 'v:purchase', 'v:offset', 'v:waiting', 'v:payable'].map(
      (k) => figures(before, k)[0],
    ),
    // The open month shows what its closing plan offsets (audit 0.9.9, plan §5.1).
    ['360.00', '180.00', '180.00', '0.00', '180.00'],
  );
  assert.ok(before.checks.some((c) => /bağlanmayıb/.test(c.text)));
  // VM 175: exempt sales and purchase VAT — the taxable share 2 300 / 2 350.
  assert.ok(before.checks.some((c) => /VM 175/.test(c.text) && /97,87%/.test(c.text)));

  f.exec({ type: 'closing.post', companyId: f.companyId, month: '2026-09', acknowledged: true });
  const after = declaration(f, 'vat', '2026-09');
  assert.deepEqual(
    ['v:offset', 'v:waiting', 'v:payable'].map((k) => figures(after, k)[0]),
    ['180.00', '0.00', '180.00'],
  );
  assert.ok(!after.checks.some((c) => /bağlanmayıb/.test(c.text)));
  // The same figures as ƏDV icmalı.
  const s = f.query<VatSummaryView>({
    type: 'vatSummary',
    companyId: f.companyId,
    month: '2026-09',
  });
  assert.deepEqual(
    [s.salesVat, s.purchaseVat, s.offset, s.payable],
    ['v:accrued', 'v:purchase', 'v:offset', 'v:payable'].map((k) => figures(after, k)[0]),
  );
  // 521.01: 0 + 360 − 180 − 0 = 180.
  assert.deepEqual(
    ['l:opening', 'l:credit', 'l:offset', 'l:paid', 'l:closing'].map((k) => figures(after, k)[0]),
    ['0.00', '360.00', '180.00', '0.00', '180.00'],
  );
  assert.ok(!after.checks.some((c) => /kredit dövriyyəsi/.test(c.text)));
});

test('V2: ƏDV return — appendices by invoice; more offset than accrued carries over', (t) => {
  const f = fixture(t);
  const accounts = september(f);
  const v = declaration(f, 'vat', '2026-09');
  const zero = v.appendices.find((a) => a.title.includes('0%'))!;
  assert.deepEqual(
    zero.rows.map((r) => [r[2], r[3], r[4]]),
    [['Xarici Alıcı LLC', '1700000005', '300.00']],
  );
  const exempt = v.appendices.find((a) => a.title.includes('azad'))!;
  assert.deepEqual(
    exempt.rows.map((r) => [r[2], r[4]]),
    [['Alıcı MMC', '50.00']],
  );
  assert.equal(v.appendices.length, 4, 'no list for a rate without sales; two offset lists');
  // The incoming e-qaimə paid through the deposit: offset by the plan of the open month.
  const list = (d: DeclarationView, title: string) =>
    d.appendices.find((a) => a.title.startsWith(title))!;
  assert.deepEqual(
    list(v, 'Əvəzləşdirilən').rows.map((r) => [r[2], r[3], r[4], r[5], r[6]]),
    [['Təchizat ASC', '1700000002', 'MT0001', '180.00', '180.00']],
  );
  assert.match(list(v, 'Əvəzləşdirilən').title, /bağlanışın planı/);
  assert.deepEqual(list(v, 'Əvəzləşdirilməyən').rows, []);

  // October: a purchase only, paid through the deposit — the offset exceeds what is accrued.
  const supplier = f.partner('Təchizat 2', '1700000012');
  const cp = f.contract(supplier, 'P-2', 'purchase');
  const fuel = f.product('Yanacaq', 'litr');
  f.invoice(
    'purchase',
    '2026-10-03',
    supplier,
    cp,
    [{ productId: fuel, quantity: '100', price: '1' }],
    {
      eqNumber: 'MT0002',
    },
  );
  dvx(f, 'purchase', 'MT0002', '1700000012', '100.00', '18.00', '2026-10-03');
  f.bank('out', '2026-10-05', accounts.bank, [f.bankLine('531.01', [supplier, cp], '100')]);
  f.bank('out', '2026-10-05', accounts.deposit, [f.bankLine('531.01', [supplier, cp], '18')]);
  // Two more: confirmed in DVX but its VAT not paid; and one with no e-qaimə at all.
  f.invoice(
    'purchase',
    '2026-10-07',
    supplier,
    cp,
    [{ productId: fuel, quantity: '200', price: '1' }],
    {
      eqNumber: 'MT0003',
    },
  );
  dvx(f, 'purchase', 'MT0003', '1700000012', '200.00', '36.00', '2026-10-07');
  f.invoice('purchase', '2026-10-09', supplier, cp, [
    { productId: fuel, quantity: '50', price: '1' },
  ]);
  f.exec({ type: 'closing.post', companyId: f.companyId, month: '2026-09', acknowledged: true });
  f.exec({ type: 'closing.post', companyId: f.companyId, month: '2026-10', acknowledged: true });
  const october = declaration(f, 'vat', '2026-10');
  const payable = october.sections[1]!.rows.find((r) => r.key === 'v:payable')!;
  assert.deepEqual([payable.label, payable.values[0]], ['Artıq — növbəti aya keçir', '18.00']);
  // 521.01: September's 180 owed, October's offset 18 → 162.
  assert.deepEqual(
    ['l:opening', 'l:credit', 'l:offset', 'l:closing'].map((k) => figures(october, k)[0]),
    ['180.00', '0.00', '18.00', '162.00'],
  );
  assert.deepEqual(
    list(october, 'Əvəzləşdirilən').rows.map((r) => [r[4], r[6]]),
    [['MT0002', '18.00']],
  );
  assert.doesNotMatch(list(october, 'Əvəzləşdirilən').title, /plan/);
  assert.deepEqual(
    list(october, 'Əvəzləşdirilməyən').rows.map((r) => [r[4], r[5], r[6]]),
    [
      ['MT0003', '36.00', 'ƏDV depozitdən ödənilməyib'],
      ['', '9.00', 'e-qaimə bağlanmayıb'],
    ],
  );
  assert.throws(() => declaration(f, 'vat', '2026-13'), /Ay/);
});
