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
