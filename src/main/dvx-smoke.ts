/**
 * Smoke test of the DVX cabinet window (stage 4d, E17), run inside the real Electron app with
 * MEYAR_SMOKE and MEYAR_SMOKE_DVX=1. A loopback server stands in for e-taxes.gov.az: its page sets
 * a session cookie, tries to open and to navigate to outside addresses, exports an "Excel" file
 * (blob), offers an .exe and a 52 MB file of unannounced size. Reported: what reached the e-qaimə box, what was refused, whether a
 * temporary file was left behind and how many cookies survive closing the window.
 *
 * Stage 6a (D1, D2): the page also asks its API with a session key, as the real portal does. Meyar
 * repeats that list request for the diagnostics; reported: what the server saw of the repeat, what
 * the diagnostics file holds (the key, a VÖEN or a number must not be in it) and that the key is
 * gone once the window is closed.
 */
import type { BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  closeDvxPortal,
  dvxConnected,
  dvxDiagnose,
  dvxPortalWindow,
  setDvxTestOrigin,
} from './dvx-portal.js';

const KEY = 'smoke-secret-key.abc';
const LIST = '/api/po/invoice/public/v2/invoice/find.inbox';

const page = `<!doctype html><meta charset="utf-8"><title>DVX (sınaq)</title><body>
<script>
document.cookie = 'sid=secret; path=/';
fetch('${LIST}', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-authorization': 'Bearer ${KEY}' },
  body: JSON.stringify({ senderTin: '1700000001', statuses: ['APPROVED'], offset: 20, maxCount: 50 }),
});
window.open('https://evil.example/');
const a = document.createElement('a');
a.href = URL.createObjectURL(new Blob([new Uint8Array([80, 75, 3, 4])]));
a.download = 'Gelenler.xlsx';
document.body.append(a);
a.click();
setTimeout(() => {
  const b = document.createElement('a');
  b.href = '/x.exe';
  b.download = 'x.exe';
  document.body.append(b);
  b.click();
}, 500);
setTimeout(() => {
  const c = document.createElement('a');
  c.href = '/big.xlsx';
  document.body.append(c);
  c.click();
}, 700);
setTimeout(() => { location.href = 'http://evil.invalid/'; }, 1500);
</script>`;

export async function dvxSmoke(window: BrowserWindow): Promise<Record<string, unknown>> {
  const repeats: { key: boolean; ownHeader: boolean; body: unknown }[] = [];
  let portalAsked = 0;
  const server = createServer((req, res) => {
    if (req.url === LIST) {
      let text = '';
      req.on('data', (c: Buffer) => (text += c.toString('utf8')));
      req.on('end', () => {
        const key = req.headers['x-authorization'] === `Bearer ${KEY}`;
        const body = JSON.parse(text || '{}') as { maxCount?: number };
        // The page's own request asks for 50; Meyar's repeat for one small page.
        if (body.maxCount === 50) portalAsked++;
        else repeats.push({ key, ownHeader: 'x-meyar-own' in req.headers, body });
        res.writeHead(key ? 200 : 401, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            invoices: [{ serialNumber: 'MT2610007', senderTin: '1700000001', status: 'APPROVED' }],
            total: 1,
          }),
        );
      });
    } else if (req.url === '/big.xlsx') {
      // No Content-Length: the size is learnt only while it arrives (52 MB > the 50 MB limit).
      res.writeHead(200, { 'content-disposition': 'attachment; filename=big.xlsx' });
      const chunk = Buffer.alloc(1024 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < 52 && res.write(chunk)) sent++;
        if (sent >= 52) res.end();
        else res.once('drain', () => (sent++, pump()));
      };
      pump();
    } else if (req.url === '/x.exe') {
      res.writeHead(200, { 'content-disposition': 'attachment; filename=x.exe' });
      res.end('MZ');
    } else {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  setDvxTestOrigin(`http://127.0.0.1:${port}`);
  const js = (code: string) => window.webContents.executeJavaScript(code);
  try {
    await js(`window.__dvx = { files: [], refused: [], states: [] };
      window.meyar.onDvxState((s) => window.__dvx.states.push(s.connected));
      window.meyar.onDvxFile((f) => window.__dvx.files.push({ direction: f.direction, name: f.name, size: f.bytes.length }));
      window.meyar.onDvxRefused((m) => window.__dvx.refused.push(m));
      window.meyar.dvxOpen('purchase')`);
    await new Promise((r) => setTimeout(r, 8000));
    // The cabinet is a window of its own: it stays on screen when Meyar is minimized, and a
    // second "DVX kabinetini aç" brings a minimized cabinet back.
    const cabinet = dvxPortalWindow()!;
    window.minimize();
    await new Promise((r) => setTimeout(r, 800));
    const ownWindow = {
      parent: cabinet.getParentWindow() ? 'var' : 'yox',
      visibleWithMeyarMinimized: cabinet.isVisible() && !cabinet.isMinimized(),
      connected: dvxConnected(),
    };
    window.restore();
    cabinet.minimize();
    await new Promise((r) => setTimeout(r, 800));
    await js("window.meyar.dvxOpen('purchase')");
    await new Promise((r) => setTimeout(r, 800));
    Object.assign(ownWindow, { restoredByOpen: !cabinet.isMinimized() && cabinet.isVisible() });
    const seen = (await js('window.__dvx')) as { files: unknown[]; refused: string[] };
    const leftovers = (await readdir(tmpdir())).filter((f) => f.startsWith('meyar-dvx-'));
    const diagnosis = await dvxDiagnose(tmpdir(), 'smoke');
    const text = await readFile(diagnosis.file, 'utf8');
    await rm(diagnosis.file, { force: true });
    const report = JSON.parse(text) as { requests: { path: string; status?: number }[] };
    const cookiesAfterClose = await closeDvxPortal();
    const afterClose = await dvxDiagnose(tmpdir(), 'smoke').then(
      () => 'saxlandı',
      (e: Error) => e.message,
    );
    return {
      ...seen,
      leftovers,
      cookiesAfterClose,
      ownWindow,
      statesAfterClose: await js('window.__dvx.states'),
      api: {
        portalAsked,
        repeats,
        diagnosis: { requests: diagnosis.requests, replayed: diagnosis.replayed },
        reportPaths: report.requests.map((r) => `${r.path} ${r.status ?? '-'}`),
        leaked: [KEY, '1700000001', 'MT2610007'].filter((v) => text.includes(v)),
        afterClose,
      },
    };
  } finally {
    setDvxTestOrigin('');
    server.close();
  }
}
