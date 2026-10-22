/**
 * The DVX cabinet's API as seen from its own window (stage 6a; docs/MERHELE-6-DVX-AVTOMAT.md §3;
 * QERARLAR 2026-10-22 §2).
 *
 * The portal page asks new.e-taxes.gov.az/api/po/… with "x-authorization: Bearer <JWT>". Meyar
 * watches those requests in the cabinet's session: it keeps the key (memory only), the request
 * line and its JSON body, and the answer's status. Nothing typed in the page is read. The key goes
 * only with Meyar's own repeats of the e-qaimə lists, through the same session (same cookies), and
 * is forgotten when the cabinet window closes.
 */
import { apiUrl, bearerOf, type SeenRequest } from './dvx-api-policy.js';

/** Marks Meyar's own requests in the session; removed before they leave. */
export const OWN_REQUEST = 'x-meyar-own';
const MAX_SEEN = 200;
const MAX_BODY = 256 * 1024;

export interface DvxRecorder {
  /** The portal's session key; empty until the user has signed in (or after forget). */
  token(): string;
  /** The portal's API requests so far, oldest first (Meyar's own are not among them). */
  seen(): SeenRequest[];
  forget(): void;
}

export function recordDvxApi(
  ses: Electron.Session,
  testOrigin: () => string,
  /** Signed in (a key seen) or not any more (window closed, the portal answered 401). */
  onConnected: (connected: boolean) => void = () => {},
): DvxRecorder {
  let token = '';
  const setToken = (next: string) => {
    if (!!next === !!token) {
      token = next;
      return;
    }
    token = next;
    onConnected(!!next);
  };
  let seen: SeenRequest[] = [];
  const pending = new Map<number, SeenRequest>();
  const own = new Set<number>();
  const api = (url: string) => apiUrl(url, testOrigin());

  ses.webRequest.onBeforeRequest((details, callback) => {
    if (api(details.url) && details.method !== 'OPTIONS') {
      const entry: SeenRequest = { method: details.method, url: details.url };
      const bytes = details.uploadData?.[0]?.bytes;
      if (bytes && bytes.length <= MAX_BODY) {
        try {
          entry.body = JSON.parse(bytes.toString('utf8'));
        } catch {
          entry.body = '(JSON deyil)';
        }
      }
      pending.set(details.id, entry);
    }
    callback({});
  });
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    const mine = Object.keys(headers).find((h) => h.toLowerCase() === OWN_REQUEST);
    if (mine) {
      delete headers[mine];
      own.add(details.id);
      pending.delete(details.id);
    } else if (api(details.url)) {
      setToken(bearerOf(headers) || token);
    }
    callback({ requestHeaders: headers });
  });
  const done = (id: number, status?: number, headers?: Record<string, string[]>) => {
    own.delete(id);
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    entry.status = status;
    // The portal's own request refused: its session has ended (signed out or expired).
    if (status === 401) setToken('');
    const type = Object.entries(headers ?? {}).find(([h]) => h.toLowerCase() === 'content-type');
    if (type?.[1]?.[0]) entry.contentType = type[1][0];
    seen.push(entry);
    if (seen.length > MAX_SEEN) seen = seen.slice(-MAX_SEEN);
  };
  ses.webRequest.onCompleted((d) => done(d.id, d.statusCode, d.responseHeaders));
  ses.webRequest.onErrorOccurred((d) => done(d.id));

  return {
    token: () => token,
    seen: () => [...seen],
    forget() {
      setToken('');
      seen = [];
      pending.clear();
      own.clear();
    },
  };
}
