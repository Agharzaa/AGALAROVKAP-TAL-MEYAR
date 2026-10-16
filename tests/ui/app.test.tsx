import './setup';
import React from 'react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/renderer/App';
import type {
  BankDocumentDetail,
  BankDocumentSummary,
  Catalog,
  InvoiceSummary,
  StatementView,
  TrialBalance,
} from '../../src/contracts/queries';
import { harness } from './harness';

afterEach(() => cleanup());
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
