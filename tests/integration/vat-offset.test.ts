/**
 * Purchase VAT offset in the month closing (QERARLAR 2026-10-30): an individual entrepreneur is
 * paid VAT through the deposit; VAT paid ahead (an advance) is offset once the e-qaimə is
 * confirmed; what was offset is taken back by the closing when the payment goes down or DVX no
 * longer confirms the e-qaimə.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { EqDocumentInputDto } from '../../src/contracts/commands.js';
import type { ClosingView, DeclarationView, VatOffsetView } from '../../src/contracts/queries.js';
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
/** Debit − credit of 241 for the invoice; and what the closings and ƏƏ- documents offset. */
const left241 = (f: F, id: string) =>
  f.db.get(
    "SELECT COALESCE(SUM(debit-credit),0) AS b FROM registers WHERE account='241' AND s2=?",
    `invoice:${id}`,
  )!.b;
const offsetByClosings = (f: F) =>
  f.db.get(
    `SELECT COALESCE(SUM(p.amount),0) AS a FROM postings p JOIN entries e ON e.id=p.entry_id
     WHERE e.source_type IN ('closing','vatOffset') AND p.dt_account='521.01' AND p.kt_account='241'`,
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
  return { f, bankK, deposit, buy, confirmed, pay, supplier, contract };
}

test('2026-10-31: VAT paid from the current account with the "ƏDV-nin ödənilməsi" item is offset', (t) => {
  const { f, bankK, buy, confirmed, supplier, contract } = setup(t);
  const inv = buy('2026-09-05', 'MT2609001');
  confirmed('MT2609001', '2026-09-05');
  const vatItem = f.item('cashFlowItem', 'ƏDV-nin ödənilməsi (depozitə)');
  // One payment from the current account: 5 000 net and 900 VAT, the VAT line marked.
  const doc = f.bank('out', '2026-09-10', bankK, [
    f.bankLine('531.01', [supplier, contract], '5000'),
    f.bankLine('531.01', [supplier, contract], '900', { cashFlowItem: vatItem }),
  ]);
  const memos = f.db
    .all(
      `SELECT p.memo, p.amount FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE e.source_id=? AND p.dt_account='531.01' ORDER BY p.amount`,
      doc.id,
    )
    .map((r) => [String(r.memo).startsWith('ƏDV ödənişi · '), r.amount]);
  assert.deepEqual(memos, [
    [true, 90000n],
    [false, 500000n],
  ]);
  assert.deepEqual(vat(f, '2026-09'), [['521.01', '241', '900.00']]);
  close(f, '2026-09');
  assert.equal(left241(f, inv.id), 0n);
});

test('2026-10-31: without the item the same payment from the current account offsets nothing', (t) => {
  const { f, bankK, buy, confirmed, supplier, contract } = setup(t);
  buy('2026-09-05', 'MT2609001');
  confirmed('MT2609001', '2026-09-05');
  f.bank('out', '2026-09-10', bankK, [
    f.bankLine('531.01', [supplier, contract], '5000'),
    f.bankLine('531.01', [supplier, contract], '900'),
  ]);
  assert.deepEqual(vat(f, '2026-09'), []);
});

test('audit 2026-10-31: VAT paid ahead with the item from the current account counts once offset', (t) => {
  const { f, bankK, buy, confirmed, supplier, contract } = setup(t);
  const vatItem = f.item('cashFlowItem', 'ƏDV-nin ödənilməsi (depozitə)');
  // An advance before the invoice: 5 000 and, marked, 900 VAT — both from the current account.
  f.bank('out', '2026-09-02', bankK, [
    f.bankLine('531.01', [supplier, contract], '5000'),
    f.bankLine('531.01', [supplier, contract], '900', { cashFlowItem: vatItem }),
  ]);
  const inv = buy('2026-09-05', 'MT2609001'); // the invoice offsets the advance
  confirmed('MT2609001', '2026-09-05');
  assert.deepEqual(vat(f, '2026-09'), [['521.01', '241', '900.00']]);
  close(f, '2026-09');
  assert.equal(left241(f, inv.id), 0n);
});

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

// ---------------------------------------------------------------------------------------------
// The ƏƏ- document: "Doldur", lines by hand, the closing takes it as it is

const doc = (f: F, month: string) =>
  f.query<VatOffsetView>({ type: 'vatOffset', companyId: f.companyId, month });
const save = (f: F, month: string, lines: [string, string][], version?: number) =>
  f.exec({
    type: 'vatOffset.save',
    companyId: f.companyId,
    month,
    ...(version !== undefined ? { version } : {}),
    lines: lines.map(([invoiceId, amount]) => ({ invoiceId, amount })),
  });

test('ƏƏ-: Doldur, then lines added, changed and deleted by hand; the closing takes it as it is', (t) => {
  const { f, bankK, deposit, buy, confirmed, pay } = setup(t);
  const paid = buy('2026-09-05', 'MT2609001');
  confirmed('MT2609001', '2026-09-05');
  pay('2026-09-10', bankK, '5000');
  pay('2026-09-10', deposit, '900');
  // A second one: DVX has not confirmed it, nothing paid through the deposit — by hand only.
  const other = buy('2026-09-20', 'MT2609002');
  const v0 = doc(f, '2026-09');
  assert.equal(v0.posted, null);
  assert.equal(v0.number, 'ƏƏ-2026-09');
  assert.deepEqual(
    v0.proposal.map((l) => [l.invoiceId, l.amount, l.paid, l.confirmed]),
    [[paid.id, '900.00', '900.00', true]],
  );
  assert.deepEqual(
    v0.candidates.map((l) => [l.invoiceId, l.open, l.proposal, l.confirmed]),
    [
      [paid.id, '900.00', '900.00', true],
      [other.id, '900.00', '0.00', false],
    ],
  );
  // Filled, one amount changed, one line added by hand.
  const r1 = save(f, '2026-09', [
    [paid.id, '800'],
    [other.id, '450'],
  ]);
  assert.equal(r1.number, 'ƏƏ-2026-09');
  assert.deepEqual([left241(f, paid.id), left241(f, other.id)], [10000n, 45000n]);
  const v1 = doc(f, '2026-09');
  assert.equal(v1.posted!.total, '1250.00');
  assert.equal(v1.posted!.differs, true);
  assert.deepEqual(
    v1.proposal.map((l) => [l.invoiceId, l.amount]),
    [[paid.id, '900.00']],
    'Doldur leaves the document itself out',
  );
  assert.throws(() => save(f, '2026-09', [[paid.id, '900']]), /artıq uçotdadır/);
  // The first line deleted: storno of the previous postings, the rest posted again.
  const r2 = save(f, '2026-09', [[other.id, '450']], r1.version);
  assert.equal(r2.version, 2);
  assert.deepEqual([left241(f, paid.id), left241(f, other.id)], [90000n, 45000n]);
  // The closing takes the document as it is: nothing more offset, a note that Doldur differs.
  const step = view(f, '2026-09').steps.find((s) => s.key === 'vat')!;
  assert.deepEqual(
    step.postings.map((p) => [p.ktSk[1], p.amount]),
    [[`invoice:${other.id}`, '450.00']],
  );
  assert.match(step.summary, /ƏƏ-2026-09 \(uçotdadır\) · 1 qaimə · 450,00/);
  assert.match(step.notes.join(' '), /"Doldur" indi başqa nəticə verir \(1 qaimə · 900,00\)/);
  close(f, '2026-09');
  assert.deepEqual([left241(f, paid.id), left241(f, other.id)], [90000n, 45000n]);
  assert.throws(() => save(f, '2026-09', [], r2.version), /bağlanıb/);
  // October's Doldur goes on from what September's document offset.
  assert.deepEqual(
    doc(f, '2026-10').proposal.map((l) => [l.invoiceId, l.amount, l.offset]),
    [[paid.id, '900.00', '0.00']],
  );
});

test('ƏƏ-: a line cannot offset more than is on 241, nor take back more than was offset', (t) => {
  const { f, bankK, deposit, buy, confirmed, pay } = setup(t);
  const inv = buy('2026-09-05', 'MT2609001');
  confirmed('MT2609001', '2026-09-05');
  pay('2026-09-10', bankK, '5000');
  pay('2026-09-10', deposit, '900');
  assert.throws(
    () => save(f, '2026-09', [[inv.id, '900.01']]),
    /900\.00 AZN-dir, 900\.01 əvəzləşdirilə bilməz/,
  );
  assert.throws(
    () => save(f, '2026-09', [[inv.id, '-1']]),
    /0\.00 AZN-dir, 1\.00 geri alına bilməz/,
  );
  assert.throws(() => save(f, '2026-09', [[inv.id, '0']]), /sıfır ola bilməz/);
  assert.throws(
    () =>
      save(f, '2026-09', [
        [inv.id, '100'],
        [inv.id, '200'],
      ]),
    /artıq var/,
  );
  // Saving again: the document's own offset is room again (900 → 900 is allowed).
  const r = save(f, '2026-09', [[inv.id, '900']]);
  save(f, '2026-09', [[inv.id, '900']], r.version);
  assert.equal(left241(f, inv.id), 0n);
  // A month later, taking back no more than was offset.
  close(f, '2026-09');
  assert.throws(() => save(f, '2026-10', [[inv.id, '-900.01']]), /geri alına bilməz/);
  save(f, '2026-10', [[inv.id, '-300']]);
  assert.equal(left241(f, inv.id), 30000n);
});

test('ƏƏ-: the closing fills and posts it when there is none; it stays when the closing is cancelled', (t) => {
  const { f, bankK, deposit, buy, confirmed, pay } = setup(t);
  const inv = buy('2026-09-05', 'MT2609001');
  confirmed('MT2609001', '2026-09-05');
  pay('2026-09-10', bankK, '5000');
  pay('2026-09-10', deposit, '900');
  assert.match(
    view(f, '2026-09').steps.find((s) => s.key === 'vat')!.summary,
    /ƏƏ-2026-09 \(uçota alınacaq\) · 1 qaimə · 900,00/,
  );
  close(f, '2026-09');
  const posted = doc(f, '2026-09').posted!;
  assert.deepEqual(
    posted.lines.map((l) => [l.invoiceId, l.amount]),
    [[inv.id, '900.00']],
  );
  assert.equal(posted.differs, false);
  assert.equal(left241(f, inv.id), 0n);
  assert.equal(
    f.db.get(
      `SELECT COUNT(*) AS n FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE e.source_type='closing' AND p.kt_account='241'`,
    )!.n,
    0n,
    'the offset is the document’s, not the closing’s',
  );
  const c = view(f, '2026-09').posted!;
  f.exec({
    type: 'closing.cancel',
    companyId: f.companyId,
    id: c.id,
    version: c.version,
    reason: 'yoxlama',
  });
  assert.equal(doc(f, '2026-09').posted!.id, posted.id, 'the document stays');
  assert.equal(left241(f, inv.id), 0n);
  f.exec({
    type: 'vatOffset.cancel',
    companyId: f.companyId,
    id: posted.id,
    version: posted.version,
    reason: 'yenidən',
  });
  assert.equal(doc(f, '2026-09').posted, null);
  assert.equal(left241(f, inv.id), 90000n);
  close(f, '2026-09');
  assert.equal(left241(f, inv.id), 0n);
  assert.notEqual(doc(f, '2026-09').posted!.id, posted.id);
});

test('ƏƏ-: the ƏDV return of an open month counts the posted document once', (t) => {
  const { f, bankK, deposit, buy, confirmed, pay } = setup(t);
  const inv = buy('2026-09-05', 'MT2609001');
  confirmed('MT2609001', '2026-09-05');
  pay('2026-09-10', bankK, '5000');
  pay('2026-09-10', deposit, '900');
  const figure = (key: string) =>
    f
      .query<DeclarationView>({
        type: 'declaration',
        companyId: f.companyId,
        kind: 'vat',
        period: '2026-09',
      })
      .sections.flatMap((s) => s.rows)
      .find((r) => r.key === key)!.values[0];
  assert.equal(figure('v:offset'), '900.00', 'the plan before the document');
  save(f, '2026-09', [[inv.id, '600']]);
  assert.deepEqual(
    ['v:offset', 'v:waiting'].map((k) => figure(k)),
    ['600.00', '300.00'],
  );
});
