/**
 * Audit 2026-10-31 (0.9.16–0.9.21, independent reviewer): each test failed before its fix
 * (0.9.22). Made-up names and numbers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { EqDocumentInputDto, StatementLineInput } from '../../src/contracts/commands.js';
import type { ClosingView, VatOffsetView } from '../../src/contracts/queries.js';
import { partnerByName, partnerNameKey } from '../../src/domain/statement.js';
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
const offsetTotal = (f: F, id: string) =>
  f.db.get(
    `SELECT COALESCE(SUM(amount),0) AS a FROM postings
     WHERE dt_account='521.01' AND kt_account='241' AND kt_s2=?`,
    `invoice:${id}`,
  )!.a;
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

let hash = 5000;
function dvx(f: F, documents: Partial<EqDocumentInputDto>[]) {
  f.exec({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: f.companyId,
    direction: 'purchase',
    report: 'invoices',
    source: 'file',
    fileName: `audit-${++hash}.xlsx`,
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
  const founder = f.partner('Test Təsisçi', '', 'individual');
  const capitalIn = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const bankK = f.bankAccount(bankP, 'AZ12TEST38060019441234567890', '223.01', 'AZN', 'Cari');
  const deposit = f.bankAccount(bankP, 'AZ77TEST38060019449999999999', '224.04', 'AZN', 'ƏDV');
  const supplier = f.partner('Nümunə Təchizat MMC', '1700000099');
  const contract = f.contract(supplier, 'P-9', 'purchase');
  const good = f.product('Nümunə mal', 'ədəd');
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
      [{ productId: good, quantity: '10', price: '500' }],
      {
        eqNumber: eq,
      },
    ); // 5 000 + 900 VAT
  const confirmed = (eq: string, date: string) =>
    dvx(f, [{ number: eq, date, taxId: '1700000099', net: '5000.00', vat: '900.00' }]);
  const pay = (date: string, from: string, amount: string, invoice?: string) =>
    f.bank('out', date, from, [
      f.bankLine(
        '531.01',
        [supplier, contract, ...(invoice ? [`invoice:${invoice}`] : [])],
        amount,
      ),
    ]);
  return { f, bankK, deposit, buy, confirmed, pay, supplier, contract };
}

test('D1: a later month’s ƏƏ- posted first — the earlier month’s closing offsets the same VAT again', (t) => {
  const { f, bankK, deposit, buy, confirmed, pay } = setup(t);
  const inv = buy('2026-09-05', 'AA2609001');
  confirmed('AA2609001', '2026-09-05');
  pay('2026-09-10', bankK, '5000');
  pay('2026-09-10', deposit, '900');
  // October's document is filled and saved while September is still open.
  const oct = doc(f, '2026-10').proposal.map((l): [string, string] => [l.invoiceId, l.amount]);
  assert.deepEqual(oct, [[inv.id, '900.00']]);
  save(f, '2026-10', oct);
  assert.equal(left241(f, inv.id), 0n);
  // September's closing would not see October's document: it is refused instead of offsetting
  // 900 again, and so is a September document typed by hand.
  assert.throws(() => close(f, '2026-09'), /ƏƏ-2026-10 uçotdadır, ƏƏ-2026-09 isə yoxdur/);
  assert.throws(() => save(f, '2026-09', [[inv.id, '900']]), /ƏƏ-2026-10 artıq uçotdadır/);
  assert.equal(offsetTotal(f, inv.id), 90000n, 'VAT offset once');
  assert.equal(left241(f, inv.id), 0n);
  // Cancelled, the months go in order: September offsets it, October has nothing left.
  const posted = doc(f, '2026-10').posted!;
  f.exec({
    type: 'vatOffset.cancel',
    companyId: f.companyId,
    id: posted.id,
    version: posted.version,
    reason: 'ardıcıl',
  });
  close(f, '2026-09');
  assert.equal(offsetTotal(f, inv.id), 90000n);
  assert.deepEqual(doc(f, '2026-10').proposal, []);
});

test('D2: a manual extra offset is taken back by the rule in the next month', (t) => {
  const { f, bankK, deposit, buy, confirmed, pay } = setup(t);
  const inv = buy('2026-09-05', 'AA2609002');
  confirmed('AA2609002', '2026-09-05');
  pay('2026-09-10', bankK, '5000');
  pay('2026-09-10', deposit, '500');
  close(f, '2026-09'); // the rule offsets 500
  assert.equal(offsetTotal(f, inv.id), 50000n);
  // October: the accountant offsets the other 400 by hand (a decision of his own).
  assert.deepEqual(doc(f, '2026-10').proposal, []);
  save(f, '2026-10', [[inv.id, '400']]);
  close(f, '2026-10');
  assert.equal(offsetTotal(f, inv.id), 90000n);
  // November: nothing changed, yet the rule takes the hand-made 400 back (from its own 500).
  assert.deepEqual(vat(f, '2026-11'), [], 'the manual line is taken back by the rule');
});

test('D4: a VAT-item line placed before the net line leaves part of the net payment unsettled', (t) => {
  const { f, bankK, buy, confirmed, supplier, contract } = setup(t);
  const inv = buy('2026-09-05', 'AA2609004');
  confirmed('AA2609004', '2026-09-05');
  const vatItem = f.item('cashFlowItem', 'ƏDV-nin ödənilməsi (depozitə)');
  const d = f.bank('out', '2026-09-10', bankK, [
    f.bankLine('531.01', [supplier, contract], '900', { cashFlowItem: vatItem }),
    f.bankLine('531.01', [supplier, contract], '5000'),
  ]);
  const onInvoice = f.db.get(
    `SELECT COALESCE(SUM(p.amount),0) AS a FROM postings p JOIN entries e ON e.id=p.entry_id
     WHERE e.source_id=? AND p.dt_account='531.01' AND p.dt_s3=?`,
    d.id,
    `invoice:${inv.id}`,
  )!.a;
  assert.equal(onInvoice, 590000n, 'the whole 5 900 settles the invoice');
});

test('D5: a foreign counterparty IBAN typed on import is dropped (regex "d{2}" instead of "\\d{2}")', (t) => {
  const f = fixture(t);
  const bankP = f.partner('Test Bank ASC', '9900000001');
  const iban = 'AZ12TEST38060019441234567890';
  f.bankAccount(bankP, iban, '223.01', 'AZN', 'Cari');
  const line: StatementLineInput = {
    row: 2,
    date: '2026-10-05',
    direction: 'out',
    amount: '100',
    reference: 'R-1',
    counterparty: 'FOREIGN SAMPLE LTD',
    counterpartyTaxId: '',
    counterpartyIban: 'TR330006100519786457841326',
    purpose: 'invoice 1',
  };
  f.exec({
    type: 'statement.import',
    companyId: f.companyId,
    iban,
    fileName: 'audit.xlsx',
    fileHash: 'b'.repeat(64),
    lines: [line],
  });
  const stored = f.db.get('SELECT counterparty_iban FROM statement_lines')!.counterparty_iban;
  assert.equal(stored, 'TR330006100519786457841326');
});

test('D6: fuzzy name matching takes a different individual (other patronymic) for the partner', () => {
  const byKey = new Map([[partnerNameKey('Məmmədov Elçin Vaqif oğlu'), 'P1']]);
  assert.equal(partnerByName('MAMMADOV ELCHIN ALI OGLU', byKey), undefined);
  const byKey2 = new Map([[partnerNameKey('"Kaspi Trans Servis" MMC'), 'P2']]);
  assert.equal(partnerByName('KASPI TRANS LOGISTIKA LLC', byKey2), undefined);
  // The right one still found: shortened, in Latin letters, without the legal form.
  const byKey3 = new Map([
    [partnerNameKey('"ŞƏRQ DAŞIMA XİDMƏTLƏRİ" Məhdud Məsuliyyətli Cəmiyyəti'), 'P3'],
  ]);
  assert.equal(partnerByName('SHARQ DASHIMA XIDMATLARI MMC', byKey3), 'P3');
});

test('order: a prepayment typed after its invoice is offset by the invoice (543 → 211)', (t) => {
  const f = fixture(t);
  const bank = f.partner('Nümunə Bank ASC', '9900000001');
  const acc = f.bankAccount(bank, 'AZ11TEST00000000000000000011', '223.01', 'AZN', 'Bank');
  const customer = f.partner('Alıcı Bir MMC', '1700000101');
  const contract = f.contract(customer, 'S-1', 'sale');
  const service = f.product('Daşıma', 'reys', 'service');
  // The e-qaimə of 05.10 is booked first; the statement with the payment of 02.10 comes later.
  const inv = f.invoice('sale', '2026-10-05', customer, contract, [
    { productId: service, price: '1000', vatRate: '0' },
  ]);
  f.bank('in', '2026-10-02', acc, [f.bankLine('211.01', [customer, contract], '1000')]);
  const balance = (account: string, document: string) =>
    f.db.get(
      `SELECT COALESCE(SUM(a),0) AS a FROM (
         SELECT amount AS a FROM postings WHERE dt_account=? AND dt_s3=?
         UNION ALL SELECT -amount FROM postings WHERE kt_account=? AND kt_s3=?)`,
      account,
      document,
      account,
      document,
    )!.a;
  assert.equal(balance('211.01', `invoice:${inv.id}`), 0n, 'the invoice is paid by the advance');
  assert.equal(
    f.db.get("SELECT COALESCE(SUM(-amount),0) AS a FROM postings WHERE kt_account='543.01'")!.a !==
      0n,
    true,
    'the advance was there',
  );
  const advanceLeft = f.db.get(
    `SELECT COALESCE(SUM(a),0) AS a FROM (
       SELECT -amount AS a FROM postings WHERE kt_account='543.01'
       UNION ALL SELECT amount FROM postings WHERE dt_account='543.01')`,
  )!.a;
  assert.equal(advanceLeft, 0n, 'nothing left on 543');
  assert.equal(
    f.db.get('SELECT version FROM invoices WHERE id=?', inv.id)!.version,
    2n,
    'posted again (storno + new)',
  );
});
