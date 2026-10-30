import './setup';
import React from 'react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/renderer/App';
import type {
  BankDocumentDetail,
  BankDocumentSummary,
  CashBookView,
  CashDocumentDetail,
  CashDocumentSummary,
  Catalog,
  InvoiceSummary,
  StatementView,
  TrialBalance,
} from '../../src/contracts/queries';
import { monthEnd } from '../../src/domain/rates';
import { harness } from './harness';
import type { Outcome } from '../../src/contracts/bridge';
import { readSheet } from '../../src/renderer/sheet-reader';

afterEach(() => cleanup());
const azMonths = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'İyun',
  'İyul',
  'Avqust',
  'Sentyabr',
  'Oktyabr',
  'Noyabr',
  'Dekabr',
];
const monthsBack = (n: number) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - n, 1);
  return {
    year: d.getFullYear(),
    index: d.getMonth(),
    iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
  };
};
const azMonth = (m: { year: number; index: number }) => `${azMonths[m.index]} ${m.year}`;

const pane = () =>
  (document.querySelector('.mdi-window.active:not([hidden])') ??
    document.querySelector('.desktop')) as HTMLElement;

function seed(h: ReturnType<typeof harness>) {
  const companyId = h.run({
    type: 'company.create',
    name: 'Meyar MMC',
    taxId: '1234567890',
    vatPayer: true,
  }).id;
  const p = (name: string, taxId: string, kind = 'legal') =>
    h.run({ type: 'partner.save', companyId, name, taxId, kind, note: '', archived: false }).id;
  const bank = p('Kapital Bank ASC', '9900003611');
  const founder = p('Ağarza Ağalarov', '', 'individual');
  const customer = p('Alıcı MMC', '1700000001');
  const bankAccount = h.run({
    type: 'bankAccount.save',
    companyId,
    bankId: bank,
    iban: 'AZ12AIIB38060019441234567890',
    currency: 'AZN',
    account: '223.01',
    name: 'Kapital Bank AZN',
    archived: false,
  }).id;
  const contract = h.run({
    type: 'contract.save',
    companyId,
    partnerId: customer,
    number: '7',
    date: '2026-01-01',
    kind: 'sale',
    currency: 'AZN',
    note: '',
    archived: false,
  }).id;
  const catalog = h.ledger.query({ type: 'catalog', companyId }) as Catalog;
  const capitalIn = catalog.items.find((i) => i.kind === 'capitalChange')!.id;
  return { companyId, bank, founder, customer, bankAccount, contract, capitalIn };
}

test('first run: the company is created and Başlanğıc lists the first tasks', async () => {
  const h = harness();
  try {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByRole('textbox', { name: 'Şirkətin adı' }), 'Birinci MMC');
    await user.type(screen.getByRole('textbox', { name: /^VÖEN/ }), '123');
    await user.click(screen.getByRole('button', { name: 'Şirkəti yarat' }));
    await screen.findByText(/VÖEN 10 rəqəmdən/);
    await user.clear(screen.getByRole('textbox', { name: /^VÖEN/ }));
    await user.type(screen.getByRole('textbox', { name: /^VÖEN/ }), '1234567890');
    await user.click(screen.getByRole('button', { name: 'Şirkəti yarat' }));
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await screen.findByText('Bank hesablarını daxil edin');
    await screen.findByText('Başlanğıc qalıqları daxil edin');
    await screen.findByText(/Baza yoxlanıldı: tarazdır/);
  } finally {
    h.close();
  }
});

test('manual operation: accounts and subkonto by keyboard, posting, storno on edit, trial balance', async () => {
  const h = harness();
  const s = seed(h);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getAllByRole('button', { name: 'Əl ilə əməliyyat' })[0]!);
    const editor = within(pane());
    const pick = async (label: string, text: string) => {
      await user.click(await editor.findByRole('combobox', { name: label }));
      await user.keyboard(text);
      await user.keyboard('{Enter}');
    };
    await pick('Sətir 1 debet hesabı', '223.01');
    await pick('Sətir 1 debet 223.01 · Bank hesabı', 'Kapital');
    await pick('Sətir 1 kredit hesabı', '301');
    await pick('Sətir 1 kredit 301 · Kontragent', 'Ağarza');
    await pick('Sətir 1 kredit 301 · Kapitalda dəyişiklik növü', 'qoyuluş');
    await user.type(editor.getByRole('textbox', { name: 'Sətir 1 məbləğ' }), '30000');
    await user.click(editor.getByRole('button', { name: 'Sətir əlavə et' }));
    await pick('Sətir 2 debet hesabı', '211.01');
    await pick('Sətir 2 debet 211.01 · Kontragent', 'Alıcı');
    await pick('Sətir 2 debet 211.01 · Müqavilə', '7');
    await pick('Sətir 2 kredit hesabı', '601');
    await pick('Sətir 2 kredit 601 · Gəlir növü', 'Məhsul');
    await pick('Sətir 2 kredit 601 · ƏDV dərəcəsi', '18');
    await user.type(editor.getByRole('textbox', { name: 'Sətir 2 məbləğ' }), '15000');
    assert.match(pane().textContent ?? '', /45\s000,00/);
    await user.keyboard('{Control>}s{/Control}');
    await editor.findByText(/Sənəd ƏƏ-000001 uçota alındı/);
    // Edit: 15 000 → 14 000 is posted as storno + new entry.
    const amount = editor.getByRole('textbox', { name: 'Sətir 2 məbləğ' }) as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, '14000');
    await user.click(editor.getByRole('button', { name: 'Düzəlişi uçota al' }));
    await editor.findByText(/storno edildi/);
    const tb = h.ledger.query({
      type: 'trialBalance',
      companyId: s.companyId,
      from: '2000-01-01',
      to: '2099-12-31',
      expand: [],
    }) as TrialBalance;
    assert.equal(tb.totals.turnDt, '44000.00');
    assert.equal(tb.rows.find((r) => r.account === '211')!.turnDt, '14000.00');
  } finally {
    h.close();
  }
});

test('trial balance: drill into bank accounts and partners, export to Excel', async () => {
  const h = harness();
  const s = seed(h);
  const date = new Date();
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
  h.run({
    type: 'operation.save',
    companyId: s.companyId,
    number: '',
    date: iso,
    memo: 'Başlanğıc',
    lines: [
      {
        dtAccount: '223.01',
        dtSk: [s.bankAccount],
        ktAccount: '301',
        ktSk: [s.founder, s.capitalIn],
        amount: '30000',
        memo: '',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getAllByRole('button', { name: 'Dövriyyə balansı' })[0]!);
    const page = within(pane());
    await user.click(await page.findByRole('button', { name: 'Aç: Bank hesablaşma hesabları' }));
    await user.click(await page.findByRole('button', { name: 'Aç: Bank hesabları (AZN)' }));
    await page.findByText(/Kapital Bank AZN · …7890/);
    assert.match(pane().querySelector('tfoot')!.textContent ?? '', /30\s000,00/);
    await user.click(page.getByRole('button', { name: 'Excel' }));
    await page.findByText(/Saxlanıldı: C:\\Hesabatlar\\DBC/);
    const file = h.saved.at(-1)!;
    assert.match(file.name, /^DBC .*\.xlsx$/);
    assert.equal(String.fromCharCode(file.bytes[0]!, file.bytes[1]!), 'PK');
    // audit 2026-10-25: the file says what the screen says (1C's names).
    globalThis.DOMParser ??= window.DOMParser;
    const sheet = await readSheet(file.name, file.bytes);
    assert.ok(
      sheet.some(
        (r) => r.includes('Dövrün əvvəlinə saldo Dt') && r.includes('Dövrün sonuna saldo Kt'),
      ),
      JSON.stringify(sheet.slice(0, 4)),
    );
  } finally {
    h.close();
  }
});

test('partners: a partner and its contract are created from the master–detail screen', async () => {
  const h = harness();
  const s = seed(h);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getAllByRole('button', { name: 'Kontragentlər' })[0]!);
    const page = within(pane());
    await user.click(await page.findByRole('button', { name: 'Yeni kontragent' }));
    await user.type(page.getByRole('textbox', { name: 'Ad' }), 'Təchizat ASC');
    await user.type(page.getByRole('textbox', { name: /^VÖEN/ }), '1700000002');
    await user.click(page.getByRole('button', { name: 'Saxla' }));
    await page.findByRole('heading', { name: /Təchizat ASC/ });
    await user.click(page.getByRole('button', { name: 'Müqavilə' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByRole('textbox', { name: 'Nömrə' }), '12');
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Növ' }), 'purchase');
    await user.click(dialog.getByRole('button', { name: 'Saxla' }));
    await waitFor(() => {
      const c = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
      assert.ok(c.contracts.some((x) => x.number === '12' && x.kind === 'purchase'));
    });
  } finally {
    h.close();
  }
});

test('unsaved operation: closing its tab asks first', async () => {
  const h = harness();
  seed(h);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.keyboard('{Control>}n{/Control}');
    const editor = within(pane());
    await user.type(await editor.findByRole('textbox', { name: 'Sətir 1 məbləğ' }), '5');
    await user.click(screen.getByRole('button', { name: /^Bağla: Yeni əməliyyat/ }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Geri' }));
    assert.ok(screen.getByRole('tab', { name: /Yeni əməliyyat/ }));
    await user.click(screen.getByRole('button', { name: /^Bağla: Yeni əməliyyat/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Saxlamadan bağla' }),
    );
    await waitFor(() => assert.equal(screen.queryByRole('tab', { name: /Yeni əməliyyat/ }), null));
  } finally {
    h.close();
  }
});

test('sales invoice: partner, contract, product and price by keyboard; entry shown after posting', async () => {
  const h = harness();
  const s = seed(h);
  h.run({
    type: 'product.save',
    companyId: s.companyId,
    code: 'X-1',
    name: 'Konsaltinq xidməti',
    unit: 'saat',
    kind: 'service',
    groupId: '',
    archived: false,
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getAllByRole('button', { name: 'Satış qaiməsi' })[0]!);
    const editor = within(pane());
    const pick = async (label: string, text: string) => {
      await user.click(await editor.findByRole('combobox', { name: label }));
      await user.keyboard(text);
      await user.keyboard('{Enter}');
    };
    await pick('Kontragent', 'Alıcı');
    // The partner has one contract: it is chosen by itself.
    assert.match(
      (editor.getByRole('combobox', { name: 'Müqavilə' }) as HTMLInputElement).value ||
        pane().textContent ||
        '',
      /№7/,
    );
    await pick('Sətir 1 nomenklatura', 'Konsalt');
    const qtyField = editor.getByRole('textbox', { name: 'Sətir 1 miqdar' });
    await user.clear(qtyField);
    await user.type(qtyField, '10');
    await user.type(editor.getByRole('textbox', { name: 'Sətir 1 qiymət' }), '50');
    // 10 × 50 = 500 + 18% = 590, computed while typing.
    assert.match(pane().textContent ?? '', /590,00/);
    await user.keyboard('{Control>}s{/Control}');
    await editor.findByText(/Qaimə SQ-000001 uçota alındı/);
    const entry = await editor.findByRole('region', { name: 'Yazılışlar' });
    assert.match(entry.textContent ?? '', /211\.01.*601.*500,00|211\.01/);
    assert.match(entry.textContent ?? '', /521\.01/);
    const tb = h.ledger.query({
      type: 'trialBalance',
      companyId: s.companyId,
      from: '2000-01-01',
      to: '2099-12-31',
      expand: [],
    }) as TrialBalance;
    assert.equal(tb.rows.find((r) => r.account === '211')!.turnDt, '590.00');
    assert.equal(tb.rows.find((r) => r.account === '521')!.turnKt, '90.00');

    // The e-qaimə number is one field ("MT" is part of it) and the postings can be corrected
    // by hand (1C "Əl ilə düzəliş").
    await user.type(editor.getByRole('textbox', { name: 'E-qaimə nömrəsi' }), 'mt 2610007');
    await user.click(editor.getByRole('checkbox', { name: 'Əl ilə düzəliş' }));
    const grid = within(editor.getByRole('region', { name: 'Yazılışlar' }));
    const amounts = ['Sətir 1 məbləğ', 'Sətir 2 məbləğ'].map(
      (name) => grid.getByRole('textbox', { name }) as HTMLInputElement,
    );
    const vatLine = amounts.findIndex((a) => a.value.replace(/\s/g, '') === '90,00');
    assert.ok(vatLine >= 0);
    await user.clear(amounts[vatLine]!);
    await user.type(amounts[vatLine]!, '72');
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => {
      const after = h.ledger.query({
        type: 'trialBalance',
        companyId: s.companyId,
        from: '2000-01-01',
        to: '2099-12-31',
        expand: [],
      }) as TrialBalance;
      assert.equal(after.rows.find((r) => r.account === '521')!.turnKt, '72.00');
      assert.equal(after.rows.find((r) => r.account === '211')!.turnDt, '590.00');
    });
    const list = h.ledger.query({
      type: 'invoices',
      companyId: s.companyId,
      direction: 'sale',
      from: '2000-01-01',
      to: '2099-12-31',
    }) as InvoiceSummary[];
    assert.equal(list[0]!.eqNumber, 'MT2610007');
    // The checkbox stays on after saving: the document remembers it was corrected by hand.
    await waitFor(() =>
      assert.equal(
        (editor.getByRole('checkbox', { name: 'Əl ilə düzəliş' }) as HTMLInputElement).checked,
        true,
      ),
    );
  } finally {
    h.close();
  }
});

test('windows: sections open as 1C-like child windows that minimize, maximize and close', async () => {
  const h = harness();
  seed(h);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getAllByRole('button', { name: 'Satış qaiməsi' })[0]!);
    await user.keyboard('{Control>}n{/Control}');
    const windows = () => [...document.querySelectorAll<HTMLElement>('.mdi-window')];
    assert.equal(windows().length, 2);
    // Both stay open on the work area; the newest is in front.
    const [invoice, operation] = windows() as [HTMLElement, HTMLElement];
    assert.ok(operation.classList.contains('active'));
    assert.ok(Number(operation.style.zIndex) > Number(invoice.style.zIndex));
    // Clicking the other window brings it to the front.
    await user.click(invoice.querySelector('.mdi-caption')!);
    assert.ok(invoice.classList.contains('active'));
    assert.ok(Number(invoice.style.zIndex) > Number(operation.style.zIndex));
    // Maximize and restore.
    await user.click(within(invoice).getByRole('button', { name: 'Böyüt' }));
    assert.ok(invoice.classList.contains('maximized'));
    await user.click(within(invoice).getByRole('button', { name: 'Əvvəlki ölçü' }));
    assert.ok(!invoice.classList.contains('maximized'));
    // Minimize: the window hides, the other one becomes active; the window panel brings it back.
    await user.click(within(invoice).getByRole('button', { name: 'Kiçilt' }));
    assert.ok(invoice.hidden);
    assert.ok(operation.classList.contains('active'));
    await user.click(screen.getByRole('tab', { name: /satış qaiməsi/i }));
    assert.ok(!invoice.hidden && invoice.classList.contains('active'));
    // Başlanğıc minimizes everything; close all empties the work area.
    await user.click(screen.getByRole('tab', { name: /Başlanğıc/ }));
    assert.ok(windows().every((w) => w.hidden));
    await user.click(screen.getByRole('button', { name: 'Bütün pəncərələri bağla' }));
    await waitFor(() => assert.equal(windows().length, 0));
  } finally {
    h.close();
  }
});

test('bank receipt: keyboard entry, matched to the open invoice, the rest is an advance', async () => {
  const h = harness();
  const s = seed(h);
  const date = new Date();
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
  const service = h.run({
    type: 'product.save',
    companyId: s.companyId,
    code: '',
    name: 'Konsaltinq',
    unit: 'saat',
    kind: 'service',
    groupId: '',
    archived: false,
  }).id;
  const invoice = h.run({
    type: 'invoice.save',
    companyId: s.companyId,
    direction: 'sale',
    number: '',
    date: iso,
    partnerId: s.customer,
    contractId: s.contract,
    rate: '',
    pricesIncludeVat: false,
    eqSeries: '',
    eqNumber: '',
    memo: '',
    lines: [{ productId: service, quantity: '1', price: '100', vatRate: '0', memo: '' }],
  }).id;
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    // The work map opens a receipt (Satış → Alıcıdan ödəniş).
    await user.click(screen.getAllByRole('button', { name: 'Alıcıdan ödəniş' })[0]!);
    const editor = within(pane());
    const pick = async (label: string, text: string) => {
      await user.click(await editor.findByRole('combobox', { name: label }));
      await user.keyboard(text);
      await user.keyboard('{Enter}');
    };
    // The only bank account is chosen already.
    assert.match(
      (editor.getByRole('combobox', { name: 'Bank hesabı' }) as HTMLInputElement).value,
      /223\.01 · Kapital Bank AZN/,
    );
    await pick('Sətir 1 hesab', '211.01');
    await pick('Sətir 1 211.01 · Kontragent', 'Alıcı');
    await pick('Sətir 1 211.01 · Müqavilə', '7');
    assert.equal(
      (
        editor.getByRole('combobox', {
          name: 'Sətir 1 211.01 · Hesablaşma sənədi',
        }) as HTMLInputElement
      ).value,
      'Açıq qaimələrə avtomatik',
    );
    await user.type(editor.getByRole('textbox', { name: 'Sətir 1 məbləğ' }), '150');
    await user.type(editor.getByRole('textbox', { name: 'Ödənişin təyinatı' }), 'SQ-000001 üzrə');
    await user.keyboard('{Control>}s{/Control}');
    await editor.findByText(/Sənəd BD-000001 uçota alındı/);
    const postings = await editor.findByRole('region', { name: 'Yazılışlar' });
    await within(postings).findByText('543.01');
    const list = h.ledger.query({
      type: 'bankDocuments',
      companyId: s.companyId,
      from: '2000-01-01',
      to: '2099-12-31',
    }) as BankDocumentSummary[];
    const doc = h.ledger.query({
      type: 'bankDocument',
      companyId: s.companyId,
      id: list[0]!.id,
    }) as BankDocumentDetail;
    assert.deepEqual(
      doc.postings.map((p) => [p.dt.account, p.kt.account, p.amount, p.kt.sk[2]]),
      [
        ['223.01', '211.01', '100.00', `invoice:${invoice}`],
        ['223.01', '543.01', '50.00', `bank:${doc.id}`],
      ],
    );
    assert.equal(doc.purpose, 'SQ-000001 üzrə');
  } finally {
    h.close();
  }
});

test('cash order: template, keyboard entry, posting, cash book, a payment beyond the cash refused', async () => {
  const h = harness();
  const s = seed(h);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getAllByRole('button', { name: 'Kassa mədaxili' })[0]!);
    const editor = within(pane());
    const pick = async (label: string, text: string) => {
      await user.click(await editor.findByRole('combobox', { name: label }));
      await user.keyboard(text);
      await user.keyboard('{Enter}');
    };
    // The company's only cashbox is chosen already.
    assert.match(
      (editor.getByRole('combobox', { name: 'Kassa' }) as HTMLInputElement).value,
      /221.01 · Əsas kassa/,
    );
    await user.selectOptions(
      editor.getByRole('combobox', { name: 'Əməliyyat növü' }),
      'Nizamnamə kapitalına qoyuluş',
    );
    assert.equal(
      (editor.getByRole('combobox', { name: 'Sətir 1 hesab' }) as HTMLInputElement).value.split(
        ' ',
      )[0],
      '301',
    );
    assert.equal(
      (editor.getByRole('textbox', { name: 'Əsas' }) as HTMLInputElement).value,
      'Nizamnamə kapitalına qoyuluş',
    );
    await pick('Sətir 1 301 · Kontragent', 'Ağarza');
    await pick('Sətir 1 301 · Kapitalda dəyişiklik növü', 'qoyuluş');
    await user.type(editor.getByRole('textbox', { name: 'Sətir 1 məbləğ' }), '250');
    await user.type(
      editor.getByRole('textbox', { name: 'Kimdən qəbul edilib' }),
      'Ağarza Ağalarov',
    );
    await user.keyboard('{Control>}s{/Control}');
    await editor.findByText(/Order KMO-000001 uçota alındı/);
    const postings = await editor.findByRole('region', { name: 'Yazılışlar' });
    await within(postings).findByText('221.01');
    assert.ok(editor.getByRole('button', { name: 'Çap et' }));
    const list = h.ledger.query({
      type: 'cashDocuments',
      companyId: s.companyId,
      from: '2000-01-01',
      to: '2099-12-31',
    }) as CashDocumentSummary[];
    const doc = h.ledger.query({
      type: 'cashDocument',
      companyId: s.companyId,
      id: list[0]!.id,
    }) as CashDocumentDetail;
    assert.deepEqual(
      doc.postings.map((p) => [p.dt.account, p.kt.account, p.amount]),
      [['221.01', '301', '250.00']],
    );
    assert.equal(doc.amountWords, 'İki yüz əlli manat 00 qəpik');
    // A payment of more than the cash holds is refused with the day it would go negative.
    const out = h.run({
      type: 'cash.save',
      companyId: s.companyId,
      direction: 'out',
      number: '',
      date: doc.date,
      cashboxId: doc.cashboxId,
      rate: '',
      counterpartyName: '',
      basis: '',
      attachment: '',
      lines: [
        { account: '301', sk: [s.founder, s.capitalIn], amount: '50', cashFlowItem: '', memo: '' },
      ],
    });
    assert.ok(out.id);
    await assert.rejects(
      async () =>
        h.run({
          type: 'cash.save',
          companyId: s.companyId,
          direction: 'out',
          number: '',
          date: doc.date,
          cashboxId: doc.cashboxId,
          rate: '',
          counterpartyName: '',
          basis: '',
          attachment: '',
          lines: [
            {
              account: '301',
              sk: [s.founder, s.capitalIn],
              amount: '500',
              cashFlowItem: '',
              memo: '',
            },
          ],
        }),
      /Kassa qalığı .* mənfi olur/,
    );
    const book = h.ledger.query({
      type: 'cashBook',
      companyId: s.companyId,
      cashboxId: doc.cashboxId,
      from: '2000-01-01',
      to: '2099-12-31',
    }) as CashBookView;
    assert.equal(book.closing, '200.00');
  } finally {
    h.close();
  }
});

test('revaluation: missing month-end rate loaded from AMB, the difference posted to 611', async () => {
  const h = harness();
  const s = seed(h);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const end = monthEnd(month);
  const usd = h.run({
    type: 'bankAccount.save',
    companyId: s.companyId,
    bankId: s.bank,
    iban: 'AZ12AIIB38060019449999999901',
    currency: 'USD',
    account: '223.02',
    name: 'Kapital Bank USD',
    archived: false,
  }).id;
  h.run({
    type: 'bank.save',
    companyId: s.companyId,
    direction: 'in',
    number: '',
    date: `${month}-01`,
    bankAccountId: usd,
    rate: '1.7',
    bankReference: '',
    counterpartyName: '',
    counterpartyTaxId: '',
    purpose: '',
    lines: [
      { account: '301', sk: [s.founder, s.capitalIn], amount: '100', cashFlowItem: '', memo: '' },
    ],
  });
  const [y, mm, dd] = end.split('-');
  h.ambFiles.set(
    end,
    `<ValCurs Date="${dd}.${mm}.${y}"><ValType Type="Xarici valyutalar"><Valute Code="USD"><Nominal>1</Nominal><Name>ABŞ dolları</Name><Value>1.71</Value></Valute></ValType></ValCurs>`,
  );
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Mühasibat' }));
    await user.click(screen.getByRole('menuitem', { name: 'Valyuta yenidən qiymətləndirilməsi' }));
    const page = within(pane());
    await page.findByText(/AMB məzənnəsi yoxdur: USD/);
    await user.click(page.getByRole('button', { name: 'AMB-dən yüklə' }));
    await page.findByText(/AMB: 1 bülleten yükləndi — 1 yeni/);
    assert.equal(h.ambAsked.length, 7);
    const table = await page.findByRole('region', { name: 'Hesablama' });
    await within(table).findByText('223.02');
    within(table).getByText(/gəlir 611: 1,00/);
    await user.click(page.getByRole('button', { name: 'Uçota al' }));
    await page.findByText(new RegExp(`YQ-${month} uçota alındı`));
    await page.findByRole('region', { name: 'Uçotda' });
    const tb = h.ledger.query({
      type: 'trialBalance',
      companyId: s.companyId,
      from: `${month}-01`,
      to: end,
      expand: [],
    }) as TrialBalance;
    assert.equal(tb.rows.find((r) => r.account === '611')!.closeKt, '1.00');
  } finally {
    h.close();
  }
});

test('VAT pair: a signal on İş masası opens the deposit document; unpair and pair again', async () => {
  const h = harness();
  const s = seed(h);
  const date = new Date();
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
  const deposit = h.run({
    type: 'bankAccount.save',
    companyId: s.companyId,
    bankId: s.bank,
    iban: 'AZ77AIIB38060019449999999999',
    currency: 'AZN',
    account: '224.04',
    name: 'ƏDV depoziti',
    archived: false,
  }).id;
  const receipt = (bankAccountId: string, amount: string) =>
    h.run({
      type: 'bank.save',
      companyId: s.companyId,
      direction: 'in',
      number: '',
      date: iso,
      bankAccountId,
      rate: '',
      bankReference: '',
      counterpartyName: '',
      counterpartyTaxId: '',
      purpose: '',
      lines: [{ account: '211.01', sk: [s.customer, s.contract], amount, memo: '' }],
    }).id;
  receipt(s.bankAccount, '16000');
  const vat = receipt(deposit, '2000');
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ƏDV hissəsi 18/118-ə uyğun deyil');
    await user.click(screen.getByRole('button', { name: 'Sənədi aç' }));
    const editor = within(pane());
    const panel = await editor.findByRole('region', { name: 'ƏDV cütü' });
    assert.match(within(panel).getByRole('status').textContent ?? '', /fərq/);
    await user.click(within(panel).getByRole('button', { name: 'Cütü ayır' }));
    await editor.findByText('ƏDV cütü ayrıldı.');
    await user.click(await within(panel).findByRole('button', { name: 'BD-000001 ilə cütləşdir' }));
    await editor.findByText('ƏDV cütü bağlandı.');
    const doc = h.ledger.query({
      type: 'bankDocument',
      companyId: s.companyId,
      id: vat,
    }) as BankDocumentDetail;
    assert.equal(doc.pair?.number, 'BD-000001');
  } finally {
    h.close();
  }
});

test('bank statement: CSV preview, load, book a row from its prefilled form', async () => {
  const h = harness();
  const s = seed(h);
  const date = new Date();
  const dmy = `05.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
  const csv = [
    'Hesabdan çıxarış',
    'Hesab;AZ12AIIB38060019441234567890',
    'Əvvələ qalıq;0,00',
    'Tarix;Sənəd №;Qarşı tərəf;VÖEN;Debet;Kredit;Təyinat',
    `${dmy};PT-9;ALICI MMC;1700000001;;250,00;Müqavilə 7 üzrə ödəniş`,
    `${dmy};;Kapital Bank;;1,50;;Hesabın aparılmasına görə komissiya`,
    'Sona qalıq;248,50',
  ].join('\r\n');
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getAllByRole('button', { name: 'Bank çıxarışı' })[0]!);
    const page = within(pane());
    await page.findByText('Hələ çıxarış yüklənməyib');
    await user.upload(
      page.getByLabelText('Çıxarış faylı'),
      new File([csv], 'cixaris.csv', { type: 'text/csv' }),
    );
    const preview = await page.findByRole('region', { name: 'İlkin baxış' });
    assert.match(preview.textContent ?? '', /AZ12AIIB38060019441234567890/);
    assert.match(preview.textContent ?? '', /fayl öz-özünə tarazdır/);
    await user.click(within(preview).getByRole('button', { name: 'Yüklə' }));
    await page.findByText(/Yükləndi: yeni 2 sətir/);
    const head = await page.findByRole('region', { name: 'Çıxarış ilə uçotun tutuşdurulması' });
    assert.match(head.textContent ?? '', /bankda 248,50 çox/);
    await user.click(page.getByRole('button', { name: /Sətir 5: uçota al/ }));
    const editor = within(pane());
    await editor.findByText(/Çıxarış sətri 5: daxilolma/);
    assert.equal(
      (editor.getByRole('textbox', { name: 'Sətir 1 məbləğ' }) as HTMLInputElement).value,
      '250,00',
    );
    assert.equal(
      (editor.getByRole('textbox', { name: 'VÖEN (bankda)' }) as HTMLInputElement).value,
      '1700000001',
    );
    await user.keyboard('{Control>}s{/Control}');
    await editor.findByText(/Sənəd BD-000001 uçota alındı/);
    const imports = h.ledger.query({ type: 'statementImports', companyId: s.companyId }) as {
      id: string;
      posted: number;
      waiting: number;
    }[];
    assert.deepEqual([imports[0]!.posted, imports[0]!.waiting], [1, 1]);
  } finally {
    h.close();
  }
});

test('rules: save a booking as a rule, switch it to auto, undo an automatic posting', async () => {
  const h = harness();
  const s = seed(h);
  const date = new Date();
  const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const fees = (h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog).items.find(
    (i) => i.kind === 'expenseItem' && i.name === 'Bank xidmətləri',
  )!.id;
  let n = 0;
  const load = (day: string) =>
    h.run({
      type: 'statement.import',
      companyId: s.companyId,
      iban: 'AZ12AIIB38060019441234567890',
      fileName: `cixaris-${day}.csv`,
      fileHash: String(++n).padStart(64, '0'),
      lines: [
        {
          row: 5,
          date: `${ym}-${day}`,
          direction: 'out',
          amount: '2.50',
          reference: '',
          counterparty: 'Kapital Bank',
          counterpartyTaxId: '',
          counterpartyIban: '',
          purpose: 'SMS xidmətinə görə komissiya',
        },
      ],
    });
  const first = load('01');
  const line = (
    h.ledger.query({ type: 'statement', companyId: s.companyId, id: first.id }) as StatementView
  ).lines[0]!;
  h.run({
    type: 'bank.save',
    companyId: s.companyId,
    direction: 'out',
    number: '',
    date: line.date,
    bankAccountId: s.bankAccount,
    rate: '',
    bankReference: '',
    counterpartyName: 'Kapital Bank',
    counterpartyTaxId: '',
    purpose: line.purpose,
    statementLineId: line.id,
    lines: [{ account: '721', sk: [fees], amount: '2.50', cashFlowItem: '', memo: '' }],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getAllByRole('button', { name: 'Bank çıxarışı' })[0]!);
    const page = within(pane());
    await user.click(await page.findByRole('tab', { name: /Uçota alınıb/ }));
    await user.click(await page.findByRole('button', { name: 'BX-000001' }));
    const editor = within(pane());
    await user.click(await editor.findByRole('button', { name: 'Qayda kimi saxla' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Yeni qayda' }));
    assert.equal(
      (dialog.getByRole('textbox', { name: 'Sözlər' }) as HTMLInputElement).value,
      'xidmətinə, komissiya',
    );
    await user.clear(dialog.getByRole('textbox', { name: 'Sözlər' }));
    await user.type(dialog.getByRole('textbox', { name: 'Sözlər' }), 'sms');
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Rejim' }), 'auto');
    await user.click(dialog.getByRole('button', { name: 'Saxla' }));
    await editor.findByText(/Qayda saxlanıldı/);
    // The next statement is posted by the rule at once; undoing it leaves the row to the accountant.
    const second = load('02');
    assert.equal(second.posted, 1);
    // Back to the desk (all windows minimised), then the statement window again.
    await user.click(
      within(screen.getByRole('tablist', { name: 'Açıq pəncərələr' })).getByRole('tab', {
        name: /Başlanğıc/,
      }),
    );
    await user.click(screen.getAllByRole('button', { name: 'Bank çıxarışı' })[0]!);
    const statements = within(pane());
    // The statement was loaded behind the window's back (h.run): refresh its list.
    await user.click(statements.getByRole('button', { name: 'Yenilə' }));
    await statements.findByRole('option', { name: /cixaris-02/ });
    await user.selectOptions(statements.getByRole('combobox', { name: 'Çıxarış' }), second.id);
    await user.click(await statements.findByRole('tab', { name: /Uçota alınıb/ }));
    await statements.findByText(/avtomatik, qayda: /);
    await user.click(
      statements.getByRole('button', { name: 'Sətir 5: avtomatik uçotu geri qaytar' }),
    );
    await statements.findByText(/Avtomatik uçot geri qaytarıldı: BX-000002 storno edildi/);
    const after = h.ledger.query({
      type: 'statement',
      companyId: s.companyId,
      id: second.id,
    }) as StatementView;
    assert.deepEqual([after.lines[0]!.state, after.lines[0]!.manualOnly], ['new', true]);
  } finally {
    h.close();
  }
});

test('bank receipt: an invoice already paid can be chosen by hand, the form warns', async () => {
  const h = harness();
  const s = seed(h);
  const date = new Date();
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
  const service = h.run({
    type: 'product.save',
    companyId: s.companyId,
    code: '',
    name: 'Konsaltinq',
    unit: 'saat',
    kind: 'service',
    groupId: '',
    archived: false,
  }).id;
  h.run({
    type: 'invoice.save',
    companyId: s.companyId,
    direction: 'sale',
    number: '',
    date: iso,
    partnerId: s.customer,
    contractId: s.contract,
    rate: '',
    pricesIncludeVat: false,
    eqSeries: '',
    eqNumber: '',
    memo: '',
    lines: [{ productId: service, quantity: '1', price: '100', vatRate: '0', memo: '' }],
  });
  // Paid in full already.
  h.run({
    type: 'bank.save',
    companyId: s.companyId,
    direction: 'in',
    number: '',
    date: iso,
    bankAccountId: s.bankAccount,
    rate: '',
    bankReference: '',
    counterpartyName: '',
    counterpartyTaxId: '',
    purpose: '',
    lines: [{ account: '211.01', sk: [s.customer, s.contract], amount: '100', memo: '' }],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getAllByRole('button', { name: 'Alıcıdan ödəniş' })[0]!);
    const editor = within(pane());
    const pick = async (label: string, text: string) => {
      await user.click(await editor.findByRole('combobox', { name: label }));
      await user.keyboard(text);
      await user.keyboard('{Enter}');
    };
    await pick('Sətir 1 hesab', '211.01');
    await pick('Sətir 1 211.01 · Kontragent', 'Alıcı');
    await pick('Sətir 1 211.01 · Müqavilə', '7');
    await pick('Sətir 1 211.01 · Hesablaşma sənədi', 'SQ-000001');
    await user.type(editor.getByRole('textbox', { name: 'Sətir 1 məbləğ' }), '30');
    await user.keyboard('{Control>}s{/Control}');
    await editor.findByText(/Sənəd BD-000002 uçota alındı/);
    await editor.findByText('Sətir 1: SQ-000001 qaiməsi artıq ödənilib — artıq ödəniş 30.00 AZN.');
  } finally {
    h.close();
  }
});

test('DVX e-qaimələr: file preview, load, the box by state; a file of the other direction is held back', async () => {
  const h = harness();
  const s = seed(h);
  const csv = (title: string) =>
    [
      title,
      'Seriya;Nömrə;Tarix;VÖEN;Adı;Malın ƏDV-siz ümumi dəyəri;Malın ƏDV məbləği;Yekun məbləğ;ƏDV-yə cəlb edilən;Vəziyyəti',
      'MT;2609001;05.09.2026;1700000001;Malsatan MMC;1000,00;180,00;1180,00;1000,00;Təsdiqləndi',
      'MT;2609002;06.09.2026;1700000002;Rabitə ASC;50,00;9,00;59,00;50,00;Təsdiq gözləyir',
    ].join('\r\n');
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const page = within(pane());
    await page.findByText('Hələ e-qaimə yüklənməyib');
    // Göndərilənlər in the title: the preview says so and loading is not offered.
    await user.upload(
      page.getByLabelText('DVX faylı'),
      new File([csv('Göndərilənlər')], 'gonderilenler.csv', { type: 'text/csv' }),
    );
    let preview = await page.findByRole('region', { name: 'İlkin baxış' });
    assert.match(preview.textContent ?? '', /fayl yüklənməyəcək/);
    assert.equal(
      (within(preview).getByRole('button', { name: 'Yüklə' }) as HTMLButtonElement).disabled,
      true,
    );
    await user.click(within(preview).getByRole('button', { name: 'İmtina' }));
    await user.upload(
      page.getByLabelText('DVX faylı'),
      new File([csv('E-qaimələr — Gələnlər')], 'gelenler.csv', { type: 'text/csv' }),
    );
    preview = await page.findByRole('region', { name: 'İlkin baxış' });
    assert.match(preview.textContent ?? '', /faylın başlığı ilə uyğundur/);
    assert.match(preview.textContent ?? '', /2 e-qaimə · cəmi 1\s?239,00/);
    await user.click(within(preview).getByRole('button', { name: 'Yüklə' }));
    await page.findByText(/Yükləndi: yeni 2 e-qaimə\. Heç nə avtomatik uçota alınmayıb\./);
    const waiting = await page.findByRole('tab', { name: /Təklif 1/ });
    assert.equal(waiting.getAttribute('aria-selected'), 'true');
    await page.findByText('MT2609001');
    await user.click(page.getByRole('tab', { name: /DVX-də gözləyir 1/ }));
    await page.findByText('MT2609002');
    // The same file again: nothing new.
    await user.upload(
      page.getByLabelText('DVX faylı'),
      new File([csv('Gələnlər')], 'gelenler.csv', { type: 'text/csv' }),
    );
    preview = await page.findByRole('region', { name: 'İlkin baxış' });
    await user.click(within(preview).getByRole('button', { name: 'Yüklə' }));
    await page.findByText(/yeni 0 e-qaimə, 2 dəyişməyib/);
    // Loading books nothing.
    const invoices = h.ledger.query({
      type: 'invoices',
      companyId: s.companyId,
      direction: 'purchase',
      from: '2026-01-01',
      to: '2026-12-31',
    }) as InvoiceSummary[];
    assert.equal(invoices.length, 0);
  } finally {
    h.close();
  }
});

test('DVX e-qaimə → invoice: book a proposal by hand, learn the map, switch it to auto', async () => {
  const h = harness();
  const s = seed(h);
  const supplier = h.run({
    type: 'partner.save',
    companyId: s.companyId,
    name: 'Kağız MMC',
    taxId: '1700000005',
    kind: 'legal',
    note: '',
    archived: false,
  }).id;
  h.run({
    type: 'contract.save',
    companyId: s.companyId,
    partnerId: supplier,
    number: 'A-1',
    date: '2026-01-01',
    kind: 'purchase',
    currency: 'AZN',
    note: '',
    archived: false,
  });
  h.run({
    type: 'product.save',
    companyId: s.companyId,
    code: '',
    name: 'Kağız A4',
    unit: 'qutu',
    kind: 'goods',
    groupId: '',
    archived: false,
  });
  const date = new Date();
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-05`;
  let n = 0;
  const eq = (number: string) =>
    h.run({
      type: 'eqaime.import',
      directionConfirmed: true,
      companyId: s.companyId,
      direction: 'purchase',
      report: 'goods',
      source: 'file',
      fileName: `mallar-${number}.xlsx`,
      fileHash: String(++n).padStart(64, 'a'),
      documents: [
        {
          row: 2,
          number,
          date: iso,
          taxId: '1700000005',
          name: 'Kağız MMC',
          kind: 'Əsas',
          status: 'Təsdiqləndi',
          net: '50.00',
          vat: '9.00',
          lines: [
            {
              code: '4802',
              name: 'Kağız A4 80q',
              unit: 'qutu',
              quantity: '10',
              price: '5',
              net: '50.00',
              vat: '9.00',
              vatRate: '18',
            },
          ],
        },
      ],
    });
  eq('MT1');
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const box = within(pane());
    await box.findByRole('tab', { name: /Təklif 1/ });
    await user.click(await box.findByRole('button', { name: 'MT1: uçota al' }));
    const editor = within(pane());
    await editor.findByText(/DVX e-qaimə MT1/);
    await editor.findByText(/uyğunluq yoxdur — nomenklaturanı seçin/);
    assert.equal(
      (editor.getByRole('textbox', { name: 'E-qaimə nömrəsi' }) as HTMLInputElement).value,
      'MT1',
    );
    await user.click(await editor.findByRole('combobox', { name: 'Sətir 1 nomenklatura' }));
    await user.keyboard('Kağız');
    await user.keyboard('{Enter}');
    await user.keyboard('{Control>}s{/Control}');
    await editor.findByText(/Qaimə AQ-000001 uçota alındı \(DVX e-qaimə MT1\)/);
    await user.click(await editor.findByRole('button', { name: 'Uyğunluq kimi saxla' }));
    await editor.findByText(/1 uyğunluq “təklif” rejimində saxlandı/);
    // The map: the accountant switches the entry to auto.
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'E-qaimə uyğunluqları' }));
    const maps = within(pane());
    await user.click(await maps.findByRole('button', { name: 'Kağız A4 80q: avtomatik et' }));
    await maps.findByText(/Uyğunluq avtomatik rejimdədir/);
    // The next e-qaimə of these goods books by itself.
    const r = eq('MT2');
    assert.equal(r.posted, 1);
    const invoices = h.ledger.query({
      type: 'invoices',
      companyId: s.companyId,
      direction: 'purchase',
      from: '2000-01-01',
      to: '2099-12-31',
    }) as InvoiceSummary[];
    assert.deepEqual(invoices.map((i) => [i.number, i.eqNumber, i.total]).sort(), [
      ['AQ-000001', 'MT1', '59.00'],
      ['AQ-000002', 'MT2', '59.00'],
    ]);
  } finally {
    h.close();
  }
});

test('DVX statuses: cancel the invoice of a cancelled e-qaimə, apply a correction to its invoice, DVX ↔ uçot', async () => {
  const h = harness();
  const s = seed(h);
  const supplier = h.run({
    type: 'partner.save',
    companyId: s.companyId,
    name: 'Kağız MMC',
    taxId: '1700000005',
    kind: 'legal',
    note: '',
    archived: false,
  }).id;
  h.run({
    type: 'contract.save',
    companyId: s.companyId,
    partnerId: supplier,
    number: 'A-1',
    date: '2026-01-01',
    kind: 'purchase',
    currency: 'AZN',
    note: '',
    archived: false,
  });
  const paper = h.run({
    type: 'product.save',
    companyId: s.companyId,
    code: '',
    name: 'Kağız A4',
    unit: 'qutu',
    kind: 'goods',
    groupId: '',
    archived: false,
  }).id;
  h.run({
    type: 'eqMap.save',
    companyId: s.companyId,
    direction: 'purchase',
    taxId: '1700000005',
    dvxCode: '4802',
    productId: paper,
    mode: 'auto',
  });
  const date = new Date();
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-05`;
  let n = 0;
  const eq = (number: string, quantity: string, extra: object = {}) => {
    const net = `${Number(quantity) * 5}.00`;
    const vat = (Number(quantity) * 0.9).toFixed(2);
    return h.run({
      type: 'eqaime.import',
      directionConfirmed: true,
      companyId: s.companyId,
      direction: 'purchase',
      report: 'goods',
      source: 'file',
      fileName: `mallar-${++n}.xlsx`,
      fileHash: String(n).padStart(64, 'b'),
      documents: [
        {
          row: 2,
          number,
          date: iso,
          taxId: '1700000005',
          name: 'Kağız MMC',
          kind: 'Əsas',
          status: 'Təsdiqləndi',
          net,
          vat,
          lines: [
            {
              code: '4802',
              name: 'Kağız A4',
              unit: 'qutu',
              quantity,
              price: '5',
              net,
              vat,
              vatRate: '18',
            },
          ],
          ...extra,
        },
      ],
    });
  };
  eq('MT1', '10');
  eq('MT5', '10');
  eq('MT1', '10', { status: 'Ləğv edildi' });
  eq('MT6', '8', { kind: 'Düzəliş qaiməsi', refNumber: 'MT5' });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const box = within(pane());
    await user.click(await box.findByRole('tab', { name: /Ziddiyyət 1/ }));
    await user.click(await box.findByRole('button', { name: 'MT1: qaiməni ləğv et' }));
    await box.findByText(/AQ-000001 storno ilə ləğv edildi; MT1 kənara qoyuldu/);
    await box.findByRole('tab', { name: /Kənar qoyulub 1/ });
    // The correction of MT5 opens AQ-000002 itself, with the correction's quantity.
    await user.click(box.getByRole('tab', { name: /Təklif 1/ }));
    await user.click(await box.findByRole('button', { name: 'MT6: uçota al' }));
    const editor = within(pane());
    await editor.findByText(/Düzəliş: AQ-000002 qaiməsi \(e-qaimə MT5\)/);
    assert.equal(
      (editor.getByRole('textbox', { name: 'Sətir 1 miqdar' }) as HTMLInputElement).value,
      '8',
    );
    await user.keyboard('{Control>}s{/Control}');
    await editor.findByText(/Düzəliş uçota alındı/);
    const invoices = h.ledger.query({
      type: 'invoices',
      companyId: s.companyId,
      direction: 'purchase',
      from: '2000-01-01',
      to: '2099-12-31',
    }) as InvoiceSummary[];
    assert.deepEqual(invoices.map((i) => [i.number, i.eqNumber, i.status, i.total]).sort(), [
      ['AQ-000001', 'MT1', 'cancelled', '59.00'],
      ['AQ-000002', 'MT6', 'posted', '47.20'],
    ]);
    // DVX ↔ books for the working month.
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const again = within(pane());
    await user.click(await again.findByRole('button', { name: /DVX ↔ uçot/ }));
    const panel = await again.findByRole('region', { name: 'DVX ilə uçotun tutuşdurulması' });
    const vat = within(panel).getByRole('table', { name: 'Aylar üzrə ƏDV' });
    assert.match(vat.textContent ?? '', /uyğundur/);
  } finally {
    h.close();
  }
});

test('DVX cabinet: the box opens it; an export made there arrives as a preview and loads as from a file', async () => {
  const h = harness();
  seed(h);
  const csv = [
    'E-qaimələr — Gələnlər',
    'Seriya;Nömrə;Tarix;VÖEN;Adı;Malın ƏDV-siz ümumi dəyəri;Malın ƏDV məbləği;Yekun məbləğ;ƏDV-yə cəlb edilən;Vəziyyəti',
    'MT;2609001;05.09.2026;1700000001;Malsatan MMC;100,00;18,00;118,00;100,00;Təsdiqləndi',
  ].join('\r\n');
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const page = within(pane());
    await user.click(await page.findByRole('button', { name: 'DVX kabinetini aç' }));
    await page.findByText(/DVX kabineti ayrıca pəncərədə açıldı/);
    assert.deepEqual(h.dvxOpened, ['purchase']);
    // A sales export does not land in the purchases box.
    h.dvxExport({ direction: 'sale', name: 'x.csv', bytes: new TextEncoder().encode(csv) });
    h.dvxExport({
      direction: 'purchase',
      name: 'gelenler.csv',
      bytes: new TextEncoder().encode(csv),
    });
    const preview = await page.findByRole('region', { name: 'İlkin baxış' });
    assert.match(preview.textContent ?? '', /gelenler\.csv/);
    await user.click(within(preview).getByRole('button', { name: 'Yüklə' }));
    await page.findByText(/Yükləndi: yeni 1 e-qaimə/);
    const imports = h.ledger.query({
      type: 'eqImports',
      companyId: (h.ledger.query({ type: 'companies' }) as { id: string }[])[0]!.id,
      direction: 'purchase',
    }) as { source: string; fileName: string }[];
    assert.deepEqual(
      imports.map((i) => [i.source, i.fileName]),
      [['portal', 'gelenler.csv']],
    );
  } finally {
    h.close();
  }
});

test('audit: a cabinet export goes only to the box that opened the cabinet, not another company’s', async () => {
  const h = harness();
  seed(h);
  const other = h.run({
    type: 'company.create',
    name: 'İkinci MMC',
    taxId: '1234567891',
    vatPayer: true,
  }).id;
  const csv = [
    'Seriya;Nömrə;Tarix;VÖEN;Adı;Malın ƏDV-siz ümumi dəyəri;Malın ƏDV məbləği;Vəziyyəti',
    'MT;2609001;05.09.2026;1700000001;Malsatan MMC;100,00;18,00;Təsdiqləndi',
  ].join('\r\n');
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    const openBox = async () => {
      await user.click(screen.getByRole('button', { name: 'Alış' }));
      await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
      return within(pane());
    };
    const first = await openBox();
    await user.click(await first.findByRole('button', { name: 'DVX kabinetini aç' }));
    await first.findByText(/DVX kabineti ayrıca pəncərədə açıldı/);
    // The other company's box is open too, without the cabinet.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Şirkət' }), other);
    const second = await openBox();
    await second.findByText('Hələ e-qaimə yüklənməyib');
    h.dvxExport({ direction: 'purchase', name: 'ixrac.csv', bytes: new TextEncoder().encode(csv) });
    await waitFor(() =>
      assert.equal(document.querySelectorAll('[aria-label="İlkin baxış"]').length, 1),
    );
    assert.equal(second.queryByRole('region', { name: 'İlkin baxış' }), null);
  } finally {
    h.close();
  }
});

test('DVX box: the partners it names are created at once, with a contract each', async () => {
  const h = harness();
  const s = seed(h);
  h.run({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: s.companyId,
    direction: 'purchase',
    report: 'invoices',
    source: 'file',
    fileName: 'gelenler.xlsx',
    fileHash: 'c'.repeat(64),
    documents: [
      {
        row: 2,
        number: 'MT1',
        date: '2026-09-05',
        taxId: '1800000001',
        name: 'Yeni Təchizatçı MMC',
        status: 'Təsdiqləndi',
        net: '100.00',
        vat: '18.00',
        base18: '100.00',
      },
      {
        row: 3,
        number: 'MT2',
        date: '2026-09-06',
        taxId: '1800000002',
        name: 'Fərdi Sahibkar',
        status: 'Təsdiqləndi',
        net: '50.00',
        vat: '0.00',
        baseExempt: '50.00',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const page = within(pane());
    await user.click(await page.findByRole('button', { name: /Yeni kontragentləri yarat \(2\)/ }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Yarat' }));
    await page.findByText(/Yaradıldı: 2 kontragent, 2 “Əsas” müqavilə/);
    const catalog = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
    assert.deepEqual(
      catalog.partners
        .filter((p) => p.taxId.startsWith('18'))
        .map((p) => [p.name, p.kind])
        .sort(),
      [
        ['Fərdi Sahibkar', 'individual'],
        ['Yeni Təchizatçı MMC', 'legal'],
      ],
    );
  } finally {
    h.close();
  }
});

test('DVX box: e-qaimələr with totals only are mapped to one service for all their partners', async () => {
  const h = harness();
  const s = seed(h);
  const supplier = h.run({
    type: 'partner.save',
    companyId: s.companyId,
    name: 'Rabitə ASC',
    taxId: '1700000003',
    kind: 'legal',
    note: '',
    archived: false,
  }).id;
  h.run({
    type: 'contract.save',
    companyId: s.companyId,
    partnerId: supplier,
    number: 'R-1',
    date: '2026-01-01',
    kind: 'purchase',
    currency: 'AZN',
    note: '',
    archived: false,
  });
  h.run({
    type: 'product.save',
    companyId: s.companyId,
    code: '',
    name: 'Rabitə xidməti',
    unit: 'ay',
    kind: 'service',
    groupId: '',
    archived: false,
  });
  h.run({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: s.companyId,
    direction: 'purchase',
    report: 'invoices',
    source: 'file',
    fileName: 'gelenler.xlsx',
    fileHash: 'd'.repeat(64),
    documents: [
      {
        row: 2,
        number: 'MT1',
        date: '2026-09-30',
        taxId: '1700000003',
        name: 'Rabitə ASC',
        status: 'Təsdiqləndi',
        net: '50.00',
        vat: '9.00',
        base18: '50.00',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const page = within(pane());
    await user.click(
      await page.findByRole('button', { name: /Bütün qaiməni bir xidmətə bağla \(1 kontragent\)/ }),
    );
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('combobox', { name: 'Xidmət' }));
    await user.keyboard('Rabitə');
    await user.keyboard('{Enter}');
    await user.click(dialog.getByRole('button', { name: 'Uyğunluğu yaz' }));
    await page.findByText(/1 kontragentə “bütün qaimə” uyğunluğu yazıldı\. Təkliflər hazırdır/);
    const box = h.ledger.query({
      type: 'eqInbox',
      companyId: s.companyId,
      direction: 'purchase',
      from: '',
      to: '',
    }) as { documents: { proposal: { lines: unknown[] } | null }[] };
    assert.equal(box.documents[0]!.proposal!.lines.length, 1);
  } finally {
    h.close();
  }
});

test('month closing: steps of the last month, Ctrl+Enter closes it, cancel opens it again', async () => {
  const h = harness();
  const s = seed(h);
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const catalog = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
  const service = catalog.items.find((i) => i.kind === 'incomeType' && i.name === 'Xidmət satışı')!;
  h.run({
    type: 'operation.save',
    companyId: s.companyId,
    number: '',
    date: `${month}-10`,
    memo: 'Xidmət',
    lines: [
      {
        dtAccount: '211.01',
        dtSk: [s.customer, s.contract, ''],
        ktAccount: '601',
        ktSk: [service.id, '0'],
        amount: '1000',
        memo: '',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Mühasibat' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ay bağlanışı' }));
    const page = within(pane());
    const input = within(page.getByRole('group', { name: 'Ay' })).getByRole('button', {
      name: /^Ay seçimi/,
    });
    // It opens on the first month not closed (decided after the audit), not the work period.
    await waitFor(() => assert.equal(input.textContent, azMonth(monthsBack(1))));
    const income = await page.findByRole('listitem', {
      name: 'Gəlir və xərclərin 801-ə bağlanması',
    });
    within(income).getByRole('table', { name: 'Bağlanışdan əvvəlki qalıqlar' });
    await user.click(within(income).getByRole('button', { name: 'Yazılışlar (1)' }));
    within(income).getByText('Ay bağlanışı · 601 → 801');
    within(page.getByRole('listitem', { name: 'Nəticənin 341-ə keçirilməsi' })).getByText(
      /^Mənfəət 1.000,00$/,
    );
    input.focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    await page.findByText(new RegExp(`AB-${month} uçota alındı: dövr`));
    await page.findByText(new RegExp(`AB-${month} uçotdadır \\(versiya 1\\)`));
    const company = h.db.get('SELECT closed_through FROM companies')!;
    assert.equal(company.closed_through, monthEnd(month));
    await user.click(page.getByRole('button', { name: 'Ləğv et' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByRole('textbox', { name: 'Səbəb' }), 'Gecikən sənəd');
    await user.click(dialog.getByRole('button', { name: 'Ləğv et' }));
    await page.findByText(/Ay bağlanışı ləğv edildi: yazılışları storno edildi, dövr açıldı/);
    await page.findByRole('button', { name: 'Ayı bağla' });
    assert.equal(h.db.get('SELECT closed_through FROM companies')!.closed_through, '');
  } finally {
    h.close();
  }
});

test('reports: the dashboard tile opens M/Z, a row opens the account card, Excel is saved', async () => {
  const h = harness();
  const s = seed(h);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const catalog = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
  const service = catalog.items.find((i) => i.kind === 'incomeType' && i.name === 'Xidmət satışı')!;
  h.run({
    type: 'operation.save',
    companyId: s.companyId,
    number: '',
    date: `${month}-01`,
    memo: 'Xidmət',
    lines: [
      {
        dtAccount: '211.01',
        dtSk: [s.customer, s.contract, ''],
        ktAccount: '601',
        ktSk: [service.id, '0'],
        amount: '1000',
        memo: '',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Hesabatlar' }));
    await user.click(screen.getByRole('menuitem', { name: 'İdarə paneli' }));
    const panel = within(pane());
    const income = await panel.findByRole('button', { name: /^Gəlirs*1.000,00/ });
    panel.getByRole('button', { name: /^Debitor borcus*1.000,00/ });
    panel.getByRole('img', { name: '12 ayın gəlir, xərc və mənfəəti' });
    await user.click(income);
    const report = within(pane());
    const row = await report.findByRole('rowheader', { name: '601 · Satış' });
    await user.click(report.getByRole('button', { name: /Excel/ }));
    await report.findByText(
      new RegExp(`Saxlanıldı: .*Mənfəət və zərər ${month.slice(0, 4)}\.xlsx`),
    );
    assert.equal(h.saved.length, 1);
    await user.dblClick(row);
    await waitFor(() =>
      assert.equal(
        document.querySelector('.mdi-window.active .mdi-caption')?.textContent,
        'Hesab kartı 601',
      ),
    );
  } finally {
    h.close();
  }
});

test('audit: a dashboard tile opens its report for the dashboard month; returns draw no negative bar; an empty year says so', async () => {
  const h = harness();
  const s = seed(h);
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const catalog = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
  const service = catalog.items.find((i) => i.kind === 'incomeType' && i.name === 'Xidmət satışı')!;
  // Only a return in the month: its income is negative.
  h.run({
    type: 'operation.save',
    companyId: s.companyId,
    number: '',
    date: `${month}-10`,
    memo: 'Qaytarma',
    lines: [
      {
        dtAccount: '602',
        dtSk: [service.id, '0'],
        ktAccount: '211.01',
        ktSk: [s.customer, s.contract, ''],
        amount: '100',
        memo: '',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Hesabatlar' }));
    await user.click(screen.getByRole('menuitem', { name: 'İdarə paneli' }));
    const panel = within(pane());
    await user.click(
      within(await panel.findByRole('group', { name: 'Ay' })).getByRole('button', {
        name: 'Əvvəlki ay',
      }),
    );
    const income = await panel.findByRole('button', { name: /^Gəlir\s*[−-]100,00/ });
    for (const bar of document.querySelectorAll('.dashboard-chart rect'))
      assert.ok(Number(bar.getAttribute('height')) >= 0, bar.outerHTML);
    await user.click(panel.getByRole('button', { name: /^Ödənilməli ƏDV/ }));
    await waitFor(() =>
      assert.equal(
        document.querySelector('.mdi-window.active .mdi-caption')?.textContent,
        'ƏDV icmalı',
      ),
    );
    within(within(pane()).getByRole('group', { name: 'Ay' })).getByRole('button', {
      name: `Ay seçimi: ${azMonth(monthsBack(1))}`,
    });
    await user.click(income);
    const report = within(pane());
    await report.findByRole('rowheader', {
      name: '602 · Satılmış malların qaytarılması və ucuzlaşdırılması',
    });
    const year = report.getByLabelText('İl') as HTMLInputElement;
    assert.equal(year.value, month.slice(0, 4));
    await user.clear(year);
    await user.type(year, '2001');
    await report.findByText('Bu ildə gəlir və xərc yoxdur');
  } finally {
    h.close();
  }
});

test('design 0.7.1: a closing step with nothing to post is not laid out as an empty page', async () => {
  const h = harness();
  const s = seed(h);
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const catalog = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
  const service = catalog.items.find((i) => i.kind === 'incomeType' && i.name === 'Xidmət satışı')!;
  h.run({
    type: 'operation.save',
    companyId: s.companyId,
    number: '',
    date: `${month}-10`,
    memo: 'Xidmət',
    lines: [
      {
        dtAccount: '211.01',
        dtSk: [s.customer, s.contract, ''],
        ktAccount: '601',
        ktSk: [service.id, '0'],
        amount: '1000',
        memo: '',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Mühasibat' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ay bağlanışı' }));
    await within(pane()).findByRole('listitem', {
      name: 'Valyuta qalıqlarının yenidən qiymətləndirilməsi',
    });
    const steps = [...document.querySelectorAll('.closing-steps > li')];
    const classes = steps.map((li) => li.className).join(' | ');
    // Some steps of the month have nothing to post…
    assert.ok(
      steps.some((li) => (li as HTMLElement).dataset.state === 'empty'),
      classes,
    );
    // …and `.empty` is the centred "nothing here" block: a step keeps its own layout.
    for (const li of steps) assert.ok(!li.classList.contains('empty'), classes);
  } finally {
    h.close();
  }
});

test('design 0.7.1: the dashboard chart is drawn at its real size, so month names keep their size', async () => {
  const h = harness();
  seed(h);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Hesabatlar' }));
    await user.click(screen.getByRole('menuitem', { name: 'İdarə paneli' }));
    const svg = await waitFor(() => {
      const found = document.querySelector('.dashboard-chart svg');
      assert.ok(found);
      return found;
    });
    const [, , w, h2] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    assert.equal(Number(svg.getAttribute('width')), w);
    assert.equal(Number(svg.getAttribute('height')), h2);
  } finally {
    h.close();
  }
});

test('design 0.7.1: the dark theme is chosen in the settings, applied at once and kept', async () => {
  const h = harness();
  seed(h);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    assert.equal(document.documentElement.dataset.theme, undefined);
    await user.click(screen.getByRole('button', { name: 'Müəssisə' }));
    await user.click(screen.getByRole('menuitem', { name: 'Şirkət və dövrün bağlanması' }));
    const page = within(pane());
    const dark = await page.findByRole('button', { name: 'Tünd' });
    assert.equal(page.getByRole('button', { name: 'Açıq' }).getAttribute('aria-pressed'), 'true');
    await user.click(dark);
    await waitFor(() => assert.equal(document.documentElement.dataset.theme, 'dark'));
    assert.equal(dark.getAttribute('aria-pressed'), 'true');
    assert.equal(h.theme(), 'dark');
    await user.click(page.getByRole('button', { name: 'Açıq' }));
    await waitFor(() => assert.equal(document.documentElement.dataset.theme, undefined));
    assert.equal(h.theme(), 'light');
  } finally {
    h.close();
  }
});

test('design §8: the month picker speaks Azerbaijani, not the Windows language, and marks closed months', async () => {
  const h = harness();
  const s = seed(h);
  const current = monthsBack(0);
  const prev = monthsBack(1);
  const closed = monthsBack(2);
  h.run({
    type: 'period.close',
    companyId: s.companyId,
    through: monthEnd(closed.iso),
    reason: '',
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Hesabatlar' }));
    await user.click(screen.getByRole('menuitem', { name: 'İdarə paneli' }));
    const panel = within(pane());
    const picker = within(await panel.findByRole('group', { name: 'Ay' }));
    // No native month input: its names come from the Windows language ("Ekim", "Ağustos").
    assert.equal(document.querySelector('input[type="month"]'), null);
    const shown = picker.getByRole('button', { name: /^Ay seçimi/ });
    assert.equal(shown.textContent, azMonth(current));
    await user.click(picker.getByRole('button', { name: 'Əvvəlki ay' }));
    assert.equal(shown.textContent, azMonth(prev));
    await waitFor(() =>
      assert.match(
        document.querySelector('.mdi-window.active')!.textContent!,
        new RegExp(prev.iso),
      ),
    );
    await user.click(picker.getByRole('button', { name: 'Növbəti ay' }));
    assert.equal(shown.textContent, azMonth(current));
    // The list of a year: closed months are marked, by text as well as by look.
    await user.click(shown);
    const list = within(await screen.findByRole('dialog', { name: 'Ay seçimi' }));
    if (closed.year !== current.year)
      await user.click(list.getByRole('button', { name: 'Əvvəlki il' }));
    const closedButton = list.getByRole('button', { name: `${azMonth(closed)}, dövr bağlıdır` });
    assert.ok(closedButton.classList.contains('closed'));
    if (prev.year === closed.year) list.getByRole('button', { name: azMonth(prev) });
    assert.equal(list.getAllByRole('button', { name: /^\S+ \d{4}/ }).length, 12);
    await user.click(closedButton);
    assert.equal(screen.queryByRole('dialog', { name: 'Ay seçimi' }), null);
    assert.equal(shown.textContent, azMonth(closed));
    assert.match(shown.getAttribute('aria-label')!, /dövr bağlıdır/);
    // Escape closes the list without a change.
    await user.click(shown);
    await screen.findByRole('dialog', { name: 'Ay seçimi' });
    await user.keyboard('{Escape}');
    assert.equal(screen.queryByRole('dialog', { name: 'Ay seçimi' }), null);
    assert.equal(shown.textContent, azMonth(closed));
  } finally {
    h.close();
  }
});

test('design §8: a document form shows its state by its title, a cancelled one is banded; the posting rule folds', async () => {
  const h = harness();
  const s = seed(h);
  const op = h.run({
    type: 'operation.save',
    companyId: s.companyId,
    number: '',
    date: `${monthsBack(0).iso}-01`,
    memo: 'Ləğv olunacaq',
    lines: [
      {
        dtAccount: '223.01',
        dtSk: [s.bankAccount],
        ktAccount: '301',
        ktSk: [s.founder, s.capitalIn],
        amount: '100',
        memo: '',
      },
    ],
  });
  h.run({
    type: 'operation.cancel',
    companyId: s.companyId,
    id: op.id,
    version: 1,
    reason: 'Səhv',
  });
  const heading = () => pane().querySelector('.module-heading') as HTMLElement;
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    // New forms are drafts; the posting rule is one line, folded, until asked for.
    for (const create of [
      'Satış qaiməsi',
      'Bank daxilolması',
      'Kassa mədaxili',
      'Əl ilə əməliyyat',
    ]) {
      await user.click(screen.getByRole('button', { name: 'Yarat' }));
      await user.click(screen.getByRole('menuitem', { name: create }));
      await waitFor(() => assert.ok(heading().querySelector('.status.draft'), create));
      assert.equal(heading().querySelector('.status')!.textContent, 'Qaralama');
      const rule = within(pane()).getByRole('group', {
        name: 'Yazılış qaydası',
      }) as HTMLDetailsElement;
      assert.equal(rule.tagName, 'DETAILS', create);
      assert.equal(rule.open, false, create);
      assert.doesNotMatch(pane().textContent!, /Yazılış: Dt/, create);
    }
    const rule = within(pane()).getByRole('group', {
      name: 'Yazılış qaydası',
    }) as HTMLDetailsElement;
    await user.click(within(rule).getByText('Yazılış qaydası'));
    assert.equal(rule.open, true);
    // A cancelled document: ✕ by the title and a band across the form.
    await user.click(screen.getByRole('button', { name: 'Mühasibat' }));
    await user.click(screen.getByRole('menuitem', { name: 'Əl ilə əməliyyatlar' }));
    await user.dblClick(await within(pane()).findByRole('cell', { name: 'ƏƏ-000001' }));
    await waitFor(() => assert.ok(heading().querySelector('.status.cancelled')));
    assert.equal(heading().querySelector('.status')!.textContent, 'Ləğv edilib');
    const band = pane().querySelector('.doc-cancelled') as HTMLElement;
    assert.ok(band);
    assert.match(band.textContent!, /ləğv edilib/i);
    assert.equal(document.querySelector('.module.cancelled'), pane().querySelector('.module'));
  } finally {
    h.close();
  }
});

test('design §8: the sales list sums net, VAT and total; the AZN column only when a currency is there', async () => {
  const h = harness();
  const s = seed(h);
  const date = `${monthsBack(0).iso}-01`;
  const service = h.run({
    type: 'product.save',
    companyId: s.companyId,
    code: 'X-1',
    name: 'Konsaltinq',
    unit: 'saat',
    kind: 'service',
    groupId: '',
    archived: false,
  }).id;
  const sale = (price: string, contractId = s.contract, rate = '') =>
    h.run({
      type: 'invoice.save',
      companyId: s.companyId,
      direction: 'sale',
      number: '',
      date,
      partnerId: s.customer,
      contractId,
      rate,
      pricesIncludeVat: false,
      eqSeries: '',
      eqNumber: '',
      memo: '',
      lines: [{ productId: service, quantity: '1', price, vatRate: '18', memo: '' }],
    });
  sale('100');
  sale('200');
  const cancelled = sale('5000');
  h.run({
    type: 'invoice.cancel',
    companyId: s.companyId,
    id: cancelled.id,
    version: 1,
    reason: 'Səhv',
  });
  const headers = () =>
    within(pane())
      .getAllByRole('columnheader')
      .map((c) => c.textContent);
  const footer = () =>
    [...pane().querySelectorAll('tfoot td')].map((c) => c.textContent!.replace(/\s/g, ' ').trim());
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(
      within(screen.getByRole('navigation', { name: 'Əsas menyu' })).getByRole('button', {
        name: 'Satış',
      }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Satış qaimələri' }));
    await within(pane()).findAllByRole('cell', { name: /^SQ-/ });
    // All in manats: one total column, and the footer sums what is posted.
    assert.deepEqual(headers().slice(5, 8), ['ƏDV-siz', 'ƏDV', 'Cəmi']);
    assert.ok(!headers().includes('Cəmi, AZN'));
    assert.deepEqual(footer().filter(Boolean), [
      'Uçotdakı qaimələr üzrə cəmi',
      '300,00',
      '54,00',
      '354,00',
    ]);
  } finally {
    h.close();
  }
  cleanup();
  // A dollar invoice: the list shows "Cəmi, AZN" and sums in manats.
  const h2 = harness();
  const s2 = seed(h2);
  const usd = h2.run({
    type: 'contract.save',
    companyId: s2.companyId,
    partnerId: s2.customer,
    number: 'USD-1',
    date: '2026-01-01',
    kind: 'sale',
    currency: 'USD',
    note: '',
    archived: false,
  }).id;
  const service2 = h2.run({
    type: 'product.save',
    companyId: s2.companyId,
    code: 'X-1',
    name: 'Konsaltinq',
    unit: 'saat',
    kind: 'service',
    groupId: '',
    archived: false,
  }).id;
  for (const [contractId, price, rate] of [
    [s2.contract, '100', ''],
    [usd, '100', '1.7000'],
  ] as const)
    h2.run({
      type: 'invoice.save',
      companyId: s2.companyId,
      direction: 'sale',
      number: '',
      date,
      partnerId: s2.customer,
      contractId,
      rate,
      pricesIncludeVat: false,
      eqSeries: '',
      eqNumber: '',
      memo: '',
      lines: [{ productId: service2, quantity: '1', price, vatRate: '18', memo: '' }],
    });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(
      within(screen.getByRole('navigation', { name: 'Əsas menyu' })).getByRole('button', {
        name: 'Satış',
      }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Satış qaimələri' }));
    await within(pane()).findAllByRole('cell', { name: /^SQ-/ });
    assert.deepEqual(headers().slice(5, 9), ['ƏDV-siz', 'ƏDV', 'Cəmi', 'Cəmi, AZN']);
    // 100 + 170 net, 18 + 30,60 VAT, 118 + 200,60 total — in manats, the currency column blank.
    assert.deepEqual(footer().filter(Boolean), [
      'Uçotdakı qaimələr üzrə cəmi, AZN',
      '270,00',
      '48,60',
      '318,60',
    ]);
  } finally {
    h2.close();
  }
});

test('design §8: a negative amount or quantity is always written with "−", never a hyphen', async () => {
  const { money, qty } = await import('../../src/renderer/format');
  const plain = (v: string) => v.replace(/\s/g, ' ');
  assert.equal(plain(money('-1234.50')), '−1 234,50');
  assert.equal(plain(qty('-1234.5')), '−1 234,5');
  assert.equal(plain(qty('1234.5')), '1 234,5');
});

test('design §8: the dashboard chart has a Y scale — 3–4 grid lines, a zero line, figures with "−"', async () => {
  const h = harness();
  const s = seed(h);
  const catalog = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
  const service = catalog.items.find((i) => i.kind === 'incomeType' && i.name === 'Xidmət satışı')!;
  const line = (amount: string, back: boolean) =>
    back
      ? {
          dtAccount: '602',
          dtSk: [service.id, '0'],
          ktAccount: '211.01',
          ktSk: [s.customer, s.contract, ''],
          amount,
          memo: '',
        }
      : {
          dtAccount: '211.01',
          dtSk: [s.customer, s.contract, ''],
          ktAccount: '601',
          ktSk: [service.id, '0'],
          amount,
          memo: '',
        };
  // A return in the last month (income −100), a sale in this one (+1 000).
  for (const [date, amount, back] of [
    [`${monthsBack(1).iso}-10`, '100', true],
    [`${monthsBack(0).iso}-01`, '1000', false],
  ] as const)
    h.run({
      type: 'operation.save',
      companyId: s.companyId,
      number: '',
      date,
      memo: '',
      lines: [line(amount, back)],
    });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Hesabatlar' }));
    await user.click(screen.getByRole('menuitem', { name: 'İdarə paneli' }));
    const svg = await waitFor(() => {
      const found = document.querySelector('.dashboard-chart svg');
      assert.ok(found);
      return found;
    });
    const grid = svg.querySelectorAll('line.grid');
    assert.ok(grid.length >= 3 && grid.length <= 4, `${grid.length} grid lines`);
    const zero = svg.querySelectorAll('line.zero');
    assert.equal(zero.length, 1);
    const ticks = [...svg.querySelectorAll('text.tick')].map((t) =>
      t.textContent!.replace(/\s/g, ' '),
    );
    assert.equal(ticks.length, grid.length + 1);
    assert.ok(ticks.includes('0'), ticks.join(' | '));
    assert.ok(
      ticks.some((t) => t.startsWith('−')),
      ticks.join(' | '),
    );
    assert.ok(!ticks.some((t) => t.includes('-')), ticks.join(' | '));
    // The scale is not symmetric: zero sits where the figures put it, bars stand on it.
    const zeroY = Number(zero[0]!.getAttribute('y1'));
    const height = Number(svg.getAttribute('height'));
    assert.ok(zeroY > height / 2, `zero at ${zeroY} of ${height}`);
    for (const bar of svg.querySelectorAll('rect.bar')) {
      const top = Number(bar.getAttribute('y'));
      const bottom = top + Number(bar.getAttribute('height'));
      assert.ok(Math.abs(top - zeroY) < 0.01 || Math.abs(bottom - zeroY) < 0.01, bar.outerHTML);
    }
    // The grid lines start right of the figures, not under them.
    const x1 = Number(grid[0]!.getAttribute('x1'));
    assert.ok(x1 >= 30, `grid from x=${x1}`);
  } finally {
    h.close();
  }
});

/** jsdom has no layout: the work area reports the given size, as Electron would measure it. */
function workArea(w: number, h: number) {
  const proto = window.HTMLElement.prototype;
  const original = {
    w: Object.getOwnPropertyDescriptor(window.Element.prototype, 'clientWidth')!,
    h: Object.getOwnPropertyDescriptor(window.Element.prototype, 'clientHeight')!,
  };
  const size = (el: Element, value: number, fallback: PropertyDescriptor) =>
    el.classList.contains('workspace') ? value : (fallback.get!.call(el) as number);
  Object.defineProperty(proto, 'clientWidth', {
    configurable: true,
    get(this: Element) {
      return size(this, w, original.w);
    },
  });
  Object.defineProperty(proto, 'clientHeight', {
    configurable: true,
    get(this: Element) {
      return size(this, h, original.h);
    },
  });
  return () => {
    delete (proto as unknown as Record<string, unknown>).clientWidth;
    delete (proto as unknown as Record<string, unknown>).clientHeight;
  };
}

test('design §8: on a work area narrower than 1600 px a document opens full; on a wider one as a window', async () => {
  for (const [width, full] of [
    [1366, true],
    [1599, true],
    [1828, false],
  ] as const) {
    window.localStorage.removeItem('meyar.windows.v2');
    const restore = workArea(width, 700);
    const h = harness();
    seed(h);
    try {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole('navigation', { name: 'Əsas menyu' });
      await user.click(screen.getAllByRole('button', { name: 'Satış qaiməsi' })[0]!);
      await user.keyboard('{Control>}n{/Control}');
      const windows = [...document.querySelectorAll<HTMLElement>('.mdi-window')];
      assert.equal(windows.length, 2);
      // A new invoice and a new operation: both follow the width of the work area.
      const [invoice, operation] = windows as [HTMLElement, HTMLElement];
      assert.equal(invoice.classList.contains('maximized'), full, `invoice, ${width} px`);
      assert.equal(operation.classList.contains('maximized'), full, `operation, ${width} px`);
      if (full) {
        // "Əvvəlki ölçü" still gives a window that fits on the work area.
        await user.click(within(invoice).getByRole('button', { name: 'Əvvəlki ölçü' }));
        assert.ok(!invoice.classList.contains('maximized'));
        assert.ok(
          parseFloat(invoice.style.left) + parseFloat(invoice.style.width) <= width,
          invoice.style.cssText,
        );
      }
    } finally {
      h.close();
      cleanup();
      restore();
      window.localStorage.removeItem('meyar.windows.v2');
    }
  }
});

test('design §8: the status bar shows the zoom the page is drawn at — the step times the fit to the screen', async () => {
  // A full HD monitor: the page is fitted to 105% (src/main/fit-zoom.ts).
  const h = harness({ fit: 1.05 });
  seed(h);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    const value = () => document.querySelector<HTMLButtonElement>('.zoom-value')!;
    await waitFor(() => assert.equal(value().textContent, '105%'));
    // What makes up the figure is told, and what the button does.
    assert.match(value().title, /seçilmiş 100%/);
    assert.match(value().title, /ekran eninə görə 105%/);
    assert.match(value().title, /Ctrl 0/);
    await user.click(screen.getByRole('button', { name: 'Miqyası böyüt' }));
    await waitFor(() => assert.equal(value().textContent, '116%'));
    assert.match(value().title, /seçilmiş 110%/);
    // The window is made narrower: the fit changes, the figure follows.
    h.refit(1);
    await waitFor(() => assert.equal(value().textContent, '110%'));
    assert.doesNotMatch(value().title, /ekran eninə/);
    await user.click(value());
    await waitFor(() => assert.equal(value().textContent, '100%'));
  } finally {
    h.close();
  }
});

test('stage 6a: the box saves the shape of the DVX requests; without a sign-in it says what to do', async () => {
  const h = harness();
  seed(h);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const page = within(pane());
    const save = await page.findByRole('button', { name: 'DVX sorğularının quruluşunu saxla' });
    await user.click(save);
    await page.findByText('DVX ilə əlaqə yoxdur.');
    h.setDvxDiagnosis({
      ok: true,
      value: {
        file: 'C:\Users\m\Documents\Meyar-DVX-quruluş-2026-10-22-1200.json',
        requests: 7,
        replayed: 2,
      },
    });
    await user.click(save);
    await page.findByText(/Meyar-DVX-quruluş-2026-10-22-1200\.json/);
    await page.findByText(/7 sorğu, 2 siyahı/);
    assert.equal(h.dvxDiagnoses.length, 2);
  } finally {
    h.close();
  }
});

test('stage 6a: the box shows whether the DVX cabinet is signed in', async () => {
  const h = harness();
  seed(h);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Satış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Göndərilən e-qaimələr (DVX)' }));
    const page = within(pane());
    const status = await page.findByRole('status', { name: 'DVX ilə əlaqə' });
    assert.match(status.textContent ?? '', /daxil olunmayıb/);
    act(() => h.dvxState({ connected: true }));
    await waitFor(() => assert.match(status.textContent ?? '', /DVX: daxil olunub/));
    act(() => h.dvxState({ connected: false }));
    await waitFor(() => assert.match(status.textContent ?? '', /daxil olunmayıb/));
  } finally {
    h.close();
  }
});

test('stage 6b: "DVX-dən yenilə" signs in first, then loads the open period by itself, once', async () => {
  const h = harness();
  seed(h);
  const csv = [
    'Daxil olan qaimələrin siyahısı',
    'Seriya;Nömrə;Tarix;VÖEN;Adı;Malın ƏDV-siz ümumi dəyəri;Malın ƏDV məbləği;Yekun məbləğ;ƏDV-yə cəlb edilən;Vəziyyəti',
    'MT;2609001;05.09.2026;1700000001;Malsatan MMC;100,00;18,00;118,00;100,00;Təsdiqləndi',
  ].join('\r\n');
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const page = within(pane());
    // Not signed in: the cabinet opens and the update waits for the sign-in.
    await user.click(await page.findByRole('button', { name: 'DVX-dən yenilə' }));
    await page.findByText(/girişdən sonra yeniləmə özü başlayacaq/);
    assert.deepEqual(h.dvxOpened, ['purchase']);
    assert.equal(h.dvxExports.length, 0);
    h.setDvxExport({
      ok: true,
      value: { files: [{ name: 'DVX-Gelenler.csv', bytes: new TextEncoder().encode(csv) }] },
    });
    act(() => h.dvxState({ connected: true }));
    await page.findByText(/DVX-dən yeniləndi .*yeni 1 e-qaimə/);
    // Stage 6c-1: the attempt is kept and the box says when it was last updated.
    await waitFor(() =>
      assert.match(
        page.getByRole('status', { name: 'Son yeniləmə' }).textContent ?? '',
        /^Son yeniləmə: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} — yeni 1, statusu dəyişən 0$/,
      ),
    );
    assert.equal(h.commands.filter((c) => c.type === 'eqaime.synced').length, 1);
    assert.equal(h.dvxExports.length, 1);
    assert.equal(h.dvxExports[0]!.direction, 'purchase');
    assert.match(h.dvxExports[0]!.from, /^\d{4}-01-01$/);
    const imports = h.ledger.query({
      type: 'eqImports',
      companyId: (h.ledger.query({ type: 'companies' }) as { id: string }[])[0]!.id,
      direction: 'purchase',
    }) as { source: string }[];
    assert.deepEqual(
      imports.map((i) => i.source),
      ['portal'],
    );
    // Signed in: the next update goes straight to DVX; the same e-qaimə is not added again.
    await user.click(page.getByRole('button', { name: 'DVX-dən yenilə' }));
    await page.findByText(/DVX-dən yeniləndi .*yeni 0 e-qaimə/);
    assert.equal(h.dvxExports.length, 2);
    assert.deepEqual(h.dvxOpened, ['purchase']);
    // audit 2026-10-25: DVX could not say whether more pages follow — the update says it is partial.
    h.setDvxExport({
      ok: true,
      value: {
        files: [{ name: 'DVX-Gelenler.csv', bytes: new TextEncoder().encode(csv) }],
        partial: true,
      },
    });
    await user.click(page.getByRole('button', { name: 'DVX-dən yenilə' }));
    await page.findByText(/yarımçıq: DVX növbəti səhifəni demədi/);
    // A refused export says why, nothing is loaded.
    h.setDvxExport({ ok: false, error: { message: 'DVX sessiyasının vaxtı bitib.', code: 'dvx' } });
    await user.click(page.getByRole('button', { name: 'DVX-dən yenilə' }));
    await page.findByText('DVX sessiyasının vaxtı bitib.');
    // A failed attempt is kept too; the last good update stays visible.
    await waitFor(() =>
      assert.match(
        page.getByRole('status', { name: 'Son yeniləmə' }).textContent ?? '',
        /^Son cəhd \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} alınmadı — DVX sessiyasının vaxtı bitib\.; son yeniləmə: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/,
      ),
    );
    const syncs = h.commands.filter((c) => c.type === 'eqaime.synced') as unknown as {
      result: string;
    }[];
    assert.deepEqual(
      syncs.map((s) => s.result),
      ['ok', 'ok', 'partial', 'failed'],
    );
  } finally {
    h.close();
  }
});

test('stage 6c-2: "DVX-dən yenilə" shows its progress and can be cancelled; the pages taken stay', async () => {
  const h = harness();
  seed(h);
  const csv = [
    'Daxil olan qaimələrin siyahısı',
    'Seriya;Nömrə;Tarix;VÖEN;Adı;Malın ƏDV-siz ümumi dəyəri;Malın ƏDV məbləği;Yekun məbləğ;ƏDV-yə cəlb edilən;Vəziyyəti',
    'MT;2609001;05.09.2026;1700000001;Malsatan MMC;100,00;18,00;118,00;100,00;Təsdiqləndi',
  ].join('\r\n');
  try {
    const user = userEvent.setup();
    act(() => h.dvxState({ connected: true }));
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const page = within(pane());
    let answer!: (
      a: Outcome<{ files: { name: string; bytes: Uint8Array }[]; cancelled?: boolean }>,
    ) => void;
    h.setDvxExport(new Promise((resolve) => (answer = resolve)));
    await user.click(await page.findByRole('button', { name: 'DVX-dən yenilə' }));
    await page.findByText('Gələnlər: DVX-dən alınır…');
    act(() => h.dvxProgress({ direction: 'purchase', page: 3 }));
    await page.findByText('Gələnlər: səhifə 3 alınır…');
    // Another box's progress is not this box's.
    act(() => h.dvxProgress({ direction: 'sale', page: 7 }));
    assert.equal(page.queryByText(/səhifə 7/), null);
    await user.click(page.getByRole('button', { name: 'Ləğv et' }));
    assert.equal(h.dvxCancels(), 1);
    await act(async () =>
      answer({
        ok: true,
        value: {
          files: [{ name: 'DVX-Gelenler.csv', bytes: new TextEncoder().encode(csv) }],
          cancelled: true,
        },
      }),
    );
    await page.findByText(/DVX yeniləməsi ləğv edildi .*yeni 1 e-qaimə/);
    assert.equal(page.queryByRole('button', { name: 'Ləğv et' }), null);
    await waitFor(() =>
      assert.match(
        page.getByRole('status', { name: 'Son yeniləmə' }).textContent ?? '',
        /^Son cəhd .* ləğv edildi; son yeniləmə: /,
      ),
    );
    const syncs = h.commands.filter((c) => c.type === 'eqaime.synced') as unknown as {
      result: string;
      added: number;
    }[];
    assert.deepEqual(
      syncs.map((s) => [s.result, s.added]),
      [['cancelled', 1]],
    );
  } finally {
    h.close();
  }
});

test('stage 7a: a new fixed asset is put into service from 113 and the list shows its depreciation', async () => {
  const h = harness();
  const s = seed(h);
  const supplier = h.run({
    type: 'partner.save',
    companyId: s.companyId,
    name: 'Avto MMC',
    taxId: '1700000011',
    kind: 'legal',
    note: '',
    archived: false,
  }).id;
  const contract = h.run({
    type: 'contract.save',
    companyId: s.companyId,
    partnerId: supplier,
    number: 'A-1',
    date: '2026-01-01',
    kind: 'purchase',
    currency: 'AZN',
    note: '',
    archived: false,
  }).id;
  const truck = h.run({
    type: 'product.save',
    companyId: s.companyId,
    code: '',
    name: 'Mercedes Actros',
    unit: 'ədəd',
    kind: 'asset',
    groupId: '',
    archived: false,
  }).id;
  h.run({
    type: 'invoice.save',
    companyId: s.companyId,
    direction: 'purchase',
    number: '',
    date: '2026-01-15',
    partnerId: supplier,
    contractId: contract,
    rate: '',
    pricesIncludeVat: false,
    eqSeries: '',
    eqNumber: '',
    memo: '',
    lines: [{ productId: truck, quantity: '1', price: '50000', vatRate: '18', memo: '' }],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Əsas vəsaitlər' }));
    await user.click(screen.getByRole('menuitem', { name: 'Əsas vəsaitlər' }));
    const list = within(pane());
    await list.findByText('Hələ əsas vəsait yoxdur');
    await user.click(list.getAllByRole('button', { name: 'Yeni əsas vəsait' })[0]!);
    await user.type(
      await screen.findByRole('textbox', { name: 'Əsas vəsaitin adı' }),
      'Actros 10-AB-123',
    );
    await user.click(screen.getByRole('button', { name: 'Saxla' }));
    await list.findByText('İN-000001');
    await user.click(list.getByRole('button', { name: 'İstismara ver' }));
    const editor = within(pane());
    const pick = async (label: string, text: string) => {
      await user.click(await editor.findByRole('combobox', { name: label }));
      await user.keyboard(text);
      await user.keyboard('{Enter}');
    };
    await pick('Sətir 1: əsas vəsait', 'Actros 10');
    // Transport: 60 months to 701 with the "Amortizasiya" item, filled in by itself.
    assert.equal(
      (editor.getByRole('textbox', { name: 'Sətir 1: müddət' }) as HTMLInputElement).value,
      '60',
    );
    await pick('Sətir 1: nomenklatura', 'Mercedes');
    await user.click(editor.getByRole('button', { name: /^Uçota al$/ }));
    await editor.findByText('Sənəd ƏV-000001 uçota alındı.');
    await editor.findByText(/Aylıq amortizasiya: 833,33/);
    const rows = h.ledger.query({
      type: 'fixedAssets',
      companyId: s.companyId,
      date: '2099-12-31',
    }) as { cost: string; monthly: string; expenseAccount: string; expenseNames: string[] }[];
    assert.deepEqual(
      [rows[0]!.cost, rows[0]!.monthly, rows[0]!.expenseAccount, rows[0]!.expenseNames],
      ['50000.00', '833.33', '701', ['Əsas nomenklatura qrupu', 'Amortizasiya']],
    );
    // Stage 7b: the schedule lists it; its card opens from the row.
    await user.click(screen.getByRole('button', { name: 'Əsas vəsaitlər' }));
    await user.click(screen.getByRole('menuitem', { name: 'Amortizasiya cədvəli' }));
    await within(pane()).findByText('Actros 10-AB-123');
  } finally {
    h.close();
  }
});

test('stage 7c: a sale invoice line of a fixed asset asks which asset is sold and books it to 611', async () => {
  const h = harness();
  const s = seed(h);
  const now = new Date();
  const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const p = (name: string, taxId: string) =>
    h.run({
      type: 'partner.save',
      companyId: s.companyId,
      name,
      taxId,
      kind: 'legal',
      note: '',
      archived: false,
    }).id;
  const supplier = p('Avto MMC', '1700000011');
  const contract = h.run({
    type: 'contract.save',
    companyId: s.companyId,
    partnerId: supplier,
    number: 'A-1',
    date: '2026-01-01',
    kind: 'purchase',
    currency: 'AZN',
    note: '',
    archived: false,
  }).id;
  const truck = h.run({
    type: 'product.save',
    companyId: s.companyId,
    code: '',
    name: 'Mercedes Actros',
    unit: 'ədəd',
    kind: 'asset',
    groupId: '',
    archived: false,
  }).id;
  h.run({
    type: 'invoice.save',
    companyId: s.companyId,
    direction: 'purchase',
    number: '',
    date: first,
    partnerId: supplier,
    contractId: contract,
    rate: '',
    pricesIncludeVat: false,
    eqSeries: '',
    eqNumber: '',
    memo: '',
    lines: [{ productId: truck, quantity: '1', price: '50000', vatRate: '18', memo: '' }],
  });
  const actros = h.run({
    type: 'fixedAsset.save',
    companyId: s.companyId,
    name: 'Actros 10-AB-123',
    inventoryNo: '',
    group: 'transport',
    plate: '',
    note: '',
    archived: false,
  }).id;
  const items = (h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog).items;
  h.run({
    type: 'asset.save',
    companyId: s.companyId,
    kind: 'commission',
    number: '',
    date: first,
    memo: '',
    lines: [
      {
        assetId: actros,
        productId: truck,
        quantity: '1',
        cost: '',
        accumulated: '0',
        salvage: '0',
        lifeMonths: 60,
        expenseAccount: '721',
        expenseSk: [items.find((i) => i.role === 'depreciation')!.id],
        counterAccount: '',
        counterSk: [],
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getAllByRole('button', { name: 'Satış qaiməsi' })[0]!);
    const editor = within(pane());
    const pick = async (label: string, text: string) => {
      await user.click(await editor.findByRole('combobox', { name: label }));
      await user.keyboard(text);
      await user.keyboard('{Enter}');
    };
    await pick('Kontragent', 'Alıcı');
    await pick('Sətir 1 nomenklatura', 'Mercedes');
    // A fixed asset: no stock account, but the asset itself.
    assert.equal(editor.queryByRole('combobox', { name: 'Sətir 1 anbar hesabı' }), null);
    await user.type(editor.getByRole('textbox', { name: 'Sətir 1 qiymət' }), '40000');
    await user.keyboard('{Control>}s{/Control}');
    await editor.findByText(/hansı əsas vəsait satılır/);
    await pick('Sətir 1 əsas vəsait', 'Actros');
    await user.keyboard('{Control>}s{/Control}');
    await editor.findByText(/Qaimə SQ-000001 uçota alındı/);
    const entry = await editor.findByRole('region', { name: 'Yazılışlar' });
    assert.match(entry.textContent ?? '', /611/);
    assert.match(entry.textContent ?? '', /731/);
  } finally {
    h.close();
  }
});

test('stage 6c-3: İş masası updates both boxes from DVX at once, after the sign-in', async () => {
  const h = harness();
  seed(h);
  const csv = [
    'Daxil olan qaimələrin siyahısı',
    'Seriya;Nömrə;Tarix;VÖEN;Adı;Malın ƏDV-siz ümumi dəyəri;Malın ƏDV məbləği;Yekun məbləğ;ƏDV-yə cəlb edilən;Vəziyyəti',
    'MT;2609001;05.09.2026;1700000001;Malsatan MMC;100,00;18,00;118,00;100,00;Təsdiqləndi',
  ].join('\r\n');
  h.setDvxExport((direction) =>
    direction === 'purchase'
      ? {
          ok: true,
          value: { files: [{ name: 'DVX-Gelenler.csv', bytes: new TextEncoder().encode(csv) }] },
        }
      : { ok: true, value: { files: [] } },
  );
  try {
    const user = userEvent.setup();
    render(<App />);
    const desk = within(await screen.findByRole('region', { name: 'DVX e-qaimələri' }));
    await user.click(desk.getByRole('button', { name: 'DVX-dən yenilə (gələn və göndərilən)' }));
    await desk.findByText(/girişdən sonra hər iki qutu özü yenilənəcək/);
    assert.deepEqual(h.dvxOpened, ['purchase']);
    act(() => h.dvxState({ connected: true }));
    await desk.findByText(/Gələnlər: DVX-dən yeniləndi .*yeni 1 e-qaimə/);
    desk.getByText(/Göndərilənlər: DVX-də .* dövründə e-qaimə yoxdur/);
    assert.deepEqual(
      h.dvxExports.map((e) => e.direction),
      ['purchase', 'sale'],
    );
    const syncs = h.commands.filter((c) => c.type === 'eqaime.synced') as unknown as {
      direction: string;
      result: string;
    }[];
    assert.deepEqual(
      syncs.map((s) => [s.direction, s.result]),
      [
        ['purchase', 'ok'],
        ['sale', 'ok'],
      ],
    );
  } finally {
    h.close();
  }
});

test('audit of stage 6: an export that does not page is partial when its one file holds no more than a page', async () => {
  const h = harness();
  seed(h);
  const head = [
    'Daxil olan qaimələrin siyahısı',
    'Seriya;Nömrə;Tarix;VÖEN;Adı;Malın ƏDV-siz ümumi dəyəri;Malın ƏDV məbləği;Yekun məbləğ;ƏDV-yə cəlb edilən;Vəziyyəti',
  ];
  const one =
    'MT;2609001;05.09.2026;1700000001;Malsatan MMC;100,00;18,00;118,00;100,00;Təsdiqləndi';
  const two =
    'MT;2609002;06.09.2026;1700000001;Malsatan MMC;200,00;36,00;236,00;200,00;Təsdiqləndi';
  const file = (...rows: string[]) => ({
    name: 'DVX-Gelenler.csv',
    bytes: new TextEncoder().encode([...head, ...rows].join('\r\n')),
  });
  try {
    const user = userEvent.setup();
    act(() => h.dvxState({ connected: true }));
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const page = within(pane());
    // DVX said more follow, the next page was the same file of a page or less: the rest is missing.
    h.setDvxExport({ ok: true, value: { files: [file(one)], repeated: true, pageSize: 100 } });
    await user.click(await page.findByRole('button', { name: 'DVX-dən yenilə' }));
    const said = await page.findByText(/DVX-dən yeniləndi .*yarımçıq/);
    // Not shown as a success.
    assert.match(said.closest('.notice')?.className ?? '', /warning/);
    // More rows than a page: the export gave the whole period at once.
    h.setDvxExport({ ok: true, value: { files: [file(one, two)], repeated: true, pageSize: 1 } });
    await user.click(page.getByRole('button', { name: 'DVX-dən yenilə' }));
    await page.findByText(/DVX-dən yeniləndi \([^)]*\): yeni 1 e-qaimə/);
    const syncs = h.commands.filter((c) => c.type === 'eqaime.synced') as unknown as {
      result: string;
    }[];
    assert.deepEqual(
      syncs.map((s) => s.result),
      ['partial', 'ok'],
    );
  } finally {
    h.close();
  }
});

test('2026-10-22: a VAT-inclusive DVX e-qaimə opens as an invoice with "ƏDV daxildir" and DVX\'s VAT', async () => {
  const h = harness();
  const s = seed(h);
  const supplier = h.run({
    type: 'partner.save',
    companyId: s.companyId,
    name: 'Kaan',
    taxId: '1700000003',
    kind: 'legal',
    note: '',
    archived: false,
  }).id;
  h.run({
    type: 'contract.save',
    companyId: s.companyId,
    partnerId: supplier,
    number: 'K-1',
    date: '2026-01-01',
    kind: 'purchase',
    currency: 'AZN',
    note: '',
    archived: false,
  });
  const product = h.run({
    type: 'product.save',
    companyId: s.companyId,
    code: '',
    name: 'Yanacaq',
    unit: 'xidmət',
    kind: 'service',
    groupId: '',
    archived: false,
  }).id;
  const expense = (
    h.ledger.query({ type: 'catalog', companyId: s.companyId }) as {
      items: { id: string; kind: string }[];
    }
  ).items.find((i) => i.kind === 'expenseItem')!.id;
  h.run({
    type: 'eqMap.bulk',
    companyId: s.companyId,
    direction: 'purchase',
    taxIds: ['1700000003'],
    productId: product,
    account: '721',
    expenseItemId: expense,
    incomeTypeId: '',
    vatTreatment: '',
    mode: 'suggest',
  });
  h.run({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: s.companyId,
    direction: 'purchase',
    report: 'invoices',
    source: 'file',
    fileName: 'gelenler.xlsx',
    fileHash: 'e'.repeat(64),
    documents: [
      {
        row: 2,
        number: 'MT1',
        date: '2026-09-30',
        taxId: '1700000003',
        name: 'Kaan',
        status: 'Təsdiqləndi',
        net: '1091.53',
        vat: '196.47',
        base18: '1091.53',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const page = within(pane());
    await user.click(await page.findByRole('button', { name: 'MT1: uçota al' }));
    const inclusive = await screen.findByRole('checkbox', { name: /ƏDV daxildir/ });
    assert.equal((inclusive as HTMLInputElement).checked, true);
    // The VAT is DVX's to the qəpik: no difference to warn about.
    await screen.findAllByText(/196,47/);
  } finally {
    h.close();
  }
});

test('2026-10-25: no common period in the header; each page keeps its own (DVX ↔ uçot has a month field)', async () => {
  const h = harness();
  const s = seed(h);
  h.run({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: s.companyId,
    direction: 'purchase',
    report: 'invoices',
    source: 'file',
    fileName: 'gelenler.xlsx',
    fileHash: 'f'.repeat(64),
    documents: [
      {
        row: 2,
        number: 'MT1',
        date: '2026-09-30',
        taxId: '1700000003',
        name: 'Rabitə ASC',
        status: 'Təsdiqləndi',
        net: '50.00',
        vat: '9.00',
        base18: '50.00',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    assert.ok(!screen.queryByRole('group', { name: 'İş dövrü' }), 'header period');
    assert.ok(!document.querySelector('.period-switch'), 'header period');
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const page = within(pane());
    await user.click(await page.findByRole('button', { name: /DVX ↔ uçot/ }));
    const panel = await page.findByRole('region', { name: 'DVX ilə uçotun tutuşdurulması' });
    const month = within(panel).getByRole('group', { name: 'Ay' });
    await user.click(within(month).getByRole('button', { name: 'Əvvəlki ay' }));
    // The month moved: the panel shows the month before.
    await within(panel).findByRole('table', { name: 'Aylar üzrə ƏDV' });
  } finally {
    h.close();
  }
});

test('2026-10-25: trial balance and account card as in 1C (the user chose variant A)', async () => {
  const h = harness();
  const s = seed(h);
  const date = new Date();
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
  h.run({
    type: 'operation.save',
    companyId: s.companyId,
    number: '',
    date: iso,
    memo: 'Başlanğıc',
    lines: [
      {
        dtAccount: '223.01',
        dtSk: [s.bankAccount],
        ktAccount: '301',
        ktSk: [s.founder, s.capitalIn],
        amount: '30000',
        memo: '',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getAllByRole('button', { name: 'Dövriyyə balansı' })[0]!);
    const page = within(pane());
    // The report sheet: company, title, period; 1C's column groups; no section headings.
    await page.findByText('Hesablar üzrə dövriyyə-saldo cədvəli');
    for (const name of ['Dövrün əvvəlinə saldo', 'Dövr üzrə dövriyyə', 'Dövrün sonuna saldo'])
      page.getByRole('columnheader', { name });
    assert.ok(!/Qısamüddətli aktivlər/.test(pane().textContent ?? ''), 'no section headings');
    // Grouping marks in the left margin, as 1C: ⊞ closed, ⊟ open.
    const open = await page.findByRole('button', { name: 'Aç: Bank hesablaşma hesabları' });
    assert.equal(open.textContent, '⊞');
    await user.click(open);
    assert.equal(
      page.getByRole('button', { name: 'Bağla: Bank hesablaşma hesabları' }).textContent,
      '⊟',
    );
    // The account card of 223: 1C's columns, the saldo rows.
    const row = [...pane().querySelectorAll('tr')].find((r) =>
      /^\s*⊟?\s*223\b/.test(r.textContent ?? ''),
    )!;
    await user.dblClick(row);
    const card = within(pane());
    await card.findByText('223 hesabının kartı');
    for (const name of ['Debet (hesab, subkonto)', 'Kredit (hesab, subkonto)', 'Cari saldo'])
      card.getByRole('columnheader', { name });
    card.getByText('Dövrün əvvəlinə saldo');
    card.getByText('Dövrün sonuna saldo');
    // The posting: Dt 223.01 (the bank account), Kt 301; the saldo is debit.
    const line = [...pane().querySelectorAll('tbody tr')].find((r) =>
      /Başlanğıc/.test(r.textContent ?? ''),
    )!;
    assert.match(line.textContent ?? '', /223\.01/);
    assert.match(line.textContent ?? '', /301/);
    assert.match(line.textContent ?? '', /D\s*30\s000,00/);
  } finally {
    h.close();
  }
});

test('audit 2026-10-25: an invoice saved other than DVX wrote shows the warning at once and stays open', async () => {
  const h = harness();
  const s = seed(h);
  const supplier = h.run({
    type: 'partner.save',
    companyId: s.companyId,
    name: 'Kaan',
    taxId: '1700000003',
    kind: 'legal',
    note: '',
    archived: false,
  }).id;
  h.run({
    type: 'contract.save',
    companyId: s.companyId,
    partnerId: supplier,
    number: 'K-1',
    date: '2026-01-01',
    kind: 'purchase',
    currency: 'AZN',
    note: '',
    archived: false,
  });
  const product = h.run({
    type: 'product.save',
    companyId: s.companyId,
    code: '',
    name: 'Yanacaq',
    unit: 'xidmət',
    kind: 'service',
    groupId: '',
    archived: false,
  }).id;
  const expense = (
    h.ledger.query({ type: 'catalog', companyId: s.companyId }) as {
      items: { id: string; kind: string }[];
    }
  ).items.find((i) => i.kind === 'expenseItem')!.id;
  h.run({
    type: 'eqMap.bulk',
    companyId: s.companyId,
    direction: 'purchase',
    taxIds: ['1700000003'],
    productId: product,
    account: '721',
    expenseItemId: expense,
    incomeTypeId: '',
    vatTreatment: '',
    mode: 'suggest',
  });
  h.run({
    type: 'eqaime.import',
    directionConfirmed: true,
    companyId: s.companyId,
    direction: 'purchase',
    report: 'invoices',
    source: 'file',
    fileName: 'gelenler.xlsx',
    fileHash: 'e'.repeat(64),
    documents: [
      {
        row: 2,
        number: 'MT1',
        date: '2026-09-30',
        taxId: '1700000003',
        name: 'Kaan',
        status: 'Təsdiqləndi',
        net: '1091.53',
        vat: '196.47',
        base18: '1091.53',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const page = within(pane());
    await user.click(await page.findByRole('button', { name: 'MT1: uçota al' }));
    const price = (await screen.findByRole('textbox', {
      name: 'Sətir 1 qiymət',
    })) as HTMLInputElement;
    await user.clear(price);
    await user.type(price, '1300');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await screen.findByText(/Qaimə saxlanıldı, amma DVX-dən fərqlidir/);
    // Ctrl+Enter did not close the window: the warning is read first.
    screen.getByRole('checkbox', { name: /ƏDV daxildir/ });
  } finally {
    h.close();
  }
});

test('stage 8a: the month payroll fills in from the employees, computes as typed and is posted', async () => {
  const h = harness();
  const s = seed(h);
  const catalog = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
  const group = catalog.items.find((i) => i.role === 'defaultProductGroup')!.id;
  const driver = h.run({
    type: 'employee.save',
    companyId: s.companyId,
    name: 'Sürücü Məmmədov',
    position: 'Sürücü',
    fin: '',
    tabNo: '001',
    hired: '2026-01-12',
    left: '',
    salary: '1000',
    expenseAccount: '701',
    expenseSk: [group, ''],
    archived: false,
  }).id;
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Əmək haqqı' }));
    await user.click(screen.getByRole('menuitem', { name: 'Əmək haqqının hesablanması' }));
    const list = within(pane());
    await list.findByText('Hələ əmək haqqı hesablanmayıb');
    await user.click(list.getByRole('button', { name: 'Əmək haqqını hesabla' }));
    const editor = within(pane());
    // Filled in from the employee's card; 1 000 → 865,00 to pay (§9).
    await waitFor(() =>
      assert.equal(editor.getByLabelText('Sətir 1: ödəniləcək').textContent, '865,00'),
    );
    const bonus = editor.getByRole('textbox', { name: 'Sətir 1: mükafat' });
    await user.type(bonus, '1500');
    // 2 500: the 200 relief still applies — 2 500 − 69 − 236 − 12,50 − 50.
    await waitFor(() =>
      assert.equal(
        editor.getByLabelText('Sətir 1: ödəniləcək').textContent?.replace(/\s/g, ' '),
        '2 132,50',
      ),
    );
    await user.clear(bonus);
    await user.click(editor.getByRole('button', { name: /^Uçota al$/ }));
    await editor.findByText('Sənəd ƏH-000001 uçota alındı.');
    const docs = h.ledger.query({ type: 'payrollDocuments', companyId: s.companyId }) as {
      net: string;
      lines: { employeeId: string }[];
    }[];
    assert.deepEqual([docs[0]!.net, docs[0]!.lines[0]!.employeeId], ['865.00', driver]);
    // The rates: the 2026 set, used by the posted month, is not changed any more.
    await user.click(screen.getByRole('button', { name: 'Əmək haqqı' }));
    await user.click(screen.getByRole('menuitem', { name: 'Dərəcələr' }));
    const rates = within(pane());
    await rates.findByText('01.01.2026 tarixindən');
    await rates.findByText('Uçotdakı əmək haqqı sənədləri ilə istifadə olunub');
  } finally {
    h.close();
  }
});

test('stage 8c: a vacation with the accountant’s average goes to the month payroll; the payslip shows the debt', async () => {
  const h = harness();
  const s = seed(h);
  const catalog = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
  const group = catalog.items.find((i) => i.role === 'defaultProductGroup')!.id;
  h.run({
    type: 'employee.save',
    companyId: s.companyId,
    name: 'Sürücü Məmmədov',
    position: 'Sürücü',
    fin: '',
    tabNo: '001',
    hired: '2025-01-12',
    left: '',
    salary: '1000',
    expenseAccount: '701',
    expenseSk: [group, ''],
    mainJob: true,
    exemption: '0',
    exemptionExtra: false,
    exemptionFrom: '',
    exemptionTo: '',
    archived: false,
  });
  const month = monthsBack(1);
  const [y, m] = [month.iso.slice(0, 4), month.iso.slice(5, 7)];
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Əmək haqqı' }));
    await user.click(screen.getByRole('menuitem', { name: 'Məzuniyyətlər' }));
    const list = within(pane());
    await list.findByText('Hələ sənəd yoxdur');
    await user.click(list.getByRole('button', { name: 'Məzuniyyət' }));
    const editor = within(pane());
    await user.click(await editor.findByRole('combobox', { name: 'İşçi' }));
    await user.keyboard('Sürücü');
    await user.keyboard('{Enter}');
    const date = async (label: string, text: string) => {
      const input = editor.getByRole('textbox', { name: label });
      await user.clear(input);
      await user.type(input, text);
    };
    await date('Başlama', `05.${m}.${y}`);
    await date('Bitmə', `09.${m}.${y}`);
    await user.type(editor.getByRole('textbox', { name: /Orta aylıq qazanc/ }), '1216');
    await user.click(editor.getByRole('button', { name: 'Hesabla və saxla' }));
    // 1 216 / 30,4 = 40,00 a day × the days (the holidays of the calendar not counted, 8d).
    await waitFor(() =>
      assert.match(
        editor.getByRole('status', { name: 'Hesablama' }).textContent ?? '',
        /40,00 ₼ × \d+ gün/,
      ),
    );
    const vac = (
      h.ledger.query({ type: 'absences', companyId: s.companyId }) as { amount: string }[]
    )[0]!;
    const shown = vac.amount.replace('.', ',');
    await editor.findByText(new RegExp(`Məzuniyyət haqqı: ${shown}`));
    // The month's payroll shows it and the fewer working days.
    await user.click(screen.getByRole('button', { name: 'Əmək haqqı' }));
    await user.click(screen.getByRole('menuitem', { name: 'Əmək haqqını hesabla' }));
    const doc = within(pane());
    await waitFor(() => assert.equal(doc.getByLabelText('Sətir 1: məzuniyyət').textContent, shown));
    await user.click(doc.getByRole('button', { name: /^Uçota al$/ }));
    await doc.findByText('Sənəd ƏH-000001 uçota alındı.');
    const posted = h.ledger.query({ type: 'payrollDocuments', companyId: s.companyId }) as {
      net: string;
      lines: { vacation: string }[];
    }[];
    assert.equal(posted[0]!.lines[0]!.vacation, vac.amount);
    // The payslip: nothing paid yet — the month's net is owed.
    await user.click(screen.getByRole('button', { name: 'Əmək haqqı' }));
    await user.click(screen.getByRole('menuitem', { name: 'Hesablaşma vərəqəsi' }));
    const slip = within(pane());
    await user.click(await slip.findByRole('combobox', { name: 'İşçi' }));
    await user.keyboard('Sürücü');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      assert.equal(
        slip.getByLabelText('Ayın sonuna borc').textContent?.replace(/\s/g, ' '),
        posted[0]!.net.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' '),
      ),
    );
    await slip.findByText('Məzuniyyət / kompensasiya');
  } finally {
    h.close();
  }
});

test('stage 8d: the timesheet fills itself, a cell typed changes the hours at once; the calendar shows the norms', async () => {
  const h = harness();
  const s = seed(h);
  h.run({
    type: 'employee.save',
    companyId: s.companyId,
    name: 'Sürücü Məmmədov',
    position: 'Sürücü',
    fin: '',
    tabNo: '001',
    hired: '2025-01-12',
    left: '',
    salary: '1000',
    expenseAccount: '721',
    expenseSk: [],
    mainJob: true,
    exemption: '0',
    exemptionExtra: false,
    exemptionFrom: '',
    exemptionTo: '',
    vacationDays: 21,
    vacationExtra: 0,
    tenureFrom: '',
    archived: false,
  });
  const month = monthsBack(1).iso;
  const filled = h.ledger.query({ type: 'timesheetFill', companyId: s.companyId, month }) as {
    days: { workday: boolean; norm: number }[];
  };
  const first = filled.days.findIndex((d) => d.workday);
  const norm = filled.days.reduce((t, d) => t + d.norm, 0);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Əmək haqqı' }));
    await user.click(screen.getByRole('menuitem', { name: 'Tabel' }));
    const list = within(pane());
    await list.findByText('Hələ tabel yoxdur');
    await user.click(list.getByRole('button', { name: 'Tabel' }));
    const grid = within(pane());
    const hours = await grid.findByLabelText('Sürücü Məmmədov: saat');
    assert.equal(hours.textContent, String(norm));
    const cell = grid.getByRole('textbox', { name: `Sürücü Məmmədov, ${first + 1}` });
    await user.clear(cell);
    await user.type(cell, 'Q');
    await waitFor(() =>
      assert.equal(
        grid.getByLabelText('Sürücü Məmmədov: saat').textContent,
        String(norm - filled.days[first]!.norm),
      ),
    );
    await user.click(grid.getByRole('button', { name: 'Saxla' }));
    await grid.findByText(`Tabel TB-${month} saxlanıldı.`);
    const saved = h.ledger.query({ type: 'timesheets', companyId: s.companyId }) as {
      rows: { absent: { truancy: number } }[];
    }[];
    assert.equal(saved[0]!.rows[0]!.absent.truancy, 1);
    // The production calendar: the year's norms.
    await user.click(screen.getByRole('button', { name: 'Əmək haqqı' }));
    await user.click(screen.getByRole('menuitem', { name: 'İstehsalat təqvimi' }));
    const cal = within(pane());
    await cal.findByRole('table', { name: 'Aylar üzrə norma' });
    if (month.startsWith('2026')) await cal.findByText(/2026: 241 iş günü, 1922 saat/);
  } finally {
    h.close();
  }
});

test('stage 9a: the VAT return lists sales by rate with their source; a row opens the account card', async () => {
  const h = harness();
  const s = seed(h);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const catalog = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
  const service = catalog.items.find((i) => i.kind === 'incomeType' && i.name === 'Xidmət satışı')!;
  h.run({
    type: 'operation.save',
    companyId: s.companyId,
    number: '',
    date: `${month}-01`,
    memo: 'İxrac xidməti',
    lines: [
      {
        dtAccount: '211.01',
        dtSk: [s.customer, s.contract, ''],
        ktAccount: '601',
        ktSk: [service.id, '0'],
        amount: '1000',
        memo: '',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Hesabatlar' }));
    await user.click(screen.getByRole('menuitem', { name: 'ƏDV bəyannaməsi' }));
    const report = within(pane());
    const row = await report.findByRole('rowheader', {
      name: 'Sıfır dərəcə ilə vergi tutulan əməliyyatlar',
    });
    const cells = within(row.closest('tr')!).getAllByRole('cell');
    assert.deepEqual(
      cells.map((c) => c.textContent!.replace(/\s/g, ' ')),
      ['1 000,00', '', '601, dərəcə 0%'],
    );
    // A sale without an invoice: the appendix says the accountant names the document.
    await report.findByText(/qaiməsiz dövriyyədir/);
    report.getByText(/ayı bağlanmayıb/);
    await user.click(report.getByRole('button', { name: /Excel/ }));
    await report.findByText(new RegExp(`Saxlanıldı: .*ƏDV bəyannaməsi ${month}\.xlsx`));
    await user.dblClick(row);
    await waitFor(() =>
      assert.equal(
        document.querySelector('.mdi-window.active .mdi-caption')?.textContent,
        'Hesab kartı 601',
      ),
    );
  } finally {
    h.close();
  }
});

test('stage 9b: the muzdlu iş return opens on the quarter, by months; another quarter is chosen', async () => {
  const h = harness();
  const s = seed(h);
  const catalog = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
  const group = catalog.items.find((i) => i.role === 'defaultProductGroup')!.id;
  h.run({
    type: 'employee.save',
    companyId: s.companyId,
    name: 'Sürücü Məmmədov',
    position: 'Sürücü',
    fin: '5AAA111',
    tabNo: '001',
    hired: '2026-01-12',
    left: '',
    salary: '1000',
    expenseAccount: '701',
    expenseSk: [group, ''],
    archived: false,
  });
  const lines = h.ledger.query({ type: 'payrollFill', companyId: s.companyId, month: '2026-04' });
  h.run({ type: 'payroll.save', companyId: s.companyId, month: '2026-04', lines } as never);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Əmək haqqı' }));
    await user.click(screen.getByRole('menuitem', { name: 'Muzdlu iş bəyannaməsi' }));
    const report = within(pane());
    await report.findByRole('rowheader', { name: 'Gəlir vergisi' });
    await user.clear(report.getByLabelText('İl'));
    await user.type(report.getByLabelText('İl'), '2026');
    await user.selectOptions(report.getByLabelText('Rüb'), 'Q2');
    await report.findAllByRole('columnheader', { name: '2026-04' });
    const tax = report.getByRole('rowheader', { name: 'Gəlir vergisi' }).closest('tr')!;
    assert.deepEqual(
      within(tax)
        .getAllByRole('cell')
        .map((c) => c.textContent),
      ['24,00', '0,00', '0,00', '24,00', '521.03'],
    );
    report.getByText(/2026-05: uçotda əmək haqqı sənədi yoxdur/);
    report.getByRole('cell', { name: '5AAA111' });
  } finally {
    h.close();
  }
});

test('stage 9c: tax depreciation by category; the year’s rates are changed in the parameters', async () => {
  const h = harness();
  const s = seed(h);
  const year = String(new Date().getFullYear());
  const catalog = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
  const depreciation = catalog.items.find((i) => i.role === 'depreciation')!.id;
  const kamaz = h.run({
    type: 'fixedAsset.save',
    companyId: s.companyId,
    name: 'Kamaz',
    group: 'transport',
    archived: false,
  } as never).id;
  h.run({
    type: 'asset.save',
    companyId: s.companyId,
    kind: 'opening',
    date: `${year}-01-01`,
    lines: [
      {
        assetId: kamaz,
        cost: '60000',
        accumulated: '10000',
        taxResidual: '40000',
        lifeMonths: 60,
        remainingMonths: 48,
        expenseAccount: '721',
        expenseSk: [depreciation],
        counterAccount: '343',
        counterSk: [],
      },
    ],
  } as never);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Əsas vəsaitlər' }));
    await user.click(screen.getByRole('menuitem', { name: 'Vergi amortizasiyası' }));
    const report = within(pane());
    const cells = async () =>
      within((await report.findByRole('rowheader', { name: 'Amortizasiya' })).closest('tr')!)
        .getAllByRole('cell')
        .map((c) => c.textContent!.replace(/\s/g, ' '));
    // Transport (the 4th category): 40 000 × 25%.
    assert.equal((await cells())[3], '10 000,00');
    await user.click(report.getByRole('button', { name: 'Parametrlər' }));
    const dialog = within(await screen.findByRole('dialog'));
    const rate = dialog.getByLabelText('Norma: Nəqliyyat vasitələri');
    await user.clear(rate);
    await user.type(rate, '20');
    await user.click(dialog.getByRole('button', { name: 'Saxla' }));
    await waitFor(async () => assert.equal((await cells())[3], '8 000,00'));
    assert.equal(screen.queryByRole('dialog'), null);
  } finally {
    h.close();
  }
});

test('stage 9d: an expense item is marked not deductible; the profit tax return leaves it out', async () => {
  const h = harness();
  const s = seed(h);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const catalog = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
  const service = catalog.items.find((i) => i.kind === 'incomeType' && i.name === 'Xidmət satışı')!;
  const fine = h.run({
    type: 'item.save',
    companyId: s.companyId,
    kind: 'expenseItem',
    name: 'Cərimələr',
    archived: false,
  } as never).id;
  h.run({
    type: 'operation.save',
    companyId: s.companyId,
    number: '',
    date: `${month}-01`,
    memo: 'Xidmət və cərimə',
    lines: [
      {
        dtAccount: '211.01',
        dtSk: [s.customer, s.contract, ''],
        ktAccount: '601',
        ktSk: [service.id, '0'],
        amount: '1000',
        memo: '',
      },
      {
        dtAccount: '731',
        dtSk: [fine],
        ktAccount: '211.01',
        ktSk: [s.customer, s.contract, ''],
        amount: '100',
        memo: '',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Hesabatlar' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mənfəət vergisi bəyannaməsi' }));
    const report = within(pane());
    const tax = async () =>
      within((await report.findByRole('rowheader', { name: 'Mənfəət vergisi' })).closest('tr')!)
        .getAllByRole('cell')[0]!
        .textContent!.replace(/\s/g, ' ');
    // (1 000 − 100) × 20%.
    assert.equal(await tax(), '180,00');
    h.run({
      type: 'item.save',
      companyId: s.companyId,
      id: fine,
      version: 1,
      kind: 'expenseItem',
      name: 'Cərimələr',
      archived: false,
      taxDeductible: false,
    } as never);
    await user.click(report.getByRole('button', { name: /Yenilə/ }));
    // The fine is not deducted: 1 000 × 20%.
    await waitFor(async () => assert.equal(await tax(), '200,00'));
    report.getByRole('rowheader', { name: 'çıxılır: Cərimələr' });
  } finally {
    h.close();
  }
});

test('2026-10-29: trial balance — 211 opens with its partners, detail level, period steps, print and PDF', async () => {
  const h = harness();
  const s = seed(h);
  const date = new Date();
  const y = date.getFullYear();
  const ym = `${y}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  h.run({
    type: 'operation.save',
    companyId: s.companyId,
    number: '',
    date: `${ym}-01`,
    memo: 'Başlanğıc',
    lines: [
      {
        dtAccount: '223.01',
        dtSk: [s.bankAccount],
        ktAccount: '301',
        ktSk: [s.founder, s.capitalIn],
        amount: '30000',
        memo: '',
      },
      {
        dtAccount: '211.01',
        dtSk: [s.customer, s.contract, ''],
        ktAccount: '223.01',
        ktSk: [s.bankAccount],
        amount: '500',
        memo: '',
      },
    ],
  });
  const printed = window.print;
  let prints = 0;
  window.print = () => void prints++;
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getAllByRole('button', { name: 'Dövriyyə balansı' })[0]!);
    const page = within(pane());
    const rowOf = (re: RegExp) =>
      [...pane().querySelectorAll('tbody tr')].find((r) => re.test(r.textContent ?? ''));
    // One click on 211: 211.01 comes open with the partner, as in 1C.
    await user.click(
      await page.findByRole('button', {
        name: 'Aç: Alıcıların və sifarişçilərin qısamüddətli debitor borcları',
      }),
    );
    await page.findByRole('button', {
      name: 'Bağla: Alıcılar və sifarişçilərlə hesablaşmalar (manatla)',
    });
    await waitFor(() => assert.match(rowOf(/Alıcı MMC/)?.textContent ?? '', /500,00/));
    // Closing 211.01 hides the partner.
    await user.click(
      page.getByRole('button', {
        name: 'Bağla: Alıcılar və sifarişçilərlə hesablaşmalar (manatla)',
      }),
    );
    await waitFor(() => assert.ok(!rowOf(/Alıcı MMC/)));

    // Detail level: everything, then back to accounts only.
    const detail = page.getByRole('group', { name: 'Detallaşdırma' });
    await user.click(within(detail).getByRole('button', { name: 'Hamısı' }));
    await waitFor(() => assert.ok(rowOf(/Kapital Bank/), 'bank account row'));
    assert.ok(rowOf(/Alıcı MMC/));
    await user.click(within(detail).getByRole('button', { name: 'Hesablar' }));
    await waitFor(() => assert.ok(!rowOf(/Alıcı MMC/) && !rowOf(/Kapital Bank/)));
    await user.click(within(detail).getByRole('button', { name: 'Kontragentlər' }));
    await waitFor(() => assert.ok(rowOf(/Alıcı MMC/)));
    assert.ok(!rowOf(/Kapital Bank/), 'a bank account is no partner');

    // Period steps: the year, the year before (empty), back, the month.
    const steps = page.getByRole('group', { name: 'Dövr seçimi' });
    await user.click(within(steps).getByRole('button', { name: 'İl' }));
    await page.findByText(`Dövr: 01.01.${y} – 31.12.${y}`);
    assert.equal(
      within(steps).getByRole('button', { name: 'İl' }).getAttribute('aria-pressed'),
      'true',
    );
    await user.click(within(steps).getByRole('button', { name: 'Əvvəlki dövr' }));
    await page.findByText(`Dövr: 01.01.${y - 1} – 31.12.${y - 1}`);
    await page.findByText(/qalıq və dövriyyə yoxdur/);
    await user.click(within(steps).getByRole('button', { name: 'Növbəti dövr' }));
    await page.findByText(`Dövr: 01.01.${y} – 31.12.${y}`);
    await user.click(within(steps).getByRole('button', { name: 'Ay' }));
    await page.findByText(new RegExp(`^Dövr: 01\\.${ym.slice(5)}\\.${y} – `));

    // Print: the report sheet in the print area, the dialog asked once.
    await user.click(page.getByRole('button', { name: 'Çap et' }));
    await waitFor(() => assert.equal(prints, 1));
    const sheet = document.querySelector('.print-sheet')!.textContent ?? '';
    assert.match(sheet, /Hesablar üzrə dövriyyə-saldo cədvəli/);
    assert.match(sheet, /Alıcı MMC/);
    assert.match(sheet, /Cəmi/);
    assert.match(sheet, /30\s000,00/);
    act(() => void window.dispatchEvent(new Event('afterprint')));

    // PDF: the same sheet saved as a file.
    await user.click(page.getByRole('button', { name: 'PDF' }));
    await page.findByText(/Saxlanıldı: C:\\Hesabatlar\\DBC .*\.pdf/);
    assert.equal(h.pdfs.length, 1);
    assert.match(h.pdfs[0]!.name, /^DBC .*\.pdf$/);
    assert.match(h.pdfs[0]!.sheet, /Hesablar üzrə dövriyyə-saldo cədvəli/);
    assert.ok(!document.querySelector('.print-sheet'), 'the sheet goes after saving');
  } finally {
    window.print = printed;
    h.close();
  }
});

test('stage 10a: the balance sheet opens from the menu, lines with their source; another year is chosen', async () => {
  const h = harness();
  const s = seed(h);
  const year = new Date().getFullYear();
  h.run({
    type: 'operation.save',
    companyId: s.companyId,
    number: '',
    date: `${year}-01-10`,
    memo: 'Nizamnamə kapitalı',
    lines: [
      {
        dtAccount: '223.01',
        dtSk: [s.bankAccount],
        ktAccount: '301',
        ktSk: [s.founder, s.capitalIn],
        amount: '5000',
        memo: '',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Hesabatlar' }));
    await user.click(screen.getByRole('menuitem', { name: 'Maliyyə vəziyyəti haqqında hesabat' }));
    const report = within(pane());
    const cells = async (name: string) =>
      within((await report.findByRole('rowheader', { name })).closest('tr')!)
        .getAllByRole('cell')
        .map((c) => c.textContent!.replace(/\s/g, ' '));
    assert.deepEqual(await cells('22 · Pul vəsaitləri və onların ekvivalentləri'), [
      '5 000,00',
      '0,00',
      '223',
    ]);
    assert.deepEqual((await cells('CƏMİ KAPİTAL VƏ ÖHDƏLİKLƏR')).slice(0, 2), ['5 000,00', '0,00']);
    report.getByText(new RegExp(`${year - 1}-c. il üçün uçot yoxdur`));
    // The next year: this year's end is its opening column.
    const field = report.getByLabelText('İl');
    await user.clear(field);
    await user.type(field, String(year + 1));
    await waitFor(async () =>
      assert.deepEqual((await cells('30 · Ödənilmiş nominal (nizamnamə) kapital')).slice(0, 2), [
        '5 000,00',
        '5 000,00',
      ]),
    );
    await user.click(report.getByRole('button', { name: /Excel/ }));
    await report.findByText(
      new RegExp(`Saxlanıldı: .*Maliyyə vəziyyəti haqqında hesabat ${year + 1}\.xlsx`),
    );
    // A line of one account opens its card.
    await user.dblClick(
      await report.findByRole('rowheader', { name: '30 · Ödənilmiş nominal (nizamnamə) kapital' }),
    );
    await waitFor(() =>
      assert.equal(
        document.querySelector('.mdi-window.active .mdi-caption')?.textContent,
        'Hesab kartı 301',
      ),
    );
  } finally {
    h.close();
  }
});

test('stage 10b: the IFRS income statement and the changes in equity open from the menu', async () => {
  const h = harness();
  const s = seed(h);
  const year = new Date().getFullYear();
  const catalog = h.ledger.query({ type: 'catalog', companyId: s.companyId }) as Catalog;
  const service = catalog.items.find((i) => i.kind === 'incomeType' && i.name === 'Xidmət satışı')!;
  const line = (
    dtAccount: string,
    dtSk: string[],
    ktAccount: string,
    ktSk: string[],
    amount: string,
  ) => ({
    dtAccount,
    dtSk,
    ktAccount,
    ktSk,
    amount,
    memo: '',
  });
  h.run({
    type: 'operation.save',
    companyId: s.companyId,
    number: '',
    date: `${year}-01-10`,
    memo: '',
    lines: [
      line('223.01', [s.bankAccount], '301', [s.founder, s.capitalIn], '5000'),
      line('211.01', [s.customer, s.contract, ''], '601', [service.id, '0'], '1200'),
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Hesabatlar' }));
    await user.click(screen.getByRole('menuitem', { name: 'Mənfəət və ya zərər (MHBS)' }));
    const report = within(pane());
    const cells = async (name: string) =>
      within((await report.findByRole('rowheader', { name })).closest('tr')!)
        .getAllByRole('cell')
        .map((c) => c.textContent!.replace(/\s/g, ' '));
    assert.deepEqual(await cells('60 · Əsas əməliyyat gəlirləri'), ['1 200,00', '0,00', '601']);
    assert.deepEqual((await cells('341 · Hesabat dövründə xalis mənfəət (zərər)')).slice(0, 2), [
      '1 200,00',
      '0,00',
    ]);
    report.getByText(/ilin dekabrı bağlanmayıb: mənfəət vergisi/);
    await user.click(screen.getByRole('button', { name: 'Hesabatlar' }));
    await user.click(screen.getByRole('menuitem', { name: 'Kapitalda dəyişikliklər' }));
    const equity = within(pane());
    const closing = await waitFor(() => {
      const rows = equity.getAllByRole('rowheader', { name: 'İlin sonuna qalıq' });
      assert.equal(rows.length, 2);
      return rows[1]!;
    });
    assert.deepEqual(
      within(closing.closest('tr')!)
        .getAllByRole('cell')
        .map((c) => c.textContent!.replace(/\s/g, ' ')),
      ['5 000,00', '0,00', '0,00', '0,00', '1 200,00', '6 200,00', `balans 31.12.${year}`],
    );
  } finally {
    h.close();
  }
});

test('stage 10c: the cash flow by the direct method opens from the menu, by activity', async () => {
  const h = harness();
  const s = seed(h);
  const year = new Date().getFullYear();
  h.run({
    type: 'bank.save',
    companyId: s.companyId,
    direction: 'in',
    number: '',
    date: `${year}-01-10`,
    bankAccountId: s.bankAccount,
    rate: '',
    bankReference: '',
    counterpartyName: '',
    counterpartyTaxId: '',
    purpose: '',
    lines: [
      { account: '301', sk: [s.founder, s.capitalIn], amount: '5000', cashFlowItem: '', memo: '' },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Hesabatlar' }));
    await user.click(
      screen.getByRole('menuitem', { name: 'Pul vəsaitlərinin hərəkəti (birbaşa)' }),
    );
    const report = within(pane());
    const cells = async (name: string) =>
      within((await report.findByRole('rowheader', { name })).closest('tr')!)
        .getAllByRole('cell')
        .map((c) => c.textContent!.replace(/\s/g, ' '));
    assert.deepEqual(
      await cells('Səhmlərin və digər kapital alətlərinin buraxılmasından daxilolmalar'),
      ['5 000,00', '0,00', '301'],
    );
    assert.deepEqual((await cells('Balansın 22-ci maddəsi (yoxlama)')).slice(0, 2), [
      '5 000,00',
      '0,00',
    ]);
    report.getByRole('table', {
      name: 'Maliyyələşdirmə üzrə fəaliyyətdən pul vəsaitlərinin hərəkəti',
    });
  } finally {
    h.close();
  }
});

test('ƏDV əvəzləşdirilməsi: an invoice added by hand, its amount changed, posted 241 → 521.01', async () => {
  const h = harness();
  const s = seed(h);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const supplier = h.run({
    type: 'partner.save',
    companyId: s.companyId,
    name: 'Yanacaq MMC',
    taxId: '1700000077',
    kind: 'legal',
    note: '',
    archived: false,
  }).id;
  const contract = h.run({
    type: 'contract.save',
    companyId: s.companyId,
    partnerId: supplier,
    number: 'Y-1',
    date: '2026-01-01',
    kind: 'purchase',
    currency: 'AZN',
    note: '',
    archived: false,
  }).id;
  const fuel = h.run({
    type: 'product.save',
    companyId: s.companyId,
    code: '',
    name: 'Dizel',
    unit: 'litr',
    kind: 'material',
    groupId: '',
    archived: false,
  }).id;
  h.run({
    type: 'invoice.save',
    companyId: s.companyId,
    direction: 'purchase',
    number: '',
    date: `${month}-01`,
    partnerId: supplier,
    contractId: contract,
    rate: '',
    pricesIncludeVat: false,
    eqSeries: '',
    eqNumber: '',
    memo: '',
    lines: [{ productId: fuel, quantity: '1000', price: '1', vatRate: '18', memo: '' }],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Mühasibat' }));
    await user.click(screen.getByRole('menuitem', { name: 'ƏDV əvəzləşdirilməsi' }));
    const page = within(pane());
    await page.findByText(/hələ uçotda deyil/);
    // No e-qaimə confirmed: "Doldur" gives nothing; the accountant adds the invoice by hand.
    await page.findByText('Sətir yoxdur');
    await user.click(page.getByRole('combobox', { name: 'Qaimə əlavə et' }));
    await user.keyboard('Yanacaq');
    await user.keyboard('{Enter}');
    const amount = (await page.findByRole('textbox', {
      name: 'Sətir 1: əvəzləşdirilir',
    })) as HTMLInputElement;
    assert.equal(amount.value, '180,00');
    await user.clear(amount);
    await user.type(amount, '150');
    await user.click(page.getByRole('button', { name: 'Uçota al' }));
    await page.findByText(new RegExp(`ƏƏ-${month} uçota alındı`));
    const tb = h.ledger.query({
      type: 'trialBalance',
      companyId: s.companyId,
      from: `${month}-01`,
      to: monthEnd(month),
      expand: [],
    }) as TrialBalance;
    assert.equal(tb.rows.find((r) => r.account === '241')!.closeDt, '30.00');
    // Saved: the button waits for a change; deleting the line and saving takes it back.
    assert.equal(page.queryByRole('button', { name: 'Yadda saxla' }), null);
    await user.click(page.getByRole('button', { name: 'Sətir 1: sil' }));
    await user.click(page.getByRole('button', { name: 'Yadda saxla' }));
    await page.findByText(/uçota alındı \(versiya 2\)/);
    const after = h.ledger.query({
      type: 'trialBalance',
      companyId: s.companyId,
      from: `${month}-01`,
      to: monthEnd(month),
      expand: [],
    }) as TrialBalance;
    assert.equal(after.rows.find((r) => r.account === '241')!.closeDt, '180.00');
  } finally {
    h.close();
  }
});
