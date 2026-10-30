/**
 * Purchase VAT offset in the month closing (QERARLAR 2026-10-30): an individual entrepreneur is
 * paid VAT through the deposit; VAT paid ahead (an advance) is offset once the e-qaimə is
 * confirmed; what was offset is taken back by the closing when the payment goes down or DVX no
 * longer confirms the e-qaimə.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { EqDocumentInputDto } from '../../src/contracts/commands.js';
import type { ClosingView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;

const view = (f: F, month: string) =>
  f.query<ClosingView>({ type: 'closing', companyId: f.companyId, month });
const close = (f: F, month: string) =>
  f.exec({ type: 'closing.post', companyId: f.companyId, month, acknowledged: true });
const vat = (f: F, month: string) =>
  view(f, month)
    .steps.find((s) => s.key === 'vat')!
    .postings.map((p) => [p.dt, p.kt, p.amount]);
const notes = (f: F, month: string) =>
  view(f, month)
    .steps.find((s) => s.key === 'vat')!
    .notes.join(' ');
/** Debit − credit of 241 for the invoice; and 521.01's debit from the closings. */
const left241 = (f: F, id: string) =>
  f.db.get(
    "SELECT COALESCE(SUM(debit-credit),0) AS b FROM registers WHERE account='241' AND s2=?",
    `invoice:${id}`,
  )!.b;
const offsetByClosings = (f: F) =>
  f.db.get(
    `SELECT COALESCE(SUM(p.amount),0) AS a FROM postings p JOIN entries e ON e.id=p.entry_id
     WHERE e.source_type='closing' AND p.dt_account='521.01' AND p.kt_account='241'`,
  )!.a;

let hash = 0;
function dvx(f: F, documents: Partial<EqDocumentInputDto>[]) {
  f.exec({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: f.companyId,
    direction: 'purchase',
    report: 'invoices',
    source: 'file',
    fileName: `dvx-${++hash}.xlsx`,
    fileHash: String(hash).padStart(64, '0'),
    documents: documents.map((d, i) => ({
      row: i + 2,
      number: '',
      date: '',
      taxId: '',
      name: 'Kontragent',
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
  });
}

function setup(t: Parameters<typeof fixture>[0], kind: 'legal' | 'individual' = 'legal') {
  const f = fixture(t);
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Ağarza Ağalarov', '', 'individual');
  const capitalIn = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const bankK = f.bankAccount(kapital, 'AZ12AIIB38060019441234567890', '223.01', 'AZN', 'Kapital');
  const deposit = f.bankAccount(kapital, 'AZ77AIIB38060019449999999999', '224.04', 'AZN', 'ƏDV');
  const supplier = f.partner('Təkər Sahibkar', '1700000012', kind);
  const contract = f.contract(supplier, 'P-1', 'purchase');
  const tyre = f.product('Təkər', 'ədəd');
  f.operation('2026-08-31', [
    f.line('223.01', [bankK], '301', [founder, capitalIn], '30000'),
    f.line('224.04', [deposit], '301', [founder, capitalIn], '3000'),
  ]);
  close(f, '2026-08');
  const buy = (date: string, eq: string) =>
    f.invoice(
      'purchase',
      date,
      supplier,
      contract,
      [{ productId: tyre, quantity: '10', price: '500' }],
      {
        eqNumber: eq,
      },
    ); // 5 000 + 900 VAT
  const confirmed = (eq: string, date: string, status = 'Təsdiqləndi') =>
    dvx(f, [{ number: eq, date, taxId: '1700000012', net: '5000.00', vat: '900.00', status }]);
  const pay = (
    date: string,
    from: string,
    amount: string,
    direction: 'in' | 'out' = 'out',
    invoice?: string,
  ) =>
    f.bank(direction, date, from, [
      f.bankLine(
        '531.01',
        [supplier, contract, ...(invoice ? [`invoice:${invoice}`] : [])],
        amount,
      ),
    ]);
  return { f, bankK, deposit, buy, confirmed, pay };
}

test('an individual entrepreneur charging VAT: only VAT through the deposit is offset', (t) => {
  const { f, bankK, deposit, buy, confirmed, pay } = setup(t, 'individual');
  const inv = buy('2026-09-05', 'MT2609001');
  confirmed('MT2609001', '2026-09-05');
  // The whole 5 900 from the current account: the VAT has not gone through the deposit.
  pay('2026-09-10', bankK, '5900');
  assert.deepEqual(vat(f, '2026-09'), []);
  assert.match(notes(f, '2026-09'), /1 qaimənin ƏDV-si \(900,00\) hələ ödənilməyib/);
  pay('2026-09-12', deposit, '900');
  assert.deepEqual(vat(f, '2026-09'), [['521.01', '241', '900.00']]);
  close(f, '2026-09');
  assert.equal(left241(f, inv.id), 0n);
});

test('VAT paid ahead through the deposit is offset in the month the e-qaimə is confirmed', (t) => {
  const { f, bankK, deposit, buy, confirmed, pay } = setup(t);
  // September: an advance — 5 000 from the current account, 900 from the deposit; no invoice yet.
  pay('2026-09-10', bankK, '5000');
  pay('2026-09-10', deposit, '900');
  close(f, '2026-09');
  // October: the invoice and its e-qaimə arrive.
  const inv = buy('2026-10-03', 'MT2610001');
  assert.deepEqual(vat(f, '2026-10'), [], 'not offset before DVX confirms it');
  confirmed('MT2610001', '2026-10-03');
  assert.deepEqual(vat(f, '2026-10'), [['521.01', '241', '900.00']]);
  close(f, '2026-10');
  assert.equal(left241(f, inv.id), 0n);
});

test('a refund to the deposit after the offset: the next closing takes the VAT back', (t) => {
  const { f, bankK, deposit, buy, confirmed, pay } = setup(t);
  const inv = buy('2026-09-05', 'MT2609001');
  confirmed('MT2609001', '2026-09-05');
  pay('2026-09-10', bankK, '5000');
  pay('2026-09-10', deposit, '900');
  close(f, '2026-09');
  assert.equal(offsetByClosings(f), 90000n);
  // October: the supplier returns 450 of the VAT to the deposit, against the invoice.
  pay('2026-10-08', deposit, '450', 'in', inv.id);
  assert.deepEqual(vat(f, '2026-10'), [['521.01', '241', '-450.00']]);
  assert.match(
    notes(f, '2026-10'),
    /əvəzləşdirilmiş ƏDV 450,00 geri alınır — ödənilmiş ƏDV azalıb/,
  );
  close(f, '2026-10');
  assert.equal(left241(f, inv.id), 45000n);
  assert.equal(offsetByClosings(f), 45000n);
  // Paid again in November: offset again; nothing taken back twice.
  pay('2026-11-04', deposit, '450', 'out', inv.id);
  assert.deepEqual(vat(f, '2026-11'), [['521.01', '241', '450.00']]);
  close(f, '2026-11');
  assert.equal(left241(f, inv.id), 0n);
  assert.deepEqual(vat(f, '2026-12'), []);
});

test('the accountant already took it back by hand: the closing does not take it back again', (t) => {
  const { f, bankK, deposit, buy, confirmed, pay } = setup(t);
  const inv = buy('2026-09-05', 'MT2609001');
  confirmed('MT2609001', '2026-09-05');
  pay('2026-09-10', bankK, '5000');
  pay('2026-09-10', deposit, '900');
  close(f, '2026-09');
  pay('2026-10-08', deposit, '450', 'in', inv.id);
  const vatTax = f.item('paymentKind', 'Vergi (haqq)');
  const supplier = String(
    f.db.get('SELECT partner_id FROM invoices WHERE id=?', inv.id)!.partner_id,
  );
  const rate = String(
    f.db.get("SELECT s3 FROM registers WHERE account='241' AND s2=? LIMIT 1", `invoice:${inv.id}`)!
      .s3,
  );
  f.operation('2026-10-08', [
    f.line('241', [supplier, `invoice:${inv.id}`, rate], '521.01', [vatTax], '450'),
  ]);
  assert.deepEqual(vat(f, '2026-10'), []);
  close(f, '2026-10');
  assert.equal(left241(f, inv.id), 45000n);
});

test('DVX cancels a confirmed e-qaimə after the offset: the closing takes the VAT back', (t) => {
  const { f, bankK, deposit, buy, confirmed, pay } = setup(t);
  const inv = buy('2026-09-05', 'MT2609001');
  confirmed('MT2609001', '2026-09-05');
  pay('2026-09-10', bankK, '5000');
  pay('2026-09-10', deposit, '900');
  close(f, '2026-09');
  confirmed('MT2609001', '2026-09-05', 'Ləğv edildi');
  assert.deepEqual(vat(f, '2026-10'), [['521.01', '241', '-900.00']]);
  assert.match(notes(f, '2026-10'), /e-qaimə DVX-də artıq təsdiqlənmiş deyil/);
  close(f, '2026-10');
  assert.equal(left241(f, inv.id), 90000n);
  assert.equal(offsetByClosings(f), 0n);
});
