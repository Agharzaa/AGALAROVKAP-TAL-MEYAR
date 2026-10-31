// UX audit 2 (2026-10-31): each test states what an accountant should get and fails where the
// UI does not give it yet. Run: node --import tsx --test tests/ui/audit2-ux.test.tsx
import './setup';
import React from 'react';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/renderer/App';
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
  const p = (name: string, taxId: string) =>
    h.run({
      type: 'partner.save',
      companyId,
      name,
      taxId,
      kind: 'legal',
      note: '',
      archived: false,
    }).id;
  const supplier = p('Yanacaq MMC', '1700000077');
  const contract = h.run({
    type: 'contract.save',
    companyId,
    partnerId: supplier,
    number: 'Y-1',
    date: '2026-01-01',
    kind: 'purchase',
    currency: 'AZN',
    note: '',
    archived: false,
  }).id;
  return { companyId, supplier, contract };
}

function purchase(h: ReturnType<typeof harness>, s: ReturnType<typeof seed>, month: string) {
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
    partnerId: s.supplier,
    contractId: s.contract,
    rate: '',
    pricesIncludeVat: false,
    eqSeries: '',
    eqNumber: '',
    memo: '',
    lines: [{ productId: fuel, quantity: '1000', price: '1', vatRate: '18', memo: '' }],
  });
}

const thisMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

async function openVatOffset(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('navigation', { name: 'Əsas menyu' });
  await user.click(screen.getByRole('button', { name: 'Mühasibat' }));
  await user.click(screen.getByRole('menuitem', { name: 'ƏDV əvəzləşdirilməsi' }));
  const page = within(pane());
  await page.findByText('Sətir yoxdur');
  await user.click(page.getByRole('combobox', { name: 'Qaimə əlavə et' }));
  await user.keyboard('Yanacaq{Enter}');
  await page.findByRole('textbox', { name: 'Sətir 1: əvəzləşdirilir' });
  return page;
}

test('audit2: ƏDV əvəzləşdirilməsi with unsaved lines asks before its window is closed', async () => {
  const h = harness();
  const s = seed(h);
  purchase(h, s, thisMonth());
  try {
    const user = userEvent.setup();
    render(<App />);
    await openVatOffset(user);
    // The window tab should carry the "Saxlanmayıb" dot like every other document form.
    await waitFor(() => assert.ok(screen.queryAllByLabelText('Saxlanmayıb').length > 0));
    await user.click(screen.getByRole('button', { name: /^Bağla: ƏDV əvəzləşdirilməsi/ }));
    await screen.findByRole('button', { name: 'Saxlamadan bağla' });
  } finally {
    h.close();
  }
});

test('audit2: ƏDV əvəzləşdirilməsi is posted by Ctrl+Enter, as every other document', async () => {
  const h = harness();
  const s = seed(h);
  purchase(h, s, thisMonth());
  try {
    const user = userEvent.setup();
    render(<App />);
    const page = await openVatOffset(user);
    await user.click(page.getByRole('textbox', { name: 'Sətir 1: əvəzləşdirilir' }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => assert.ok(h.commands.some((c) => c.type === 'vatOffset.save')), {
      timeout: 500,
    });
  } finally {
    h.close();
  }
});

test('audit2: "Qaiməni ləğv et" in the DVX box (storno of a posted invoice) asks first', async () => {
  const h = harness();
  const s = seed(h);
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
    taxId: '1700000077',
    dvxCode: '4802',
    productId: paper,
    mode: 'auto',
  });
  const iso = `${thisMonth()}-05`;
  let n = 0;
  const eq = (status: string) =>
    h.run({
      type: 'eqaime.import',
      directionConfirmed: true,
      companyId: s.companyId,
      direction: 'purchase',
      report: 'goods',
      source: 'file',
      fileName: `mallar-${++n}.xlsx`,
      fileHash: String(n).padStart(64, 'c'),
      documents: [
        {
          row: 2,
          number: 'MT1',
          date: iso,
          taxId: '1700000077',
          name: 'Yanacaq MMC',
          kind: 'Əsas',
          status,
          net: '50.00',
          vat: '9.00',
          lines: [
            {
              code: '4802',
              name: 'Kağız A4',
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
  eq('Təsdiqləndi');
  eq('Ləğv edildi');
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Alış' }));
    await user.click(screen.getByRole('menuitem', { name: 'Alınan e-qaimələr (DVX)' }));
    const box = within(pane());
    await user.click(await box.findByRole('tab', { name: /Ziddiyyət 1/ }));
    await user.click(await box.findByRole('button', { name: 'MT1: qaiməni ləğv et' }));
    // Destructive (red storno of a posted invoice): a confirmation, nothing sent yet.
    assert.equal(
      h.commands.some((c) => c.type === 'invoice.cancel'),
      false,
      'invoice.cancel was sent on a single click, without a confirmation',
    );
    await screen.findByRole('dialog');
  } finally {
    h.close();
  }
});

test('audit2: the main menu opens and is walked by the keyboard (Enter, ↓)', async () => {
  const h = harness();
  seed(h);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    screen.getByRole('button', { name: 'Mühasibat' }).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu', { name: 'Mühasibat' });
    await user.keyboard('{ArrowDown}');
    assert.equal(
      document.activeElement?.getAttribute('role'),
      'menuitem',
      'ArrowDown leaves the focus on the section button; menu items are reachable only by Tab',
    );
  } finally {
    h.close();
  }
});

test('audit2: a picker keeps the option chosen by ↓ in view and names it to a screen reader', async () => {
  const h = harness();
  seed(h);
  const calls: Element[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    calls.push(this);
  };
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.keyboard('{Control>}n{/Control}');
    const editor = within(pane());
    const box = await editor.findByRole('combobox', { name: 'Sətir 1 debet hesabı' });
    await user.click(box);
    // The list is 300 px high (about 10 rows); the 15th account is below its edge.
    for (let i = 0; i < 15; i++) await user.keyboard('{ArrowDown}');
    assert.ok(
      box.getAttribute('aria-activedescendant'),
      'no aria-activedescendant on the combobox',
    );
    assert.ok(calls.length > 0, 'the active option is never scrolled into view');
  } finally {
    Element.prototype.scrollIntoView = original;
    h.close();
  }
});

test('audit2: the quarter select speaks correct Azerbaijani ordinals (3-cü, 4-cü rüb)', async () => {
  const h = harness();
  seed(h);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Əmək haqqı' }));
    await user.click(screen.getByRole('menuitem', { name: 'Muzdlu iş bəyannaməsi' }));
    const report = within(pane());
    const quarter = (await report.findByLabelText('Rüb')) as HTMLSelectElement;
    assert.deepEqual(
      [...quarter.options].map((o) => o.textContent),
      ['1-ci rüb', '2-ci rüb', '3-cü rüb', '4-cü rüb'],
    );
  } finally {
    h.close();
  }
});

test('audit2: declaration columns name months as the month field does ("Aprel 2026"), not ISO', async () => {
  const h = harness();
  seed(h);
  try {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Əsas menyu' });
    await user.click(screen.getByRole('button', { name: 'Əmək haqqı' }));
    await user.click(screen.getByRole('menuitem', { name: 'Muzdlu iş bəyannaməsi' }));
    const report = within(pane());
    await report.findByLabelText('Rüb');
    const heads = (await report.findAllByRole('columnheader')).map((c) => c.textContent ?? '');
    assert.equal(
      heads.filter((t) => /^\d{4}-\d{2}$/.test(t)).length,
      0,
      `ISO month headers: ${heads.join(' | ')}`,
    );
  } finally {
    h.close();
  }
});
