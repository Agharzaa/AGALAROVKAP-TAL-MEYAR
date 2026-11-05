// UX audit 3 (2026-11-05): each test states what an accountant should get and fails where the
// UI does not give it yet. Run: node --import tsx --test tests/ui/audit3-ux.test.tsx
import './setup';
import React from 'react';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/renderer/App';
import { api } from '../../src/renderer/api';
import { sections } from '../../src/renderer/pages';
import { harness } from './harness';

type H = ReturnType<typeof harness>;
type User = ReturnType<typeof userEvent.setup>;
const realQuery = api.query;
const realSaveFile = api.saveFile;
afterEach(() => {
  api.query = realQuery;
  api.saveFile = realSaveFile;
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* no storage */
  }
});

const source = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', p), 'utf8');
const pane = () =>
  (document.querySelector('.mdi-window.active:not([hidden])') ??
    document.querySelector('.desktop')) as HTMLElement;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));
const thisMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

function seed(h: H) {
  const companyId = h.run({
    type: 'company.create',
    name: 'Meyar MMC',
    taxId: '1234567890',
    vatPayer: true,
  }).id;
  const partner = h.run({
    type: 'partner.save',
    companyId,
    name: 'Yanacaq MMC',
    taxId: '1700000077',
    kind: 'legal',
    note: '',
    archived: false,
  }).id;
  const contract = h.run({
    type: 'contract.save',
    companyId,
    partnerId: partner,
    number: 'Y-1',
    date: '2026-01-01',
    kind: 'purchase',
    currency: 'AZN',
    note: '',
    archived: false,
  }).id;
  const fuel = h.run({
    type: 'product.save',
    companyId,
    code: '',
    name: 'Dizel',
    unit: 'litr',
    kind: 'material',
    groupId: '',
    archived: false,
  }).id;
  return { companyId, partner, contract, fuel };
}
function purchase(h: H, s: ReturnType<typeof seed>, day = '01') {
  return h.run({
    type: 'invoice.save',
    companyId: s.companyId,
    direction: 'purchase',
    number: '',
    date: `${thisMonth()}-${day}`,
    partnerId: s.partner,
    contractId: s.contract,
    rate: '',
    pricesIncludeVat: false,
    eqSeries: '',
    eqNumber: '',
    memo: '',
    lines: [{ productId: s.fuel, quantity: '1000', price: '1', vatRate: '18', memo: '' }],
  });
}
function employee(h: H, companyId: string) {
  const catalog = h.ledger.query({ type: 'catalog', companyId }) as {
    items: { id: string; role?: string }[];
  };
  const group = catalog.items.find((i) => i.role === 'defaultProductGroup')!.id;
  return h.run({
    type: 'employee.save',
    companyId,
    name: 'Sürücü Məmmədov',
    position: 'Sürücü',
    fin: '',
    tabNo: '001',
    hired: '2025-01-12',
    left: '',
    salary: '1000',
    expenseAccount: '701',
    expenseSk: [group, ''],
    archived: false,
  }).id;
}

async function start() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('navigation', { name: 'Əsas menyu' });
  return user;
}
/** Opens a main-menu item by its label (the section found from the menu's own data). */
async function openItem(user: User, label: string, sectionLabel?: string) {
  const sec = sections.find(
    (s) =>
      (!sectionLabel || s.label === sectionLabel) &&
      s.groups.some((g) => g.items.some((i) => i.label === label)),
  )!;
  const nav = screen.getByRole('navigation', { name: 'Əsas menyu' });
  await user.click(within(nav).getByRole('button', { name: sec.label }));
  const menu = screen.getByRole('menu', { name: sec.label });
  await user.click(within(menu).getAllByRole('menuitem', { name: label })[0]!);
  await settle();
}
async function openCardBySearch(user: User, code: string) {
  await user.click(screen.getByRole('textbox', { name: 'Axtarış və əmrlər' }));
  await user.keyboard(`${code}{Enter}`);
  await settle();
}
/** The query of this type answers with an error, as main does when the database fails. */
function failQuery(type: string, message = 'Baza oxunmadı') {
  const original = api.query;
  api.query = (async (q: { type: string }) => {
    if (q.type === type) throw new Error(message);
    return original(q as never);
  }) as typeof api.query;
}
const dialogUp = () => screen.findByRole('button', { name: 'Saxlamadan bağla' });

// ---- 2. Keyboard ----------------------------------------------------------------------------

test('audit: Enter on a ⊞ in the trial balance opens that row, not the card of the selected row', async () => {
  const h = harness();
  const s = seed(h);
  purchase(h, s);
  try {
    const user = await start();
    await openItem(user, 'Dövriyyə balansı');
    const report = within(pane());
    const marks = await report.findAllByRole('button', { name: /^Aç: / });
    const mark = marks[marks.length - 1]!;
    const name = mark.getAttribute('aria-label')!;
    mark.focus();
    await user.keyboard('{Enter}');
    await settle();
    assert.equal(
      document.querySelectorAll('.mdi-window').length,
      1,
      'Enter on ⊞ opened an account card (of the row selected before) instead of the row',
    );
    await report.findByRole('button', { name: name.replace('Aç', 'Bağla') });
  } finally {
    h.close();
  }
});

test('audit: ↓ in the trial balance keeps the selected row in view', async () => {
  const h = harness();
  const s = seed(h);
  purchase(h, s);
  const calls: Element[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    calls.push(this);
  };
  try {
    const user = await start();
    await openItem(user, 'Dövriyyə balansı');
    const report = within(pane());
    await report.findAllByRole('button', { name: /^Aç: / });
    (pane().querySelector('.grid.trial')!.closest('.table-scroll') as HTMLElement).focus();
    await user.keyboard('{ArrowDown}');
    await settle();
    assert.ok(
      calls.some((el) => el.classList.contains('selected')),
      'the selected row is never scrolled into view; a long balance loses the cursor below the fold',
    );
  } finally {
    Element.prototype.scrollIntoView = original;
    h.close();
  }
});

test('audit: ⊞ / ⊟ of the account card say aria-expanded, as in the trial balance', async () => {
  const h = harness();
  const s = seed(h);
  purchase(h, s);
  try {
    const user = await start();
    await openCardBySearch(user, '531');
    const mark = await within(pane()).findByRole('button', { name: /^Aç: Yanacaq/ });
    assert.equal(mark.getAttribute('aria-expanded'), 'false');
  } finally {
    h.close();
  }
});

test('audit: list rows are walked by ↓ / ↑, as the trial balance rows are', async () => {
  const h = harness();
  const s = seed(h);
  purchase(h, s, '01');
  purchase(h, s, '02');
  try {
    const user = await start();
    await openItem(user, 'Alış qaimələri');
    const rows = (await within(pane()).findAllByRole('row')).filter(
      (r) => r.getAttribute('tabindex') === '0',
    );
    assert.equal(rows.length, 2);
    rows[0]!.focus();
    await user.keyboard('{ArrowDown}');
    assert.ok(document.activeElement === rows[1], 'ArrowDown does not move to the next row');
  } finally {
    h.close();
  }
});

test('audit: a window opened from the menu by keyboard takes the focus', async () => {
  const h = harness();
  seed(h);
  try {
    const user = await start();
    within(screen.getByRole('navigation', { name: 'Əsas menyu' }))
      .getByRole('button', { name: 'Satış' })
      .focus();
    await user.keyboard('{Enter}{ArrowDown}');
    let guard = 0;
    while (!document.activeElement?.textContent?.includes('Satış qaimələri') && guard++ < 20)
      await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    await settle();
    assert.ok(
      pane().classList.contains('mdi-window') && pane().contains(document.activeElement),
      `focus is on <${document.activeElement?.tagName}>, not in the new window: Tab starts over at the title bar`,
    );
  } finally {
    h.close();
  }
});

test('audit: Ctrl+Tab moves the focus into the window it brings forward', async () => {
  const h = harness();
  seed(h);
  try {
    const user = await start();
    await openItem(user, 'Alış qaimələri');
    await openItem(user, 'Satış qaimələri');
    await user.keyboard('{Control>}{Tab}{/Control}');
    await settle();
    assert.ok(
      pane().contains(document.activeElement),
      `focus stays on <${document.activeElement?.tagName}>, outside the active window`,
    );
  } finally {
    h.close();
  }
});

test('audit: the keyboard cannot reach controls of a window covered by a maximized one', async () => {
  const h = harness();
  seed(h);
  try {
    const user = await start();
    await openItem(user, 'Alış qaimələri');
    await openItem(user, 'Satış qaimələri');
    const covered = [...document.querySelectorAll<HTMLElement>('.mdi-window:not(.active)')][0]!;
    assert.ok(covered.classList.contains('maximized'));
    const control = covered.querySelector<HTMLElement>('.mdi-body input, .mdi-body button')!;
    // Either unreachable (inert), or reaching it brings that window forward.
    if (!control.closest('[inert]')) {
      await act(async () => control.focus());
      await settle();
      assert.ok(
        covered.classList.contains('active'),
        'Tab lands on invisible controls of a covered window, and that window stays behind',
      );
    }
    assert.ok(user);
  } finally {
    h.close();
  }
});

test('audit: while a dialog is open Ctrl+S does not save the document behind it', async () => {
  const h = harness();
  seed(h);
  try {
    const user = await start();
    await user.keyboard('{Control>}n{/Control}');
    const editor = within(pane());
    await user.type(await editor.findByRole('textbox', { name: 'Sətir 1 məzmun' }), 'x');
    await user.keyboard('{Control>}{F4}{/Control}');
    await dialogUp();
    const before = h.commands.length;
    await user.keyboard('{Control>}s{/Control}');
    await settle();
    assert.equal(h.commands.length, before, 'Ctrl+S reached the editor behind the modal dialog');
  } finally {
    h.close();
  }
});

test('audit: the page-size menu gives the focus back to its button', async () => {
  const h = harness();
  seed(h);
  try {
    const user = await start();
    await openItem(user, 'Alış qaimələri');
    const button = await within(pane()).findByRole('button', { name: 'Səhifədə 50 sətir' });
    await user.click(button);
    await user.keyboard('{Escape}');
    assert.ok(document.activeElement === button, 'Esc drops the focus to the page');
  } finally {
    h.close();
  }
});

test('audit: the search box does not promise documents ("sənəd"): it does not search them', async () => {
  const h = harness();
  seed(h);
  try {
    await start();
    const box = screen.getByRole('textbox', { name: 'Axtarış və əmrlər' });
    assert.doesNotMatch(box.getAttribute('placeholder') ?? '', /sənəd/);
  } finally {
    h.close();
  }
});

// ---- 2. Editors: the same keys and the same prompt everywhere ---------------------------------

for (const [what, item, section] of [
  ['Məzuniyyət', 'Məzuniyyət', 'Əmək haqqı'],
  ['Xəstəlik vərəqəsi', 'Xəstəlik vərəqəsi', 'Əmək haqqı'],
] as const) {
  test(`audit: "${what}" with unsaved changes asks before its window is closed`, async () => {
    const h = harness();
    seed(h);
    try {
      const user = await start();
      await openItem(user, item, section);
      const date = (await within(pane()).findAllByPlaceholderText('gg.aa.iiii'))[0]!;
      await user.clear(date);
      await user.type(date, '05112026');
      await user.click(within(pane()).getByRole('button', { name: 'Bağla' }));
      await dialogUp();
    } finally {
      h.close();
    }
  });
}

test('audit: the absence form saves by Ctrl+S, as every other document form', async () => {
  const h = harness();
  seed(h);
  try {
    const user = await start();
    await openItem(user, 'Məzuniyyət', 'Əmək haqqı');
    await within(pane()).findAllByPlaceholderText('gg.aa.iiii');
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => assert.ok(h.commands.some((c) => c.type === 'absence.save')), {
      timeout: 300,
    });
  } finally {
    h.close();
  }
});

test('audit: a timesheet with unsaved hours asks before its window is closed', async () => {
  const h = harness();
  const s = seed(h);
  employee(h, s.companyId);
  try {
    const user = await start();
    await openItem(user, 'Tabel (yeni)');
    const cell = await waitFor(() => {
      const c = pane().querySelector<HTMLInputElement>('input[data-cell="0-0"]');
      assert.ok(c);
      return c;
    });
    await user.clear(cell);
    await user.type(cell, '7');
    await user.click(within(pane()).getByRole('button', { name: 'Bağla' }));
    await dialogUp();
  } finally {
    h.close();
  }
});

test('audit: the timesheet saves by Ctrl+S, as every other document form', async () => {
  const h = harness();
  const s = seed(h);
  employee(h, s.companyId);
  try {
    const user = await start();
    await openItem(user, 'Tabel (yeni)');
    await waitFor(() => assert.ok(pane().querySelector('input[data-cell="0-0"]')));
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => assert.ok(h.commands.some((c) => c.type === 'timesheet.save')), {
      timeout: 300,
    });
  } finally {
    h.close();
  }
});

test('audit: the work calendar with unsaved days asks before its window is closed', async () => {
  const h = harness();
  seed(h);
  try {
    const user = await start();
    await openItem(user, 'İstehsalat təqvimi');
    await user.click(await within(pane()).findByRole('button', { name: 'Gün əlavə et' }));
    await user.click(within(pane()).getByRole('button', { name: 'Bağla' }));
    await dialogUp();
  } finally {
    h.close();
  }
});

test('audit: a date typed wrong is not replaced silently by the old date when saved', async () => {
  const h = harness();
  seed(h);
  try {
    const user = await start();
    await user.keyboard('{Control>}n{/Control}');
    const date = (await within(pane()).findAllByPlaceholderText('gg.aa.iiii'))[0]!;
    await user.tripleClick(date);
    await user.keyboard('32132026');
    assert.equal(date.getAttribute('aria-invalid'), 'true');
    await user.keyboard('{Control>}s{/Control}');
    await settle();
    const sent = h.commands.filter((c) => c.type === 'operation.save') as unknown as {
      date: string;
    }[];
    assert.ok(
      sent.every((c) => c.date === ''),
      `the field shows 32.13.2026, the command carries ${sent.map((c) => c.date).join()}`,
    );
  } finally {
    h.close();
  }
});

// ---- 3. Low screen ----------------------------------------------------------------------------

test('audit: a dialog taller than a 768 px screen scrolls, its buttons stay reachable', () => {
  const css = source('styles.css');
  const rule = (selector: string) =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => m[1]!.split(',').some((s) => s.trim() === selector))
      .map((m) => m[2]!)
      .join('');
  const scrolls = (selector: string) => /overflow(-y)?:\s*(auto|scroll)/.test(rule(selector));
  // The browser caps a modal <dialog> at the viewport; `overflow: hidden` on it then cuts it off.
  assert.ok(
    scrolls('.modal') || (scrolls('.modal-body') && scrolls('.modal > .dialog-form')),
    '.modal is overflow: hidden and nothing inside it scrolls: "Saxla" is cut off on a low screen',
  );
});

test('audit: the second header row of the trial balance sticks right under the first', () => {
  const css = source('styles.css');
  // .trial.onec th is 24 px high, the shared rule puts row 2 at var(--row-head) (30–32 px):
  // figures scroll visibly through the gap between the two sticky rows.
  assert.match(css, /\.trial\.onec thead tr:nth-child\(2\) th\s*\{[^}]*top:\s*2\dpx/);
});

// ---- 1. Design ---------------------------------------------------------------------------------

test('audit: no italics (DIZAYN §3): the <i> texts of the mapping list are upright', () => {
  // No rule in styles.css resets <i> here (only .status.cancelled i and the like are upright).
  assert.doesNotMatch(
    source('pages/eq-maps.tsx'),
    /<i>[^<]+<[/]i>/,
    '<i>istənilən</i> and <i>bütün qaimə</i> render in the browser default italic',
  );
});

test('audit: closings in the list carry the status shape (DIZAYN §6: ● uçotda, ✕ ləğv)', () => {
  assert.doesNotMatch(
    source('pages/closing.tsx'),
    /c\.status === 'posted' \? 'uçotda' : 'ləğv edilib'/,
    'plain text in lower case; every other list uses <Status>',
  );
});

test('audit: row counts use the same thousands separator as money() (1 234, not 1.234)', () => {
  for (const file of ['ui.tsx', 'frame.tsx', 'App.tsx', 'pages/home.tsx'])
    assert.doesNotMatch(
      source(file),
      /toLocaleString\('az-AZ'\)/,
      `${file}: toLocaleString('az-AZ') gives "1.234" beside "1 234,50"`,
    );
});

// ---- 4. Empty and error states -----------------------------------------------------------------

test('audit: a failed Excel save in the trial balance is an error, not a green success', async () => {
  const h = harness();
  seed(h);
  try {
    const user = await start();
    await openItem(user, 'Dövriyyə balansı');
    api.saveFile = async () => {
      throw new Error('Fayl başqa proqramda açıqdır');
    };
    const report = within(pane());
    await waitFor(() =>
      assert.equal(
        (report.getByRole('button', { name: 'Excel' }) as HTMLButtonElement).disabled,
        false,
      ),
    );
    await user.click(report.getByRole('button', { name: 'Excel' }));
    const alert = await report.findByText('Fayl başqa proqramda açıqdır');
    assert.equal(alert.closest('.notice')?.getAttribute('role'), 'alert');
  } finally {
    h.close();
  }
});

test('audit: a failed Excel save in the account card is an error, not a green success', async () => {
  const h = harness();
  const s = seed(h);
  purchase(h, s);
  try {
    const user = await start();
    await openCardBySearch(user, '531');
    api.saveFile = async () => {
      throw new Error('Fayl başqa proqramda açıqdır');
    };
    const report = within(pane());
    await report.findByRole('button', { name: /^Aç: Yanacaq/ });
    await user.click(report.getByRole('button', { name: 'Excel' }));
    const alert = await report.findByText('Fayl başqa proqramda açıqdır');
    assert.equal(alert.closest('.notice')?.getAttribute('role'), 'alert');
  } finally {
    h.close();
  }
});

for (const file of [
  'pages/reports.tsx',
  'pages/payroll.tsx',
  'pages/settings.tsx',
  'pages/timesheet.tsx',
])
  test(`audit: ${file} does not show caught errors in its success notice`, () => {
    assert.doesNotMatch(
      source(file),
      /setMessage\(\(?e(\.message| as Error\)\.message)/,
      'a caught error goes to setMessage, rendered as <Notice kind="success">',
    );
  });

test('audit: a failed read of the e-qaimə mappings is not shown as "no mappings yet"', async () => {
  const h = harness();
  seed(h);
  failQuery('eqMaps');
  try {
    const user = await start();
    await openItem(user, 'E-qaimə uyğunluqları');
    await within(pane()).findByText('Baza oxunmadı', {}, { timeout: 500 });
  } finally {
    h.close();
  }
});

test('audit: a failed read of the statement list is not shown as "no statement yet"', async () => {
  const h = harness();
  seed(h);
  failQuery('statementImports');
  try {
    const user = await start();
    await openItem(user, 'Bank çıxarışları');
    await within(pane()).findByText('Baza oxunmadı', {}, { timeout: 500 });
  } finally {
    h.close();
  }
});

test('audit: month closing whose first query fails says so, not a blank form', async () => {
  const h = harness();
  seed(h);
  failQuery('closingNext');
  try {
    const user = await start();
    await openItem(user, 'Ay bağlanışı');
    await within(pane()).findByText('Baza oxunmadı', {}, { timeout: 500 });
  } finally {
    h.close();
  }
});

test('audit: a catalog that fails to load is an error, not "Yüklənir…" forever', async () => {
  const h = harness();
  seed(h);
  failQuery('catalog');
  try {
    const user = await start();
    await user.keyboard('{Control>}n{/Control}');
    await within(pane()).findByText('Baza oxunmadı', {}, { timeout: 500 });
  } finally {
    h.close();
  }
});

test('audit: a failed integrity check is not "Hazır" in the status bar', async () => {
  const h = harness();
  seed(h);
  failQuery('integrity');
  try {
    await start();
    await settle();
    const bar = document.querySelector('.statusbar')!;
    assert.doesNotMatch(bar.textContent ?? '', /^Hazır/);
  } finally {
    h.close();
  }
});

test('audit: an account card without movements says so, as the trial balance does', async () => {
  const h = harness();
  seed(h);
  try {
    const user = await start();
    await openCardBySearch(user, '531');
    await within(pane()).findByText(/yoxdur/, {}, { timeout: 500 });
  } finally {
    h.close();
  }
});

test('audit: in the card tree a document that cannot be opened is not a dead link', async () => {
  const h = harness();
  const s = seed(h);
  const invoice = purchase(h, s);
  h.run({
    type: 'vatOffset.save',
    companyId: s.companyId,
    month: thisMonth(),
    lines: [{ invoiceId: invoice.id, amount: '180.00' }],
  });
  try {
    const user = await start();
    await openCardBySearch(user, '241');
    const card = within(pane());
    for (let i = 0; i < 6; i++) {
      const closed = card.queryAllByRole('button', { name: /^Aç: / });
      if (!closed.length) break;
      await user.click(closed[0]!);
    }
    const before = document.querySelectorAll('.mdi-window').length;
    const links = [...pane().querySelectorAll<HTMLButtonElement>('tr.move button.link')].filter(
      (b) => /ƏƏ-/.test(b.textContent ?? ''),
    );
    assert.ok(links.length > 0, 'no offset document in the tree');
    await user.click(links[0]!);
    await settle();
    assert.ok(
      document.querySelectorAll('.mdi-window').length > before,
      `"${links[0]!.textContent}" looks like a link and does nothing on click`,
    );
  } finally {
    h.close();
  }
});

// ---- 5. Language and dates ----------------------------------------------------------------------

test('audit: "Ay hələ bitməyib" names the month as "Noyabr 2026", not ISO', async () => {
  const h = harness();
  seed(h);
  try {
    const user = await start();
    await openItem(user, 'Ay bağlanışı');
    const text = await within(pane()).findByText(/Ay hələ bitməyib/);
    assert.doesNotMatch(text.textContent ?? '', /\d{4}-\d{2}/);
  } finally {
    h.close();
  }
});

test('audit: the VAT return names its month as "Noyabr 2026", not ISO', async () => {
  const h = harness();
  seed(h);
  try {
    const user = await start();
    await openItem(user, 'ƏDV bəyannaməsi');
    const text = await within(pane()).findByText(/ƏDV bəyannaməsi üçün rəqəmlər ·/);
    assert.doesNotMatch(text.textContent ?? '', /\d{4}-\d{2}/);
  } finally {
    h.close();
  }
});

test('audit: the payroll return checks name months as "Noyabr 2026", not ISO', async () => {
  const h = harness();
  seed(h);
  try {
    const user = await start();
    await openItem(user, 'Muzdlu iş bəyannaməsi');
    const texts = await within(pane()).findAllByText(/uçotda əmək haqqı sənədi yoxdur/);
    for (const t of texts) assert.doesNotMatch(t.textContent ?? '', /\d{4}-\d{2}/);
  } finally {
    h.close();
  }
});

test('audit: the change history shows document dates as dd.mm.yyyy', async () => {
  const h = harness();
  const s = seed(h);
  purchase(h, s);
  try {
    const user = await start();
    await openItem(user, 'Dəyişiklik tarixçəsi');
    const detail = await within(pane()).findByText(/AQ-000001 ·/);
    assert.doesNotMatch(detail.textContent ?? '', /\d{4}-\d{2}-\d{2}/);
  } finally {
    h.close();
  }
});

test('audit: the menu has no "coming in stage N" item for a stage long finished', () => {
  const stale = sections.flatMap((sec) =>
    sec.groups.flatMap((g) =>
      g.items.filter((i) => i.action.kind === 'soon').map((i) => `${sec.label} / ${i.label}`),
    ),
  );
  assert.deepEqual(
    stale,
    [],
    'click answers "… 5-ci mərhələdə bu təmələ köçürüləcək": developer talk about finished stages',
  );
});

// ---- 6. Consistency ------------------------------------------------------------------------------

test('audit: Ctrl+Enter in ƏDV əvəzləşdirilməsi posts and closes, as the status bar says', async () => {
  const h = harness();
  const s = seed(h);
  purchase(h, s);
  try {
    const user = await start();
    await openItem(user, 'ƏDV əvəzləşdirilməsi');
    const page = within(pane());
    await page.findByText('Sətir yoxdur');
    await user.click(page.getByRole('combobox', { name: 'Qaimə əlavə et' }));
    await user.keyboard('Yanacaq{Enter}');
    await user.click(await page.findByRole('textbox', { name: 'Sətir 1: əvəzləşdirilir' }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => assert.ok(h.commands.some((c) => c.type === 'vatOffset.save')));
    await settle();
    assert.equal(document.querySelectorAll('.mdi-window').length, 0, 'the window stays open');
  } finally {
    h.close();
  }
});
