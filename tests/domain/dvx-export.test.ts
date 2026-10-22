/**
 * Stage 6b (docs/MERHELE-6-DVX-AVTOMAT.md §2, §4): Meyar asks DVX for the cabinet's own Excel
 * export ("Exceli endir → Qaimələr üzrə"), as the portal's page does: POST the list filter to
 * …/invoice/find.<box>/excel, then GET the file by the id it answers. The request is read from the
 * portal's public code (new.e-taxes.gov.az/eportal, 22.10.2026).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadPath,
  exportRequest,
  fileIdOf,
  hasMore,
  isXlsx,
  listPath,
} from '../../src/main/dvx-api-policy.js';
import { openPeriod } from '../../src/domain/eqaime.js';

test('6b: Gələnlər are the inbox, Göndərilənlər the outbox; the whole period, every status', () => {
  const inbox = exportRequest('purchase', '2026-10-01', '2026-10-22');
  assert.equal(inbox.path, '/api/po/invoice/public/v2/invoice/find.inbox/excel');
  assert.equal(
    exportRequest('sale', '2026-10-01', '2026-10-22').path,
    '/api/po/invoice/public/v2/invoice/find.outbox/excel',
  );
  const b = inbox.body;
  // The portal's date format; the end is the next midnight, so the last day is whole.
  assert.equal(b.creationDateFrom, '01-10-2026 00:00');
  assert.equal(b.creationDateTo, '23-10-2026 00:00');
  // Page by page, as the portal asks (the first real export refused one huge page: 400).
  assert.equal(b.offset, 0);
  assert.equal(b.maxCount, 100);
  assert.equal(exportRequest('purchase', '2026-10-01', '2026-10-22', 2).body.offset, 200);
  assert.equal(b.sortBy, 'creationDate');
  assert.equal(b.sortAsc, false);
  // Exactly the statuses the portal's own list sends (seen in a real session, 22.10.2026).
  assert.deepEqual(b.statuses, [
    'approved',
    'onApproval',
    'updateApproval',
    'updateRequested',
    'cancelRequested',
    'approvedBySystem',
    'onApprovalEdited',
    'deactivated',
    'cancelationRefused',
    'correctionRefused',
  ]);
  assert.deepEqual(b.types, ['current', 'corrected']);
  assert.ok((b.kinds as string[]).includes('defaultInvoice'));
  assert.ok((b.kinds as string[]).includes('advanceInvoice'));
  // No narrowing by partner, number or amount.
  for (const k of [
    'serialNumber',
    'senderTin',
    'receiverTin',
    'senderName',
    'receiverName',
    'amountFrom',
    'amountTo',
  ])
    assert.equal(b[k], null, k);
  // Month ends and the year change are whole days.
  assert.equal(
    exportRequest('sale', '2026-12-01', '2026-12-31').body.creationDateTo,
    '01-01-2027 00:00',
  );
  assert.throws(() => exportRequest('sale', '2026-10-22', '2026-10-01'), /dövr/);
  assert.throws(() => exportRequest('sale', '22.10.2026', '2026-10-01'), /dövr/);
});

test('6b: the open period runs from the day after the closed one (or 1 January) to today', () => {
  assert.deepEqual(openPeriod('2026-09-30', '2026-10-22'), {
    from: '2026-10-01',
    to: '2026-10-22',
  });
  assert.deepEqual(openPeriod('2025-12-31', '2026-03-05'), {
    from: '2026-01-01',
    to: '2026-03-05',
  });
  assert.deepEqual(openPeriod('', '2026-10-22'), { from: '2026-01-01', to: '2026-10-22' });
  // Closed through today (or later): only today is asked, nothing earlier.
  assert.deepEqual(openPeriod('2026-10-22', '2026-10-22'), {
    from: '2026-10-22',
    to: '2026-10-22',
  });
});

test('6b: the export answers a file id; only a plain id is followed', () => {
  assert.equal(
    fileIdOf('3f2a9c1e-77aa-4b1c-9d2e-0a1b2c3d4e5f'),
    '3f2a9c1e-77aa-4b1c-9d2e-0a1b2c3d4e5f',
  );
  assert.equal(fileIdOf('"abc_123"'), 'abc_123');
  assert.equal(fileIdOf({ id: 'abc-1' }), 'abc-1');
  assert.equal(fileIdOf({ fileId: 'abc-2' }), 'abc-2');
  assert.equal(fileIdOf({ data: { uuid: 'abc-3' } }), 'abc-3');
  for (const bad of [
    '',
    '../x',
    'a/b',
    'https://evil.example/x',
    { id: 5 },
    null,
    ['x'],
    'x'.repeat(300),
  ])
    assert.equal(fileIdOf(bad), '', JSON.stringify(bad));
  assert.equal(downloadPath('abc-1'), '/api/po/filestorage/public/v1/download/abc-1?type=lk');
  assert.throws(() => downloadPath('../x'));
});

test('6b: only an .xlsx file (a zip) is taken from the download', () => {
  assert.equal(isXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2])), true);
  assert.equal(isXlsx(new TextEncoder().encode('{"error":"x"}')), false);
  assert.equal(isXlsx(new TextEncoder().encode('<html>')), false);
  assert.equal(isXlsx(new Uint8Array([0x50, 0x4b])), false);
});

test("6b: the portal's own list filter seen in the session is the template; only period and page change", () => {
  const seen = {
    statuses: ['approved', 'approvedBySystem'],
    types: ['current'],
    kinds: ['defaultInvoice'],
    senderTin: '1700000001',
    creationDateFrom: '01-01-2026 00:00',
    creationDateTo: '23-10-2026 00:00',
    offset: 40,
    maxCount: 10,
    sortBy: 'creationDate',
    sortAsc: true,
    newField: 'x',
  };
  const b = exportRequest('purchase', '2026-10-01', '2026-10-22', 1, seen).body;
  assert.deepEqual(b.statuses, ['approved', 'approvedBySystem']);
  assert.deepEqual(b.types, ['current']);
  assert.equal(b.newField, 'x');
  // The user's own narrowing in the cabinet does not narrow Meyar's update.
  assert.equal(b.senderTin, null);
  assert.equal(b.creationDateFrom, '01-10-2026 00:00');
  assert.equal(b.creationDateTo, '23-10-2026 00:00');
  assert.equal(b.offset, 100);
  assert.equal(b.maxCount, 100);
  // A template that is not an object is ignored.
  assert.equal(exportRequest('purchase', '2026-10-01', '2026-10-22', 0, 'x').body.maxCount, 100);
});

test('6b: the list answer says whether another page follows', () => {
  assert.equal(hasMore({ hasMore: true, invoices: [] }), true);
  assert.equal(hasMore({ hasMore: false }), false);
  assert.equal(hasMore({ invoices: [] }), false);
  assert.equal(hasMore(null), false);
  assert.equal(listPath('purchase'), '/api/po/invoice/public/v2/invoice/find.inbox');
  assert.equal(listPath('sale'), '/api/po/invoice/public/v2/invoice/find.outbox');
});
