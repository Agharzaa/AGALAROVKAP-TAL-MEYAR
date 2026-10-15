import test from 'node:test';
import assert from 'node:assert/strict';
import type { RuleLineInput, StatementLineInput } from '../../src/contracts/commands.js';
import type {
  BankDocumentDetail,
  RuleDraft,
  RuleView,
  StatementView,
} from '../../src/contracts/queries.js';
import { fixture, type Cmd } from './fixture.js';

type F = ReturnType<typeof fixture>;
type RuleCmd = Extract<Cmd, { type: 'rule.save' }>;
const IBAN = 'AZ12AIIB38060019441234567890';

function setup(f: F) {
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const account = f.bankAccount(bank, IBAN, '223.01', 'AZN', 'Kapital');
  const landlord = f.partner('İcarə MMC', '1700000003');
  const lease = f.contract(landlord, 'İ-1', 'purchase');
  const rent = f.item('expenseItem', 'İcarə');
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  const tax = f.item('paymentKind', 'Vergi (haqq)');
  return { bank, account, landlord, lease, rent, fees, tax };
}

let row = 100;
const L = (
  date: string,
  direction: 'in' | 'out',
  amount: string,
  extra: Partial<StatementLineInput> = {},
) => ({
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
let hash = 0;
const load = (f: F, lines: StatementLineInput[]) =>
  f.exec({
    type: 'statement.import',
    companyId: f.companyId,
    iban: IBAN,
    fileName: 'cixaris.xlsx',
    fileHash: String(++hash).padStart(64, '0'),
    lines,
  });
const view = (f: F, id: string) =>
  f.query<StatementView>({ type: 'statement', companyId: f.companyId, id });
const rule = (f: F, cmd: Partial<RuleCmd> & { lines: RuleLineInput[] }) =>
  f.exec({
    type: 'rule.save',
    companyId: f.companyId,
    name: 'Qayda',
    direction: 'out',
    bankAccountId: '',
    counterpartyTaxId: '',
    terms: [],
    amountMin: '',
    amountMax: '',
    mode: 'suggest',
    archived: false,
    ...cmd,
  });
const R = (
  account: string,
  sk: string[],
  amount = '',
  extra: Partial<RuleLineInput> = {},
): RuleLineInput => ({
  account,
  sk,
  amount,
  cashFlowItem: '',
  memo: '',
  ...extra,
});
const rules = (f: F) => f.query<RuleView[]>({ type: 'rules', companyId: f.companyId });

const rentRow = (date: string, amount = '1180') =>
  L(date, 'out', amount, {
    counterparty: 'İCARƏ MMC',
    counterpartyTaxId: '1700000003',
    purpose: `Ofis icarəsi, ${date.slice(0, 7)} ayı, ƏDV daxil`,
  });

test('B10: a rule made from the accountant’s booking proposes; switched to auto it posts', (t) => {
  const f = fixture(t);
  const s = setup(f);
  // September: the accountant books the rent by hand from the statement row.
  const sep = load(f, [rentRow('2026-09-05')]);
  const sepRow = view(f, sep.id).lines[0]!;
  const doc = f.bank(
    'out',
    '2026-09-05',
    s.account,
    [f.bankLine('531.01', [s.landlord, s.lease], '1180')],
    {
      statementLineId: sepRow.id,
      counterpartyTaxId: '1700000003',
      counterpartyName: 'İCARƏ MMC',
      purpose: 'Ofis icarəsi, 2026-09 ayı, ƏDV daxil',
    },
  );
  // The draft: VÖEN is enough to recognise the payee, so no purpose words; the line as booked.
  const draft = f.query<RuleDraft>({
    type: 'ruleDraft',
    companyId: f.companyId,
    documentId: doc.id,
  });
  assert.deepEqual(
    [
      draft.direction,
      draft.counterpartyTaxId,
      draft.terms,
      draft.lines.map((l) => [l.account, l.sk, l.amount]),
    ],
    ['out', '1700000003', [], [['531.01', [s.landlord, s.lease, ''], '']]],
  );
  assert.equal(draft.existing, undefined);
  const saved = rule(f, { ...draft, name: 'İcarə', mode: 'suggest' });
  // October: the rule proposes; nothing is posted while it is "suggest".
  const oct = load(f, [rentRow('2026-10-05')]);
  assert.deepEqual([oct.posted, oct.failed], [0, []]);
  const octRow = view(f, oct.id).lines[0]!;
  assert.deepEqual(
    [
      octRow.state,
      octRow.proposal!.rule,
      octRow.proposal!.lines!.map((l) => [l.account, l.amount]),
    ],
    ['new', { id: saved.id, name: 'İcarə', mode: 'suggest' }, [['531.01', '1180.00']]],
  );
  assert.match(octRow.proposal!.reason, /^Qayda “İcarə”\.$/);
  // The accountant switches the rule to auto; applying it posts the waiting row.
  rule(f, { ...draft, id: saved.id, version: 1, name: 'İcarə', mode: 'auto' });
  const applied = f.exec({ type: 'statement.apply', companyId: f.companyId, importId: oct.id });
  assert.equal(applied.posted, 1);
  const posted = view(f, oct.id).lines[0]!;
  assert.deepEqual([posted.state, posted.documentRule], ['posted', 'İcarə']);
  const d = f.query<BankDocumentDetail>({
    type: 'bankDocument',
    companyId: f.companyId,
    id: posted.documentId,
  });
  assert.deepEqual(
    d.postings.map((p) => [p.dt.account, p.kt.account, p.amount]),
    [['543.01'.replace('543', '243'), '223.01', '1180.00']],
    'no open invoice: the payment is an advance to the landlord (243.01)',
  );
  // November: posted at import, with the rule in the audit trail.
  const nov = load(f, [rentRow('2026-11-05')]);
  assert.equal(nov.posted, 1);
  assert.match(
    f
      .query<{ action: string; detail: string }[]>({ type: 'audit', companyId: f.companyId })
      .map((a) => `${a.action} ${a.detail}`)
      .join('\n'),
    /Qayda ilə avtomatik uçota alındı BX-000003 · qayda “İcarə” \(v2\)/,
  );
  assert.equal(rules(f)[0]!.uses, 2);
  // Undo: cancelling the automatic booking puts the row back for the accountant only.
  const novRow = view(f, nov.id).lines[0]!;
  f.exec({
    type: 'bank.cancel',
    companyId: f.companyId,
    id: novRow.documentId,
    version: 1,
    reason: 'Avtomatik uçot səhvdir',
  });
  const back = view(f, nov.id).lines[0]!;
  assert.deepEqual([back.state, back.manualOnly], ['new', true]);
  assert.match(back.proposal!.reason, /Avtomatik uçot geri qaytarılıb/);
  assert.equal(
    f.exec({ type: 'statement.apply', companyId: f.companyId, importId: nov.id }).posted,
    0,
  );
});

test('B11: equal rules disagreeing are a conflict — nothing posts; the more specific rule wins', (t) => {
  const f = fixture(t);
  const s = setup(f);
  const fee = (purpose: string) => L('2026-09-30', 'out', '3', { purpose });
  rule(f, {
    name: 'Komissiya → 721',
    terms: ['komissiya'],
    lines: [R('721', [s.fees])],
    mode: 'auto',
  });
  rule(f, {
    name: 'Komissiya → 731',
    terms: ['komissiya'],
    amountMin: '',
    lines: [R('731', [s.rent])],
    mode: 'auto',
    bankAccountId: '',
    counterpartyTaxId: '',
    amountMax: '1000',
  });
  // The second rule has an amount range: more specific, so it wins without a conflict.
  const a = load(f, [fee('Hesabın aparılmasına görə komissiya')]);
  assert.equal(a.posted, 1);
  const posted = view(f, a.id).lines[0]!;
  assert.equal(posted.documentRule, 'Komissiya → 731');
  // A third rule as specific as the second (one word + amount range) but booking differently:
  // a row both recognise is a conflict, and nothing is posted.
  rule(f, {
    name: 'SMS → 721',
    terms: ['sms'],
    amountMax: '1000',
    lines: [R('721', [s.fees])],
    mode: 'auto',
  });
  const b = load(f, [fee('SMS xidmətinə görə komissiya')]);
  assert.equal(b.posted, 0);
  const waiting = view(f, b.id).lines[0]!;
  assert.match(
    waiting.proposal!.reason,
    /Qaydalar ziddiyyətlidir \(“Komissiya → 731”, “SMS → 721”\)/,
  );
  // A rule with the very same conditions is refused at once.
  assert.throws(
    () =>
      rule(f, {
        name: 'Dublikat',
        terms: ['KOMİSSİYA'],
        amountMax: '1000',
        lines: [R('721', [s.fees])],
      }),
    /Eyni şərtli qayda artıq var: “Komissiya → 731”/,
  );
});

test('rules: what is refused, and an auto rule that cannot post leaves the row with the reason', (t) => {
  const f = fixture(t);
  const s = setup(f);
  assert.throws(() => rule(f, { lines: [R('721', [s.fees])] }), /VÖEN-i və ya təyinatdakı söz/);
  assert.throws(
    () =>
      rule(f, {
        terms: ['icarə'],
        lines: [R('721', [s.fees], '10'), R('751', [s.landlord, s.lease], '5')],
      }),
    /bir sətrin məbləği boş qalmalıdır/,
  );
  assert.throws(
    () => rule(f, { terms: ['icarə'], lines: [R('721', [])] }),
    /subkonto 1 seçilməyib/,
  );
  assert.throws(
    () => rule(f, { terms: ['icarə'], counterpartyTaxId: '123', lines: [R('721', [s.fees])] }),
    /10 rəqəm/,
  );
  // A loan payment: fixed interest, principal takes the rest.
  const loanBank = f.partner('Bank ASC', '9900000001');
  const loan = f.contract(loanBank, 'K-1', 'loan');
  rule(f, {
    name: 'Kredit',
    counterpartyTaxId: '9900000001',
    lines: [R('751', [loanBank, loan], '85.50', { memo: 'Faiz' }), R('501', [loanBank, loan])],
    mode: 'auto',
  });
  const r = load(f, [
    L('2026-09-30', 'out', '1085.50', {
      counterpartyTaxId: '9900000001',
      purpose: 'Kredit ödənişi',
    }),
    L('2026-09-30', 'out', '50', {
      counterpartyTaxId: '9900000001',
      purpose: 'Kredit ödənişi (qismən)',
    }),
  ]);
  assert.equal(r.posted, 1);
  assert.deepEqual(r.failed, [
    { row: row, message: 'Qaydanın sabit məbləğləri sətrin məbləğindən (50.00) böyükdür.' },
  ]);
  const [ok, failed] = view(f, r.id).lines;
  const d = f.query<BankDocumentDetail>({
    type: 'bankDocument',
    companyId: f.companyId,
    id: ok!.documentId,
  });
  assert.deepEqual(
    d.postings.map((p) => [p.dt.account, p.amount, p.memo]),
    [
      ['751', '85.50', 'Faiz'],
      ['501', '1000.00', 'Kredit ödənişi'],
    ],
  );
  assert.match(failed!.autoNote, /“Kredit”: Qaydanın sabit məbləğləri/);
  assert.match(failed!.proposal!.reason, /Avtomatik uçot alınmadı/);
});

test('budget classification code → 521 sub-account and payment kind', (t) => {
  const f = fixture(t);
  const s = setup(f);
  const code = (c: string, account: string, paymentKindId = s.tax) =>
    f.exec({
      type: 'budgetCode.save',
      companyId: f.companyId,
      code: c,
      name: '',
      account,
      paymentKindId,
      archived: false,
    });
  code('141110', '521.04');
  assert.throws(() => code('12345', '521.04'), /6 rəqəmdir/);
  assert.throws(() => code('141120', '721'), /521 və ya 522/);
  assert.throws(() => code('141110', '521.01'), /Bu kod artıq var/);
  assert.throws(() => code('141130', '521.01', ''), /Ödəniş növünü seçin/);
  const r = load(f, [
    L('2026-10-20', 'out', '500', {
      counterparty: 'Dövlət Xəzinədarlığı',
      purpose: 'Mənfəət vergisi, büdcə təsnifat kodu: 141110',
    }),
    L('2026-10-20', 'out', '70', {
      counterparty: 'Dövlət Xəzinədarlığı',
      purpose: 'Vergi ödənişi BTK 999999',
    }),
  ]);
  const [known, unknown] = view(f, r.id).lines;
  assert.deepEqual(
    [
      known!.proposal!.account,
      known!.proposal!.sk,
      known!.proposal!.budgetCode,
      known!.proposal!.reason,
    ],
    ['521.04', [s.tax], '141110', 'Büdcə təsnifat kodu 141110 → 521.04.'],
  );
  assert.equal(unknown!.proposal!.account, '');
  assert.match(unknown!.proposal!.reason, /Büdcə təsnifat kodu 999999 cədvəldə yoxdur/);
});

test('audit: an auto rule never books a row a hand-typed document already covers (B13)', (t) => {
  const f = fixture(t);
  const s = setup(f);
  rule(f, {
    name: 'İcarə',
    counterpartyTaxId: '1700000003',
    lines: [R('531.01', [s.landlord, s.lease])],
    mode: 'auto',
  });
  // The rent was typed by hand a day before the statement arrived.
  const manual = f.bank('out', '2026-10-04', s.account, [
    f.bankLine('531.01', [s.landlord, s.lease], '1180'),
  ]);
  const r = load(f, [rentRow('2026-10-05')]);
  assert.equal(r.posted, 0, 'the payment is already in the ledger');
  const waiting = view(f, r.id).lines[0]!;
  assert.equal(waiting.state, 'new');
  assert.deepEqual(
    waiting.proposal!.matches.map((m) => m.id),
    [manual.id],
  );
  assert.match(waiting.autoNote, /BX-000001/);
  assert.equal(
    f.query<unknown[]>({
      type: 'bankDocuments',
      companyId: f.companyId,
      from: '2026-01-01',
      to: '2026-12-31',
    }).length,
    1,
    'no second document',
  );
});

test('audit: a rule never carries one payment’s settlement document to the next', (t) => {
  const f = fixture(t);
  const s = setup(f);
  const service = f.product('Ofis icarəsi', 'ay');
  const inv = f.invoice('purchase', '2026-09-01', s.landlord, s.lease, [
    { productId: service, quantity: '1', price: '1000' },
  ]);
  const sep = load(f, [rentRow('2026-09-05')]);
  const doc = f.bank(
    'out',
    '2026-09-05',
    s.account,
    [f.bankLine('531.01', [s.landlord, s.lease, `invoice:${inv.id}`], '1180')],
    { statementLineId: view(f, sep.id).lines[0]!.id, counterpartyTaxId: '1700000003' },
  );
  const draft = f.query<RuleDraft>({
    type: 'ruleDraft',
    companyId: f.companyId,
    documentId: doc.id,
  });
  assert.deepEqual(
    draft.lines[0]!.sk,
    [s.landlord, s.lease, ''],
    'open invoices, not SQ of September',
  );
  assert.throws(
    () =>
      rule(f, {
        counterpartyTaxId: '1700000003',
        lines: [R('531.01', [s.landlord, s.lease, `invoice:${inv.id}`])],
      }),
    /hesablaşma sənədi qaydada seçilmir/i,
  );
});
