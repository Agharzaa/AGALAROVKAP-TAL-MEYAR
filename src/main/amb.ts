/**
 * Downloads one AMB rates file (stage 5b). Only the official cbar.az address is ever requested,
 * built here from a validated date; the text goes back to the renderer, which reads it with the
 * domain reader and posts the rates as a command (never on its own — QERARLAR 2026-10-17 §4).
 */
import { net } from 'electron';
import { ambUrl } from '../domain/rates.js';
import type { Outcome } from '../contracts/bridge.js';

const MAX = 1024 * 1024;

/** The file's XML, or null when AMB has none for that date (weekend, holiday, future). */
export async function fetchAmb(date: unknown): Promise<Outcome<string | null>> {
  try {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new Error('Tarix düzgün deyil.');
    const response = await net.fetch(ambUrl(date), {
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (response.status === 404) return { ok: true, value: null };
    if (!response.ok) throw new Error(`cbar.az cavab vermədi (HTTP ${response.status}).`);
    if (Number(response.headers.get('content-length') ?? 0) > MAX)
      throw new Error('AMB faylı gözləniləndən böyükdür.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX) throw new Error('AMB faylı gözləniləndən böyükdür.');
    const xml = new TextDecoder('utf-8').decode(bytes);
    // Some days answer 200 with an HTML page instead of a file: no rates for that date.
    if (!/<ValCurs\b/.test(xml)) return { ok: true, value: null };
    return { ok: true, value: xml };
  } catch (error) {
    const message =
      (error as Error).name === 'TimeoutError'
        ? 'cbar.az 20 saniyədə cavab vermədi. İnternet bağlantısını yoxlayın.'
        : (error as Error).message.startsWith('net::')
          ? `cbar.az-a qoşulmaq olmadı (${(error as Error).message}). İnternet bağlantısını yoxlayın.`
          : (error as Error).message;
    return { ok: false, error: { message, code: 'amb' } };
  }
}
