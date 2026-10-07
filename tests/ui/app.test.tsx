import './setup';
import React from 'react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/renderer/App';
import type { Catalog, TrialBalance } from '../../src/contracts/queries';
import { harness } from './harness';

afterEach(() => cleanup());
const pane = () => document.querySelector('.pane:not([hidden])') as HTMLElement;

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
  return { companyId, bank, founder, customer, bankAccount, contract };
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
    await screen.findByRole('navigation', { name: 'Lent menyu' });
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
    await screen.findByRole('navigation', { name: 'Lent menyu' });
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
    await user.type(editor.getByRole('textbox', { name: 'Sətir 1 məbləğ' }), '30000');
    await user.click(editor.getByRole('button', { name: 'Sətir əlavə et' }));
    await pick('Sətir 2 debet hesabı', '211');
    await pick('Sətir 2 debet 211 · Kontragent', 'Alıcı');
    await pick('Sətir 2 debet 211 · Müqavilə', '7');
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
        ktSk: [s.founder],
        amount: '30000',
        memo: '',
      },
    ],
  });
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Lent menyu' });
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
    await screen.findByRole('navigation', { name: 'Lent menyu' });
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
    await screen.findByRole('navigation', { name: 'Lent menyu' });
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
