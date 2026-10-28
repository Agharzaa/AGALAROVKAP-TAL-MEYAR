/**
 * Stage 5c — month closing (docs/MERHELE-5-AY-BAGLANISI.md §4.3–§4.5, §5, §8: A1–A6).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { EqDocumentInputDto } from '../../src/contracts/commands.js';
import type { ClosingSummary, ClosingView, RevaluationView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';
import { september } from './september.js';

type F = ReturnType<typeof fixture>;

const view = (f: F, month: string) =>
  f.query<ClosingView>({ type: 'closing', companyId: f.companyId, month });
const close = (f: F, month: string, acknowledged = false) =>
  f.exec({ type: 'closing.post', companyId: f.companyId, month, acknowledged });
const cancel = (f: F, month: string, reason = 'Sənəd düzəlişi') => {
  const p = view(f, month).posted!;
  return f.exec({
    type: 'closing.cancel',
    companyId: f.companyId,
    id: p.id,
    version: p.version,
    reason,
  });
};
const closed = (f: F) =>
  String(f.db.get('SELECT closed_through FROM companies WHERE id=?', f.companyId)!.closed_through);
const entries = (f: F) => Number(f.db.get('SELECT COUNT(*) AS n FROM entries')!.n);
/** Signed (debit − credit) balance of an account family at the end of `date`. */
const balance = (f: F, account: string, date = '2026-12-31') =>
  String(
    f.db.get(
      `SELECT COALESCE(SUM(a),0) AS b FROM (
         SELECT amount AS a FROM postings WHERE company_id=?1 AND (dt_account=?2 OR dt_account LIKE ?2||'.%') AND date<=?3
         UNION ALL
         SELECT -amount FROM postings WHERE company_id=?1 AND (kt_account=?2 OR kt_account LIKE ?2||'.%') AND date<=?3)`,
      f.companyId,
      account,
      date,
    )!.b,
  );
const step = (v: ClosingView, key: string) => v.steps.find((s) => s.key === key)!;

test('A1: the September example closes — 6xx / 7xx / 801 zero, 341 = profit, to the qəpik', (t) => {
  const f = fixture(t);
  const s = september(f);
  // August holds the opening balances: it is closed first (nothing to close to 801).
  assert.deepEqual(close(f, '2026-08'), {
    id: view(f, '2026-08').posted!.id,
    version: 1,
    number: 'AB-2026-08',
  });
  assert.equal(closed(f), '2026-08-31');
  const before = view(f, '2026-09');
  assert.deepEqual([before.blocking, before.warnings], [[], []]);
  assert.equal(before.profit, '5708.86');
  // The month's figures before closing, per account (the M/Z report of 5d reads the same).
  assert.deepEqual(
    step(before, 'income').totals.map((x) => [x.account, x.debit, x.credit]),
    [
      ['601', '0.00', '15000.00'],
      ['604.1', '2288.14', '0.00'],
      ['701', '7000.00', '0.00'],
      ['721', '3.00', '0.00'],
    ],
  );
  assert.deepEqual(
    step(before, 'income').postings.map((p) => [p.dt, p.kt, p.amount]),
    [
      ['601', '801', '15000.00'],
      ['801', '604.1', '2288.14'],
      ['801', '701', '7000.00'],
      ['801', '721', '3.00'],
    ],
  );
  assert.deepEqual(
    step(before, 'result').postings.map((p) => [p.dt, p.kt, p.amount]),
    [['801', '341', '5708.86']],
  );
  // Goods followed FIFO: nothing to re-cost; no currency; the manual 241 has no invoice.
  for (const k of ['fifo', 'revaluation', 'vat']) assert.equal(step(before, k).state, 'empty', k);
  assert.ok(!before.steps.some((x) => x.key === 'year'));
  const r = close(f, '2026-09');
  assert.equal(r.number, 'AB-2026-09');
  assert.equal(closed(f), '2026-09-30');
  for (const a of ['601', '604', '701', '721', '801']) assert.equal(balance(f, a), '0', a);
  assert.equal(balance(f, '341'), '-570886');
  // Every closing entry is dated the month's last day, with source type "closing".
  assert.deepEqual(
    f.db
      .all(
        "SELECT DISTINCT date, source_number FROM entries WHERE source_type='closing' AND source_id=?",
        r.id,
      )
      .map((e) => [e.date, e.source_number]),
    [['2026-09-30', 'AB-2026-09']],
  );
  const after = view(f, '2026-09');
  assert.equal(after.posted!.profit, '5708.86');
  assert.deepEqual(
    step(after, 'income').totals.map((x) => x.account),
    ['601', '604.1', '701', '721'],
  );
  assert.equal(step(after, 'lock').summary, '30.09.2026 daxil olmaqla bağlandı');
  // The trial balance of September shows the closing turnover; the period is locked.
  const tb = f.trial('2026-09-01', '2026-09-30');
  assert.equal(tb.totals.closeDt, tb.totals.closeKt);
  assert.throws(
    () => f.operation('2026-09-15', [f.line('721', [s.fees], '223.01', [s.bankK], '1')]),
    /bağlanıb/,
  );
  assert.throws(() => close(f, '2026-09'), /artıq bağlanıb/);
  const list = f.query<ClosingSummary[]>({ type: 'closings', companyId: f.companyId });
  assert.deepEqual(
    list.map((c) => [c.month, c.status, c.profit]),
    [
      ['2026-09', 'posted', '5708.86'],
      ['2026-08', 'posted', '0.00'],
    ],
  );
});

test('A2: a purchase entered later with an earlier date — the month re-costs strict FIFO', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Təchizat ASC', '1700000002');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const cp = f.contract(supplier, 'P-1', 'purchase');
  const cs = f.contract(customer, 'S-1', 'sale');
  const paper = f.product('Kağız A4', 'qutu');
  const buy = (date: string, quantity: string, price: string) =>
    f.invoice('purchase', date, supplier, cp, [
      { productId: paper, quantity, price, vatRate: '0' },
    ]);
  buy('2026-09-10', '10', '10');
  f.invoice('sale', '2026-09-15', customer, cs, [
    { productId: paper, quantity: '5', price: '30', vatRate: '0' },
  ]);
  assert.equal(balance(f, '701'), '5000', 'the sale took 5 × 10.00 from the only layer');
  // Entered afterwards, dated before the sale: under FIFO the sale took 5 × 20.00 from it.
  buy('2026-09-05', '10', '20');
  const v = view(f, '2026-09');
  assert.deepEqual(
    step(v, 'fifo').postings.map((p) => [p.dt, p.kt, p.ktSk[0] === paper, p.amount]),
    [['701', '205', true, '50.00']],
  );
  close(f, '2026-09');
  // 701 = 5 × 20.00 exactly; 205 keeps 5 × 20.00 + 10 × 10.00 = 200.00.
  assert.equal(balance(f, '205'), '20000');
  assert.equal(
    f.db.get(
      "SELECT SUM(amount) AS a FROM postings WHERE dt_account='701' AND date<='2026-09-30' AND entry_id NOT IN (SELECT e.id FROM entries e JOIN postings p ON p.entry_id=e.id WHERE e.source_type='closing' AND p.kt_account='701')",
    )!.a,
    10000n,
  );
  // The adjustment moves value only: the quantity left stays 15.
  assert.equal(
    f.db.get(
      "SELECT SUM(dt_qty)-(SELECT SUM(kt_qty) FROM postings WHERE kt_account='205') AS q FROM postings WHERE dt_account='205'",
    )!.q,
    15_000_000n,
  );
  assert.equal(balance(f, '701'), '0', 'closed to 801');
  assert.equal(balance(f, '341'), String(-(15000 - 10000)));
});

/** DVX e-qaimələr of the purchase box, in the "Qaimələr üzrə" layout (header only). */
function confirm(f: F, documents: Partial<EqDocumentInputDto>[]) {
  f.exec({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: f.companyId,
    direction: 'purchase',
    report: 'invoices',
    source: 'file',
    fileName: `dvx-${documents[0]!.number}.xlsx`,
    fileHash: '1'.padStart(64, '0'),
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

test('A3: purchase VAT offset — paid through the deposit 241 → 521.01, unpaid stays', (t) => {
  const f = fixture(t);
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Ağarza Ağalarov', '', 'individual');
  const capitalIn = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const bankK = f.bankAccount(kapital, 'AZ12AIIB38060019441234567890', '223.01', 'AZN', 'Kapital');
  const deposit = f.bankAccount(kapital, 'AZ77AIIB38060019449999999999', '224.04', 'AZN', 'ƏDV');
  const supplier = f.partner('Təchizat ASC', '1700000002');
  const other = f.partner('Xidmət MMC', '1700000003');
  const person = f.partner('Fərdi Sahibkar', '1700000012', 'individual');
  const late = f.partner('Gecikən MMC', '1700000004');
  const contract = (p: string) => f.contract(p, 'P-1', 'purchase');
  const [c1, c2, c3, c4] = [supplier, other, person, late].map(contract) as [
    string,
    string,
    string,
    string,
  ];
  const paper = f.product('Kağız A4', 'qutu');
  const L = f.line;
  f.operation('2026-08-31', [
    L('223.01', [bankK], '301', [founder, capitalIn], '30000'),
    L('224.04', [deposit], '301', [founder, capitalIn], '3000'),
  ]);
  close(f, '2026-08');
  const buy = (partner: string, c: string, price: string, eq: string) =>
    f.invoice('purchase', '2026-09-05', partner, c, [{ productId: paper, quantity: '10', price }], {
      eqNumber: eq,
    });
  const full = buy(supplier, c1, '100', 'MT2609001'); // 1 000 + 180 VAT
  const half = buy(other, c2, '200', 'MT2609002'); // 2 000 + 360 VAT
  const fiz = buy(person, c3, '50', 'MT2609003'); // 500 + 90 VAT, an individual
  const none = buy(late, c4, '10', 'MT2609004'); // 100 + 18 VAT, e-qaimə not confirmed
  confirm(f, [
    { number: 'MT2609001', date: '2026-09-05', taxId: '1700000002', net: '1000.00', vat: '180.00' },
    { number: 'MT2609002', date: '2026-09-05', taxId: '1700000003', net: '2000.00', vat: '360.00' },
    { number: 'MT2609003', date: '2026-09-05', taxId: '1700000012', net: '500.00', vat: '90.00' },
    {
      number: 'MT2609004',
      date: '2026-09-05',
      taxId: '1700000004',
      net: '100.00',
      vat: '18.00',
      status: 'Təsdiq gözləyir',
    },
  ]);
  assert.equal(
    f.db.get(
      "SELECT COUNT(*) AS n FROM eq_documents WHERE invoice_id IS NOT NULL AND status='accepted'",
    )!.n,
    3n,
    'every confirmed e-qaimə found its invoice',
  );
  const B = f.bankLine;
  // The first: net from the current account, VAT from the deposit — wholly paid.
  f.bank('out', '2026-09-10', bankK, [B('531.01', [supplier, c1], '1000')]);
  f.bank('out', '2026-09-10', deposit, [B('531.01', [supplier, c1], '180')]);
  // The second: only the net part paid; its VAT waits on 241.
  f.bank('out', '2026-09-12', bankK, [B('531.01', [other, c2], '2000')]);
  // The individual pays VAT with the rest: half of 590 paid → half of the VAT, 45.00.
  f.bank('out', '2026-09-12', bankK, [B('531.01', [person, c3], '295')]);
  // The unconfirmed one is paid in full, VAT included — still no offset without DVX.
  f.bank('out', '2026-09-12', bankK, [B('531.01', [late, c4], '100')]);
  f.bank('out', '2026-09-12', deposit, [B('531.01', [late, c4], '18')]);
  const v = view(f, '2026-09');
  assert.deepEqual(
    step(v, 'vat').postings.map((p) => [p.dt, p.kt, p.ktSk[1], p.amount]),
    [
      ['521.01', '241', `invoice:${full.id}`, '180.00'],
      ['521.01', '241', `invoice:${fiz.id}`, '45.00'],
    ].sort((a, b) => a[2]!.localeCompare(b[2]!)),
  );
  assert.match(step(v, 'vat').notes.join(), /2 qaimənin ƏDV-si \(405,00\) hələ ödənilməyib/);
  const waiting = v.warnings.filter((w) => w.kind === 'vatUnconfirmed');
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0]!.invoice!.id, none.id);
  assert.match(waiting[0]!.text, /e-qaiməsi DVX-də təsdiqlənməyib/);
  assert.throws(() => close(f, '2026-09'), /xəbərdarlıq var: oxuyub "Oxudum"/);
  close(f, '2026-09', true);
  assert.equal(balance(f, '241'), String((360 + 45 + 18) * 100));
  assert.equal(view(f, '2026-09').posted!.warnings.length, v.warnings.length);
  const left241 = (id: string) =>
    f.db.get(
      "SELECT SUM(debit-credit) AS b FROM registers WHERE account='241' AND s2=?",
      `invoice:${id}`,
    )!.b;
  assert.deepEqual(
    [full, half, fiz, none].map((x) => left241(x.id)),
    [0n, 36000n, 4500n, 1800n],
  );
});

test('A4: months close in order; only the last one is cancelled, by storno, and the lock opens', (t) => {
  const f = fixture(t);
  september(f);
  assert.throws(() => close(f, '2026-09'), /2026-08 ayı bağlanmayıb/);
  assert.equal(f.db.get('SELECT COUNT(*) AS n FROM month_closings')!.n, 0n);
  assert.throws(() => close(f, '2026-12'), /Ay hələ bitməyib/);
  close(f, '2026-08');
  const sept = close(f, '2026-09');
  assert.throws(() => cancel(f, '2026-08'), /yalnız sonuncu bağlanmış ay ləğv olunur/);
  // The lock cannot be moved back under a posted closing by hand.
  assert.throws(
    () =>
      f.exec({
        type: 'period.close',
        companyId: f.companyId,
        through: '2026-09-15',
        reason: 'düzəliş',
      }),
    /AB-2026-09 ay bağlanışı uçotdadır/,
  );
  assert.throws(() => cancel(f, '2026-09', ' '), /səbəbini yazın/);
  const before = entries(f);
  const c = cancel(f, '2026-09');
  assert.equal(c.version, 2);
  assert.equal(closed(f), '2026-08-31');
  // Every closing entry is stornoed on the same date; the books are back as before closing.
  const closingEntries = f.db
    .all("SELECT storno FROM entries WHERE source_type='closing' AND source_id=?", sept.id)
    .map((e) => Number(e.storno));
  assert.equal(entries(f) - before, closingEntries.filter((x) => x === 1).length);
  assert.equal(
    closingEntries.filter((x) => x === 0).length,
    closingEntries.filter((x) => x === 1).length,
  );
  assert.equal(balance(f, '601'), '-1500000');
  assert.equal(balance(f, '341'), '0');
  const reopened = view(f, '2026-09');
  assert.equal(reopened.posted, null);
  assert.equal(reopened.cancelled!.status, 'cancelled');
  assert.match(
    String(
      f.db.get("SELECT detail FROM audit WHERE action='Dövr yenidən açıldı' ORDER BY seq DESC")!
        .detail,
    ),
    /AB-2026-09 ləğv edildi · Sənəd düzəlişi/,
  );
  // Closing again is a new version of the same document.
  const again = close(f, '2026-09');
  assert.deepEqual([again.id, again.version], [sept.id, 3]);
  assert.equal(balance(f, '341'), '-570886');
  assert.throws(
    () =>
      f.exec({
        type: 'closing.cancel',
        companyId: f.companyId,
        id: sept.id,
        version: 1,
        reason: 'x',
      }),
    /başqa pəncərədə/,
  );
});

test('A5: a blocking check stops the closing — nothing is written', (t) => {
  const f = fixture(t);
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Təsisçi', '', 'individual');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  f.exec({
    type: 'rates.save',
    companyId: f.companyId,
    date: '2026-09-01',
    source: 'manual',
    rates: [{ currency: 'USD', rate: '1.7' }],
  });
  const usd = f.bankAccount(kapital, 'AZ12AIIB38060019449999999901', '223.02', 'USD', 'USD');
  f.bank('in', '2026-09-01', usd, [f.bankLine('301', [founder, capital], '1000')]);
  // A manual operation takes the cashbox below zero on the 20th.
  const box = f.cashbox();
  f.operation('2026-09-20', [f.line('721', [fees], '221.01', [box], '50')]);
  f.operation('2026-09-25', [f.line('221.01', [box], '301', [founder, capital], '50')]);
  const before = entries(f);
  const v = view(f, '2026-09');
  assert.deepEqual(
    v.blocking.map((b) => b.kind),
    ['cash', 'rate'],
  );
  assert.match(v.blocking[0]!.text, /20\.09\.2026 tarixində mənfi kassa qalığı/);
  assert.match(v.blocking[1]!.text, /30\.09\.2026 üçün AMB məzənnəsi yoxdur: USD/);
  assert.ok(v.steps.filter((s) => s.key !== 'checks').every((s) => s.state === 'blocked'));
  assert.throws(() => close(f, '2026-09', true), /Ay bağlanmadı: .*mənfi kassa qalığı/);
  assert.equal(entries(f), before);
  assert.equal(closed(f), '');
  assert.equal(f.db.get('SELECT COUNT(*) AS n FROM month_closings')!.n, 0n);
  // A negative stock blocks too.
  const f2 = fixture(t);
  const paper = f2.product('Kağız A4', 'qutu');
  const goods = f2.item('productGroup', 'Əsas nomenklatura qrupu');
  const cogs = f2.item('expenseItem', 'Satılmış malların maya dəyəri');
  f2.operation('2026-09-10', [
    f2.line('701', [goods, cogs], '205', [paper], '10', { quantity: '1' }),
  ]);
  assert.match(
    view(f2, '2026-09').blocking[0]!.text,
    /205 · Kağız A4: 10\.09\.2026 tarixində mənfi qalıq/,
  );
});

test('A6: December closes the year — the profit tax (stage 9d), then 341 → 343', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const cs = f.contract(customer, 'S-1', 'sale');
  const service = f.item('incomeType', 'Xidmət satışı');
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  const L = f.line;
  f.operation('2026-11-20', [L('211.01', [customer, cs, ''], '601', [service, '0'], '1000')]);
  f.operation('2026-11-25', [L('721', [fees], '211.01', [customer, cs, ''], '100')]);
  close(f, '2026-11');
  assert.equal(balance(f, '341'), '-90000');
  f.operation('2026-12-10', [L('211.01', [customer, cs, ''], '601', [service, '0'], '500')]);
  f.operation('2026-12-11', [L('721', [fees], '211.01', [customer, cs, ''], '800')]);
  const v = view(f, '2026-12');
  assert.equal(v.profit, '-300.00');
  assert.deepEqual(
    step(v, 'result').postings.map((p) => [p.dt, p.kt, p.amount]),
    [['341', '801', '300.00']],
  );
  // The year made 600,00: 20% profit tax (QERARLAR 2026-10-28 mərhələ 9 §7), the rest to 343.
  assert.deepEqual(
    step(v, 'profitTax').postings.map((p) => [p.dt, p.kt, p.amount]),
    [
      ['901', '521.04', '120.00'],
      ['341', '901', '120.00'],
    ],
  );
  assert.deepEqual(
    step(v, 'year').postings.map((p) => [p.dt, p.kt, p.amount]),
    [['341', '343', '480.00']],
  );
  close(f, '2026-12');
  assert.equal(balance(f, '341'), '0');
  assert.equal(balance(f, '901'), '0');
  assert.equal(balance(f, '521.04'), '-12000');
  assert.equal(balance(f, '343'), '-48000');
  assert.equal(closed(f), '2026-12-31');
});

test('revaluation is a step: the YQ- document is posted by the closing and stays after cancelling', (t) => {
  const f = fixture(t);
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Təsisçi', '', 'individual');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const rates = (date: string, rate: string) =>
    f.exec({
      type: 'rates.save',
      companyId: f.companyId,
      date,
      source: 'manual',
      rates: [{ currency: 'USD', rate }],
    });
  rates('2026-09-01', '1.7');
  rates('2026-09-30', '1.71');
  const usd = f.bankAccount(kapital, 'AZ12AIIB38060019449999999901', '223.02', 'USD', 'USD');
  f.bank('in', '2026-09-01', usd, [f.bankLine('301', [founder, capital], '1000')]);
  const v = view(f, '2026-09');
  assert.equal(
    step(v, 'revaluation').summary,
    'YQ-2026-09 (uçota alınacaq) · gəlir 611: 10,00 · xərc 731: 0,00',
  );
  // The 611 income of the revaluation is part of the month's result.
  assert.equal(v.profit, '10.00');
  close(f, '2026-09');
  const reval = () =>
    f.query<RevaluationView>({ type: 'revaluation', companyId: f.companyId, month: '2026-09' });
  assert.equal(reval().posted!.number, 'YQ-2026-09');
  assert.equal(reval().posted!.stale, false);
  assert.equal(balance(f, '611'), '0');
  assert.equal(balance(f, '341'), '-1000');
  const id = view(f, '2026-09').posted!.id;
  assert.equal(
    f.db.get('SELECT revaluation_id FROM month_closings WHERE id=?', id)!.revaluation_id,
    reval().posted!.id,
  );
  // The rate the revaluation used cannot change under the closed month.
  assert.throws(() => rates('2026-09-30', '1.72'), /YQ-2026-09/);
  cancel(f, '2026-09');
  assert.equal(reval().posted!.version, 1, 'the revaluation stays posted');
  assert.equal(balance(f, '611'), '-1000');
  const again = view(f, '2026-09');
  assert.equal(
    step(again, 'revaluation').summary,
    'YQ-2026-09 (uçotdadır) · gəlir 611: 10,00 · xərc 731: 0,00',
  );
  close(f, '2026-09');
  assert.equal(reval().posted!.version, 1, 'kept as it was');
});

test('warnings are read and acknowledged; they are kept with the closing', (t) => {
  const f = fixture(t);
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const cs = f.contract(customer, 'S-1', 'sale');
  const bankK = f.bankAccount(kapital, 'AZ12AIIB38060019441234567890');
  const service = f.item('incomeType', 'Xidmət satışı');
  const L = f.line;
  // A debt and an advance of the same contract: the advance was not offset.
  f.operation('2026-09-02', [L('211.01', [customer, cs, ''], '601', [service, '0'], '100')]);
  f.operation('2026-09-03', [L('223.01', [bankK], '543.01', [customer, cs, ''], '40')]);
  const v = view(f, '2026-09');
  assert.deepEqual(
    v.warnings.map((w) => w.kind),
    ['advance'],
  );
  assert.throws(() => close(f, '2026-09'), /1 xəbərdarlıq var/);
  close(f, '2026-09', true);
  const posted = view(f, '2026-09').posted!;
  assert.equal(posted.warnings.length, 1);
  assert.match(posted.warnings[0]!, /avans əvəzləşdirilməyib/);
  assert.match(
    String(f.db.get("SELECT detail FROM audit WHERE entity='Ay bağlanışı'")!.detail),
    /AB-2026-09 · mənfəət 100\.00 AZN · 1 xəbərdarlıq oxundu/,
  );
});

test('audit: a step of more than 2000 lines is posted in several entries, not refused', (t) => {
  const f = fixture(t);
  const founder = f.partner('Təsisçi', '', 'individual');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const items = Array.from(
    { length: 2001 },
    (_, i) =>
      f.exec({
        type: 'item.save',
        companyId: f.companyId,
        kind: 'expenseItem',
        name: `Xərc ${i}`,
        archived: false,
      }).id,
  );
  // 2001 expense keys of 721: the closing moves each of them to 801.
  for (const part of [items.slice(0, 1000), items.slice(1000)])
    f.operation(
      '2026-09-10',
      part.map((x) => f.line('721', [x], '301', [founder, capital], '1')),
    );
  assert.equal(step(view(f, '2026-09'), 'income').postings.length, 2001);
  const r = close(f, '2026-09');
  assert.equal(balance(f, '721'), '0');
  assert.equal(balance(f, '341'), '200100');
  assert.deepEqual(
    f.db
      .all(
        `SELECT COUNT(*) AS n FROM postings p JOIN entries e ON e.id=p.entry_id
         WHERE e.source_id=? AND p.kt_account='721' GROUP BY e.id ORDER BY n DESC`,
        r.id,
      )
      .map((x) => x.n),
    [2000n, 1n],
  );
  cancel(f, '2026-09');
  assert.equal(balance(f, '721'), '200100');
});

test('audit: a revaluation the closing took back reads "storno edildi" once the month is closed', (t) => {
  const f = fixture(t);
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Təsisçi', '', 'individual');
  const capital = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  for (const [date, rate] of [
    ['2026-09-01', '1.7'],
    ['2026-09-30', '1.71'],
  ] as const)
    f.exec({
      type: 'rates.save',
      companyId: f.companyId,
      date,
      source: 'manual',
      rates: [{ currency: 'USD', rate }],
    });
  const usd = f.bankAccount(kapital, 'AZ12AIIB38060019449999999901', '223.02', 'USD', 'USD');
  const doc = f.bank('in', '2026-09-01', usd, [f.bankLine('301', [founder, capital], '1000')]);
  f.exec({ type: 'revaluation.post', companyId: f.companyId, month: '2026-09' });
  // The money was never there: with the document cancelled the revaluation has nothing to revalue.
  f.exec({
    type: 'bank.cancel',
    companyId: f.companyId,
    id: doc.id,
    version: doc.version!,
    reason: 'Səhv sənəd',
  });
  assert.equal(
    step(view(f, '2026-09'), 'revaluation').summary,
    'YQ-2026-09: fərq qalmayıb — storno ediləcək',
  );
  close(f, '2026-09');
  assert.equal(
    step(view(f, '2026-09'), 'revaluation').summary,
    'YQ-2026-09: fərq qalmayıb — storno edildi',
  );
  assert.equal(balance(f, '611'), '0');
  assert.equal(balance(f, '223'), '0');
});

test('FIFO adjustment goes where the goods went, by quantity; to another stock account — 701', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Təchizat ASC', '1700000002');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const cp = f.contract(supplier, 'P-1', 'purchase');
  const cs = f.contract(customer, 'S-1', 'sale');
  const paper = f.product('Kağız A4', 'qutu');
  const shortage = f.item('expenseItem', 'Ofis xərcləri');
  const buy = (date: string, quantity: string, price: string) =>
    f.invoice('purchase', date, supplier, cp, [
      { productId: paper, quantity, price, vatRate: '0' },
    ]);
  buy('2026-09-10', '10', '10');
  f.invoice('sale', '2026-09-15', customer, cs, [
    { productId: paper, quantity: '4', price: '30', vatRate: '0' },
  ]);
  f.operation('2026-09-20', [
    f.line('731', [shortage], '205', [paper], '20', { quantity: '2' }),
    f.line('201', [paper], '205', [paper], '20', { quantity: '2' }),
  ]);
  // Entered afterwards, dated first: the 8 qutu out took 8 × 20.00 under FIFO, booked 8 × 10.00.
  buy('2026-09-05', '10', '20');
  const fifo = step(view(f, '2026-09'), 'fifo');
  const sale = f.db.get("SELECT dt_s1, dt_s2 FROM postings WHERE dt_account='701'")!;
  // 4 sold and 2 moved to 201 (its stock is not re-costed from here): 6/8 of 80.00 to 701.
  assert.deepEqual(
    fifo.postings.map((p) => [p.dt, p.dtSk, p.kt, p.ktSk, p.amount]),
    [
      ['701', [String(sale.dt_s1), String(sale.dt_s2)], '205', [paper], '60.00'],
      ['731', [shortage], '205', [paper], '20.00'],
    ],
  );
  assert.equal(fifo.summary, '1 mal üzrə düzəliş · 80,00');
  close(f, '2026-09');
  assert.equal(balance(f, '205'), '14000', '2 × 20.00 + 10 × 10.00');
  assert.equal(balance(f, '201'), '2000', 'the stock moved keeps its value');
});

test('the closing form opens on the first month not closed: the first posting after the lock', (t) => {
  const f = fixture(t);
  const next = () =>
    f.query<{ month: string }>({ type: 'closingNext', companyId: f.companyId }).month;
  assert.equal(next(), '', 'no postings, no lock: the form keeps the work period');
  september(f);
  assert.equal(next(), '2026-08', 'the opening balances of 31.08');
  close(f, '2026-08');
  assert.equal(next(), '2026-09');
  close(f, '2026-09');
  assert.equal(next(), '2026-10', 'nothing after the lock: the month after it');
  cancel(f, '2026-09');
  assert.equal(next(), '2026-09');
});

test('audit 2026-10-25: the VAT offset never exceeds the VAT of the confirmed e-qaimə', (t) => {
  const f = fixture(t);
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const founder = f.partner('Ağarza Ağalarov', '', 'individual');
  const capitalIn = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const bankK = f.bankAccount(kapital, 'AZ12AIIB38060019441234567890', '223.01', 'AZN', 'Kapital');
  const deposit = f.bankAccount(kapital, 'AZ77AIIB38060019449999999999', '224.04', 'AZN', 'ƏDV');
  const supplier = f.partner('Təchizat ASC', '1700000002');
  const c1 = f.contract(supplier, 'P-1', 'purchase');
  const paper = f.product('Kağız A4', 'qutu');
  const L = f.line;
  f.operation('2026-08-31', [
    L('223.01', [bankK], '301', [founder, capitalIn], '30000'),
    L('224.04', [deposit], '301', [founder, capitalIn], '3000'),
  ]);
  close(f, '2026-08');
  // The invoice says 180.00 VAT; DVX's e-qaimə only 170.00 (the accountant saved it anyway:
  // since 25.10.2026 a difference from DVX is a warning, not a refusal).
  const inv = f.invoice(
    'purchase',
    '2026-09-05',
    supplier,
    c1,
    [{ productId: paper, quantity: '10', price: '100' }],
    { eqNumber: 'MT2609001' },
  );
  confirm(f, [
    { number: 'MT2609001', date: '2026-09-05', taxId: '1700000002', net: '1000.00', vat: '170.00' },
  ]);
  const B = f.bankLine;
  f.bank('out', '2026-09-10', bankK, [B('531.01', [supplier, c1], '1000')]);
  f.bank('out', '2026-09-10', deposit, [B('531.01', [supplier, c1], '180')]);
  const v = view(f, '2026-09');
  assert.deepEqual(
    step(v, 'vat').postings.map((p) => [p.ktSk[1], p.amount]),
    [[`invoice:${inv.id}`, '170.00']],
  );
  assert.match(step(v, 'vat').notes.join(), /DVX-də ƏDV 170,00/);
});
