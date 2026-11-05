/**
 * Audit 3 (developer / security, core) — 2026-11-05. Made-up names and numbers.
 * Each test states the expected behaviour; a failing test is a confirmed defect.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainError } from '../../src/domain/errors.js';
import { fixture } from './fixture.js';

test('audit: a full disk reaches the caller as the disk error, not as a failed ROLLBACK', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'meyar-a3-'));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* the fixture's connection closes after this hook */
    }
  });
  const f = fixture(t, join(dir, 'full.sqlite'));
  const partner = f.partner('Alıcı MMC', '1700000111');
  const contract = f.contract(partner, 'K-1', 'sale');
  const service = f.product('Daşıma', 'reys', 'service');
  f.db.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const pages = (f.db.raw.prepare('PRAGMA page_count').get() as { page_count: number }).page_count;
  // SQLite answers SQLITE_FULL here as on a full disk, and rolls the transaction back by itself.
  f.db.raw.exec(`PRAGMA max_page_count=${pages}`);
  let failure: Error | undefined;
  for (let i = 0; i < 200 && !failure; i++) {
    try {
      f.invoice(
        'sale',
        '2026-10-02',
        partner,
        contract,
        Array.from({ length: 50 }, () => ({
          productId: service,
          price: '10',
          vatRate: '0' as const,
          memo: 'x'.repeat(290),
        })),
      );
    } catch (e) {
      failure = e as Error;
    }
  }
  assert.ok(failure, 'the page limit was not reached');
  assert.equal(f.db.raw.isTransaction, false);
  assert.match(
    failure.message,
    /full/i,
    `the cause was replaced by: "${failure.message}" (db.ts transaction(): ROLLBACK throws)`,
  );
});

test('audit: a currency amount too large for the ledger is a domain error, not a crash in bind', (t) => {
  const f = fixture(t);
  const bank = f.partner('Nümunə Bank ASC', '9900000001');
  const usd = f.bankAccount(bank, 'AZ11TEST00000000000000000099', '223.02', 'USD', 'USD');
  const customer = f.partner('Alıcı MMC', '1700000101');
  const contract = f.contract(customer, 'S-1', 'sale', 'USD');
  assert.throws(
    () =>
      f.bank(
        'in',
        '2026-10-02',
        usd,
        [f.bankLine('211.02', [customer, contract], '999999999999.99')],
        { rate: '999999999' },
      ),
    DomainError,
  );
});

test('audit: a bug in the revaluation preview is not shown to the user as a message', (t) => {
  const f = fixture(t);
  f.db.raw.exec('ALTER TABLE registers RENAME TO registers_gone');
  // vat-offset.ts and closing.ts rethrow what is not a DomainError; revaluation.ts:478 does not.
  assert.throws(() => f.query({ type: 'revaluation', companyId: f.companyId, month: '2026-10' }));
});
