/**
 * Audit of stage 6 (2026-10-25): "DVX not updated" counts days on the accountant's calendar
 * (Baku, UTC+4), as "today" and the month's end are. The clock keeps its moments in UTC: an update
 * made at 01:30 on 1 October in Baku is 21:30 on 30 September in UTC.
 */
process.env.TZ = 'Asia/Baku';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClosingView } from '../../src/contracts/queries.js';
import { fixture } from './fixture.js';

type F = ReturnType<typeof fixture>;
const AFTER_MIDNIGHT = '2026-09-30T21:30:00.000Z';

const synced = (f: F) =>
  f.exec({
    type: 'eqaime.synced',
    companyId: f.companyId,
    direction: 'purchase',
    from: '2026-09-01',
    to: '2026-10-01',
    startedAt: '2026-09-30T21:29:00.000Z',
    result: 'ok',
    added: 1,
    updated: 0,
    conflicts: 0,
    rejected: 0,
    posted: 0,
    message: '',
  });

test('audit: an update just after midnight in Baku covers the month that ended at that midnight', (t) => {
  const f = fixture(t, ':memory:', '2026-10-01', AFTER_MIDNIGHT);
  synced(f);
  const closing = f.query<ClosingView>({
    type: 'closing',
    companyId: f.companyId,
    month: '2026-09',
  });
  assert.deepEqual(
    closing.warnings.filter((w) => w.kind === 'dvxStale').map((w) => w.text),
    [],
  );
});

test('audit: İş masası counts the days of the update in Baku, not in UTC', (t) => {
  // Updated 01.10 at 01:30 in Baku; 08.10 is 7 days later: no warning yet.
  const week = fixture(t, ':memory:', '2026-10-08', AFTER_MIDNIGHT);
  synced(week);
  assert.deepEqual(
    week.home().warnings.filter((w) => w.kind === 'dvxStale'),
    [],
  );
  // 09.10: 8 days, and the date shown is the day in Baku.
  const late = fixture(t, ':memory:', '2026-10-09', AFTER_MIDNIGHT);
  synced(late);
  const w = late.home().warnings.filter((x) => x.kind === 'dvxStale');
  assert.equal(w.length, 1);
  assert.match(w[0]!.text, /DVX 8 gündür yenilənməyib \(son: 01\.10\.2026\)/);
});
