/**
 * "DVX-dən yenilə" (stages 6b–6c): the cabinet's own Excel export of a box for the open period,
 * asked by Meyar and loaded page by page as from a file (QERARLAR 2026-10-22, 2026-10-25 §18).
 * The e-qaimə box updates its own direction; İş masası updates both, one after the other.
 */
import { useEffect, useRef, useState } from 'react';
import { openPeriod, readEqTable } from '../domain/eqaime';
import type { CommandResult } from '../contracts/commands';
import { api } from './api';
import { day, today } from './format';
import { readSheet, SheetError } from './sheet-reader';

type Direction = 'sale' | 'purchase';

export const boxName = (d: Direction) => (d === 'purchase' ? 'Gələnlər' : 'Göndərilənlər');

/** What an e-qaimə import did, in one sentence. */
export function importSummary(r: CommandResult): string {
  return (
    `yeni ${r.added ?? 0} e-qaimə` +
    (r.updated ? `, ${r.updated} e-qaimənin DVX statusu və ya sətirləri yeniləndi` : '') +
    (r.same ? `, ${r.same} dəyişməyib (təkrar yaradılmadı)` : '') +
    (r.conflicts ? `, ${r.conflicts} ziddiyyət (bax “Ziddiyyət”)` : '') +
    (r.rejected?.length ? `, ${r.rejected.length} sətir qəbul olunmadı` : '') +
    (r.posted
      ? `. ${r.posted} e-qaimə təsdiqlənmiş uyğunluqlarla avtomatik uçota alındı və ya əl ilə yazılmış qaiməyə bağlandı`
      : '. Heç nə avtomatik uçota alınmayıb') +
    (r.failed?.length ? `; ${r.failed.length} alınmadı (səbəb sətirdə)` : '') +
    '.'
  );
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** How one box's update ended: a sentence for the user, failed or not. */
export interface SyncOutcome {
  direction: Direction;
  result: 'ok' | 'partial' | 'failed' | 'cancelled';
  text: string;
}

/**
 * The update of one or more boxes, with its progress and "Ləğv et" (the pages taken stay).
 * Not signed in: the cabinet opens and the update starts by itself once the sign-in is seen.
 */
export function useDvxSync(o: {
  companyId: string;
  closedThrough: string;
  /** Before the cabinet opens for the sign-in (the box claims the cabinet's exports). */
  onOpen?: () => void;
  onDone: (outcomes: SyncOutcome[]) => void;
}) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let live = true;
    api.dvxConnected().then(
      (c) => live && setConnected(c),
      () => {},
    );
    const off = api.onDvxState((s) => setConnected(s.connected));
    return () => {
      live = false;
      off();
    };
  }, []);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState('');
  const [waiting, setWaiting] = useState<Direction[]>([]);
  const cancelled = useRef(false);
  const current = useRef<Direction | null>(null);
  useEffect(
    () =>
      api.onDvxProgress((p) => {
        if (current.current === p.direction && !cancelled.current)
          setProgress(`${boxName(p.direction)}: səhifə ${p.page} alınır…`);
      }),
    [],
  );

  async function one(direction: Direction): Promise<SyncOutcome> {
    const name = boxName(direction);
    current.current = direction;
    setProgress(`${name}: DVX-dən alınır…`);
    const startedAt = new Date().toISOString();
    const { from, to } = openPeriod(o.closedThrough, today());
    const period = `${day(from)}–${day(to)}`;
    // DVX gives the period page by page; each page is one import (one e-qaimə, once).
    const total: CommandResult = { id: '' };
    // Stage 6c-1: every attempt is kept, also a failed one.
    const end = async (
      result: SyncOutcome['result'],
      text: string,
      message = '',
    ): Promise<SyncOutcome> => {
      await api
        .command({
          type: 'eqaime.synced',
          companyId: o.companyId,
          direction,
          from,
          to,
          startedAt,
          result,
          added: total.added ?? 0,
          updated: total.updated ?? 0,
          conflicts: total.conflicts ?? 0,
          rejected: total.rejected?.length ?? 0,
          posted: total.posted ?? 0,
          message: message.slice(0, 500),
        })
        .catch(() => undefined);
      return { direction, result, text };
    };
    try {
      const exported = await api.dvxExport(direction, from, to);
      const { files } = exported;
      let stopped = !!exported.cancelled || cancelled.current;
      const add = (k: 'added' | 'updated' | 'same' | 'conflicts' | 'posted', n?: number) =>
        n && (total[k] = (total[k] ?? 0) + n);
      let loaded = 0;
      /** The e-qaimələr of the last file read. */
      let rows = 0;
      for (const [i, f] of files.entries()) {
        // Cancelled while loading: the pages loaded so far stay (one e-qaimə, once).
        if (i && cancelled.current) {
          stopped = true;
          break;
        }
        if (!cancelled.current) setProgress(`${name}: ${i + 1} / ${files.length} səhifə yüklənir…`);
        const read = readEqTable(await readSheet(f.name, f.bytes), f.name);
        rows = read.documents.length;
        if (!read.report || !read.documents.length) {
          const problem = read.problems[0]?.message;
          if (problem) return await end('failed', problem, problem);
          continue;
        }
        const r = await api.command({
          type: 'eqaime.import',
          companyId: o.companyId,
          direction,
          ...(read.directionHint ? { fileDirection: read.directionHint } : {}),
          ...(read.ownerTaxId ? { fileOwnerTaxId: read.ownerTaxId } : {}),
          // The box was chosen by Meyar itself: Gələnlər for purchases, Göndərilənlər for sales.
          directionConfirmed: true,
          report: read.report,
          source: 'portal',
          fileName: f.name,
          fileHash: await sha256(f.bytes),
          documents: read.documents,
        });
        loaded++;
        add('added', r.added);
        add('updated', r.updated);
        add('same', r.same);
        add('conflicts', r.conflicts);
        add('posted', r.posted);
        total.rejected = [...(total.rejected ?? []), ...(r.rejected ?? [])];
        total.failed = [...(total.failed ?? []), ...(r.failed ?? [])];
      }
      if (stopped)
        return await end(
          'cancelled',
          loaded
            ? `DVX yeniləməsi ləğv edildi (${period}; alınmış səhifələr yükləndi, qalanını növbəti yeniləmə alacaq): ${importSummary(total)}`
            : 'DVX yeniləməsi ləğv edildi: heç nə yüklənmədi.',
        );
      // The export did not page and its one file holds no more than a page: DVX said more follow,
      // the rest was not given (audit of stage 6).
      const unpaged = !!exported.repeated && rows <= (exported.pageSize ?? 100);
      const partial = !!exported.partial || unpaged;
      const said = unpaged
        ? 'DVX ixracı səhifələri ayırmadı'
        : partial
          ? 'DVX növbəti səhifəni demədi'
          : '';
      if (!loaded)
        return await end(
          partial ? 'partial' : 'ok',
          `DVX-də ${period} dövründə e-qaimə yoxdur.`,
          said,
        );
      return await end(
        partial ? 'partial' : 'ok',
        `DVX-dən yeniləndi (${period}${partial ? `, yarımçıq: ${said} — yenidən basın və ya qalanını kabinetdə "Exceli endir" ilə yükləyin` : ''}): ${importSummary(total)}`,
        said,
      );
    } catch (e) {
      const message = e instanceof SheetError ? e.message : (e as Error).message;
      return await end('failed', message, message);
    }
  }

  async function run(directions: Direction[]) {
    setSyncing(true);
    cancelled.current = false;
    const outcomes: SyncOutcome[] = [];
    try {
      for (const d of directions) {
        if (cancelled.current) break;
        outcomes.push(await one(d));
      }
    } finally {
      current.current = null;
      setProgress('');
      setSyncing(false);
    }
    o.onDone(outcomes);
  }

  /** Starts the update; false when the cabinet was opened for the sign-in first. */
  async function start(directions: Direction[]): Promise<boolean> {
    if (connected) {
      await run(directions);
      return true;
    }
    o.onOpen?.();
    await api.dvxOpen(directions[0]!);
    setWaiting(directions);
    return false;
  }
  useEffect(() => {
    if (waiting.length && connected) {
      setWaiting([]);
      void run(waiting);
    }
  }, [waiting, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  function cancel() {
    cancelled.current = true;
    if (current.current) setProgress(`${boxName(current.current)}: ləğv edilir…`);
    void api.dvxCancel();
  }

  return { connected, syncing, progress, cancelling: cancelled.current, start, cancel };
}
