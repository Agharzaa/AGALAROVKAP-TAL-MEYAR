/**
 * The pages of one "DVX-dən yenilə" export (stages 6b, 6c-2; docs/MERHELE-6-DVX-AVTOMAT.md §2, §6),
 * kept apart from Electron so paging, "Ləğv et" and partial answers are tested on their own. The
 * caller sends each request with the portal's session key (src/main/dvx-portal.ts).
 */
import { MAX_DOWNLOAD } from './dvx-policy.js';
import {
  downloadPath,
  EXPORT_PAGE,
  exportRequest,
  fileIdOf,
  hasMore,
  isXlsx,
  listPath,
  samePage,
} from './dvx-api-policy.js';

/** At most 100 pages of 100 e-qaimələr in one update. */
export const MAX_PAGES = 100;

/** What the export needs of an HTTP answer (a fetch Response has it). */
export interface Answer {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
/** Sends one request of the portal's API (a path under its origin). */
export type Ask = (path: string, init: { method: string; body?: string }) => Promise<Answer>;

export class ExportError extends Error {
  constructor(
    message: string,
    readonly step: string,
    readonly status?: number,
    /** The export request that went wrong (for the diagnostics). */
    readonly path = '',
  ) {
    super(message);
  }
}

export interface ExportPages {
  files: { name: string; bytes: Uint8Array }[];
  /** DVX may hold more e-qaimələr of the period than these pages: the update is partial. */
  partial: boolean;
  cancelled: boolean;
  /**
   * The export answered the page before again (it does not page). Whether that one file is the
   * whole period is told by its rows: no more than `pageSize` means the rest was not given.
   */
  repeated: boolean;
  pageSize: number;
}

export async function exportPages(o: {
  direction: 'sale' | 'purchase';
  from: string;
  to: string;
  /** The portal's own filter of this box, when its list was opened in this session. */
  template?: unknown;
  ask: Ask;
  /** "Ləğv et": the pages taken so far are answered. */
  signal: AbortSignal;
  onPage?: (page: number) => void;
  maxPages?: number;
}): Promise<ExportPages> {
  const { direction, from, to, template, ask, signal } = o;
  const maxPages = o.maxPages ?? MAX_PAGES;
  const list = listPath(direction);
  let request = exportRequest(direction, from, to, 0, template);
  const refused = (step: string, status: number) =>
    status === 401 || status === 403
      ? new ExportError(
          'DVX sessiyasının vaxtı bitib: kabinetə yenidən daxil olun və yenidən yoxlayın.',
          step,
          status,
          request.path,
        )
      : new ExportError(
          `DVX ixracı alınmadı (cavab ${status}). Hələlik kabinetdə "Exceli endir" ilə davam edin.`,
          step,
          status,
          request.path,
        );
  const box = direction === 'purchase' ? 'Gelenler' : 'Gonderilenler';
  const files: { name: string; bytes: Uint8Array }[] = [];
  // DVX could not say whether more pages follow: the update says it is partial (audit 2026-10-25).
  let partial = false;
  let repeated = false;
  /** The list's last word: another page follows. */
  let left = false;
  const done = (cancelled: boolean): ExportPages => ({
    files,
    partial,
    cancelled,
    repeated,
    pageSize: EXPORT_PAGE,
  });
  try {
    for (let page = 0; page < maxPages && !signal.aborted; page++) {
      o.onPage?.(page + 1);
      request = exportRequest(direction, from, to, page, template);
      const res = await ask(request.path, {
        method: 'POST',
        body: JSON.stringify(request.body),
      });
      if (!res.ok) throw refused('export', res.status);
      const type = res.headers.get('content-type') ?? '';
      let bytes: Uint8Array;
      if (/json|text/i.test(type)) {
        const text = await res.text();
        let answer: unknown = text;
        try {
          answer = JSON.parse(text);
        } catch {
          // A plain-text id.
        }
        const id = fileIdOf(answer);
        if (!id)
          throw new ExportError(
            'DVX ixracı gözlənilməyən cavab verdi. Hələlik kabinetdə "Exceli endir" ilə davam edin.',
            'export-answer',
            res.status,
            request.path,
          );
        const file = await ask(downloadPath(id), { method: 'GET' });
        if (!file.ok) throw refused('download', file.status);
        bytes = new Uint8Array(await file.arrayBuffer());
      } else {
        // The file itself, without an id.
        bytes = new Uint8Array(await res.arrayBuffer());
      }
      if (bytes.length > MAX_DOWNLOAD)
        throw new ExportError(
          'DVX faylı 50 MB-dan böyükdür.',
          'download-size',
          undefined,
          request.path,
        );
      if (!isXlsx(bytes))
        throw new ExportError(
          'DVX-dən Excel faylı gəlmədi. Hələlik kabinetdə "Exceli endir" ilə davam edin.',
          'download-type',
          undefined,
          request.path,
        );
      // The same file as the page before: the export ignores paging — it is not asked again.
      if (samePage(files.at(-1)?.bytes, bytes)) {
        repeated = true;
        break;
      }
      files.push({ name: `DVX-${box}-${from}_${to}-${page + 1}.xlsx`, bytes });
      // The same page of the list says whether another one follows. If the list cannot say,
      // the pages taken so far stand (a repeated update takes the rest: one e-qaimə, once).
      const more = await ask(list, { method: 'POST', body: JSON.stringify(request.body) });
      const answer: unknown = more.ok ? await more.json().catch(() => undefined) : undefined;
      if (answer === undefined) {
        partial = true;
        break;
      }
      left = hasMore(answer);
      if (!left) break;
    }
    // The page limit stopped the export while DVX said more follow (audit of stage 6).
    if (left && !repeated && !signal.aborted) partial = true;
    return done(signal.aborted);
  } catch (error) {
    if (signal.aborted) return done(true);
    if (error instanceof ExportError) throw error;
    throw new ExportError(
      `DVX ilə əlaqə alınmadı: ${(error as Error).message}`,
      'network',
      undefined,
      request.path,
    );
  }
}
