// Real Electron run: the shipped renderer, preload and IPC against a seeded in-memory ledger.
// Checks one OS window, layout at 1050/1440/1920 px, and a document saved through the UI.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdir, writeFile } = require('node:fs/promises');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'screenshots');
const results = { layouts: {}, flows: {} };
let window;
app.on('window-all-closed', () => {});
const deadline = setTimeout(() => fail(new Error('Electron smoke timed out')), 120000);

const evaluate = (js) => window.webContents.executeJavaScript(js);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(js, label = js) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await evaluate(js)) return;
    await sleep(50);
  }
  throw new Error(`Condition not met: ${label}`);
}
const frames = () =>
  evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
async function click(selectorJs, label) {
  assert.ok(
    await evaluate(
      `(() => { const el = ${selectorJs}; if (!el || el.disabled) return false; el.click(); return true; })()`,
    ),
    `Missing ${label}`,
  );
}
const byText = (scope, text, tag = 'button') =>
  `[...${scope}.querySelectorAll('${tag}')].find(b => b.getClientRects().length && b.textContent.trim() === ${JSON.stringify(text)})`;
const byLabel = (scope, label) => `${scope}.querySelector('[aria-label=${JSON.stringify(label)}]')`;
const activePane = "document.querySelector('.pane:not([hidden])')";
async function setValue(selectorJs, value) {
  assert.ok(
    await evaluate(`(() => { const el = ${selectorJs}; if (!el) return false;
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      return true; })()`),
    `Missing field for ${value}`,
  );
}
async function shot(name) {
  await frames();
  await writeFile(path.join(out, `${name}.png`), (await window.webContents.capturePage()).toPNG());
}
/** Layout invariants of a module window with filters and a table. */
async function measure(name, width, height) {
  window.setContentSize(width, height);
  await sleep(120);
  await frames();
  const m = await evaluate(`(() => {
    const pane = ${activePane};
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height, width: b.width }; };
    const body = pane.querySelector('.module-body');
    const filter = pane.querySelector('.filter-bar');
    const content = pane.querySelector('.module-content');
    const bottom = pane.querySelector('.table-bottom');
    const controls = [...filter.querySelectorAll('input,select,button,label')].filter(e => e.getClientRects().length).map(r);
    const texts = [...pane.querySelectorAll('th, td, .nav-item, .tab, .module-heading h1')].filter(e => e.getClientRects().length && getComputedStyle(e).overflow === 'visible' && e.scrollWidth > e.clientWidth + 1 && !e.querySelector('input,select')).map(e => e.textContent.trim().slice(0, 40));
    return { viewport: { w: innerWidth, h: innerHeight }, page: document.documentElement.scrollWidth, body: r(body), filter: r(filter), content: r(content), bottom: r(bottom), controls, texts, windows: 1 };
  })()`);
  assert.ok(m.page <= m.viewport.w, `${name}: page has no horizontal overflow`);
  const expected = Math.max(38, m.body.height * 0.07);
  assert.ok(
    Math.abs(m.filter.height - expected) <= 1.5,
    `${name}: filter is 7% (${m.filter.height} vs ${expected})`,
  );
  assert.ok(
    Math.abs(m.filter.height + m.content.height - m.body.height) <= 1.5,
    `${name}: work area takes the rest`,
  );
  assert.ok(m.bottom.bottom <= m.viewport.h + 0.5, `${name}: table bottom bar is visible`);
  for (const c of m.controls)
    assert.ok(
      c.top >= m.filter.top - 1 && c.bottom <= m.filter.bottom + 1,
      `${name}: filter control fits`,
    );
  assert.deepEqual(m.texts, [], `${name}: no clipped text`);
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'exactly one OS window');
  results.layouts[name] = { filter: m.filter.height, body: m.body.height, width };
  await shot(name);
}
function fail(error) {
  console.error(error);
  require('node:fs').writeFileSync(path.join(out, 'smoke-error.txt'), String(error.stack || error));
  app.exit(1);
}

app
  .whenReady()
  .then(async () => {
    await mkdir(out, { recursive: true });
    const load = (p) => import(pathToFileURL(path.join(root, 'dist/node/src', p)).href);
    const { Db } = await load('infrastructure/sqlite/db.js');
    const { Ledger } = await load('application/ledger.js');
    const { createMainWindow } = await load('main/window.js');
    const ledger = new Ledger(new Db(':memory:'));
    let n = 0;
    const run = (cmd) =>
      ledger.execute(
        { key: `seed-${String(++n).padStart(6, '0')}`, ...cmd },
        { actor: 'smoke', correlationId: 'smoke' },
      );
    const year = new Date().getFullYear();
    const companyId = run({
      type: 'company.create',
      name: 'Xəzər Ticarət MMC',
      taxId: '1500000001',
    }).id;
    const partners = [
      ['Bakı Logistika Mərkəzi Məhdud Məsuliyyətli Cəmiyyəti', '1700000001'],
      ['Gəncə Kağız Təchizatı MMC', '1700000002'],
      ['Şəki Mebel Evi', '1700000003'],
      ['Abşeron Rabitə Xidmətləri ASC', '1700000004'],
    ].map(([name, taxId]) => run({ type: 'partner.save', companyId, name, taxId }).id);
    const catalog = ledger.query({ type: 'catalog', companyId });
    const warehouseId = catalog.warehouses[0].id;
    const telecom = catalog.expenseItems.find((e) => e.name === 'Rabitə').id;
    const paper = run({
      type: 'product.save',
      companyId,
      code: 'A4-80',
      name: 'Kağız A4 80 q/m²',
      group: 'Dəftərxana',
      barcode: '',
      baseUnit: 'pcs',
      purchaseUnit: 'box',
      factor: '5',
      account: '205',
    }).id;
    for (let i = 1; i <= 64; i++) {
      // Chronological dates: stock may not be moved behind a later movement.
      const month = String(Math.ceil(i / 8)).padStart(2, '0');
      const dayOfMonth = String(((i - 1) % 8) * 3 + 1).padStart(2, '0');
      run({
        type: 'invoice.save',
        companyId,
        mode: 'post',
        direction: 'purchase',
        number: `MT-${String(i).padStart(5, '0')}`,
        date: `${year}-${month}-${dayOfMonth}`,
        partnerId: partners[(i % 3) + 1],
        note: '',
        lines:
          i % 2
            ? [
                {
                  kind: 'service',
                  description: 'Rabitə xidməti',
                  account: '721',
                  expenseItemId: telecom,
                  net: `${120 + i}.50`,
                  vat: `${((120 + i) * 0.18).toFixed(2)}`,
                },
              ]
            : [
                {
                  kind: 'stock',
                  description: '',
                  account: '205',
                  productId: paper,
                  warehouseId,
                  quantity: '4',
                  unit: 'purchase',
                  unitPrice: '42.5',
                  vat: '30.60',
                },
              ],
      });
    }
    const sale = run({
      type: 'invoice.save',
      companyId,
      mode: 'post',
      direction: 'sale',
      number: 'S-0001',
      date: `${year}-01-15`,
      partnerId: partners[0],
      note: '',
      lines: [
        { kind: 'service', description: 'Daşıma xidməti', account: '601', net: '1500', vat: '270' },
      ],
    }).id;
    run({
      type: 'payment.save',
      companyId,
      direction: 'in',
      bankAccount: '223',
      reference: 'PP-1001',
      date: `${year}-01-20`,
      partnerId: partners[0],
      amount: '2000',
      note: '',
      allocations: [{ invoiceId: sale, amount: '1770' }],
    });

    window = await createMainWindow({
      ledger,
      rendererFile: path.join(root, 'dist/web/index.html'),
      preloadFile: path.join(root, 'dist/node/src/preload/preload.cjs'),
      version: 'smoke',
      backup: async () => null,
    });
    await until(
      "!!document.querySelector('.shell') && !!document.querySelector('.figures strong .amount')",
      'home loaded',
    );
    window.setContentSize(1440, 900);
    await shot('home-1440');

    await click(byText("document.querySelector('.nav')", 'Alış qaimələri'), 'purchases nav');
    await until(
      `${activePane}?.querySelector('tbody tr') !== null && ${activePane}?.querySelectorAll('tbody tr').length > 10`,
      'purchase list',
    );
    await measure('purchases-1440', 1440, 900);
    await measure('purchases-1050', 1050, 700);
    await measure('purchases-1920', 1920, 1080);

    // Create a purchase through the UI and verify the ledger.
    window.setContentSize(1440, 900);
    await click(byText(activePane, 'Yeni qaimə'), 'new invoice');
    await until(`${activePane}?.querySelector('form.document') !== null`, 'invoice editor');
    await setValue(`${byLabel(activePane, 'Sətir 1: təsvir')}`, 'Ofis üçün internet');
    await setValue(
      `[...${activePane}.querySelectorAll('label')].find(l => l.textContent.startsWith('Qaimə nömrəsi')).querySelector('input')`,
      'UI-0001',
    );
    await setValue(
      `[...${activePane}.querySelectorAll('label')].find(l => l.textContent.startsWith('Təchizatçı')).querySelector('select')`,
      partners[3],
    );
    await setValue(byLabel(activePane, 'Sətir 1: xərc maddəsi'), telecom);
    await setValue(byLabel(activePane, 'Sətir 1: məbləğ'), '250');
    await click(byLabel(activePane, 'Sətir 1: ƏDV 18%'), 'vat helper');
    await until(`${byLabel(activePane, 'Sətir 1: ƏDV')}.value === '45,00'`, 'vat 18%');
    await until(`${activePane}.querySelector('.postings .badge.warn') !== null`, 'preview');
    await shot('invoice-editor-preview-1440');
    await click(`[...${activePane}.querySelectorAll('button[type=submit]')][0]`, 'post');
    await until(`${activePane}.querySelector('.postings .badge:not(.warn)') !== null`, 'posted');
    const posted = ledger
      .query({
        type: 'invoices',
        companyId,
        direction: 'purchase',
        from: `${year}-01-01`,
        to: `${year}-12-31`,
      })
      .find((i) => i.number === 'UI-0001');
    assert.ok(posted, 'invoice saved through IPC');
    const detail = ledger.query({ type: 'invoice', companyId, id: posted.id });
    assert.deepEqual(
      detail.postings.map((p) => [p.account, p.debit, p.credit]),
      [
        ['721', '250.00', '0.00'],
        ['241', '45.00', '0.00'],
        ['531', '0.00', '295.00'],
      ],
    );
    results.flows.invoiceThroughUi = true;
    await click(
      `[...${activePane}.querySelectorAll('.segmented button')].find(b => b.textContent === 'T-hesablar')`,
      't-accounts',
    );
    await shot('invoice-posted-taccounts-1440');

    await click(byText("document.querySelector('.nav')", 'Daxilolmalar'), 'bank in');
    await until(`${activePane}?.querySelectorAll('tbody tr').length >= 1`, 'payments list');
    await click(`${activePane}.querySelector('tbody .link')`, 'open payment');
    await until(`${activePane}?.querySelector('.links') !== null`, 'payment editor');
    await shot('payment-editor-1440');
    window.setContentSize(1050, 700);
    await shot('payment-editor-1050');

    await click(byText("document.querySelector('.nav')", 'Dövriyyə balansı'), 'trial');
    await until(`${activePane}?.querySelector('.balance-check.ok') !== null`, 'trial balanced');
    await measure('trial-1440', 1440, 900);

    // Ctrl+K quick open.
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['control'] });
    await until("document.querySelector('.quick-open[open]') !== null", 'quick open');
    await setValue("document.querySelector('.quick-search input')", 'S-0001');
    await until(
      "document.querySelectorAll('.quick-open li[role=option]').length >= 1",
      'quick results',
    );
    await shot('quick-open-1440');
    results.flows.oneWindow = BrowserWindow.getAllWindows().length === 1;
    await writeFile(path.join(out, 'smoke-results.json'), JSON.stringify(results, null, 2));
    console.log('Electron smoke passed', JSON.stringify(results.flows));
    clearTimeout(deadline);
    app.exit(0);
  })
  .catch(fail);
