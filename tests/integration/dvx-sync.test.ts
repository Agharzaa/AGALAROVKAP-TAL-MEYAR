/**
 * Stage 6c-1 — the record of every DVX update and the "not updated" warnings
 * (docs/MERHELE-6-DVX-AVTOMAT.md §10, QERARLAR 2026-10-25 §18). The fixture's clock says
 * 2026-10-07 12:00 UTC; "today" is chosen per test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readEqTable } from '../../src/domain/eqaime.js';
import type { ClosingView, EqInboxView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;

const rows = [
  ['Elektron qaimə-fakturalar — Gələnlər'],
  ['Qaimə/Akt növləri', 'Seriya', 'Nömrə', 'Tarix', 'VÖEN', 'Adı', 'Malın ƏDV-siz ümumi dəyəri'],
  ['Əsas', 'MT', '2609001', '05.09.2026', '1111111111', 'Kontragent', '100'],
];
function load(f: F) {
  const r = readEqTable(rows, 'qaimeler.xlsx');
  return f.exec({
    type: 'eqaime.import',
    companyId: f.companyId,
    direction: 'purchase',
    directionConfirmed: true,
    ...(r.directionHint ? { fileDirection: r.directionHint } : {}),
    report: r.report!,
    source: 'file',
    fileName: 'qaimeler.xlsx',
    fileHash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    documents: r.documents,
  });
}
const synced = (f: F, extra: object = {}) =>
  f.exec({
    type: 'eqaime.synced',
    companyId: f.companyId,
    direction: 'purchase',
    from: '2026-10-01',
    to: '2026-10-07',
    startedAt: '2026-10-07T11:59:00.000Z',
    result: 'ok',
    added: 12,
    updated: 3,
    conflicts: 0,
    rejected: 0,
    posted: 9,
    message: '',
    ...extra,
  });
const box = (f: F) =>
  f.query<EqInboxView>({ type: 'eqInbox', companyId: f.companyId, direction: 'purchase' });
const stale = (f: F) => f.home().warnings.filter((w) => w.kind === 'dvxStale');

test('6c-1: every DVX update is recorded and the box shows the last one', (t) => {
  const f = fixture(t);
  assert.equal(box(f).lastSync, null);
  synced(f);
  const last = box(f).lastSync!;
  assert.deepEqual(
    [last.result, last.from, last.to, last.added, last.updated, last.posted, last.finishedAt],
    ['ok', '2026-10-01', '2026-10-07', 12, 3, 9, '2026-10-07T12:00:00.000Z'],
  );
  assert.equal(box(f).refreshedAt, '2026-10-07T12:00:00.000Z');
  // A failed attempt is the last attempt, but not the last update.
  synced(f, { result: 'failed', added: 0, updated: 0, posted: 0, message: 'DVX cavab vermədi' });
  assert.equal(box(f).lastSync!.result, 'failed');
  assert.equal(box(f).lastSync!.message, 'DVX cavab vermədi');
  assert.equal(box(f).refreshedAt, '2026-10-07T12:00:00.000Z');
  // The other box has none of it.
  const sale = f.query<EqInboxView>({ type: 'eqInbox', companyId: f.companyId, direction: 'sale' });
  assert.equal(sale.lastSync, null);
  assert.equal(sale.refreshedAt, '');
  // Kept like the imports: never deleted.
  assert.throws(() => f.db.run('DELETE FROM dvx_syncs'), /silinmir/);
});

test('6c-1: a file import counts as an update; a failed attempt alone does not', (t) => {
  const f = fixture(t);
  synced(f, { result: 'failed', added: 0, updated: 0, posted: 0, message: 'x' });
  assert.equal(box(f).refreshedAt, '');
  load(f);
  assert.equal(box(f).refreshedAt, '2026-10-07T12:00:00.000Z');
});

test('6c-1: İş masası warns when DVX has not been updated for more than 7 days', (t) => {
  // No DVX work at all: no warning.
  assert.deepEqual(stale(fixture(t, ':memory:', '2026-12-31')), []);
  // Exactly 7 days: no warning yet.
  const week = fixture(t, ':memory:', '2026-10-14');
  load(week);
  assert.deepEqual(stale(week), []);
  // 8 days.
  const late = fixture(t, ':memory:', '2026-10-15');
  load(late);
  const w = stale(late);
  assert.equal(w.length, 1);
  assert.equal(w[0]!.eq, 'purchase');
  assert.match(w[0]!.text, /Alınan e-qaimələr: DVX 8 gündür yenilənməyib \(son: 07\.10\.2026\)/);
  // Only a failed attempt: still a box that works with DVX, never updated.
  const never = fixture(t, ':memory:', '2026-10-15');
  synced(never, { result: 'failed', added: 0, updated: 0, posted: 0, message: 'x' });
  assert.match(stale(never)[0]!.text, /DVX-dən heç yenilənməyib/);
});

test('6c-1: month closing warns when DVX was not updated after the month end', (t) => {
  const f = fixture(t);
  load(f);
  const closing = (month: string) =>
    f.query<ClosingView>({ type: 'closing', companyId: f.companyId, month });
  // Updated on 07.10: September is covered, October is not.
  assert.deepEqual(
    closing('2026-09').warnings.filter((w) => w.kind === 'dvxStale'),
    [],
  );
  const oct = closing('2026-10').warnings.filter((w) => w.kind === 'dvxStale');
  assert.equal(oct.length, 1);
  assert.match(oct[0]!.text, /ayın sonundan \(31\.10\.2026\) sonra DVX yenilənməyib/);
});
