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
