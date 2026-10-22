/**
 * What Meyar may take from the DVX cabinet's own API requests (stage 6a;
 * docs/MERHELE-6-DVX-AVTOMAT.md §3, §7; QERARLAR 2026-10-22). Pure rules, kept apart from
 * Electron so they are tested on their own.
 *
 * - The portal (new.e-taxes.gov.az/eportal) asks its API at /api/po/… with the header
 *   "x-authorization: Bearer <JWT>". Meyar keeps that key in memory and sends it nowhere else.
 * - Meyar repeats only the e-qaimə list requests (find.inbox / find.outbox), with a small page.
 * - The diagnostics file holds the shape of requests and answers: names, types and status codes —
 *   never a number, VÖEN, name, amount, date or the key.
 */
export const DVX_API_HOST = 'new.e-taxes.gov.az';
const API_PATH = '/api/po/';
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;

/** A request of the portal's API (where the session key may go). */
export function apiUrl(url: string, testOrigin = ''): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!u.pathname.startsWith(API_PATH)) return false;
  if (testOrigin && LOOPBACK.test(testOrigin)) return u.origin === testOrigin;
  return (
    u.protocol === 'https:' &&
    !u.username &&
    !u.password &&
    u.hostname.toLowerCase() === DVX_API_HOST
  );
}

/** The session key in the portal's own request headers; empty when there is none. */
export function bearerOf(headers: Record<string, string | string[] | undefined>): string {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'x-authorization') continue;
    const text = (Array.isArray(value) ? value[0] : value) ?? '';
    const m = /^\s*bearer\s+(\S+)\s*$/i.exec(text);
    return m?.[1] ?? '';
  }
  return '';
}

const ID_SEGMENT = /\d{3,}|^[0-9a-f]{8}-[0-9a-f-]{20,}$/i;

/** The path of a request with its ids and query values masked: "/api/po/…/download/{id}?type=…". */
export function maskPath(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '?';
  }
  const path = u.pathname
    .split('/')
    .map((s) => (ID_SEGMENT.test(decodeURIComponent(s)) ? '{id}' : s))
    .join('/');
  const keys = [...u.searchParams.keys()];
  return keys.length ? `${path}?${keys.map((k) => `${k}=…`).join('&')}` : path;
}

/** Repeated by Meyar for the diagnostics: the e-qaimə lists only (reading, nothing else). */
export function replayable(method: string, path: string): boolean {
  return (
    method.toUpperCase() === 'POST' &&
    /^\/api\/po\/invoice\/public\/v\d\/invoice\/find\.(inbox|outbox)(\/byProducts)?$/.test(path)
  );
}

const REPLAY_PAGE = 10;

/** The portal's own list filter, from its first row and at most one small page. */
export function replayBody(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const b = body as Record<string, unknown>;
  const asked = typeof b.maxCount === 'number' && b.maxCount > 0 ? b.maxCount : REPLAY_PAGE;
  return { ...b, offset: 0, maxCount: Math.min(asked, REPLAY_PAGE) };
}

/** The shape of a JSON value: a type name, an object of shapes, an array, or status codes. */
export type Shape = string | { [key: string]: Shape } | ArrayShape | CodesShape;
interface ArrayShape {
  array: number;
  of: Shape;
}
interface CodesShape {
  codes: Record<string, number>;
}

const CODE_KEY = /status|type|kind|source|reason/i;
const CODE_VALUE = /^[\p{L}_]{1,40}$/u;
const DATE = /^(\d{4}-\d{2}-\d{2}|\d{2}[-./]\d{2}[-./]\d{4})/;
const MAX_ITEMS = 500;
const MAX_DEPTH = 12;

function isArrayShape(s: Shape): s is ArrayShape {
  return typeof s === 'object' && 'array' in s && 'of' in s;
}
function isCodes(s: Shape): s is CodesShape {
  return typeof s === 'object' && 'codes' in s && Object.keys(s).length === 1;
}

/** Names and types of a JSON value; a short code under a status / type key is kept with its count. */
export function shapeOf(value: unknown, key = '', depth = 0): Shape {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    let of: Shape = 'nothing';
    value.slice(0, MAX_ITEMS).forEach((v, i) => {
      const s = shapeOf(v, key, depth + 1);
      of = i === 0 ? s : merge(of, s);
    });
    return { array: value.length, of };
  }
  switch (typeof value) {
    case 'string':
      if (CODE_KEY.test(key) && CODE_VALUE.test(value)) return { codes: { [value]: 1 } };
      return DATE.test(value) ? 'string(date)' : 'string';
    case 'number':
    case 'boolean':
      return typeof value;
    case 'object': {
      if (depth >= MAX_DEPTH) return 'object';
      const out: Record<string, Shape> = {};
      for (const k of Object.keys(value as object).sort())
        out[k] = shapeOf((value as Record<string, unknown>)[k], k, depth + 1);
      return out;
    }
    default:
      return typeof value;
  }
}

function merge(a: Shape, b: Shape): Shape {
  if (isCodes(a) && isCodes(b)) {
    const codes = { ...a.codes };
    for (const [c, n] of Object.entries(b.codes)) codes[c] = (codes[c] ?? 0) + n;
    return { codes };
  }
  if (isArrayShape(a) && isArrayShape(b))
    return { array: a.array + b.array, of: a.array ? (b.array ? merge(a.of, b.of) : a.of) : b.of };
  if (typeof a === 'object' && typeof b === 'object' && !isCodes(a) && !isCodes(b)) {
    if (!isArrayShape(a) && !isArrayShape(b)) {
      const out: Record<string, Shape> = {};
      for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        const x = (a as Record<string, Shape>)[k];
        const y = (b as Record<string, Shape>)[k];
        out[k] = x === undefined ? y! : y === undefined ? x : merge(x, y);
      }
      return out;
    }
  }
  const names = (s: Shape): string[] =>
    typeof s === 'string'
      ? s.split('|')
      : isCodes(s)
        ? ['string']
        : isArrayShape(s)
          ? ['array']
          : ['object'];
  return [...new Set([...names(a), ...names(b)])].sort().join('|');
}

/** One API request of the cabinet, as seen in its session (kept in memory only). */
export interface SeenRequest {
  method: string;
  url: string;
  body?: unknown;
  status?: number;
  contentType?: string;
}
/** One list request repeated by Meyar. */
export interface Replay {
  path: string;
  status?: number;
  response?: unknown;
  error?: string;
}

/** The diagnostics file: what the portal asks and answers, without a single value. */
export function diagnosticReport(
  seen: readonly SeenRequest[],
  replays: readonly Replay[],
  version: string,
  now: Date,
) {
  return {
    format: 'meyar-dvx-diagnostics/1',
    meyar: version,
    created: now.toISOString(),
    requests: seen.map((r) => ({
      method: r.method.toUpperCase(),
      path: maskPath(r.url),
      ...(r.status !== undefined && { status: r.status }),
      ...(r.contentType && { contentType: r.contentType.split(';')[0]!.trim() }),
      ...(r.body !== undefined && { body: shapeOf(r.body) }),
    })),
    replays: replays.map((r) => ({
      path: r.path,
      ...(r.status !== undefined && { status: r.status }),
      ...(r.response !== undefined && { response: shapeOf(r.response) }),
      ...(r.error && { error: r.error }),
    })),
  };
}
