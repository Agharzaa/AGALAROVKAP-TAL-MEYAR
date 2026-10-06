import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from '../../src/infrastructure/sqlite/db.js';
import { migrations, SCHEMA_VERSION } from '../../src/infrastructure/sqlite/schema.js';
import { readCsv, readStatementTable } from '../../src/domain/statement.js';
import type { PostingView, StatementLineView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

const sides = (postings: PostingView[]) =>
  postings.filter((p) => !p.reversal).map((p) => [p.account, p.debit, p.credit]);

test('v1 databases migrate: payments keep their data and become settlements; new accounts appear', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'v1.sqlite');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON');
  raw.exec(migrations[0]!.sql);
  raw.exec('PRAGMA user_version=1');
  raw.exec(`
    INSERT INTO companies(id,name,tax_id,created_at) VALUES('c1','Köhnə MMC','1000000001','2026-01-01');
    INSERT INTO accounts VALUES('c1','223','Bank',NULL,'active','[]',0,1,0);
    INSERT INTO accounts VALUES('c1','211','Alıcılar',NULL,'active-passive','["partner"]',0,1,0);
    INSERT INTO accounts VALUES('c1','521','Vergi',NULL,'passive','[]',0,1,0);
    INSERT INTO partners(id,company_id,name,tax_id) VALUES('p1','c1','Alıcı','1700000001');
    INSERT INTO payments VALUES('pay1','c1','in','223','B-1','B-1','2026-01-05','p1',15000,'posted',1,'','x','x');
  `);
  raw.close();

  const db = new Db(path);
  t.after(() => db.close());
  assert.equal(db.version(), SCHEMA_VERSION);
  const pay = db.get('SELECT * FROM payments WHERE id=?', 'pay1')!;
  assert.equal(pay.kind, 'settlement');
  assert.equal(pay.counter_account, '211');
  assert.equal(pay.amount, 15000n);
  assert.equal(pay.partner_id, 'p1');
  const codes = db.all("SELECT code FROM accounts WHERE company_id='c1' ORDER BY code").map((r) => r.code);
  for (const code of ['222', '301', '511', '522', '533', '611', '731']) assert.ok(codes.includes(code), code);
  assert.equal(db.get("SELECT nature FROM accounts WHERE code='521'")!.nature, 'active-passive');
  assert.ok(db.get("SELECT 1 AS x FROM expense_items WHERE name='Bank xidmətləri'"));
  assert.equal(db.raw.prepare('PRAGMA foreign_keys').get()!.foreign_keys, 1);
  assert.throws(() => db.run('DELETE FROM payments'), /silinmir/);
});

test('bank operation kinds post to their own accounts without a partner where 1C does not need one', (t) => {
  const f = fixture(t);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const tax = f.payment('out', '', '500', { kind: 'tax', partnerId: undefined });
  assert.deepEqual(sides(f.paymentDetail(tax.id).postings), [
    ['521', '500.00', '0.00'],
    ['223', '0.00', '500.00'],
  ]);
  const social = f.payment('out', '', '220', { kind: 'social', partnerId: undefined });
  const salary = f.payment('out', '', '1000', { kind: 'salary', partnerId: undefined });
  assert.throws(
    () => f.payment('out', '', '3', { kind: 'fee', partnerId: undefined }),
    /xərc maddəsi/,
  );
  const fee = f.payment('out', '', '3', {
    kind: 'fee',
    partnerId: undefined,
    expenseItemId: f.expenseItem('Bank xidmətləri'),
  });
  const capital = f.payment('in', bank, '10000', { kind: 'capital' });
  assert.throws(() => f.payment('in', '', '1', { kind: 'capital', partnerId: undefined }), /Kontragent/);
  assert.throws(() => f.payment('in', '', '1', { kind: 'salary', partnerId: undefined }), /üçün deyil/);
  const loan = f.payment('in', bank, '2000', { kind: 'loan' });
  const transfer = f.payment('out', '', '700', { kind: 'transfer', partnerId: undefined });
  assert.deepEqual(sides(f.paymentDetail(transfer.id).postings), [
    ['222', '700.00', '0.00'],
    ['223', '0.00', '700.00'],
  ]);
  assert.equal(f.paymentDetail(fee.id).kindLabel, 'Bank xidmət haqqı');
  assert.equal(f.paymentDetail(capital.id).counterAccount, '301');
  const tb = f.balanced();
  assert.equal(f.row(tb, '521')!.closingDebit, '500.00');
  assert.equal(f.row(tb, '522')!.closingDebit, '220.00');
  assert.equal(f.row(tb, '533')!.closingDebit, '1000.00');
  assert.equal(f.row(tb, '721')!.closingDebit, '3.00');
  assert.equal(f.row(tb, '301')!.closingCredit, '10000.00');
  assert.equal(f.row(tb, '511')!.closingCredit, '2000.00');
  assert.equal(f.row(tb, '222')!.closingDebit, '700.00');
  assert.equal(f.row(tb, '223')!.closingDebit, '9577.00');
  void social;
  void salary;
  void loan;
});

test('only settlements link to invoices; FIFO auto-allocation offsets advances on the invoice date', (t) => {
  const f = fixture(t);
  const customer = f.partner();
  // Advance first, invoices later (1C: avansın əvəzləşdirilməsi).
  const advance = f.payment('in', customer, '1500', { date: '2026-01-05' });
  const inv1 = f.invoice('sale', customer, [f.serviceLine('1000')], { date: '2026-01-10' });
  const inv2 = f.invoice('sale', customer, [f.serviceLine('800')], { date: '2026-01-12' });
  const r = f.exec({ type: 'allocation.auto', companyId: f.companyId, partnerId: customer });
  assert.equal(r.count, 2);
  const detail = f.paymentDetail(advance.id);
  assert.deepEqual(
    detail.allocations.map((a) => [a.invoiceNumber, a.date, a.amount]),
    [
      [f.invoiceDetail(inv1.id).number, '2026-01-10', '1000.00'],
      [f.invoiceDetail(inv2.id).number, '2026-01-12', '500.00'],
    ],
  );
  assert.equal(detail.unallocated, '0.00');
  assert.equal(f.invoiceDetail(inv2.id).remaining, '300.00');

  const tax = f.payment('out', '', '10', { kind: 'tax', partnerId: undefined });
  assert.throws(
    () =>
      f.exec({
        type: 'allocation.create',
        companyId: f.companyId,
        paymentId: tax.id,
        date: '2026-01-20',
        allocations: [{ invoiceId: inv2.id, amount: '10' }],
      }),
    /uyğun deyil|kontragentin/,
  );
  assert.throws(
    () =>
      f.payment('in', customer, '10', {
        kind: 'refund',
        allocations: [{ invoiceId: inv2.id, amount: '10' }],
      }),
    /yalnız alıcı\/malsatan/,
  );
  // Database guard: even a direct insert cannot link a non-settlement payment.
  assert.throws(
    () =>
      f.db.run(
        "INSERT INTO allocations(id,company_id,payment_id,invoice_id,date,amount,status,created_at) VALUES('x',?,?,?,'2026-01-20',100,'active','x')",
        f.companyId,
        tax.id,
        inv2.id,
      ),
    /uyğun deyil/,
  );
  f.balanced();
});

const STATEMENT = `Kapital Bank ASC;;;;;
Hesab: AZ00AIIB00000000000000000000;;;;;
Tarix;Sənəd №;Kontragent;VÖEN;Mədaxil;Məxaric;Ödənişin təyinatı
05.01.2026;101;Alıcı MMC;1700000001;"1 500,00";;Müqavilə 12 üzrə ödəniş, ƏDV daxil
06.01.2026;102;Yeni Təchizatçı MMC;1700000099;;"2 360,00";Hesab-faktura 55 üzrə ödəniş
06.01.2026;;Kapital Bank ASC;9900003611;;1,50;Hesabın aparılmasına görə komissiya
06.01.2026;;Kapital Bank ASC;9900003611;;1,50;Hesabın aparılmasına görə komissiya
10.01.2026;103;Dövlət Xəzinədarlığı;1401555071;;"340,00";ƏDV ödənişi, büdcə təsnifatı kodu 113110
10.01.2026;104;DSMF;1401111111;;"220,00";Məcburi dövlət sosial sığorta haqqı
11.01.2026;105;Meyar Test MMC;1234567890;;"700,00";Öz hesabına köçürmə
12.01.2026;106;Naməlum;;"50,00";;Qeydsiz daxilolma
;;;;Cəmi;"1 550,00";"3 623,00"
`;

test('bank statement: read, import once, classify, post high-confidence lines, auto-link invoices', (t) => {
  const f = fixture(t);
  const customer = f.partner('Alıcı MMC', '1700000001');
  const inv = f.invoice('sale', customer, [f.serviceLine('1000', '180')], { date: '2026-01-02' });

  const read = readStatementTable(readCsv(STATEMENT));
  assert.deepEqual(read.problems, []);
  assert.equal(read.lines.length, 8);
  assert.deepEqual(read.lines[0], {
    date: '2026-01-05',
    direction: 'in',
    amount: '1500.00',
    reference: '101',
    counterparty: 'Alıcı MMC',
    counterpartyTaxId: '1700000001',
    purpose: 'Müqavilə 12 üzrə ödəniş, ƏDV daxil',
  });
  assert.equal(read.lines[2]!.amount, '1.50');

  const imp = (fileName = 'yanvar.csv') =>
    f.exec({ type: 'bankStatement.import', companyId: f.companyId, bankAccount: '223', fileName, lines: read.lines });
  assert.deepEqual([imp().count, imp().count], [8, 0]);
  assert.equal(imp('təkrar.csv').skipped, 8);

  const rows = f.query<StatementLineView[]>({ type: 'bankStatement', companyId: f.companyId });
  assert.equal(rows.length, 8);
  const kinds = rows.map((r) => [r.suggestion!.kind, r.suggestion!.confidence]);
  assert.deepEqual(kinds, [
    ['settlement', 'high'],
    ['settlement', 'medium'],
    ['fee', 'high'],
    ['fee', 'high'],
    ['tax', 'high'],
    ['social', 'high'],
    ['transfer', 'high'],
    ['other', 'low'],
  ]);
  assert.equal(rows[1]!.suggestion!.createPartner, true);

  // "Avtomatik keçir": the screen sends every high-confidence proposal as is.
  const high = rows.filter((r) => r.suggestion!.confidence === 'high');
  const posted = f.exec({
    type: 'bankStatement.post',
    companyId: f.companyId,
    lines: high.map((r) => {
      const { confidence: _c, reason: _r, ...s } = r.suggestion!;
      return { lineId: r.id, ...s, createPartner: !!s.createPartner, autoAllocate: true };
    }),
  });
  assert.equal(posted.count, 6);
  assert.equal(posted.skipped, 1, 'one invoice link created');
  assert.equal(f.invoiceDetail(inv.id).remaining, '0.00');

  // The new supplier is created from the statement's name and VÖEN.
  const supplierLine = rows[1]!;
  f.exec({
    type: 'bankStatement.post',
    companyId: f.companyId,
    lines: [{ lineId: supplierLine.id, kind: 'settlement', createPartner: true, autoAllocate: true }],
  });
  assert.ok(f.catalog().partners.some((p) => p.taxId === '1700000099' && p.name === 'Yeni Təchizatçı MMC'));
  assert.throws(
    () =>
      f.exec({
        type: 'bankStatement.post',
        companyId: f.companyId,
        lines: [{ lineId: supplierLine.id, kind: 'settlement', createPartner: true, autoAllocate: true }],
      }),
    /artıq keçirilib/,
  );
  const unknown = rows[7]!;
  f.exec({ type: 'bankStatement.ignore', companyId: f.companyId, lineIds: [unknown.id], reason: 'Bankla dəqiqləşdirilir' });
  assert.equal(f.query<StatementLineView[]>({ type: 'bankStatement', companyId: f.companyId }).length, 0);
  const all = f.query<StatementLineView[]>({ type: 'bankStatement', companyId: f.companyId, status: 'all' });
  assert.deepEqual(
    all.map((r) => r.status),
    ['posted', 'posted', 'posted', 'posted', 'posted', 'posted', 'posted', 'ignored'],
  );
  assert.equal(new Set(all.filter((r) => r.paymentReference).map((r) => r.paymentReference)).size, 7);

  const tb = f.balanced();
  // 1500 in − 2360 − 1.50×2 − 340 − 220 − 700 out
  assert.equal(f.row(tb, '223')!.closingCredit, '2123.00');
  assert.equal(f.row(tb, '211')!.closingCredit, '320.00', 'customer advance after the invoice');
  assert.equal(f.row(tb, '531')!.closingDebit, '2360.00', 'supplier prepayment');
  assert.equal(f.row(tb, '721')!.closingDebit, '3.00');
  assert.equal(f.row(tb, '521')!.closingDebit, '340.00');
  assert.equal(f.row(tb, '522')!.closingDebit, '220.00');
  assert.equal(f.row(tb, '222')!.closingDebit, '700.00');
});
