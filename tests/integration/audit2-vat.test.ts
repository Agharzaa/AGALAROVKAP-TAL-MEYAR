/**
 * Audit 2 (VAT and e-qaimələr, chief-accountant review). Each test states what the books should
 * show; a failing test is a proven defect. Made-up names, VÖENs and IBANs.
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
const left241 = (f: F, id: string) =>
  f.db.get(
    "SELECT COALESCE(SUM(debit-credit),0) AS b FROM registers WHERE account='241' AND s2=?",
    `invoice:${id}`,
  )!.b;
const save = (f: F, month: string, lines: [string, string][], version?: number) =>
  f.exec({
    type: 'vatOffset.save',
    companyId: f.companyId,
    month,
    ...(version !== undefined ? { version } : {}),
    lines: lines.map(([invoiceId, amount]) => ({ invoiceId, amount })),
  });

let hash = 9100;
function dvx(f: F, documents: Partial<EqDocumentInputDto>[]) {
  f.exec({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: f.companyId,
    direction: 'purchase',
    report: 'invoices',
    source: 'file',
    fileName: `audit2-${++hash}.xlsx`,
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

function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t);
  const bankP = f.partner('Test Bank ASC', '9900000001');
  const founder = f.partner('Təsisçi Test', '', 'individual');
  const capitalIn = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const bankK = f.bankAccount(bankP, 'AZ00TEST00000000000000000001', '223.01', 'AZN', 'Cari');
  const deposit = f.bankAccount(bankP, 'AZ00TEST00000000000000000002', '224.04', 'AZN', 'ƏDV');
  const supplier = f.partner('Alfa Təchizat MMC', '1700000091');
  const contract = f.contract(supplier, 'P-A', 'purchase');
  const other = f.partner('Beta Servis MMC', '1700000081');
  const otherContract = f.contract(other, 'P-B', 'purchase');
  const tyre = f.product('Təkər', 'ədəd');
  f.operation('2026-08-31', [
    f.line('223.01', [bankK], '301', [founder, capitalIn], '30000'),
    f.line('224.04', [deposit], '301', [founder, capitalIn], '3000'),
  ]);
  close(f, '2026-08');
  const buy = (date: string, eq: string, partner = supplier, c = contract) =>
    f.invoice('purchase', date, partner, c, [{ productId: tyre, quantity: '10', price: '500' }], {
      eqNumber: eq,
    }); // 5 000 + 900 VAT
  const confirmed = (eq: string, date: string, taxId = '1700000091') =>
    dvx(f, [{ number: eq, date, taxId, net: '5000.00', vat: '900.00' }]);
  const vatItem = f.item('cashFlowItem', 'ƏDV-nin ödənilməsi (depozitə)');
  return { f, bankK, deposit, buy, confirmed, supplier, contract, other, otherContract, vatItem };
}

// ---------------------------------------------------------------------------------------------
// D1: depositPaid treats a whole advance as VAT when any line of its bank document carries the
// "ƏDV-nin ödənilməsi" item.

test('audit2 D1a (2026-11-01 §9): an advance of 5 090 offsets its share of the 900 VAT', (t) => {
  const { f, bankK, buy, confirmed, supplier, contract, vatItem } = setup(t);
  // One advance from the current account: 5 000 unmarked, 90 marked as VAT.
  f.bank('out', '2026-09-02', bankK, [
    f.bankLine('531.01', [supplier, contract], '5000'),
    f.bankLine('531.01', [supplier, contract], '90', { cashFlowItem: vatItem }),
  ]);
  const inv = buy('2026-09-05', 'MT2609101'); // offsets the 5 090 advance
  confirmed('MT2609101', '2026-09-05');
  // 5 090 of 5 900 is paid, marked or not: 5 090 / 5 900 of the VAT.
  assert.deepEqual(vat(f, '2026-09'), [['521.01', '241', '776.44']]);
  close(f, '2026-09');
  assert.equal(left241(f, inv.id), 12356n);
});

test('audit2 D1b (2026-11-01 §9): an unmarked advance paying the whole invoice offsets its VAT', (t) => {
  const { f, bankK, buy, confirmed, supplier, contract, other, otherContract, vatItem } = setup(t);
  // One payment order batch: Alfa gets an ordinary 5 900 advance from the current account;
  // Beta gets 180 marked as VAT. Nothing of Alfa's VAT went as VAT.
  f.bank('out', '2026-09-02', bankK, [
    f.bankLine('531.01', [supplier, contract], '5900'),
    f.bankLine('531.01', [other, otherContract], '180', { cashFlowItem: vatItem }),
  ]);
  const inv = buy('2026-09-05', 'MT2609102');
  confirmed('MT2609102', '2026-09-05');
  // Alfa's 5 900 pays the invoice in full: its 900 is offset.
  assert.deepEqual(vat(f, '2026-09'), [['521.01', '241', '900.00']]);
  close(f, '2026-09');
  assert.equal(left241(f, inv.id), 0n);
});

// ---------------------------------------------------------------------------------------------
// D2: a purchase invoice cancelled after its VAT was offset by the ƏƏ- document keeps the VAT
// offset for ever: vatStep only looks at status='posted' invoices, so nothing is taken back.

test('audit2 D2: VAT offset of an invoice cancelled afterwards is taken back by a later closing', (t) => {
  const { f, bankK, deposit, buy, confirmed, supplier, contract } = setup(t);
  // September: advance 5 000 current + 900 deposit.
  f.bank('out', '2026-09-10', bankK, [f.bankLine('531.01', [supplier, contract], '5000')]);
  f.bank('out', '2026-09-10', deposit, [f.bankLine('531.01', [supplier, contract], '900')]);
  close(f, '2026-09');
  const inv = buy('2026-10-03', 'MT2610101');
  confirmed('MT2610101', '2026-10-03');
  save(f, '2026-10', [[inv.id, '900.00']]); // ƏƏ-2026-10 offsets 900
  assert.equal(left241(f, inv.id), 0n);
  // The goods were never delivered: the invoice is cancelled (October is open).
  f.exec({
    type: 'invoice.cancel',
    companyId: f.companyId,
    id: inv.id,
    version: 1,
    reason: 'mal gəlmədi',
  });
  close(f, '2026-10');
  // 241 for a cancelled invoice is −900 and 521.01 is short of 900; November must take it back.
  close(f, '2026-11');
  assert.equal(left241(f, inv.id), 0n, '241 of the cancelled invoice must be back to zero');
});

// ---------------------------------------------------------------------------------------------
// D3: a hand-set ƏƏ- line stays offset after DVX cancels the e-qaimə — and nothing says so.

test('audit2 D3: hand-offset VAT of an e-qaimə DVX later cancels is taken back or flagged', (t) => {
  const { f, bankK, deposit, buy, supplier, contract } = setup(t);
  const inv = buy('2026-09-05', 'MT2609103');
  dvx(f, [
    { number: 'MT2609103', date: '2026-09-05', taxId: '1700000091', net: '5000.00', vat: '900.00' },
  ]);
  f.bank('out', '2026-09-10', bankK, [f.bankLine('531.01', [supplier, contract], '5000')]);
  f.bank('out', '2026-09-10', deposit, [f.bankLine('531.01', [supplier, contract], '900')]);
  save(f, '2026-09', [[inv.id, '500.00']]); // by hand: 500 of 900
  close(f, '2026-09');
  // October: DVX cancels the e-qaimə.
  dvx(f, [
    {
      number: 'MT2609103',
      date: '2026-09-05',
      taxId: '1700000091',
      net: '5000.00',
      vat: '900.00',
      status: 'Ləğv edildi',
    },
  ]);
  const step = view(f, '2026-10').steps.find((s) => s.key === 'vat')!;
  const taken = step.postings.reduce((s, p) => s + Number(p.amount), 0);
  const text = [...step.notes, ...view(f, '2026-10').warnings.map((w) => w.text)].join(' ');
  assert.ok(
    taken === -500 || /500,00/.test(text),
    `500 offset on a cancelled e-qaimə: neither taken back nor flagged. Notes: ${text}`,
  );
});
