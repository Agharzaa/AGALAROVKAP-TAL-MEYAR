import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../../src/infrastructure/sqlite/db.js';
import type { IntegrityView, OperationDetail } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

/**
 * The September example agreed with the user (docs/QERARLAR.md), entered as manual operations:
 * opening capital in two banks and the VAT deposit, a purchase with VAT, its payment from the
 * bank and the deposit, a 15 000 sale, an 18 000 payment split between 223.01/224.04 and between
 * the invoice and an advance (543.01), a bank fee and the cost of goods sold.
 */
function september(f: ReturnType<typeof fixture>) {
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const pasha = f.partner('PAŞA Bank ASC', '1700767721');
  const founder = f.partner('Ağarza Ağalarov', '', 'individual');
  const supplier = f.partner('Təchizat ASC', '1700000002');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const bankK = f.bankAccount(
    kapital,
    'AZ12AIIB38060019441234567890',
    '223.01',
    'AZN',
    'Kapital Bank AZN',
  );
  const bankP = f.bankAccount(
    pasha,
    'AZ55PAHA40060AZNHC0101091203',
    '223.01',
    'AZN',
    'PAŞA Bank AZN',
  );
  const deposit = f.bankAccount(
    kapital,
    'AZ77AIIB38060019449999999999',
    '224.04',
    'AZN',
    'ƏDV depozit',
  );
  const c12 = f.contract(supplier, '12', 'purchase');
  const c7 = f.contract(customer, '7', 'sale');
  const paper = f.product('Kağız A4', 'qutu');
  const goods = f.item('incomeType', 'Məhsul satışı');
  const vat = f.item('taxType', 'ƏDV');
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  const L = f.line;
  f.operation(
    '2026-08-31',
    [
      L('223.01', [bankK], '301', [founder], '30000'),
      L('223.01', [bankP], '301', [founder], '10000'),
      L('224.04', [deposit], '301', [founder], '3000'),
    ],
    'Başlanğıc qalıqlar',
  );
  const purchase = f.operation(
    '2026-09-05',
    [
      L('205', [paper], '531', [supplier, c12, ''], '10000', { quantity: '100' }),
      L('241', [supplier, '', '18'], '531', [supplier, c12, ''], '1800'),
    ],
    'Alış AA-001',
  );
  const purchaseDoc = `operation:${purchase.id}`;
  f.operation(
    '2026-09-18',
    [
      L('531', [supplier, c12, purchaseDoc], '223.01', [bankK], '10000'),
      L('531', [supplier, c12, purchaseDoc], '224.04', [deposit], '1800'),
    ],
    'Malsatana ödəniş',
  );
  const sale = f.operation(
    '2026-09-08',
    [
      L('211', [customer, c7, ''], '601', [goods, '18'], '15000'),
      L('604.1', ['18'], '521', [vat], '2288.14'),
    ],
    'Satış SF-0001',
  );
  const saleDoc = `operation:${sale.id}`;
  f.operation(
    '2026-09-15',
    [
      L('223.01', [bankK], '211', [customer, c7, saleDoc], '12711.86'),
      L('223.01', [bankK], '543.01', [customer, c7], '2542.38'),
      L('224.04', [deposit], '211', [customer, c7, saleDoc], '2288.14'),
      L('224.04', [deposit], '543.01', [customer, c7], '457.62'),
    ],
    'Alıcıdan 18 000',
  );
  f.operation('2026-09-30', [L('721', [fees], '223.01', [bankK], '3')], 'Bank xidmət haqqı');
  f.operation(
    '2026-09-30',
    [L('701', [paper], '205', [paper], '7000', { quantity: '70' })],
    'Maya dəyəri',
  );
  return {
    kapital,
    founder,
    supplier,
    customer,
    bankK,
    bankP,
    deposit,
    c12,
    c7,
    paper,
    goods,
    vat,
    fees,
    purchase,
    sale,
    saleDoc,
  };
}

test('company creation seeds the agreed chart and catalog lists', (t) => {
  const f = fixture(t);
  const c = f.catalog();
  assert.ok(c.accounts.find((a) => a.code === '604.1'));
  assert.deepEqual(c.accounts.find((a) => a.code === '211')!.subkonto, [
    'partner',
    'contract',
    'document',
  ]);
  assert.equal(c.accounts.find((a) => a.code === '223')!.postable, false);
  assert.deepEqual(
    c.items
      .filter((i) => i.kind === 'incomeType')
      .map((i) => i.name)
      .sort(),
    ['Məhsul satışı', 'Xidmət satışı'],
  );
  assert.throws(
    () => f.exec({ type: 'company.create', name: 'X', taxId: '1234567890', vatPayer: true }),
    /artıq var/,
  );
});

test('September example: trial balance by account and subkonto, to the qəpik', (t) => {
  const f = fixture(t);
  const s = september(f);
  const tb = f.trial('2026-09-01', '2026-09-30');
  assert.deepEqual(tb.totals, {
    openDt: '43000.00',
    openKt: '43000.00',
    turnDt: '65891.14',
    turnKt: '65891.14',
    closeDt: '63288.14',
    closeKt: '63288.14',
  });
  const r = (key: string) => {
    const x = f.row(
      f.trial('2026-09-01', '2026-09-30', [
        'a:223',
        'a:223.01',
        'a:211',
        `a:211|${s.customer}`,
        `a:211|${s.customer}|${s.c7}`,
        'a:205',
        'a:543',
        'a:543.01',
        `a:543.01|${s.customer}`,
      ]),
      key,
    );
    assert.ok(x, key);
    return [x!.openDt, x!.openKt, x!.turnDt, x!.turnKt, x!.closeDt, x!.closeKt];
  };
  assert.deepEqual(r('a:223'), ['40000.00', '', '15254.24', '10003.00', '45251.24', '']);
  assert.deepEqual(r(`a:223.01|${s.bankK}`), [
    '30000.00',
    '',
    '15254.24',
    '10003.00',
    '35251.24',
    '',
  ]);
  assert.deepEqual(r(`a:223.01|${s.bankP}`), ['10000.00', '', '', '', '10000.00', '']);
  assert.deepEqual(r('a:224'), ['3000.00', '', '2745.76', '1800.00', '3945.76', '']);
  assert.deepEqual(r('a:211'), ['', '', '15000.00', '15000.00', '', '']);
  assert.deepEqual(r(`a:211|${s.customer}|${s.c7}|${s.saleDoc}`), [
    '',
    '',
    '15000.00',
    '15000.00',
    '',
    '',
  ]);
  assert.deepEqual(r('a:543'), ['', '', '', '3000.00', '', '3000.00']);
  assert.deepEqual(r(`a:543.01|${s.customer}|${s.c7}`), ['', '', '', '3000.00', '', '3000.00']);
  assert.deepEqual(r('a:241'), ['', '', '1800.00', '', '1800.00', '']);
  assert.deepEqual(r('a:521'), ['', '', '', '2288.14', '', '2288.14']);
  assert.deepEqual(r('a:604'), ['', '', '2288.14', '', '2288.14', '']);
  assert.deepEqual(r('a:531'), ['', '', '11800.00', '11800.00', '', '']);
  const productRow = f.row(f.trial('2026-09-01', '2026-09-30', ['a:205']), `a:205|${s.paper}`)!;
  assert.deepEqual(
    [productRow.closeDt, productRow.closeQty, productRow.turnQtyDt, productRow.turnQtyKt],
    ['3000.00', '30', '100', '70'],
  );
  assert.equal(productRow.label, 'Kağız A4');

  // "Only arising in the period": the 543.01 advance and 205 stock arose in September; 223.01 existed.
  const arising = f
    .trial('2026-09-01', '2026-09-30', [], { onlyArising: true })
    .rows.map((x) => x.account);
  assert.ok(arising.includes('543') && arising.includes('205') && !arising.includes('223'));
  // Filter by partner.
  const byPartner = f
    .trial('2026-09-01', '2026-09-30', [], { partnerId: s.customer })
    .rows.map((x) => x.account);
  assert.deepEqual(byPartner, ['211', '543']);
  // A part of a month: registers for whole months + postings of the partial month.
  const mid = f.trial('2026-09-10', '2026-09-20');
  assert.equal(mid.totals.openDt, mid.totals.openKt);
  assert.equal(mid.totals.turnDt, mid.totals.turnKt);
});

test('October: the next invoice and the advance offset; home warns until offset', (t) => {
  const f = fixture(t);
  const s = september(f);
  const L = f.line;
  const inv = f.operation('2026-10-06', [
    L('211', [s.customer, s.c7, ''], '601', [s.goods, '18'], '5000'),
    L('604.1', ['18'], '521', [s.vat], '762.71'),
  ]);
  assert.match(
    f
      .home()
      .warnings.map((w) => w.text)
      .join('\n'),
    /Alıcı MMC · Müqavilə №7 · satış: 211-də 5000.00 borc, 543-də 3000.00 avans/,
  );
  f.operation(
    '2026-10-06',
    [L('543.01', [s.customer, s.c7], '211', [s.customer, s.c7, `operation:${inv.id}`], '3000')],
    'Avansın əvəzləşdirilməsi',
  );
  assert.equal(f.home().warnings.length, 0);
  const tb = f.trial('2026-10-01', '2026-10-31', [
    'a:211',
    `a:211|${s.customer}`,
    `a:211|${s.customer}|${s.c7}`,
  ]);
  assert.equal(f.row(tb, `a:211|${s.customer}|${s.c7}|operation:${inv.id}`)!.closeDt, '2000.00');
  assert.equal(f.row(tb, 'a:543')!.closeKt, '');
  const home = f.home();
  assert.deepEqual(
    home.balances.find((b) => b.account === '211'),
    {
      account: '211',
      name: home.balances.find((b) => b.account === '211')!.name,
      dt: '2000.00',
      kt: '0.00',
    },
  );
});

test('account card: opening, running balance and closing on one bank account', (t) => {
  const f = fixture(t);
  const s = september(f);
  const card = f.card('223.01', '2026-09-01', '2026-09-30', [s.bankK]);
  assert.equal(card.opening, '30000.00');
  assert.deepEqual(
    card.lines.map((l) => [l.date, l.debit, l.credit, l.corrAccount, l.balance]),
    [
      ['2026-09-15', '12711.86', '', '211', '42711.86'],
      ['2026-09-15', '2542.38', '', '543.01', '45254.24'],
      ['2026-09-18', '', '10000.00', '531', '35254.24'],
      ['2026-09-30', '', '3.00', '721', '35251.24'],
    ],
  );
  assert.equal(card.closing, '35251.24');
  assert.match(card.lines[0]!.corrSk, /Alıcı MMC · Müqavilə №7 · satış · ƏƏ-/);
  const whole = f.card('223', '2026-09-01', '2026-09-30');
  assert.equal(whole.opening, '40000.00');
  assert.equal(whole.closing, '45251.24');
});

test('corrections are red storno: turnovers show only the current version; cancel removes it', (t) => {
  const f = fixture(t);
  const s = september(f);
  const L = f.line;
  const op = f.operation('2026-09-20', [L('721', [s.fees], '223.01', [s.bankK], '50')]);
  f.exec({
    type: 'operation.save',
    companyId: f.companyId,
    id: op.id,
    version: 1,
    number: '',
    date: '2026-09-20',
    memo: '',
    lines: [L('721', [s.fees], '223.01', [s.bankK], '40')],
  });
  let row = f.row(f.trial('2026-09-01', '2026-09-30'), 'a:721')!;
  assert.equal(row.turnDt, '43.00', '3 + 40, not 3 + 50 + 40');
  const detail = f.query<OperationDetail>({ type: 'operation', companyId: f.companyId, id: op.id });
  assert.equal(detail.version, 2);
  assert.equal(detail.postings[0]!.amount, '40.00');
  f.exec({
    type: 'operation.cancel',
    companyId: f.companyId,
    id: op.id,
    version: 2,
    reason: 'səhv',
  });
  row = f.row(f.trial('2026-09-01', '2026-09-30'), 'a:721')!;
  assert.equal(row.turnDt, '3.00');
  assert.equal(
    f.query<OperationDetail>({ type: 'operation', companyId: f.companyId, id: op.id }).status,
    'cancelled',
  );
  // The journal itself cannot be changed or deleted.
  assert.throws(() => f.db.run('UPDATE postings SET amount=1'), /storno/);
  assert.throws(() => f.db.run('DELETE FROM entries'), /storno/);
  assert.throws(() => f.db.run('DELETE FROM audit'), /silinmir/);
});

test('subkonto values are checked against the catalogs', (t) => {
  const f = fixture(t);
  const s = september(f);
  const L = f.line;
  const other = f.partner('Başqa MMC', '1700000003');
  assert.throws(
    () => f.operation('2026-09-20', [L('211', [other, s.c7, ''], '601', [s.goods, '18'], '1')]),
    /müqavilə seçilən kontragentə aid deyil/,
  );
  assert.throws(
    () => f.operation('2026-09-20', [L('224.04', [s.bankK], '301', [s.founder], '1')]),
    /223\.01 hesabına bağlıdır/,
  );
  assert.throws(
    () =>
      f.operation('2026-09-20', [L('211', [s.customer, s.c7, ''], '601', [s.goods, '20'], '1')]),
    /ƏDV dərəcəsi seçin/,
  );
  assert.throws(
    () => f.operation('2026-09-20', [L('721', [s.goods], '223.01', [s.bankK], '1')]),
    /tapılmadı/,
  );
  assert.throws(
    () =>
      f.operation('2026-09-20', [
        L('211', [s.customer, s.c7, 'operation:nope'], '601', [s.goods, '18'], '1'),
      ]),
    /sənəd tapılmadı/,
  );
  f.exec({
    type: 'partner.save',
    companyId: f.companyId,
    id: other,
    version: 1,
    name: 'Başqa MMC',
    taxId: '1700000003',
    kind: 'legal',
    note: '',
    archived: true,
  });
  const c = f.contract(other, '1', 'sale');
  assert.throws(
    () => f.operation('2026-09-20', [L('211', [other, c, ''], '601', [s.goods, '18'], '1')]),
    /arxivdədir/,
  );
  assert.throws(
    () => f.operation('2026-09-20', [L('223', [s.bankK], '301', [s.founder], '1')]),
    /subhesab seçin/,
  );
});

test('catalog rules: VÖEN, IBAN, contract numbers, bank account binding', (t) => {
  const f = fixture(t);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  assert.throws(() => f.partner('Kapital 2', '9900003611'), /artıq var: Kapital Bank ASC/);
  assert.throws(() => f.partner('Adsız MMC', ''), /VÖEN yazılmalıdır/);
  assert.throws(() => f.bankAccount(bank, 'AZ12AIIB3806'), /IBAN/);
  assert.throws(
    () => f.bankAccount(bank, 'AZ12AIIB38060019441234567890', '223.02', 'AZN'),
    /manat hesabı/,
  );
  assert.throws(
    () => f.bankAccount(bank, 'AZ12AIIB38060019441234567890', '223.01', 'USD'),
    /223\.02/,
  );
  assert.throws(
    () => f.bankAccount(bank, 'AZ12AIIB38060019441234567890', '211', 'AZN'),
    /Bank hesabı" subkontosu yoxdur/,
  );
  f.bankAccount(bank, 'AZ12 AIIB 3806 0019 4412 3456 7890');
  assert.throws(() => f.bankAccount(bank, 'AZ12AIIB38060019441234567890'), /artıq mövcuddur/);
  const p = f.partner('Alıcı MMC', '1700000001');
  f.contract(p, '7', 'sale');
  assert.throws(() => f.contract(p, ' 7 ', 'purchase'), /artıq var/);
});

test('currency bank account: USD amounts travel next to AZN', (t) => {
  const f = fixture(t);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const buyer = f.partner('Foreign LLC', '', 'foreign');
  const usd = f.bankAccount(bank, 'AZ10AIIB38060019840000000001', '223.02', 'USD', 'Kapital USD');
  const c = f.contract(buyer, 'EX-1', 'sale', 'USD');
  f.operation('2026-09-10', [
    f.line('223.02', [usd], '543.02', [buyer, c], '1700', {
      dtCurAmount: '1000',
      ktCurAmount: '1000',
    }),
  ]);
  const row = f.row(f.trial('2026-09-01', '2026-09-30', ['a:223', 'a:223.02']), `a:223.02|${usd}`)!;
  assert.deepEqual([row.closeDt, row.currency, row.closeCur], ['1700.00', 'USD', '1000.00']);
  assert.throws(
    () => f.operation('2026-09-11', [f.line('223.02', [usd], '543.02', [buyer, c], '1700')]),
    /valyuta məbləğini/,
  );
  assert.throws(
    () =>
      f.operation('2026-09-11', [
        f.line('223.02', [usd], '543.02', [buyer, c], '1700', {
          dtCurAmount: '1',
          ktCurAmount: '1',
          currency: 'EUR',
        }),
      ]),
    /uyğun deyil/,
  );
});

test('closed period: nothing posts on or before the closing date; reopening needs a reason', (t) => {
  const f = fixture(t);
  const s = september(f);
  f.exec({ type: 'period.close', companyId: f.companyId, through: '2026-09-30', reason: '' });
  assert.throws(
    () => f.operation('2026-09-30', [f.line('721', [s.fees], '223.01', [s.bankK], '1')]),
    /bağlanıb/,
  );
  const op = f.query<OperationDetail[]>({
    type: 'operations',
    companyId: f.companyId,
    from: '2026-09-01',
    to: '2026-09-30',
  })[0]!;
  assert.throws(
    () =>
      f.exec({
        type: 'operation.cancel',
        companyId: f.companyId,
        id: op.id,
        version: op.version,
        reason: 'x',
      }),
    /bağlanıb/,
  );
  assert.throws(
    () =>
      f.db.run(
        "INSERT INTO entries VALUES('x',?,'2026-09-01','t','t','t',1,0,'x','x')",
        f.companyId,
      ) &&
      f.db.run(
        "INSERT INTO postings(entry_id,line_no,company_id,date,dt_account,kt_account,amount) VALUES('x',1,?,'2026-09-01','721','222',1)",
        f.companyId,
      ),
    /bağlanıb/,
  );
  assert.throws(
    () =>
      f.exec({ type: 'period.close', companyId: f.companyId, through: '2026-08-31', reason: '' }),
    /Səbəb/,
  );
  f.exec({
    type: 'period.close',
    companyId: f.companyId,
    through: '2026-08-31',
    reason: 'Sentyabr düzəlişi',
  });
  f.operation('2026-09-30', [f.line('721', [s.fees], '223.01', [s.bankK], '1')]);
});

test('account shape is frozen once used; integrity check finds tampered registers', (t) => {
  const f = fixture(t);
  september(f);
  const acc = f.catalog().accounts.find((a) => a.code === '205')!;
  assert.throws(
    () =>
      f.exec({
        type: 'account.update',
        companyId: f.companyId,
        code: '205',
        name: acc.name,
        nature: acc.nature,
        subkonto: [],
        quantitative: true,
        currency: false,
        archived: false,
      }),
    /dəyişdirilmir/,
  );
  f.exec({
    type: 'account.update',
    companyId: f.companyId,
    code: '205',
    name: 'Mallar (anbar)',
    nature: acc.nature,
    subkonto: acc.subkonto,
    quantitative: true,
    currency: false,
    archived: false,
  });
  assert.throws(
    () => f.exec({ type: 'account.create', companyId: f.companyId, code: '205.01', name: 'Alt' }),
    /subhesab açılmır/,
  );
  f.exec({ type: 'account.create', companyId: f.companyId, code: '711.01', name: 'Reklam' });
  assert.throws(
    () =>
      f.exec({
        type: 'account.create',
        companyId: f.companyId,
        code: '721.01',
        name: 'Bank xərcləri',
      }),
    /subhesab açılmır/,
  );
  assert.throws(
    () =>
      f.exec({
        type: 'account.update',
        companyId: f.companyId,
        code: '223.01',
        name: 'x',
        nature: 'active',
        subkonto: ['bankAccount'],
        quantitative: false,
        currency: false,
        archived: true,
      }),
    /Qalığı olan/,
  );
  let check = f.query<IntegrityView>({ type: 'integrity', companyId: f.companyId });
  assert.equal(check.ok, true, check.problems.join());
  f.db.run("UPDATE registers SET debit=debit+1 WHERE account='205'");
  check = f.query<IntegrityView>({ type: 'integrity', companyId: f.companyId });
  assert.equal(check.ok, false);
  assert.match(check.problems.join('\n'), /üst-üstə düşmür/);
});

test('idempotent commands and optimistic versions', (t) => {
  const f = fixture(t);
  const s = september(f);
  const cmd = {
    type: 'operation.save' as const,
    companyId: f.companyId,
    number: '',
    date: '2026-09-21',
    memo: '',
    lines: [f.line('721', [s.fees], '223.01', [s.bankK], '5')],
  };
  const a = f.exec(cmd, 'same-key-0001');
  const b = f.exec(cmd, 'same-key-0001');
  assert.equal(b.replayed, true);
  assert.equal(a.id, b.id);
  assert.throws(() => f.exec({ ...cmd, memo: 'başqa' }, 'same-key-0001'), /başqa məzmunla/);
  assert.throws(() => f.exec({ ...cmd, id: a.id, version: 7 }), /dəyişdirilib/);
});

test('a file database survives reopen and refuses a newer schema', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-'));
  const path = join(dir, 'm.sqlite');
  {
    const f = fixture(t, path);
    september(f);
    f.db.close();
  }
  const db = new Db(path);
  assert.equal(Number(db.get('SELECT COUNT(*) AS n FROM operations')!.n), 7);
  db.raw.exec('PRAGMA user_version=99');
  db.close();
  assert.throws(() => new Db(path), /daha yeni versiyası/);
  rmSync(dir, { recursive: true, force: true });
});

test('a used contract keeps its currency; archived accounts keep their history in the card', (t) => {
  const f = fixture(t);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  const buyer = f.partner('Foreign LLC', '', 'foreign');
  const usd = f.bankAccount(bank, 'AZ10AIIB38060019840000000001', '223.02', 'USD');
  const c = f.contract(buyer, 'EX-1', 'sale', 'USD');
  f.operation('2026-09-10', [
    f.line('223.02', [usd], '543.02', [buyer, c], '1700', {
      dtCurAmount: '1000',
      ktCurAmount: '1000',
    }),
  ]);
  assert.throws(
    () =>
      f.exec({
        type: 'contract.save',
        companyId: f.companyId,
        id: c,
        version: 1,
        partnerId: buyer,
        number: 'EX-1',
        date: '2026-01-01',
        kind: 'sale',
        currency: 'AZN',
        note: '',
        archived: false,
      }),
    /valyutası dəyişdirilmir/,
  );
  // 711.01 used in September, emptied in October and archived: September's card still shows it.
  f.exec({ type: 'account.create', companyId: f.companyId, code: '711.01', name: 'Reklam' });
  const ads = f.item('expenseItem', 'Ofis xərcləri');
  const op = f.operation('2026-09-20', [
    f.line('711.01', [ads], '223.02', [usd], '100', { ktCurAmount: '58.82' }),
  ]);
  f.operation('2026-10-01', [
    f.line('223.02', [usd], '711.01', [ads], '100', { dtCurAmount: '58.82' }),
  ]);
  f.exec({
    type: 'account.update',
    companyId: f.companyId,
    code: '711.01',
    name: 'Reklam',
    nature: 'active',
    subkonto: ['expenseItem'],
    quantitative: false,
    currency: false,
    archived: true,
  });
  const card = f.card('711', '2026-09-21', '2026-09-30');
  assert.equal(card.opening, '100.00');
  assert.ok(op.id);
});
