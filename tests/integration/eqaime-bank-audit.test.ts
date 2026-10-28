/**
 * E-qaimə and bank audit (29.10.2026, 0.9.10): regressions found by an independent reviewer.
 * Each test failed before its fix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { EqDocumentInputDto } from '../../src/contracts/commands.js';
import type { EqInboxView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;
type Dir = 'sale' | 'purchase';
const SUPPLIER = '1700000001';
let files = 0;

const doc = (
  number: string,
  date: string,
  taxId: string,
  extra: Partial<EqDocumentInputDto> = {},
) =>
  ({
    row: 2,
    number,
    date,
    taxId,
    name: `Kontragent ${taxId}`,
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
    ...extra,
  }) satisfies EqDocumentInputDto;

function load(f: F, direction: Dir, documents: EqDocumentInputDto[]) {
  return f.exec({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: f.companyId,
    direction,
    report: 'invoices',
    source: 'file',
    fileName: `audit-${++files}.xlsx`,
    fileHash: String(files).padStart(64, 'a'),
    documents,
  });
}
const byNumber = (f: F, number: string, direction: Dir = 'purchase') =>
  f
    .query<EqInboxView>({ type: 'eqInbox', companyId: f.companyId, direction, from: '', to: '' })
    .documents.find((d) => d.number === number)!;

test('audit: DVX cancels an e-qaimə in a file whose amounts differ by a qəpik — the cancel is not lost', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Kağız Təchizat MMC', SUPPLIER);
  const contract = f.contract(supplier, 'A-1', 'purchase');
  const service = f.product('Rabitə xidməti', 'ay', 'service');
  const item = f.item('expenseItem', 'Rabitə');
  const e = (number: string, net: string, status = 'Təsdiqləndi') =>
    doc(number, '2026-09-05', SUPPLIER, {
      net,
      vat: '18.00',
      total: '',
      base18: net,
      status,
    });
  load(f, 'purchase', [e('MT1', '100.00'), e('MT2', '100.00')]);
  // MT1 is booked by hand; MT2 still waits.
  f.invoice(
    'purchase',
    '2026-09-05',
    supplier,
    contract,
    [{ productId: service, price: '100', expenseItemId: item }],
    { eqNumber: 'MT1', eqDocumentId: byNumber(f, 'MT1').id },
  );
  assert.equal(byNumber(f, 'MT1').bucket, 'posted');
  // Another DVX report prints the amounts a qəpik apart (its own rounding) and both cancelled.
  load(f, 'purchase', [e('MT1', '100.01', 'Ləğv edildi'), e('MT2', '100.01', 'Ləğv edildi')]);
  const one = byNumber(f, 'MT1');
  const two = byNumber(f, 'MT2');
  // DVX's word on the status still counts: cancelled.
  assert.deepEqual([one.status, two.status], ['cancelled', 'cancelled']);
  assert.equal(one.bucket, 'conflict');
  // A waiting e-qaimə DVX cancelled is set aside, not offered for booking.
  assert.equal(f.db.get('SELECT state FROM eq_documents WHERE id=?', two.id)!.state, 'ignored');
});

/** Balance of one settlement key (Dt − Kt) in the ledger. */
const keyBalance = (f: F, account: string, document: string) =>
  f.db.get(
    `SELECT COALESCE(SUM(a),0) AS a FROM (
       SELECT amount AS a FROM postings WHERE company_id=? AND dt_account=? AND dt_s3=?
       UNION ALL SELECT -amount FROM postings WHERE company_id=? AND kt_account=? AND kt_s3=?)`,
    f.companyId,
    account,
    document,
    f.companyId,
    account,
    document,
  )!.a as bigint;

test('audit: two automatic lines of one bank document never settle the same invoice twice', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Kağız Təchizat MMC', SUPPLIER);
  const contract = f.contract(supplier, 'A-1', 'purchase');
  const service = f.product('Rabitə xidməti', 'ay', 'service');
  const item = f.item('expenseItem', 'Rabitə');
  const bankPartner = f.partner('Kapital Bank', '9900003611');
  const current = f.bankAccount(bankPartner, 'AZ12AIIB38060019441234567890');
  const inv = (date: string) =>
    f.invoice('purchase', date, supplier, contract, [
      { productId: service, price: '100', vatRate: '0', expenseItemId: item },
    ]).id;
  const a = inv('2026-09-01');
  const b = inv('2026-09-02');
  // One payment order, two lines (say, two cash-flow items): 100 + 100 for the two invoices.
  f.bank('out', '2026-09-10', current, [
    f.bankLine('531.01', [supplier, contract], '100'),
    f.bankLine('531.01', [supplier, contract], '100'),
  ]);
  // Both invoices are paid; none is overpaid, nothing left as an advance.
  assert.deepEqual(
    [keyBalance(f, '531.01', `invoice:${a}`), keyBalance(f, '531.01', `invoice:${b}`)],
    [0n, 0n],
  );
});

test('audit: two lines of one VAT deposit payment pay the VAT of two invoices, not one twice', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Kağız Təchizat MMC', SUPPLIER);
  const contract = f.contract(supplier, 'A-1', 'purchase');
  const service = f.product('Rabitə xidməti', 'ay', 'service');
  const item = f.item('expenseItem', 'Rabitə');
  const bankPartner = f.partner('Kapital Bank', '9900003611');
  const deposit = f.bankAccount(bankPartner, 'AZ12AIIB38060019441234567891', '224.04');
  const inv = (date: string) =>
    f.invoice('purchase', date, supplier, contract, [
      { productId: service, price: '100', expenseItemId: item },
    ]).id;
  const a = inv('2026-09-01');
  const b = inv('2026-09-02');
  f.bank('out', '2026-09-10', deposit, [
    f.bankLine('531.01', [supplier, contract], '18'),
    f.bankLine('531.01', [supplier, contract], '18'),
  ]);
  // Each invoice: 118 owed, its 18 of VAT paid from the deposit — 100 still owed on each.
  assert.deepEqual(
    [keyBalance(f, '531.01', `invoice:${a}`), keyBalance(f, '531.01', `invoice:${b}`)],
    [-10000n, -10000n],
  );
});

test('audit: the e-qaimə a correction replaced comes back when DVX cancels that correction', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Kağız Təchizat MMC', SUPPLIER);
  const contract = f.contract(supplier, 'A-1', 'purchase');
  const service = f.product('Rabitə xidməti', 'ay', 'service');
  const item = f.item('expenseItem', 'Rabitə');
  const original = doc('MT1', '2026-09-05', SUPPLIER, {
    net: '100.00',
    vat: '18.00',
    base18: '100.00',
  });
  const correction = (status: string) =>
    doc('MT9', '2026-09-08', SUPPLIER, {
      net: '90.00',
      vat: '16.20',
      base18: '90.00',
      kind: 'Düzəliş qaiməsi',
      refNumber: 'MT1',
      status,
    });
  load(f, 'purchase', [original, correction('Təsdiqləndi')]);
  // The correction is booked in place of the original, which steps aside.
  const inv = f.invoice(
    'purchase',
    '2026-09-08',
    supplier,
    contract,
    [{ productId: service, price: '90', expenseItemId: item }],
    { eqNumber: 'MT9', eqDocumentId: byNumber(f, 'MT9').id },
  );
  assert.equal(byNumber(f, 'MT1').bucket, 'ignored');
  // The buyer refuses the correction in DVX: the original stands again. The accountant cancels
  // the correction's invoice…
  load(f, 'purchase', [original, correction('İmtina edildi')]);
  assert.equal(byNumber(f, 'MT9').bucket, 'conflict');
  f.exec({
    type: 'invoice.cancel',
    companyId: f.companyId,
    id: inv.id,
    version: inv.version!,
    reason: 'DVX-də düzəlişdən imtina',
  });
  // …and the original waits to be booked (DVX ↔ uçot counts it as not booked).
  assert.equal(byNumber(f, 'MT1').bucket, 'proposal');
  const r = f.query<{ notBooked: { number: string }[] }>({
    type: 'eqReconcile',
    companyId: f.companyId,
    direction: 'purchase',
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.deepEqual(
    r.notBooked.map((x) => x.number),
    ['MT1'],
  );
});
