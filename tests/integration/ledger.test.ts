import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../../src/infrastructure/sqlite/db.js';
import { Ledger } from '../../src/application/ledger.js';
import { DomainError } from '../../src/domain/errors.js';
import type { PostingView } from '../../src/contracts/queries.js';
import { fixture, newKey } from './fixture.js';

const sides = (postings: PostingView[]) => postings.map((p) => [p.account, p.debit, p.credit]);

test('company creation seeds chart, units, a warehouse and expense items; VÖEN is unique', (t) => {
  const f = fixture(t);
  const c = f.catalog();
  assert.equal(c.company.name, 'Meyar Test MMC');
  assert.ok(c.accounts.some((a) => a.code === '224.04'));
  assert.deepEqual(c.units.map((u) => u.code).sort(), [
    'box',
    'kg',
    'l',
    'm',
    'm2',
    'pair',
    'pcs',
    'set',
  ]);
  assert.equal(c.warehouses[0]!.name, 'Əsas anbar');
  assert.deepEqual(
    c.expenseItems.map((e) => e.name),
    ['Nəqliyyat', 'Ofis xərcləri', 'Rabitə', 'Yemək'],
  );
  assert.throws(
    () => f.exec({ type: 'company.create', name: 'Başqa', taxId: '1234567890' }),
    /artıq var/,
  );
  assert.throws(() => f.exec({ type: 'company.create', name: '', taxId: '1' }), /adı/);
});

test('acceptance 1 end-to-end: goods 100 + VAT 18 posts Dt 205/241, Kt 531 and stock', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Təchizatçı MMC', '1700000002');
  const paper = f.product();
  const { id } = f.invoice('purchase', supplier, [f.stockLine(paper, '10', '10', { vat: '18' })]);
  const d = f.invoiceDetail(id);
  assert.deepEqual(sides(d.postings), [
    ['205', '100.00', '0.00'],
    ['241', '18.00', '0.00'],
    ['531', '0.00', '118.00'],
  ]);
  assert.equal(d.total, '118.00');
  assert.equal(d.remaining, '118.00');
  assert.deepEqual(
    f.stock().map((s) => [s.account, s.productName, s.quantity, s.value]),
    [['205', 'Kağız A4', '10', '100.00']],
  );
  assert.equal(f.balances()[0]!.payable, '118.00');
  f.balanced();
});

test('acceptance 2 and 3: line account 201 wins over the card; 2 boxes × 12 = 24 pieces', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Təchizatçı MMC', '1700000002');
  const pens = f.product({ name: 'Qələm', purchaseUnit: 'box', factor: '12' });
  const { id } = f.invoice('purchase', supplier, [
    f.stockLine(pens, '2', '24', { unit: 'purchase', account: '201' }),
  ]);
  const d = f.invoiceDetail(id);
  assert.deepEqual(sides(d.postings), [
    ['201', '48.00', '0.00'],
    ['531', '0.00', '48.00'],
  ]);
  assert.equal(d.lines[0]!.quantity, '2');
  assert.equal(d.lines[0]!.baseQuantity, '24');
  assert.equal(d.postings[0]!.quantity, '24');
  assert.deepEqual(
    f.stock().map((s) => [s.account, s.quantity, s.unit, s.value]),
    [['201', '24', 'Ədəd', '48.00']],
  );
});

test('acceptance 4: replayed request and identical re-save never post twice; numbers are unique per partner', (t) => {
  const f = fixture(t);
  const customer = f.partner();
  const key = newKey();
  const cmd = {
    type: 'invoice.save' as const,
    companyId: f.companyId,
    mode: 'post' as const,
    direction: 'sale' as const,
    number: 'S-0001',
    date: '2026-01-10',
    partnerId: customer,
    note: '',
    lines: [f.serviceLine('100', '18')],
  };
  const first = f.exec(cmd, key);
  assert.deepEqual(f.exec(cmd, key), { ...first, replayed: true });
  assert.throws(() => f.exec({ ...cmd, number: 'S-0002' }, key), /başqa məzmunla/);
  assert.deepEqual(f.exec({ ...cmd, id: first.id, version: 1 }), { id: first.id, version: 1 });
  assert.throws(() => f.exec(cmd), /artıq var/);
  assert.throws(() => f.exec({ ...cmd, number: ' s-0001 ' }), /artıq var/);
  // The same number from another partner is a different document.
  const other = f.partner('Digər MMC', '1700000009');
  f.exec({ ...cmd, partnerId: other });
  assert.equal(f.db.all('SELECT * FROM journal_entries').length, 2);
  f.balanced();
});

test('acceptance 6: company A data is refused inside company B, also below the service layer', (t) => {
  const f = fixture(t);
  const a = f.partner();
  const paper = f.product();
  const b = f.exec({ type: 'company.create', name: 'B MMC', taxId: '9999999999' }).id;
  const bPartner = f.partner('B alıcı', '1700000003', b);
  assert.throws(
    () =>
      f.exec({
        type: 'invoice.save',
        companyId: b,
        mode: 'post',
        direction: 'sale',
        number: 'X',
        date: '2026-01-10',
        partnerId: a,
        note: '',
        lines: [f.serviceLine('1')],
      }),
    /kontragent tapılmadı/,
  );
  assert.throws(
    () =>
      f.exec({
        type: 'invoice.save',
        companyId: b,
        mode: 'post',
        direction: 'purchase',
        number: 'X',
        date: '2026-01-10',
        partnerId: bPartner,
        note: '',
        lines: [f.stockLine(paper, '1', '1')],
      }),
    /nomenklatura seçin/,
  );
  const { id } = f.invoice('sale', a, [f.serviceLine('10')]);
  assert.throws(
    () => f.exec({ type: 'invoice.cancel', companyId: b, id, version: 1, reason: 'x' }),
    /tapılmadı/,
  );
  assert.equal(
    f.query<unknown[]>({
      type: 'invoices',
      companyId: b,
      direction: 'sale',
      from: '2000-01-01',
      to: '2099-12-31',
    }).length,
    0,
  );
  // Composite foreign keys stop a cross-company reference even with raw SQL.
  const entry = f.db.get('SELECT id FROM journal_entries LIMIT 1')!.id as string;
  assert.throws(
    () =>
      f.db.run(
        "INSERT INTO journal_lines(entry_id,line_no,company_id,account,debit,credit,partner_id) VALUES(?,99,?,'211',1,0,?)",
        entry,
        f.companyId,
        bPartner,
      ),
    /FOREIGN KEY/,
  );
});

test('acceptance 7: a stale version never overwrites the latest document', (t) => {
  const f = fixture(t);
  const customer = f.partner();
  const { id } = f.invoice('sale', customer, [f.serviceLine('100')], { number: 'S-1' });
  const base = {
    type: 'invoice.save' as const,
    companyId: f.companyId,
    mode: 'post' as const,
    direction: 'sale' as const,
    number: 'S-1',
    date: '2026-01-10',
    partnerId: customer,
    note: '',
    id,
  };
  f.exec({ ...base, version: 1, lines: [f.serviceLine('150')] });
  assert.throws(
    () => f.exec({ ...base, version: 1, lines: [f.serviceLine('999')] }),
    (e) => {
      assert.ok(e instanceof DomainError);
      assert.equal(e.code, 'stale');
      return true;
    },
  );
  assert.equal(f.invoiceDetail(id).total, '150.00');
  assert.throws(() => f.exec({ ...base, lines: [f.serviceLine('1')] }), /dəyişdirilib/);
});

test('acceptance 8: closed period blocks new, edit and cancel; identical retries stay harmless', (t) => {
  const f = fixture(t);
  const customer = f.partner();
  const key = newKey();
  const cmd = {
    type: 'invoice.save' as const,
    companyId: f.companyId,
    mode: 'post' as const,
    direction: 'sale' as const,
    number: 'S-1',
    date: '2026-01-10',
    partnerId: customer,
    note: '',
    lines: [f.serviceLine('100')],
  };
  const { id } = f.exec(cmd, key);
  const pay = f.payment('in', customer, '50').id;
  f.exec({ type: 'period.close', companyId: f.companyId, through: '2026-01-31' });
  const before = f.db.all('SELECT COUNT(*) AS n FROM journal_lines')[0]!.n;
  assert.equal(f.exec(cmd, key).replayed, true);
  assert.deepEqual(f.exec({ ...cmd, id, version: 1 }), { id, version: 1 });
  assert.throws(
    () => f.exec({ ...cmd, id, version: 1, lines: [f.serviceLine('200')] }),
    /bağlanıb/,
  );
  assert.throws(() => f.exec({ ...cmd, id, version: 1, date: '2026-02-01' }), /bağlanıb/);
  assert.throws(() => f.exec({ ...cmd, number: 'S-2' }), /bağlanıb/);
  assert.throws(
    () => f.exec({ type: 'invoice.cancel', companyId: f.companyId, id, version: 1, reason: 'x' }),
    /bağlanıb/,
  );
  assert.throws(
    () =>
      f.exec({ type: 'payment.cancel', companyId: f.companyId, id: pay, version: 1, reason: 'x' }),
    /bağlanıb/,
  );
  assert.throws(
    () => f.exec({ type: 'period.close', companyId: f.companyId, through: '2026-01-15' }),
    /artıq bağlıdır/,
  );
  assert.throws(
    () => f.exec({ type: 'period.close', companyId: f.companyId, through: '2026-12-31' }),
    /keçmiş tarixə/,
  );
  assert.throws(() => f.db.run("UPDATE companies SET closed_through='2026-01-01'"), /açıla bilməz/);
  assert.equal(f.db.all('SELECT COUNT(*) AS n FROM journal_lines')[0]!.n, before);
  // A raw insert into the closed period is refused by the database itself.
  assert.throws(
    () =>
      f.db.run(
        "INSERT INTO journal_entries VALUES('x',?,'2026-01-05','invoice','x','x',1,0,'now')",
        f.companyId,
      ),
    /bağlanıb/,
  );
});

test('acceptance 9: an edit reverses the old version exactly once; cancel restores accounts and stock', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Təchizatçı', '1700000002');
  const paper = f.product();
  const { id } = f.invoice('purchase', supplier, [f.stockLine(paper, '10', '10', { vat: '18' })], {
    number: 'P-1',
  });
  const base = {
    type: 'invoice.save' as const,
    companyId: f.companyId,
    mode: 'post' as const,
    direction: 'purchase' as const,
    number: 'P-1',
    date: '2026-01-10',
    partnerId: supplier,
    note: '',
    id,
  };
  f.exec({ ...base, version: 1, lines: [f.stockLine(paper, '5', '10', { vat: '9' })] });
  const d = f.invoiceDetail(id);
  assert.equal(d.version, 2);
  assert.deepEqual(
    d.postings.map((p) => [p.version, p.reversal, p.account, p.debit, p.credit]),
    [
      [1, false, '205', '100.00', '0.00'],
      [1, false, '241', '18.00', '0.00'],
      [1, false, '531', '0.00', '118.00'],
      [1, true, '205', '0.00', '100.00'],
      [1, true, '241', '0.00', '18.00'],
      [1, true, '531', '118.00', '0.00'],
      [2, false, '205', '50.00', '0.00'],
      [2, false, '241', '9.00', '0.00'],
      [2, false, '531', '0.00', '59.00'],
    ],
  );
  assert.deepEqual(
    f.stock().map((s) => [s.quantity, s.value]),
    [['5', '50.00']],
  );
  assert.equal(f.row(f.trial(), '531')!.closingCredit, '59.00');
  f.exec({ type: 'invoice.cancel', companyId: f.companyId, id, version: 2, reason: 'Səhv qaimə' });
  assert.deepEqual(f.stock(), []);
  assert.equal(f.row(f.trial(), '531')!.closingCredit, '0.00');
  assert.equal(f.invoiceDetail(id).status, 'cancelled');
  assert.deepEqual(
    f.invoiceDetail(id).history.map((h) => [h.version, h.status]),
    [
      [1, 'posted'],
      [2, 'posted'],
      [3, 'cancelled'],
    ],
  );
  assert.throws(
    () => f.exec({ ...base, version: 3, lines: [f.stockLine(paper, '1', '1')] }),
    /dəyişdirilmir/,
  );
  // Ledger rows can never be edited in place.
  assert.throws(() => f.db.run('UPDATE journal_lines SET debit=1'), /dəyişdirilə bilməz/);
  assert.throws(() => f.db.run('DELETE FROM journal_entries'), /silinə bilməz/);
  f.balanced();
});

test('acceptance 10 and 11: average cost 60 on sale; a shortage saves nothing at all', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Təchizatçı', '1700000002');
  const customer = f.partner('Alıcı', '1700000001');
  const goods = f.product({ name: 'Mal' });
  f.invoice('purchase', supplier, [f.stockLine(goods, '10', '10')], { date: '2026-01-05' });
  f.invoice('purchase', supplier, [f.stockLine(goods, '10', '20')], { date: '2026-01-06' });
  const sale = (quantity: string, number: string, date = '2026-01-10') =>
    f.invoice(
      'sale',
      customer,
      [f.stockLine(goods, quantity, '50', { account: '601', stockAccount: '205', vat: '0' })],
      { number, date },
    );
  const { id } = sale('4', 'S-1');
  const d = f.invoiceDetail(id);
  assert.deepEqual(sides(d.postings), [
    ['211', '200.00', '0.00'],
    ['601', '0.00', '200.00'],
    ['701', '60.00', '0.00'],
    ['205', '0.00', '60.00'],
  ]);
  const before = f.db.all('SELECT COUNT(*) AS n FROM journal_lines')[0]!.n;
  const invoicesBefore = f.invoices('sale').length;
  assert.throws(
    () => sale('17', 'S-2'),
    (e) => {
      assert.ok(e instanceof DomainError);
      assert.equal(e.code, 'insufficient-stock');
      return true;
    },
  );
  assert.equal(f.db.all('SELECT COUNT(*) AS n FROM journal_lines')[0]!.n, before);
  assert.equal(f.invoices('sale').length, invoicesBefore);
  // Selling the rest clears quantity and value together.
  sale('16', 'S-3');
  assert.deepEqual(f.stock(), []);
  assert.equal(f.row(f.trial(), '701')!.closingDebit, '300.00');
  f.balanced();
});

test('stock chronology: back-dated movements and edits behind later movements are refused', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Təchizatçı', '1700000002');
  const customer = f.partner('Alıcı', '1700000001');
  const goods = f.product({ name: 'Mal' });
  const receipt = f.invoice('purchase', supplier, [f.stockLine(goods, '10', '10')], {
    date: '2026-01-05',
    number: 'P-1',
  });
  f.invoice(
    'sale',
    customer,
    [f.stockLine(goods, '2', '50', { account: '601', stockAccount: '205' })],
    { date: '2026-01-10' },
  );
  assert.throws(
    () => f.invoice('purchase', supplier, [f.stockLine(goods, '1', '99')], { date: '2026-01-07' }),
    /sonrakı hərəkət/,
  );
  assert.throws(
    () =>
      f.exec({
        type: 'invoice.cancel',
        companyId: f.companyId,
        id: receipt.id,
        version: 1,
        reason: 'x',
      }),
    /sonrakı hərəkət/,
  );
  // On the same or a later date the receipt is fine.
  f.invoice('purchase', supplier, [f.stockLine(goods, '1', '99')], { date: '2026-01-10' });
  f.balanced();
});

test('cancelling a receipt whose goods were sold on the same day would go negative and is refused', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Təchizatçı', '1700000002');
  const customer = f.partner('Alıcı', '1700000001');
  const goods = f.product({ name: 'Mal' });
  const receipt = f.invoice('purchase', supplier, [f.stockLine(goods, '5', '10')], {
    date: '2026-01-05',
  });
  f.invoice(
    'sale',
    customer,
    [f.stockLine(goods, '5', '20', { account: '601', stockAccount: '205' })],
    { date: '2026-01-05' },
  );
  assert.throws(
    () =>
      f.exec({
        type: 'invoice.cancel',
        companyId: f.companyId,
        id: receipt.id,
        version: 1,
        reason: 'x',
      }),
    /mənfiyə düşür/,
  );
});

test('acceptance 12: a payment splits over invoices, never beyond either side; the rest is an advance', (t) => {
  const f = fixture(t);
  const customer = f.partner();
  const a = f.invoice('sale', customer, [f.serviceLine('100', '18')], { date: '2026-01-10' }).id;
  const b = f.invoice('sale', customer, [f.serviceLine('50', '9')], { date: '2026-01-12' }).id;
  assert.throws(
    () => f.payment('in', customer, '300', { allocations: [{ invoiceId: a, amount: '118.01' }] }),
    /qalıq borcu 118.00/,
  );
  assert.throws(
    () =>
      f.payment('in', customer, '100', {
        allocations: [
          { invoiceId: a, amount: '60' },
          { invoiceId: b, amount: '40.01' },
        ],
      }),
    /bağlanmamış qalığından/,
  );
  assert.throws(
    () =>
      f.payment('in', customer, '300', {
        date: '2026-01-11',
        allocations: [{ invoiceId: b, amount: '1' }],
      }),
    /bağlama tarixi ondan əvvəl/,
  );
  const pay = f.payment('in', customer, '300', {
    allocations: [
      { invoiceId: a, amount: '118' },
      { invoiceId: b, amount: '20.50' },
    ],
  }).id;
  const p = f.paymentDetail(pay);
  assert.equal(p.allocated, '138.50');
  assert.equal(p.unallocated, '161.50');
  assert.deepEqual(sides(p.postings), [
    ['223', '300.00', '0.00'],
    ['211', '0.00', '300.00'],
  ]);
  assert.deepEqual(
    f
      .invoices('sale')
      .map((i) => [i.total, i.paid, i.remaining])
      .sort(),
    [
      ['118.00', '118.00', '0.00'],
      ['59.00', '20.50', '38.50'],
    ],
  );
  // 211: 177 invoiced − 300 received = 123 customer advance (credit side).
  assert.equal(f.row(f.trial(), '211')!.closingCredit, '123.00');
  assert.equal(f.balances()[0]!.receivable, '-123.00');
  // Linking the advance later is analytics only: the ledger does not change.
  const lines = f.db.all('SELECT COUNT(*) AS n FROM journal_lines')[0]!.n;
  f.exec({
    type: 'allocation.create',
    companyId: f.companyId,
    paymentId: pay,
    date: '2026-01-25',
    allocations: [{ invoiceId: b, amount: '38.50' }],
  });
  assert.equal(f.db.all('SELECT COUNT(*) AS n FROM journal_lines')[0]!.n, lines);
  assert.equal(f.paymentDetail(pay).unallocated, '123.00');
  // Linked invoices cannot be edited or cancelled until the link is released.
  assert.throws(
    () =>
      f.exec({ type: 'invoice.cancel', companyId: f.companyId, id: a, version: 1, reason: 'x' }),
    /bağlantını açın/,
  );
  const link = f.paymentDetail(pay).allocations.find((x) => x.invoiceId === a)!;
  f.exec({
    type: 'allocation.cancel',
    companyId: f.companyId,
    id: link.id,
    reason: 'Səhv bağlanıb',
  });
  assert.equal(f.invoices('sale').find((i) => i.id === a)!.remaining, '118.00');
  f.exec({
    type: 'invoice.cancel',
    companyId: f.companyId,
    id: a,
    version: 1,
    reason: 'Səhv qaimə',
  });
  // Cancelling the payment releases every remaining link.
  f.exec({
    type: 'payment.cancel',
    companyId: f.companyId,
    id: pay,
    version: 1,
    reason: 'Bank qaytardı',
  });
  assert.equal(f.invoices('sale').find((i) => i.id === b)!.remaining, '59.00');
  assert.ok(f.paymentDetail(pay).allocations.every((x) => x.status === 'cancelled'));
  f.balanced();
});

test('editing a payment re-posts it and replaces its split atomically', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Təchizatçı', '1700000002');
  const inv = f.invoice('purchase', supplier, [
    f.serviceLine('100', '18', { account: '721', expenseItemId: f.expenseItem() }),
  ]).id;
  const pay = f.payment('out', supplier, '50', {
    reference: 'OUT-1',
    allocations: [{ invoiceId: inv, amount: '50' }],
  }).id;
  const base = {
    type: 'payment.save' as const,
    companyId: f.companyId,
    direction: 'out' as const,
    bankAccount: '223',
    reference: 'OUT-1',
    date: '2026-01-20',
    partnerId: supplier,
    note: '',
    id: pay,
  };
  assert.deepEqual(
    f.exec({ ...base, version: 1, amount: '50', allocations: [{ invoiceId: inv, amount: '50' }] }),
    { id: pay, version: 1 },
  );
  f.exec({ ...base, version: 1, amount: '118', allocations: [{ invoiceId: inv, amount: '118' }] });
  const p = f.paymentDetail(pay);
  assert.equal(p.version, 2);
  assert.equal(p.allocations.filter((a) => a.status === 'active').length, 1);
  assert.equal(f.invoices('purchase')[0]!.remaining, '0.00');
  assert.equal(f.balances()[0]!.payable, '0.00');
  assert.throws(() => f.payment('out', supplier, '1', { reference: 'out-1' }), /artıq var/);
  f.balanced();
});

test('acceptance 14 and 15: DBC opening + turnover = closing; postings follow the document id', (t) => {
  const f = fixture(t);
  const customer = f.partner();
  const supplier = f.partner('Təchizatçı', '1700000002');
  f.invoice('sale', customer, [f.serviceLine('100', '18')], {
    date: '2026-01-10',
    number: 'SAME-1',
  });
  const purchase = f.invoice(
    'purchase',
    supplier,
    [f.serviceLine('40', '7.20', { account: '721', expenseItemId: f.expenseItem() })],
    {
      date: '2026-02-03',
      number: 'SAME-1',
    },
  ).id;
  f.payment('in', customer, '118', { date: '2026-02-10' });
  const tb = f.trial('2026-02-01', '2026-02-28');
  for (const r of tb.rows) {
    const open = Number(r.openingDebit) - Number(r.openingCredit);
    const close = Number(r.closingDebit) - Number(r.closingCredit);
    // Integer cents only; Number() is safe at these magnitudes in a test.
    assert.equal(
      Math.round((open + Number(r.debit) - Number(r.credit)) * 100),
      Math.round(close * 100),
      r.account,
    );
  }
  assert.equal(f.row(tb, '211')!.openingDebit, '118.00');
  assert.equal(f.row(tb, '211')!.closingDebit, '0.00');
  assert.deepEqual(sides(f.invoiceDetail(purchase).postings), [
    ['721', '40.00', '0.00'],
    ['241', '7.20', '0.00'],
    ['531', '0.00', '47.20'],
  ]);
  f.balanced();
});

test('settlement accounts are shown expanded: debtors and creditors are not netted', (t) => {
  const f = fixture(t);
  const a = f.partner('A', '1700000001');
  const b = f.partner('B', '1700000002');
  f.invoice('sale', a, [f.serviceLine('100')]);
  f.payment('in', b, '30');
  const r = f.row(f.trial(), '211')!;
  assert.equal(r.closingDebit, '100.00');
  assert.equal(r.closingCredit, '30.00');
  f.balanced();
});

test('sub-accounts roll up into their parent and lock direct posting to it', (t) => {
  const f = fixture(t);
  const supplier = f.partner('Təchizatçı', '1700000002');
  assert.throws(
    () =>
      f.exec({
        type: 'account.create',
        companyId: f.companyId,
        parentCode: '531',
        code: '531.01',
        name: 'x',
      }),
    /yalnız/,
  );
  f.exec({
    type: 'account.create',
    companyId: f.companyId,
    parentCode: '205',
    code: '205.01',
    name: 'Tikinti malları',
  });
  const goods = f.product({ account: '205.01' });
  assert.throws(
    () => f.invoice('purchase', supplier, [f.stockLine(goods, '1', '10', { account: '205' })]),
    /subhesab seçin/,
  );
  f.invoice('purchase', supplier, [f.stockLine(goods, '1', '10', { account: '205.01' })]);
  const tb = f.trial();
  assert.deepEqual(
    tb.rows
      .filter((r) => r.account.startsWith('205'))
      .map((r) => [r.account, r.depth, r.closingDebit]),
    [
      ['205', 0, '10.00'],
      ['205.01', 1, '10.00'],
    ],
  );
  assert.equal(
    f.trial('2026-01-01', '2026-12-31', true).rows.some((r) => r.account === '205.01'),
    false,
  );
  // A used leaf cannot silently become a group.
  f.invoice('purchase', supplier, [
    f.serviceLine('5', '0', { account: '721', expenseItemId: f.expenseItem() }),
  ]);
  assert.throws(
    () =>
      f.exec({
        type: 'account.create',
        companyId: f.companyId,
        parentCode: '721',
        code: '721.01',
        name: 'x',
      }),
    /artıq yazılış var/,
  );
  f.balanced();
});

test('drafts carry no financial effect until posted; posted documents never return to draft', (t) => {
  const f = fixture(t);
  const customer = f.partner();
  const base = {
    type: 'invoice.save' as const,
    companyId: f.companyId,
    direction: 'sale' as const,
    number: 'D-1',
    date: '2026-01-10',
    partnerId: customer,
    note: '',
  };
  const draft = f.exec({ ...base, mode: 'draft', lines: [] });
  assert.equal(f.invoiceDetail(draft.id).status, 'draft');
  assert.equal(f.db.all('SELECT * FROM journal_entries').length, 0);
  assert.throws(
    () => f.exec({ ...base, mode: 'post', id: draft.id, version: 1, lines: [] }),
    /ən azı bir/,
  );
  f.exec({ ...base, mode: 'post', id: draft.id, version: 1, lines: [f.serviceLine('10')] });
  assert.equal(f.invoiceDetail(draft.id).status, 'posted');
  assert.throws(
    () =>
      f.exec({ ...base, mode: 'draft', id: draft.id, version: 2, lines: [f.serviceLine('10')] }),
    /qaralamaya qaytarılmır/,
  );
  f.exec({ ...base, mode: 'draft', number: 'D-2', lines: [] });
  assert.throws(
    () => f.exec({ type: 'period.close', companyId: f.companyId, through: '2026-01-31' }),
    /qaralama/,
  );
});

test('acceptance 16: a backup reopens with identical documents, ledger, stock and balances', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-'));
  const f = fixture(t, join(dir, 'live.sqlite'));
  // After-hooks run in registration order: the fixture closes the database first.
  // Windows refuses to delete a file that is still open.
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const supplier = f.partner('Təchizatçı', '1700000002');
  const customer = f.partner();
  const goods = f.product();
  f.invoice('purchase', supplier, [f.stockLine(goods, '10', '10', { vat: '18' })]);
  const sale = f.invoice('sale', customer, [
    f.stockLine(goods, '3', '30', { account: '601', stockAccount: '205', vat: '16.20' }),
  ]).id;
  f.payment('in', customer, '50', { allocations: [{ invoiceId: sale, amount: '50' }] });
  const target = join(dir, 'backup.sqlite');
  await f.db.backup(target);
  const copy = new Db(target);
  try {
    const restored = new Ledger(copy);
    const read = (q: object) => JSON.stringify(restored.query({ companyId: f.companyId, ...q }));
    const live = (q: object) => JSON.stringify(f.query({ companyId: f.companyId, ...q }));
    for (const q of [
      { type: 'catalog' },
      { type: 'invoices', direction: 'sale', from: '2000-01-01', to: '2099-12-31' },
      { type: 'payments', direction: 'in', from: '2000-01-01', to: '2099-12-31' },
      { type: 'journal', from: '2000-01-01', to: '2099-12-31', account: '' },
      { type: 'trialBalance', from: '2000-01-01', to: '2099-12-31', rollup: false },
      { type: 'stock', asOf: '2099-12-31' },
      { type: 'partnerBalances', asOf: '2099-12-31' },
    ])
      assert.equal(read(q), live(q), q.type);
  } finally {
    copy.close();
  }
});

test('a database from a newer program is refused unchanged', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'future.sqlite');
  const db = new Db(path);
  db.raw.exec('PRAGMA user_version=99');
  db.close();
  assert.throws(() => new Db(path), /daha yeni versiyası/);
});

test('malformed commands are rejected at the boundary with a pointer to the field', (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.ledger.execute({ type: 'nope' }, { actor: 'x', correlationId: 'x' }),
    /Sorğu düzgün deyil/,
  );
  assert.throws(
    () =>
      f.ledger.execute(
        { type: 'partner.save', key: 'short', companyId: f.companyId, name: 'x', taxId: '1' },
        { actor: 'x', correlationId: 'x' },
      ),
    /key/,
  );
  assert.throws(() => f.invoice('sale', f.partner(), [f.serviceLine('1.001')]), /2 onluq/);
  assert.throws(
    () =>
      f.invoice('sale', f.partner('X', '1700000005'), [f.serviceLine('10')], {
        date: '2026-02-30',
      }),
    /təqvimdə/,
  );
  assert.throws(() => f.partner('Y', '12345'), /10 rəqəm/);
});

test('audit records who changed what, in which company', (t) => {
  const f = fixture(t);
  const customer = f.partner();
  f.invoice('sale', customer, [f.serviceLine('10')], { number: 'S-AUD' });
  const audit = f.query<{ action: string; entity: string; detail: string; actor: string }[]>({
    type: 'audit',
    companyId: f.companyId,
    limit: 10,
  });
  assert.equal(audit[0]!.action, 'Uçota alındı');
  assert.match(audit[0]!.detail, /S-AUD · v1 · 10.00 AZN/);
  assert.equal(audit[0]!.actor, 'test');
  assert.throws(() => f.db.run('DELETE FROM audit'), /silinə bilməz/);
});
