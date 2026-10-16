/**
 * DVX cabinet window rules (stage 4d, E17). The window itself is checked in the real Electron
 * app (MEYAR_SMOKE with MEYAR_SMOKE_DVX=1, src/main/dvx-smoke.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedUrl,
  DVX_START,
  MAX_DOWNLOAD,
  refuseDownload,
  startUrl,
} from '../../src/main/dvx-policy.js';

test('E17: only the official HTTPS sites; look-alikes and other schemes are refused', () => {
  for (const url of [
    'https://new.e-taxes.gov.az/etaxes/',
    'https://e-taxes.gov.az/',
    'https://www.e-taxes.gov.az/x?y=1',
    'https://tools.asanimza.az/login',
    'https://sima.az/',
  ])
    assert.equal(allowedUrl(url), true, url);
  for (const url of [
    'http://new.e-taxes.gov.az/',
    'https://e-taxes.gov.az.example.com/',
    'https://evil-e-taxes.gov.az/',
    'https://user:pass@e-taxes.gov.az/',
    'https://example.com/?u=https://e-taxes.gov.az',
    'file:///C:/Windows/',
    'javascript:alert(1)',
    'not a url',
  ])
    assert.equal(allowedUrl(url), false, url);
});

test('E17: a test origin may only be loopback HTTP', () => {
  assert.equal(allowedUrl('http://127.0.0.1:5123/a', 'http://127.0.0.1:5123'), true);
  assert.equal(allowedUrl('http://127.0.0.1:5124/a', 'http://127.0.0.1:5123'), false);
  assert.equal(allowedUrl('http://example.com/', 'http://example.com'), false);
  assert.equal(startUrl('http://127.0.0.1:5123'), 'http://127.0.0.1:5123/');
  assert.equal(startUrl('https://evil.example'), DVX_START);
  assert.equal(startUrl(), 'https://new.e-taxes.gov.az/etaxes/');
});

test('E17: only spreadsheet exports up to 50 MB are taken from the cabinet', () => {
  assert.equal(refuseDownload('Gələnlər.xlsx', 1000), '');
  assert.equal(refuseDownload('mallar.CSV', 0), '');
  assert.equal(refuseDownload('kohne.xls', 10), '');
  assert.match(refuseDownload('setup.exe', 10), /Excel\/CSV faylı deyil/);
  assert.match(refuseDownload('qaimeler.xlsx.exe', 10), /Excel\/CSV faylı deyil/);
  assert.match(refuseDownload('boyuk.xlsx', MAX_DOWNLOAD + 1), /50 MB/);
});
