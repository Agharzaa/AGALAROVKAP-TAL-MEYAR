// System audit (0.9.34): defects found on a copy of a real database.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { HomeView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

const IBAN = 'AZ12AIIB38060019441234567890';

function loaded(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t);
  const bank = f.partner('Kapital Bank ASC', '9900003611');
  f.bankAccount(bank, IBAN, '223.01', 'AZN', 'Kapital');
  const base = { reference: '', counterparty: 'X', counterpartyTaxId: '', counterpartyIban: '' };
  f.exec({
    type: 'statement.import',
    companyId: f.companyId,
    iban: IBAN,
    fileName: 'cixaris.xlsx',
    fileHash: 'a'.repeat(64),
    lines: [
      { ...base, row: 1, date: '2026-09-15', direction: 'in', amount: '1000', purpose: 'a' },
      { ...base, row: 2, date: '2026-09-16', direction: 'out', amount: '250.50', purpose: 'b' },
      { ...base, row: 3, date: '2026-10-02', direction: 'out', amount: '10', purpose: 'c' },
    ],
  });
  return f;
}

test('audit: İş masası says how many bank statement lines are not booked', (t) => {
  const f = loaded(t);
  const home = f.query<HomeView>({ type: 'home', companyId: f.companyId });
  const w = home.warnings.filter((x) => x.kind === 'statementWaiting');
  assert.equal(w.length, 1);
  assert.match(w[0]!.text, /3 sətir/);
  assert.match(w[0]!.text, /1.000,00 AZN/);
  assert.match(w[0]!.text, /260,50 AZN/);
});

test('audit: the closing warns about the unbooked bank lines up to its month, not later ones', (t) => {
  const f = loaded(t);
  const plan = f.query<{ warnings: HomeView['warnings'] }>({
    type: 'closing',
    companyId: f.companyId,
    month: '2026-09',
  });
  const w = plan.warnings.filter((x) => x.kind === 'statementWaiting');
  assert.equal(w.length, 1);
  assert.match(w[0]!.text, /2 sətir/);
});
