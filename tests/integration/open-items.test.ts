/**
 * Open items of the audits, settled with their recommendations (0.9.30, 04.11.2026). Each test
 * failed before its change.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeclarationView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

test('stage 9 audit Q4: VM 175 — sales outside VAT with purchase VAT are flagged like exempt ones', (t) => {
  const f = fixture(t);
  const buyer = f.partner('Alıcı MMC', '1700000001');
  const supplier = f.partner('Malsatan MMC', '1700000002');
  const sc = f.contract(buyer, 'S-1', 'sale');
  const pc = f.contract(supplier, 'A-1', 'purchase');
  const service = f.product('Xidmət', 'ay', 'service');
  const item = f.item('expenseItem', 'Rabitə');
  f.invoice('sale', '2026-09-08', buyer, sc, [
    { productId: service, price: '1000', vatRate: '18' },
  ]);
  f.invoice('sale', '2026-09-09', buyer, sc, [
    { productId: service, price: '250', vatRate: 'nontaxable' },
  ]);
  f.invoice('purchase', '2026-09-05', supplier, pc, [
    { productId: service, price: '100', expenseItemId: item },
  ]);
  const v = f.query<DeclarationView>({
    type: 'declaration',
    companyId: f.companyId,
    kind: 'vat',
    period: '2026-09',
  });
  // The taxable share: 1 000 / 1 250.
  assert.ok(
    v.checks.some(
      (c) => /VM 175/.test(c.text) && /cəlb edilməyən/.test(c.text) && /80,00%/.test(c.text),
    ),
    v.checks.map((c) => c.text).join('\n'),
  );
});

test('stage 10 audit Q1, Q3: dividends are 534 / 344 only; a manual exchange difference is the FX effect', (t) => {
  const f = fixture(t, ':memory:', '2027-01-15');
  const bankPartner = f.partner('Kapital Bank', '9900003611');
  const bank = f.bankAccount(bankPartner, 'AZ12AIIB38060019441234567890');
  const fxIncome = f.item('incomeType', 'Məzənnə fərqi');
  const B = f.bankLine;
  f.bank('in', '2026-03-01', bank, [B('611', [fxIncome], '5000')]);
  f.bank('out', '2026-04-01', bank, [B('343', [], '500')]);
  f.bank('out', '2026-05-01', bank, [B('534.01', [], '1000')]);
  const v = f.query<DeclarationView>({
    type: 'declaration',
    companyId: f.companyId,
    kind: 'cashFlowStatement',
    period: '2026',
  });
  const k = (key: string) => {
    for (const s of v.sections) {
      const r = s.rows.find((x) => x.key === key);
      if (r) return r.values[0];
    }
    throw new Error(
      `row ${key} not found: ${v.sections.flatMap((s) => s.rows.map((r) => r.key)).join(' ')}`,
    );
  };
  assert.deepEqual(
    [k('f:f:dividends'), k('f:o:otherOut'), k('f:fx')],
    ['-1000.00', '-500.00', '5000.00'],
  );
});
