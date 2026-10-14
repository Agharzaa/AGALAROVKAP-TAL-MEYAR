import test from 'node:test';
import assert from 'node:assert/strict';
import type { StatementLineInput } from '../../src/contracts/commands.js';
import type {
  BankDocumentDetail,
  StatementImportView,
  StatementView,
} from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;
const IBAN = 'AZ12AIIB38060019441234567890';
const HASH = 'a'.repeat(64);

function setup(f: F) {
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const account = f.bankAccount(bank, IBAN, '223.01', 'AZN', 'Kapital');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const contract = f.contract(customer, '7', 'sale');
  const founder = f.partner('Təsisçi', '', 'individual');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  return { bank, account, customer, contract, founder, capital, fees };
}

let row = 10;
const L = (
  date: string,
  direction: 'in' | 'out',
  amount: string,
  extra: Partial<StatementLineInput> = {},
): StatementLineInput => ({
  row: ++row,
  date,
  direction,
  amount,
  reference: '',
  counterparty: '',
  counterpartyTaxId: '',
  counterpartyIban: '',
  purpose: '',
  ...extra,
});

const load = (
  f: F,
  lines: StatementLineInput[],
  extra: Partial<{ iban: string; bankAccountId: string; opening: string; closing: string }> = {},
) =>
  f.exec({
    type: 'statement.import',
    companyId: f.companyId,
    iban: IBAN,
    fileName: 'cixaris-2026-09.xlsx',
    fileHash: HASH,
    lines,
    ...extra,
  });
const view = (f: F, id: string) =>
  f.query<StatementView>({ type: 'statement', companyId: f.companyId, id });

const september = () => [
  L('2026-09-15', 'in', '1000', {
    reference: 'PT-1',
    counterparty: 'ALICI MMC',
    counterpartyTaxId: '1700000001',
    purpose: 'Müqavilə 7 üzrə ödəniş',
  }),
  L('2026-09-30', 'out', '3', { purpose: 'Hesabın aparılmasına görə komissiya' }),
  L('2026-09-30', 'out', '3', { purpose: 'Hesabın aparılmasına görə komissiya' }),
  L('2026-09-20', 'in', '50', { counterparty: 'Naməlum şəxs', purpose: 'qeyd' }),
];

test('B9: a second load adds nothing; two equal fees on one day are both kept', (t) => {
  const f = fixture(t);
  setup(f);
  const first = load(f, september());
  assert.deepEqual([first.added, first.duplicates, first.rejected], [4, 0, []]);
  const again = load(f, september());
  assert.deepEqual([again.added, again.duplicates], [0, 4]);
  // An overlapping export (the whole month again plus one new row) adds only the new row.
  const wider = load(f, [...september(), L('2026-09-30', 'in', '7', { purpose: 'faiz' })]);
  assert.deepEqual([wider.added, wider.duplicates], [1, 4]);
  const imports = f.query<StatementImportView[]>({
    type: 'statementImports',
    companyId: f.companyId,
  });
  assert.deepEqual(
    imports.map((i) => [i.rowsRead, i.rowsAdded, i.waiting]),
    [
      [5, 1, 1],
      [4, 0, 0],
      [4, 4, 4],
    ],
  );
});

test('B12/B14: proposals, three states, statement ↔ ledger balances', (t) => {
  const f = fixture(t);
  const s = setup(f);
  // Opening balance in the ledger: 500.
  f.bank('in', '2026-08-31', s.account, [f.bankLine('301', [s.founder, s.capital], '500')]);
  const imp = load(f, september(), { opening: '500', closing: '1544' });
  const v = view(f, imp.id);
  assert.deepEqual(v.balances, {
    fileOpening: '500.00',
    fileClosing: '1544.00',
    ledgerOpening: '500.00',
    ledgerClosing: '500.00',
    openingDifference: '0.00',
    closingDifference: '1044.00',
  });
  const [receipt, fee1, fee2, unknown] = v.lines;
  assert.deepEqual(
    [receipt!.proposal!.state, receipt!.proposal!.account, receipt!.proposal!.sk],
    ['proposal', '211.01', [s.customer, s.contract]],
  );
  assert.match(receipt!.proposal!.reason, /VÖEN üzrə tanındı: Alıcı MMC/);
  assert.deepEqual([fee1!.proposal!.account, fee1!.proposal!.sk], ['721', [s.fees]]);
  assert.deepEqual([unknown!.proposal!.state, unknown!.proposal!.account], ['unknown', '']);
  // Booking the receipt from its row: the document must keep the bank's date and amount.
  const book = (
    lineId: string,
    date: string,
    amount: string,
    lines = [f.bankLine('211.01', [s.customer, s.contract], amount)],
  ) => f.bank('in', date, s.account, lines, { statementLineId: lineId });
  assert.throws(
    () => book(receipt!.id, '2026-09-15', '999'),
    /çıxarış sətrinə uyğun deyil: məbləğ 999\.00, çıxarışda 1000\.00/,
  );
  assert.throws(
    () => book(receipt!.id, '2026-09-16', '1000'),
    /tarix 2026-09-16, çıxarışda 2026-09-15/,
  );
  const doc = book(receipt!.id, '2026-09-15', '1000');
  assert.equal(
    f.query<BankDocumentDetail>({ type: 'bankDocument', companyId: f.companyId, id: doc.id })
      .amount,
    '1000.00',
  );
  assert.throws(() => book(receipt!.id, '2026-09-15', '1000'), /artıq başqa sənədlə uçota alınıb/);
  // Fees: both rows are booked; one random receipt is set aside with a reason.
  for (const fee of [fee1!, fee2!])
    f.bank('out', '2026-09-30', s.account, [f.bankLine('721', [s.fees], '3')], {
      statementLineId: fee.id,
    });
  f.exec({
    type: 'statement.ignore',
    companyId: f.companyId,
    lineId: unknown!.id,
    reason: 'səhv köçürmə, geri qaytarılıb',
  });
  const after = view(f, imp.id);
  assert.deepEqual(
    after.lines.map((l) => [l.state, l.documentNumber, l.proposal === null]),
    [
      ['posted', 'BD-000002', true],
      ['posted', 'BX-000001', true],
      ['posted', 'BX-000002', true],
      ['ignored', '', true],
    ],
  );
  assert.deepEqual([after.waiting, after.posted, after.ignored], [0, 3, 1]);
  // The ledger now agrees with the statement except for the row set aside (50).
  assert.deepEqual(
    [after.balances.ledgerClosing, after.balances.closingDifference],
    ['1494.00', '50.00'],
  );
  // A corrected document still has to match its row.
  assert.throws(
    () =>
      f.exec({
        type: 'bank.save',
        companyId: f.companyId,
        id: doc.id,
        version: 1,
        direction: 'in',
        number: '',
        date: '2026-09-15',
        bankAccountId: s.account,
        rate: '',
        bankReference: '',
        counterpartyName: '',
        counterpartyTaxId: '',
        purpose: '',
        lines: [f.bankLine('211.01', [s.customer, s.contract], '900')],
      }),
    /çıxarış sətrinə uyğun deyil: məbləğ 900\.00/,
  );
  // Cancelling the document puts the row back; restoring an ignored row too.
  f.exec({ type: 'bank.cancel', companyId: f.companyId, id: doc.id, version: 1, reason: 'səhv' });
  f.exec({ type: 'statement.restore', companyId: f.companyId, lineId: unknown!.id });
  const back = view(f, imp.id);
  assert.deepEqual([back.lines[0]!.state, back.lines[3]!.state, back.waiting], ['new', 'new', 2]);
  assert.throws(
    () => f.exec({ type: 'statement.restore', companyId: f.companyId, lineId: unknown!.id }),
    /kənara qoyulmayıb/,
  );
});

test('B12: a row in a closed period waits; the others are booked', (t) => {
  const f = fixture(t);
  const s = setup(f);
  const imp = load(f, september());
  f.exec({ type: 'period.close', companyId: f.companyId, through: '2026-09-20', reason: '' });
  const [receipt, fee] = view(f, imp.id).lines;
  assert.match(receipt!.proposal!.reason, /bağlı dövrdədir/);
  assert.throws(
    () =>
      f.bank(
        'in',
        '2026-09-15',
        s.account,
        [f.bankLine('211.01', [s.customer, s.contract], '1000')],
        {
          statementLineId: receipt!.id,
        },
      ),
    /bağlanıb/,
  );
  f.bank('out', '2026-09-30', s.account, [f.bankLine('721', [s.fees], '3')], {
    statementLineId: fee!.id,
  });
  assert.deepEqual(
    view(f, imp.id).lines.map((l) => l.state),
    ['new', 'posted', 'new', 'new'],
  );
});

test('B13: a payment typed by hand is linked to its row, never booked twice', (t) => {
  const f = fixture(t);
  const s = setup(f);
  const manual = f.bank('in', '2026-09-14', s.account, [
    f.bankLine('211.01', [s.customer, s.contract], '1000'),
  ]);
  const imp = load(f, september());
  const receipt = view(f, imp.id).lines[0]!;
  assert.deepEqual(receipt.proposal!.matches, [
    { id: manual.id, number: 'BD-000001', date: '2026-09-14' },
  ]);
  assert.match(receipt.proposal!.reason, /BD-000001 bu ödənişə uyğundur — yeni sənəd yaratmayın/);
  const other = f.bank('in', '2026-09-01', s.account, [
    f.bankLine('211.01', [s.customer, s.contract], '1000'),
  ]);
  assert.throws(
    () =>
      f.exec({
        type: 'statement.link',
        companyId: f.companyId,
        lineId: receipt.id,
        documentId: other.id,
      }),
    /tarix 2026-09-01, çıxarışda 2026-09-15/,
  );
  f.exec({
    type: 'statement.link',
    companyId: f.companyId,
    lineId: receipt.id,
    documentId: manual.id,
  });
  const linked = view(f, imp.id).lines[0]!;
  assert.deepEqual([linked.state, linked.documentNumber], ['posted', 'BD-000001']);
  // The linked document is no longer offered for another row.
  const more = load(f, [L('2026-09-14', 'in', '1000', { purpose: 'başqa ödəniş' })]);
  assert.deepEqual(view(f, more.id).lines[0]!.proposal!.matches, []);
  assert.throws(
    () =>
      f.exec({ type: 'statement.ignore', companyId: f.companyId, lineId: receipt.id, reason: 'x' }),
    /uçota alınıb; əvvəlcə bank sənədini ləğv edin/,
  );
  // Correcting the linked document by a day is fine; it stays linked.
  f.exec({
    type: 'bank.save',
    companyId: f.companyId,
    id: manual.id,
    version: 1,
    direction: 'in',
    number: '',
    date: '2026-09-15',
    bankAccountId: s.account,
    rate: '',
    bankReference: 'PT-1',
    counterpartyName: '',
    counterpartyTaxId: '',
    purpose: '',
    lines: [f.bankLine('211.01', [s.customer, s.contract], '1000')],
  });
  assert.equal(view(f, imp.id).lines[0]!.state, 'posted');
});

test('the account is found by the IBAN printed in the file', (t) => {
  const f = fixture(t);
  const s = setup(f);
  assert.throws(
    () => load(f, september(), { iban: 'AZ99NABZ00000000000000000001' }),
    /AZ99NABZ00000000000000000001 hesabı üzrədir; bu IBAN bank hesabları kitabçasında yoxdur/,
  );
  const other = f.bankAccount(s.bank, 'AZ55PAHA40060AZNHC0101091203', '223.01', 'AZN', 'PAŞA');
  assert.throws(
    () => load(f, september(), { bankAccountId: other }),
    /seçilən bank hesabı isə başqadır/,
  );
  assert.throws(
    () => load(f, september(), { iban: '' }),
    /Faylda IBAN yoxdur; bank hesabını seçin/,
  );
  const r = load(f, september(), { iban: '', bankAccountId: other });
  assert.equal(view(f, r.id).iban, 'AZ55PAHA40060AZNHC0101091203');
  // Rows the server cannot read are reported; the rest are loaded.
  const bad = load(f, [
    L('2026-02-30', 'in', '5'),
    L('2026-09-01', 'in', '5', { purpose: 'yeni' }),
  ]);
  assert.deepEqual([bad.added, bad.rejected!.length], [1, 1]);
  assert.match(bad.rejected![0]!.message, /təqvimdə yoxdur/);
});

test('cash-flow item: an attribute of the line, checked against its own catalog', (t) => {
  const f = fixture(t);
  const s = setup(f);
  const item = f.item('cashFlowItem', 'Alıcılardan daxilolmalar');
  const r = f.bank('in', '2026-09-15', s.account, [
    f.bankLine('211.01', [s.customer, s.contract], '100', { cashFlowItem: item }),
  ]);
  const d = f.query<BankDocumentDetail>({ type: 'bankDocument', companyId: f.companyId, id: r.id });
  assert.deepEqual(
    [d.lines[0]!.cashFlowItem, d.lines[0]!.cashFlowItemName],
    [item, 'Alıcılardan daxilolmalar'],
  );
  assert.throws(
    () =>
      f.bank('in', '2026-09-15', s.account, [
        f.bankLine('301', [s.founder, s.capital], '5', { cashFlowItem: s.fees }),
      ]),
    /pul vəsaitlərinin hərəkəti maddəsi tapılmadı/,
  );
  assert.equal(
    f.catalog().items.filter((i) => i.kind === 'cashFlowItem').length,
    8,
    'a new company starts with the standard list',
  );
});
