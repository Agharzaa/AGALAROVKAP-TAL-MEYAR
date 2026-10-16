/**
 * Smoke test of the DVX cabinet window (stage 4d, E17), run inside the real Electron app with
 * MEYAR_SMOKE and MEYAR_SMOKE_DVX=1. A loopback server stands in for e-taxes.gov.az: its page sets
 * a session cookie, tries to open and to navigate to outside addresses, exports an "Excel" file
 * (blob), offers an .exe and a 52 MB file of unannounced size. Reported: what reached the e-qaimə box, what was refused, whether a
 * temporary file was left behind and how many cookies survive closing the window.
 */
import type { BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { closeDvxPortal, setDvxTestOrigin } from './dvx-portal.js';

const page = `<!doctype html><meta charset="utf-8"><title>DVX (sınaq)</title><body>
<script>
document.cookie = 'sid=secret; path=/';
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
  const server = createServer((req, res) => {
    if (req.url === '/big.xlsx') {
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
    await js(`window.__dvx = { files: [], refused: [] };
      window.meyar.onDvxFile((f) => window.__dvx.files.push({ direction: f.direction, name: f.name, size: f.bytes.length }));
      window.meyar.onDvxRefused((m) => window.__dvx.refused.push(m));
      window.meyar.dvxOpen('purchase')`);
    await new Promise((r) => setTimeout(r, 8000));
    const seen = (await js('window.__dvx')) as { files: unknown[]; refused: string[] };
    const leftovers = (await readdir(tmpdir())).filter((f) => f.startsWith('meyar-dvx-'));
    const cookiesAfterClose = await closeDvxPortal();
    return { ...seen, leftovers, cookiesAfterClose };
  } finally {
    setDvxTestOrigin('');
    server.close();
  }
}
