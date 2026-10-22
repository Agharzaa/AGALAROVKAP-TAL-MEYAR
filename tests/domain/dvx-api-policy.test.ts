/**
 * Stage 6a (docs/MERHELE-6-DVX-AVTOMAT.md §3, §7, D1–D2): what Meyar may take from the DVX
 * cabinet's own API requests and what the diagnostics file may hold. The Electron side is checked
 * in the real app (MEYAR_SMOKE with MEYAR_SMOKE_DVX=1, src/main/dvx-smoke.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apiUrl,
  bearerOf,
  diagnosticReport,
  maskPath,
  replayBody,
  replayable,
  shapeOf,
} from '../../src/main/dvx-api-policy.js';

test('D1: only the portal API of new.e-taxes.gov.az over HTTPS (or the loopback test origin)', () => {
  for (const url of [
    'https://new.e-taxes.gov.az/api/po/invoice/public/v2/invoice/find.inbox',
    'https://new.e-taxes.gov.az/api/po/filestorage/public/v1/download/abc?type=lk',
  ])
    assert.equal(apiUrl(url), true, url);
  for (const url of [
    'http://new.e-taxes.gov.az/api/po/invoice/public/v2/invoice/find.inbox',
    'https://e-taxes.gov.az/api/po/invoice/public/v2/invoice/find.inbox',
    'https://new.e-taxes.gov.az.example.com/api/po/x',
    'https://new.e-taxes.gov.az/etaxes/',
    'https://new.e-taxes.gov.az/apix/po/x',
    'https://user:p@new.e-taxes.gov.az/api/po/x',
    'https://asanimza.az/api/po/x',
    'not a url',
  ])
    assert.equal(apiUrl(url), false, url);
  assert.equal(apiUrl('http://127.0.0.1:4321/api/po/x', 'http://127.0.0.1:4321'), true);
  assert.equal(apiUrl('http://127.0.0.1:4321/etaxes/', 'http://127.0.0.1:4321'), false);
  assert.equal(apiUrl('http://127.0.0.1:9999/api/po/x', 'http://127.0.0.1:4321'), false);
  // A test origin that is not loopback is ignored.
  assert.equal(apiUrl('http://evil.example/api/po/x', 'http://evil.example'), false);
});

test('D1: the session key is the bearer value of the portal\'s own "x-authorization" header', () => {
  assert.equal(bearerOf({ 'x-authorization': 'Bearer abc.def.ghi' }), 'abc.def.ghi');
  assert.equal(bearerOf({ 'X-Authorization': 'bearer  abc.def.ghi ' }), 'abc.def.ghi');
  assert.equal(bearerOf({ 'x-authorization': ['Bearer one'] }), 'one');
  assert.equal(bearerOf({ authorization: 'Bearer other' }), '');
  assert.equal(bearerOf({ 'x-authorization': 'Basic Zm9v' }), '');
  assert.equal(bearerOf({ 'x-authorization': 'Bearer ' }), '');
  assert.equal(bearerOf({}), '');
});

test('D2: a path keeps its words; ids, numbers, VÖEN and query values are masked', () => {
  assert.equal(
    maskPath('https://new.e-taxes.gov.az/api/po/invoice/public/v2/invoice/find.inbox'),
    '/api/po/invoice/public/v2/invoice/find.inbox',
  );
  assert.equal(
    maskPath(
      'https://new.e-taxes.gov.az/api/po/filestorage/public/v1/download/3f2a9c1e-77aa-4b1c-9d2e-0a1b2c3d4e5f?type=lk',
    ),
    '/api/po/filestorage/public/v1/download/{id}?type=…',
  );
  assert.equal(
    maskPath(
      'https://new.e-taxes.gov.az/api/po/invoice/public/v2/invoice/1700000001?sourceSystem=X&tin=1700000001',
    ),
    '/api/po/invoice/public/v2/invoice/{id}?sourceSystem=…&tin=…',
  );
  assert.equal(maskPath('https://x.az/api/po/a/MT2610007/b'), '/api/po/a/{id}/b');
});

test('D2: the shape holds names and types only — no number, VÖEN, name or amount', () => {
  const shape = shapeOf({
    invoices: [
      {
        serialNumber: 'MT2610007',
        senderTin: '1700000001',
        senderName: 'Malsatan MMC',
        amount: 118.5,
        signDate: '2026-10-05T10:00:00',
        status: 'APPROVED',
        type: 'CURRENT',
        cancelled: false,
        note: null,
      },
      {
        serialNumber: 'MT2610008',
        senderTin: '1700000002',
        senderName: 'Başqa MMC',
        amount: '20.00',
        signDate: '05-10-2026',
        status: 'CANCELLED',
        type: 'CURRENT',
        cancelled: true,
        extra: { a: 1 },
      },
    ],
    total: 2,
  });
  const text = JSON.stringify(shape);
  for (const secret of ['MT2610007', '1700000001', 'Malsatan', 'Başqa', '118.5', '20.00', '2026'])
    assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(shape, {
    invoices: {
      array: 2,
      of: {
        amount: 'number|string',
        cancelled: 'boolean',
        extra: { a: 'number' },
        note: 'null',
        senderName: 'string',
        senderTin: 'string',
        serialNumber: 'string',
        signDate: 'string(date)',
        status: { codes: { APPROVED: 1, CANCELLED: 1 } },
        type: { codes: { CURRENT: 2 } },
      },
    },
    total: 'number',
  });
  // A "status" holding a number, a name or a long text is not a code: only its type is kept.
  assert.deepEqual(shapeOf({ status: 'Malsatan MMC 1700000001' }), { status: 'string' });
  assert.deepEqual(shapeOf({ type: 12 }), { type: 'number' });
});

test('D1: Meyar repeats only the e-qaimə list requests, with a small page', () => {
  for (const path of [
    '/api/po/invoice/public/v2/invoice/find.inbox',
    '/api/po/invoice/public/v2/invoice/find.outbox',
    '/api/po/invoice/public/v1/invoice/find.inbox/byProducts',
    '/api/po/invoice/public/v1/invoice/find.outbox/byProducts',
  ])
    assert.equal(replayable('POST', path), true, path);
  for (const [method, path] of [
    ['GET', '/api/po/invoice/public/v2/invoice/find.inbox'],
    ['POST', '/api/po/invoice/public/v1/invoice/find.draft'],
    ['POST', '/api/po/invoice/public/v1/common/removeDrafts'],
    ['POST', '/api/po/invoice/public/v1/invoice/sign'],
    ['POST', '/api/po/invoice/public/v2/invoice/find.inbox/excel'],
    ['POST', '/api/po/edi/public/v1/applications/find.draft'],
  ] as const)
    assert.equal(replayable(method, path), false, path);
  assert.deepEqual(replayBody({ statuses: ['APPROVED'], offset: 40, maxCount: 500 }), {
    statuses: ['APPROVED'],
    offset: 0,
    maxCount: 10,
  });
  assert.deepEqual(replayBody({ offset: 0, maxCount: 5 }), { offset: 0, maxCount: 5 });
  assert.equal(replayBody('not an object'), undefined);
});

test('D2: the diagnostics report never carries the session key or values', () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.c2VjcmV0.c2ln';
  const report = diagnosticReport(
    [
      {
        method: 'POST',
        url: `https://new.e-taxes.gov.az/api/po/invoice/public/v2/invoice/find.inbox?t=${token}`,
        body: { senderTin: '1700000001', statuses: ['APPROVED'], offset: 0, maxCount: 10 },
        status: 200,
        contentType: 'application/json;charset=UTF-8',
      },
      {
        method: 'POST',
        url: 'https://new.e-taxes.gov.az/api/po/invoice/public/v2/invoice/find.inbox/byInvoices',
        body: { creationDateFrom: '2026-10-01', creationDateTo: '2026-10-31' },
        status: 200,
        contentType: 'application/json',
      },
    ],
    [
      {
        path: '/api/po/invoice/public/v2/invoice/find.inbox',
        status: 200,
        response: { invoices: [{ serialNumber: 'MT2610007', status: 'APPROVED' }] },
      },
    ],
    '0.7.3',
    new Date('2026-10-22T12:00:00Z'),
  );
  const text = JSON.stringify(report);
  for (const secret of [token, 'c2VjcmV0', '1700000001', 'MT2610007', '2026-10-01'])
    assert.equal(text.includes(secret), false, secret);
  assert.equal(report.requests.length, 2);
  assert.equal(report.requests[0]!.path, '/api/po/invoice/public/v2/invoice/find.inbox?t=…');
  assert.deepEqual(report.requests[1]!.body, {
    creationDateFrom: 'string(date)',
    creationDateTo: 'string(date)',
  });
  assert.deepEqual(report.replays[0]!.response, {
    invoices: { array: 1, of: { serialNumber: 'string', status: { codes: { APPROVED: 1 } } } },
  });
  assert.equal(report.meyar, '0.7.3');
});
