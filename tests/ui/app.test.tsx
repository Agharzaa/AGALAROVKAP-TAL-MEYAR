import './setup';
import React from 'react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { cleanup, render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/renderer/App';
import type {
  Catalog,
  InvoiceDetail,
  InvoiceSummary,
  PaymentDetail,
} from '../../src/contracts/queries';
import { harness } from './harness';

afterEach(() => cleanup());
const all = { from: '2000-01-01', to: '2099-12-31' };
const pane = () => document.querySelector('.pane:not([hidden])') as HTMLElement;

test('first run: a company is created, then the desk opens with the module rail', async () => {
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
    await screen.findByRole('navigation', { name: 'Bölmələr' });
    assert.equal(
      (screen.getByRole('combobox', { name: 'Aktiv şirkət' }) as HTMLSelectElement)
        .selectedOptions[0]!.text,
      'Birinci MMC',
    );
    assert.ok(screen.getByRole('tab', { name: 'İş masası' }));
  } finally {
    h.close();
  }
});

test('purchase invoice: quick partner, 18% helper, live preview, posting, edit by reversal and the close guard', async () => {
  const h = harness();
  const companyId = h.run({ type: 'company.create', name: 'Meyar MMC', taxId: '1234567890' }).id;
  try {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Alış qaimələri' }));
    await user.click(await within(pane()).findByRole('button', { name: 'Yeni qaimə' }));
    const editor = () => within(pane());
    await user.type(await editor().findByRole('textbox', { name: 'Qaimə nömrəsi' }), 'MT-0001');
    // A supplier is created without leaving the document.
    await user.click(editor().getByRole('button', { name: 'Yeni kontragent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yeni kontragent' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Adı' }), 'Rabitə ASC');
    await user.type(within(dialog).getByRole('textbox', { name: /^VÖEN/ }), '1700000004');
    await user.click(within(dialog).getByRole('button', { name: 'Saxla' }));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    await waitFor(() =>
      assert.match(
        (editor().getByRole('combobox', { name: 'Təchizatçı' }) as HTMLSelectElement)
          .selectedOptions[0]!.text,
        /Rabitə ASC/,
      ),
    );
    assert.equal(
      editor().getByRole('textbox', { name: 'Qaimə nömrəsi' }).getAttribute('value') ??
        (editor().getByRole('textbox', { name: 'Qaimə nömrəsi' }) as HTMLInputElement).value,
      'MT-0001',
    );
    await user.type(editor().getByRole('textbox', { name: 'Sətir 1: təsvir' }), 'İnternet');
    const catalog = h.ledger.query({ type: 'catalog', companyId }) as Catalog;
    await user.selectOptions(
      editor().getByRole('combobox', { name: 'Sətir 1: xərc maddəsi' }),
      catalog.expenseItems.find((e) => e.name === 'Rabitə')!.id,
    );
    await user.type(editor().getByRole('textbox', { name: 'Sətir 1: məbləğ' }), '250');
    await user.click(editor().getByRole('button', { name: 'Sətir 1: ƏDV 18%' }));
    assert.equal(
      (editor().getByRole('textbox', { name: 'Sətir 1: ƏDV' }) as HTMLInputElement).value,
      '45,00',
    );
    const preview = editor().getByRole('region', { name: 'Müxabirləşmələr' });
    assert.ok(within(preview).getByText('Hələ uçota alınmayıb'));
    assert.deepEqual(
      within(preview)
        .getAllByRole('row')
        .slice(1, 4)
        .map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent?.trim())),
      [
        ['721 İnzibati xərclər', 'İnternet', '250,00', ''],
        ['241 Alış üzrə ƏDV', 'ƏDV · MT-0001', '45,00', ''],
        ['531 Malsatan və podratçılarla hesablaşmalar', 'Qaimə MT-0001', '', '295,00'],
      ],
    );
    assert.equal(h.dirty(), true, 'host knows about unsaved changes');
    await user.click(editor().getByRole('button', { name: 'Uçota al' }));
    await editor().findByText('Qaimə uçota alındı.');
    await screen.findByRole('tab', { name: /Alış qaiməsi MT-0001/ });
    const [invoice] = h.ledger.query({
      type: 'invoices',
      companyId,
      direction: 'purchase',
      ...all,
    }) as InvoiceSummary[];
    assert.equal(invoice!.total, '295.00');
    assert.equal(h.dirty(), false);

    // Edit: the old entry is reversed once and a new version posts.
    const amount = editor().getByRole('textbox', { name: 'Sətir 1: məbləğ' });
    await user.clear(amount);
    await user.type(amount, '300');
    await user.click(editor().getByRole('button', { name: 'Sətir 1: ƏDV 18%' }));
    await screen.findByText('●');
    await user.click(editor().getByRole('button', { name: 'Düzəlişi uçota al' }));
    await editor().findByText('Qaimə uçota alındı.');
    const detail = h.ledger.query({ type: 'invoice', companyId, id: invoice!.id }) as InvoiceDetail;
    assert.equal(detail.version, 2);
    assert.equal(detail.postings.filter((p) => p.reversal).length, 3);
    await waitFor(() => assert.ok(editor().getByRole('checkbox', { name: /Bütün versiyalar/ })));
    await user.click(editor().getByRole('checkbox', { name: /Bütün versiyalar/ }));
    assert.equal(
      editor().getByRole('region', { name: 'Müxabirləşmələr' }).querySelectorAll('tr.reversal')
        .length,
      3,
    );

    // Unsaved changes ask before the window closes.
    await user.type(editor().getByRole('textbox', { name: 'Qeyd' }), 'yoxlama');
    await user.click(editor().getByRole('button', { name: 'Pəncərəni bağla' }));
    const guard = await screen.findByRole('dialog', { name: 'Saxlanmamış dəyişikliklər' });
    await user.click(within(guard).getByRole('button', { name: 'Geri' }));
    assert.ok(screen.getByRole('tab', { name: /Alış qaiməsi MT-0001/ }));
    await user.click(editor().getByRole('button', { name: 'Pəncərəni bağla' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Saxlanmamış dəyişikliklər' })).getByRole(
        'button',
        { name: 'Saxlamadan bağla' },
      ),
    );
    await waitFor(() =>
      assert.equal(screen.queryByRole('tab', { name: /Alış qaiməsi MT-0001/ }), null),
    );
    assert.equal(
      (h.ledger.query({ type: 'invoice', companyId, id: invoice!.id }) as InvoiceDetail).note,
      '',
    );
  } finally {
    h.close();
  }
});

test('server rule errors are shown on the document and the form is kept', async () => {
  const h = harness();
  const companyId = h.run({ type: 'company.create', name: 'Meyar MMC', taxId: '1234567890' }).id;
  h.run({ type: 'partner.save', companyId, name: 'Rabitə ASC', taxId: '1700000004' });
  try {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Alış qaimələri' }));
    await user.click(await within(pane()).findByRole('button', { name: 'Yeni qaimə' }));
    const editor = within(pane());
    await user.type(await editor.findByRole('textbox', { name: 'Qaimə nömrəsi' }), 'MT-9');
    const partner = editor.getByRole('combobox', { name: 'Təchizatçı' }) as HTMLSelectElement;
    await user.selectOptions(partner, partner.options[1]!.value);
    await user.type(editor.getByRole('textbox', { name: 'Sətir 1: məbləğ' }), '10');
    // No expense item chosen: 721 requires one.
    await user.click(editor.getByRole('button', { name: 'Uçota al' }));
    assert.match((await editor.findByRole('alert')).textContent ?? '', /xərc maddəsi seçin/);
    assert.equal(
      (editor.getByRole('textbox', { name: 'Qaimə nömrəsi' }) as HTMLInputElement).value,
      'MT-9',
    );
    assert.equal(
      (h.ledger.query({ type: 'invoices', companyId, direction: 'purchase', ...all }) as unknown[])
        .length,
      0,
    );
  } finally {
    h.close();
  }
});

test('bank: oldest-first split, double submit posts once, the advance is linked later', async () => {
  const h = harness({ hold: (c) => c.type === 'payment.save' });
  const companyId = h.run({ type: 'company.create', name: 'Meyar MMC', taxId: '1234567890' }).id;
  const customer = h.run({
    type: 'partner.save',
    companyId,
    name: 'Alıcı MMC',
    taxId: '1700000001',
  }).id;
  const sale = (number: string, date: string) =>
    h.run({
      type: 'invoice.save',
      companyId,
      mode: 'post',
      direction: 'sale',
      number,
      date,
      partnerId: customer,
      note: '',
      lines: [{ kind: 'service', description: 'Xidmət', account: '601', net: '100', vat: '18' }],
    }).id;
  const older = sale('S-1', '2026-01-10');
  const newer = sale('S-2', '2026-02-10');
  try {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Daxilolmalar' }));
    await user.click(await within(pane()).findByRole('button', { name: 'Yeni daxilolma' }));
    const editor = within(pane());
    await user.type(await editor.findByRole('textbox', { name: 'Bank sənədinin nömrəsi' }), 'PP-1');
    const date = editor.getByRole('textbox', { name: 'Tarix' }) as HTMLInputElement;
    await user.clear(date);
    await user.type(date, '20012026');
    assert.equal(date.value, '20.01.2026');
    await user.type(editor.getByRole('textbox', { name: 'Məbləğ · AZN' }), '300');
    await user.selectOptions(editor.getByRole('combobox', { name: 'Ödəyici' }), customer);
    assert.equal(
      (editor.getByRole('textbox', { name: 'Bağlanan məbləğ · S-2' }) as HTMLInputElement).disabled,
      true,
      'invoice after the payment date',
    );
    await user.click(editor.getByRole('button', { name: /Köhnədən bölüşdür/ }));
    assert.equal(
      (editor.getByRole('textbox', { name: 'Bağlanan məbləğ · S-1' }) as HTMLInputElement).value,
      '118,00',
    );
    assert.match(
      editor.getByRole('region', { name: 'Qaimələr üzrə bölgü' }).textContent ?? '',
      /Avans qalır: 182,00/,
    );
    const submit = editor.getByRole('button', { name: 'Uçota al' });
    await user.click(submit);
    await user.click(submit);
    h.release();
    await editor.findByText('Ödəniş uçota alındı.');
    assert.equal(h.commands.filter((c) => c.type === 'payment.save').length, 1);
    const [paymentId] = (
      h.ledger.query({ type: 'payments', companyId, direction: 'in', ...all }) as { id: string }[]
    ).map((p) => p.id);
    let payment = h.ledger.query({ type: 'payment', companyId, id: paymentId! }) as PaymentDetail;
    assert.equal(payment.unallocated, '182.00');
    // Link the advance to the newer invoice; the date defaults to the later document date.
    const later = await editor.findByRole('region', { name: /Avansı bağla/ });
    await user.type(within(later).getByRole('textbox', { name: 'Bağlanan məbləğ · S-2' }), '118');
    assert.equal(
      (editor.getByRole('textbox', { name: /^Bağlama tarixi/ }) as HTMLInputElement).value,
      '10.02.2026',
    );
    await user.click(editor.getByRole('button', { name: /Qaimələrə bağla/ }));
    await editor.findByText('Avans qaimələrə bağlandı.');
    payment = h.ledger.query({ type: 'payment', companyId, id: paymentId! }) as PaymentDetail;
    assert.equal(payment.unallocated, '64.00');
    const invoices = h.ledger.query({
      type: 'invoices',
      companyId,
      direction: 'sale',
      ...all,
    }) as InvoiceSummary[];
    assert.deepEqual(
      invoices.map((i) => [i.id === older || i.id === newer, i.remaining]),
      [
        [true, '0.00'],
        [true, '0.00'],
      ],
    );
    assert.equal(payment.postings.length, 2, 'linking never adds journal lines');
  } finally {
    h.close();
  }
});

test('a document window keeps its company when the active company changes', async () => {
  const h = harness();
  const first = h.run({ type: 'company.create', name: 'Birinci MMC', taxId: '1234567890' }).id;
  const second = h.run({ type: 'company.create', name: 'İkinci MMC', taxId: '1234567891' }).id;
  const partner = h.run({
    type: 'partner.save',
    companyId: first,
    name: 'Alıcı',
    taxId: '1700000001',
  }).id;
  try {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Aktiv şirkət' }), first);
    await user.click(screen.getByRole('button', { name: 'Satış qaimələri' }));
    await user.click(await within(pane()).findByRole('button', { name: 'Yeni qaimə' }));
    const editor = within(pane());
    await user.type(await editor.findByRole('textbox', { name: 'Qaimə nömrəsi' }), 'S-77');
    await user.selectOptions(editor.getByRole('combobox', { name: 'Alıcı' }), partner);
    await user.type(editor.getByRole('textbox', { name: 'Sətir 1: məbləğ' }), '50');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Aktiv şirkət' }), second);
    await screen.findByRole('tab', { name: /Yeni satış qaiməsi.*Birinci MMC/ });
    assert.ok(within(pane()).getByText('Birinci MMC', { selector: '.company-flag' }));
    await user.click(within(pane()).getByRole('button', { name: 'Uçota al' }));
    await within(pane()).findByText('Qaimə uçota alındı.');
    assert.equal(
      (
        h.ledger.query({
          type: 'invoices',
          companyId: first,
          direction: 'sale',
          ...all,
        }) as unknown[]
      ).length,
      1,
    );
    assert.equal(
      (
        h.ledger.query({
          type: 'invoices',
          companyId: second,
          direction: 'sale',
          ...all,
        }) as unknown[]
      ).length,
      0,
    );
  } finally {
    h.close();
  }
});

test('Ctrl+K finds an invoice by number and opens it; windows keep their filters', async () => {
  const h = harness();
  const companyId = h.run({ type: 'company.create', name: 'Meyar MMC', taxId: '1234567890' }).id;
  const partner = h.run({ type: 'partner.save', companyId, name: 'Alıcı', taxId: '1700000001' }).id;
  h.run({
    type: 'invoice.save',
    companyId,
    mode: 'post',
    direction: 'sale',
    number: 'FIND-42',
    date: '2026-03-01',
    partnerId: partner,
    note: '',
    lines: [{ kind: 'service', description: 'x', account: '601', net: '10', vat: '0' }],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Satış qaimələri' }));
    const search = within(pane()).getByRole('textbox', { name: 'Axtar' });
    await user.type(search, 'nothing');
    await user.click(screen.getByRole('button', { name: 'Jurnal' }));
    await user.click(screen.getByRole('tab', { name: 'Satış qaimələri' }));
    assert.equal(
      (within(pane()).getByRole('textbox', { name: 'Axtar' }) as HTMLInputElement).value,
      'nothing',
      'filters survive switching windows',
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Tez keçid' });
    await user.type(within(dialog).getByRole('combobox'), 'find-42');
    await within(dialog).findByText('FIND-42');
    await user.keyboard('{Enter}');
    await screen.findByRole('tab', { name: /Satış qaiməsi FIND-42/ });
    assert.equal(
      (within(pane()).getByRole('textbox', { name: 'Qaimə nömrəsi' }) as HTMLInputElement).value,
      'FIND-42',
    );
  } finally {
    h.close();
  }
});

test('bank statement: a CSV is loaded once, recognised rows post automatically, the rest wait', async () => {
  const h = harness();
  const companyId = h.run({ type: 'company.create', name: 'Meyar MMC', taxId: '1234567890' }).id;
  h.run({ type: 'partner.save', companyId, name: 'Alıcı MMC', taxId: '1700000001' });
  const csv = [
    'Tarix;Sənəd №;Kontragent;VÖEN;Mədaxil;Məxaric;Ödənişin təyinatı',
    '05.01.2026;101;Alıcı MMC;1700000001;"1 500,00";;Müqavilə üzrə ödəniş',
    '06.01.2026;;Kapital Bank;9900003611;;1,50;Komissiya',
    '07.01.2026;102;Yeni MMC;1700000099;;"200,00";Hesab-faktura 5',
  ].join('\n');
  const file = () => new File([csv], 'yanvar.csv', { type: 'text/csv' });
  try {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Bank çıxarışı' }));
    const page = within(pane());
    const input = pane().querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, file());
    await page.findByText(/yanvar\.csv: 3 yeni sətir yükləndi/);
    await user.upload(input, file());
    await page.findByText(/0 yeni sətir yükləndi, 3 sətir əvvəl yüklənib/);
    const auto = await page.findByRole('button', { name: /Avtomatik keçir \(2\)/ });
    await user.click(auto);
    await page.findByText(/Avtomatik keçirmə: 2 sənəd uçota alındı/);
    // The new supplier waits: choose "+ Yeni" and post it by hand.
    const partner = await page.findByRole('combobox', { name: 'Kontragent' });
    await user.selectOptions(partner, '__new');
    await user.click(page.getByRole('button', { name: /^Uçota al 2026-01-07/ }));
    await page.findByText(/Sətir keçirildi: 1 sənəd/);
    const out = h.ledger.query({ type: 'payments', companyId, direction: 'out', ...all }) as {
      kind: string;
      counterAccount: string;
      partnerName: string;
    }[];
    assert.deepEqual(out.map((p) => [p.kind, p.counterAccount, p.partnerName]).sort(), [
      ['fee', '721', ''],
      ['settlement', '531', 'Yeni MMC'],
    ]);
  } finally {
    h.close();
  }
});

test('payment editor: a tax payment needs no partner and posts Dt 521', async () => {
  const h = harness();
  const companyId = h.run({ type: 'company.create', name: 'Meyar MMC', taxId: '1234567890' }).id;
  try {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Ödənişlər' }));
    await user.click(await within(pane()).findByRole('button', { name: 'Yeni ödəniş' }));
    const editor = within(pane());
    await user.selectOptions(
      await editor.findByRole('combobox', { name: 'Əməliyyat növü' }),
      'tax',
    );
    await user.type(editor.getByRole('textbox', { name: 'Bank sənədinin nömrəsi' }), 'V-1');
    await user.type(editor.getByRole('textbox', { name: 'Məbləğ · AZN' }), '340');
    assert.match(pane().textContent ?? '', /Dt 521 \/ Kt 223/);
    await user.click(editor.getByRole('button', { name: 'Uçota al' }));
    await editor.findByText('Ödəniş uçota alındı.');
    const [p] = h.ledger.query({ type: 'payments', companyId, direction: 'out', ...all }) as {
      id: string;
    }[];
    const detail = h.ledger.query({ type: 'payment', companyId, id: p!.id }) as PaymentDetail;
    assert.deepEqual(
      detail.postings.map((l) => [l.account, l.debit, l.credit]),
      [
        ['521', '340.00', '0.00'],
        ['223', '0.00', '340.00'],
      ],
    );
  } finally {
    h.close();
  }
});
