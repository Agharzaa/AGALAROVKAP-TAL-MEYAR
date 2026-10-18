/**
 * DVX e-qaimə box (stage 4a; docs/MERHELE-4-EQAIME.md §3, §5, §8; QERARLAR 2026-10-15,
 * mərhələ 4).
 *
 * A loaded DVX report is kept as DVX wrote it: each e-qaimə once per direction + VÖEN + number,
 * so loading the same file again, or an overlapping period, changes nothing but what DVX itself
 * changed — the status (with history) and goods lines that arrive later. The file's direction is
 * proven by the company's own VÖEN; a file of the wrong direction or of another company is
 * refused as a whole. Nothing is booked here: booking (stage 4b) goes through invoice.save.
 */
import { createHash } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import { eqKind, eqStatus, type EqDirection, type EqStatus } from '../domain/eqaime.js';
import { displayMinor, formatMinor, parseMoney, type Minor } from '../domain/money.js';
import { numberKey, parseDate, parseText } from '../domain/values.js';
import type { CommandOf, CommandResult, EqDocumentInputDto } from '../contracts/commands.js';
import type {
  EqBucket,
  EqDocumentDetail,
  EqDocumentView,
  EqImportView,
  EqInboxView,
  EqLineView,
  EqProposal,
  EqReconcileView,
  HomeView,
} from '../contracts/queries.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import type { Tx } from './tx.js';
import { BOOKING_CONFLICT, eqContext, propose, type EqContext } from './eqaime-book.js';

const label = { purchase: 'Gələnlər (alış)', sale: 'Göndərilənlər (satış)' } as const;
const money = (m: Minor) => formatMinor(m);
/** Signed DVX amount; corrections may print negative differences. Empty is zero. */
const amount = (value: string, field: string): Minor => {
  const v = value.trim();
  if (!v) return 0n;
  return v.startsWith('-') ? -parseMoney(v.slice(1), field) : parseMoney(v, field);
};
/** Why an e-qaimə in this DVX status is not booked; empty when it may be. */
const dvxReason: Partial<Record<EqStatus, string>> = {
  cancelled: 'DVX: e-qaimə ləğv edilib',
  rejected: 'DVX: alıcı e-qaimədən imtina edib',
};

interface Staged {
  row: number;
  number: string;
  key: string;
  taxId: string;
  name: string;
  date: string;
  kind: ReturnType<typeof eqKind>;
  kindText: string;
  refKey: string;
  dvxStatus: string;
  status: EqStatus;
  net: Minor;
  vat: Minor;
  total: Minor;
  bases: [Minor, Minor, Minor, Minor];
  excise: Minor;
  roadTax: Minor;
  note: string;
  lines: string;
  hash: string;
}

/** The other side's VÖEN; the company's own VÖEN must sit on our side of the e-qaimə. */
function sides(d: EqDocumentInputDto, direction: EqDirection, own: string) {
  const ours = direction === 'purchase' ? d.buyerTaxId : d.sellerTaxId;
  const theirs = direction === 'purchase' ? d.sellerTaxId : d.buyerTaxId;
  return { ours: ours.replace(/\D/g, ''), theirs: theirs.replace(/\D/g, ''), own };
}

function stage(d: EqDocumentInputDto, direction: EqDirection, own: string, report: string): Staged {
  const where = `Sətir ${d.row}`;
  const number = parseText(d.number, `${where}: e-qaimə nömrəsi`, 60)
    .replace(/\s+/g, '')
    .toUpperCase();
  const date = parseDate(d.date, `${where}: tarix`);
  const { theirs } = sides(d, direction, own);
  const taxId = theirs || d.taxId.replace(/\D/g, '');
  if (!/^\d{10}$/.test(taxId))
    throw new DomainError(`${where}: kontragentin VÖEN-i yoxdur və ya 10 rəqəm deyil.`);
  if (taxId === own)
    throw new DomainError(`${where}: e-qaimədə kontragentin VÖEN-i şirkətin öz VÖEN-idir.`);
  const net = amount(d.net, `${where}: ƏDV-siz məbləğ`);
  const vat = amount(d.vat, `${where}: ƏDV`);
  const excise = amount(d.excise, `${where}: aksiz`);
  const roadTax = amount(d.roadTax, `${where}: yol vergisi`);
  const total = d.total.trim() ? amount(d.total, `${where}: yekun məbləğ`) : net + vat;
  let lines = '';
  if (d.lines?.length) {
    const parsed: EqLineView[] = d.lines.map((l, i) => {
      const w = `${where}, mal ${i + 1}`;
      return {
        code: parseText(l.code, `${w}: kod`, 80, false),
        name: parseText(l.name, `${w}: ad`, 500),
        unit: parseText(l.unit, `${w}: ölçü vahidi`, 40, false),
        quantity: l.quantity.trim(),
        price: l.price.trim(),
        net: money(amount(l.net, `${w}: dəyər`)),
        vat: money(amount(l.vat, `${w}: ƏDV`)),
        vatRate: l.vatRate.trim(),
      };
    });
    const sum = (pick: (l: EqLineView) => string) =>
      parsed.reduce((s, l) => s + amount(pick(l), ''), 0n);
    if (sum((l) => l.net) !== net || sum((l) => l.vat) !== vat)
      throw new DomainError(`${where}: mal sətirlərinin cəmi e-qaimənin məbləğinə bərabər deyil.`);
    lines = JSON.stringify(parsed);
  }
  const key = numberKey(number);
  return {
    row: d.row,
    number,
    key,
    taxId,
    name: parseText(
      d.name || (direction === 'purchase' ? d.sellerName : d.buyerName),
      `${where}: ad`,
      300,
      false,
    ),
    date,
    kind: eqKind(d.kind),
    kindText: parseText(d.kind, `${where}: növ`, 120, false),
    refKey: d.refNumber.trim() ? numberKey(d.refNumber) : '',
    dvxStatus: parseText(d.status, `${where}: status`, 120, false),
    status: eqStatus(d.status),
    net,
    vat,
    total,
    bases:
      report === 'invoices'
        ? [
            amount(d.base18, `${where}: ƏDV-yə cəlb edilən`),
            amount(d.base0, `${where}: 0 dərəcə`),
            amount(d.baseExempt, `${where}: ƏDV-dən azad`),
            amount(d.baseNontaxable, `${where}: ƏDV-yə cəlb edilməyən`),
          ]
        : [0n, 0n, 0n, 0n],
    excise,
    roadTax,
    note: parseText(d.note, `${where}: qeyd`, 1000, false),
    lines,
    // Only what both DVX reports print: date and amounts. A difference here is a conflict.
    hash: createHash('sha256')
      .update([date, money(net), money(vat)].join('|'))
      .digest('hex')
      .slice(0, 40),
  };
}

export function importEq(tx: Tx, cmd: CommandOf<'eqaime.import'>): CommandResult {
  const company = tx.company(cmd.companyId);
  const own = String(company.tax_id);
  const fileName = parseText(cmd.fileName, 'Fayl', 240);
  // A DVX export names the company it was taken for: another company's file is not loaded.
  const owner = cmd.fileOwnerTaxId?.replace(/\D/g, '') ?? '';
  if (owner && owner !== own)
    throw new DomainError(
      `Fayl VÖEN ${owner} şirkətinin DVX çıxarışıdır, bu şirkətin VÖEN-i isə ${own}. Fayl yüklənmədi.`,
      'fileOwnerTaxId',
    );
  if (cmd.fileDirection && cmd.fileDirection !== cmd.direction)
    throw new DomainError(
      `Fayl ${label[cmd.fileDirection]} hesabatıdır, siz isə ${label[cmd.direction]} seçmisiniz. Fayl yüklənmədi.`,
      'direction',
    );
  // The file proves its direction where it prints both sides: our VÖEN on our side, always.
  for (const d of cmd.documents) {
    const { ours, theirs } = sides(d, cmd.direction, own);
    if (!ours && !theirs) continue;
    if (ours === own) continue;
    throw new DomainError(
      theirs === own
        ? `Faylda şirkətin VÖEN-i (${own}) ${cmd.direction === 'purchase' ? 'satıcı' : 'alıcı'} yerindədir: bu ${label[cmd.direction === 'purchase' ? 'sale' : 'purchase']} faylıdır. Fayl yüklənmədi.`
        : `Sətir ${d.row}: e-qaimədə şirkətin VÖEN-i (${own}) yoxdur — fayl başqa şirkətindir. Fayl yüklənmədi.`,
      'documents',
    );
  }
  // A file that proves nothing about its direction is loaded only on the user's word
  // (QERARLAR 2026-10-16 §3).
  const proven =
    !!cmd.fileDirection || cmd.documents.some((d) => d.sellerTaxId.trim() || d.buyerTaxId.trim());
  if (!proven && !cmd.directionConfirmed)
    throw new DomainError(
      `Faylda istiqamət görünmür (başlıqda “Gələnlər / Göndərilənlər” yoxdur, satıcı və alıcı VÖEN-ləri yoxdur). İlkin baxışda bunun ${label[cmd.direction]} faylı olduğunu təsdiq edin.`,
      'directionConfirmed',
    );

  const rejected: { row: number; message: string }[] = [];
  const staged: Staged[] = [];
  const seen = new Set<string>();
  for (const d of cmd.documents) {
    try {
      const s = stage(d, cmd.direction, own, cmd.report);
      const k = `${s.taxId}|${s.key}`;
      if (seen.has(k))
        throw new DomainError(`Sətir ${d.row}: e-qaimə ${s.number} faylda ikinci dəfədir.`);
      seen.add(k);
      staged.push(s);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      rejected.push({ row: d.row, message: e.message });
    }
  }
  if (!staged.length) throw new DomainError('Faylda yüklənə bilən e-qaimə yoxdur.', 'documents');

  const importId = tx.id();
  const now = tx.clock.now();
  const dates = staged.map((s) => s.date).sort();
  tx.db.run(
    `INSERT INTO eq_imports(id,company_id,source,direction,report,file_name,file_hash,period_from,period_to,
       rows_read,imported_at,actor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    importId,
    cmd.companyId,
    cmd.source,
    cmd.direction,
    cmd.report,
    fileName,
    cmd.fileHash,
    dates[0]!,
    dates[dates.length - 1]!,
    cmd.documents.length,
    now,
    tx.ctx.actor,
  );
  const history = (docId: string, from: string, s: Staged) =>
    tx.db.run(
      'INSERT INTO eq_status_history VALUES(?,?,?,?,?,?,?)',
      cmd.companyId,
      docId,
      importId,
      now,
      from,
      s.status,
      s.dvxStatus,
    );
  let added = 0;
  let updated = 0;
  let same = 0;
  let conflicts = 0;
  for (const s of staged) {
    const old = tx.db.get(
      'SELECT * FROM eq_documents WHERE company_id=? AND direction=? AND tax_id=? AND eq_key=?',
      cmd.companyId,
      cmd.direction,
      s.taxId,
      s.key,
    );
    if (!old) {
      const id = tx.id();
      const reason = dvxReason[s.status] ?? '';
      tx.db.run(
        `INSERT INTO eq_documents(id,company_id,direction,eq_number,eq_key,tax_id,name,date,kind,kind_text,ref_key,
           dvx_status,status,net,vat,total,base_18,base_0,base_exempt,base_nontaxable,excise,road_tax,note,
           header_full,lines,content_hash,state,reason,first_import_id,last_import_id,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        cmd.companyId,
        cmd.direction,
        s.number,
        s.key,
        s.taxId,
        s.name,
        s.date,
        s.kind,
        s.kindText,
        s.refKey,
        s.dvxStatus,
        s.status,
        s.net,
        s.vat,
        s.total,
        ...s.bases,
        s.excise,
        s.roadTax,
        s.note,
        cmd.report === 'invoices' ? 1 : 0,
        s.lines,
        s.hash,
        reason ? 'ignored' : 'waiting',
        reason,
        importId,
        importId,
        now,
        now,
      );
      history(id, '', s);
      added++;
      continue;
    }
    const id = String(old.id);
    if (old.content_hash !== s.hash) {
      // DVX does not change an e-qaimə's amounts (a correction is a new e-qaimə): keep the stored
      // one untouched and say what came.
      const note = `${now.slice(0, 10)} · ${fileName}: tarix ${s.date}, ƏDV-siz ${money(s.net)}, ƏDV ${money(s.vat)} — uçotdakı: tarix ${String(old.date)}, ƏDV-siz ${money(old.net as bigint)}, ƏDV ${money(old.vat as bigint)}`;
      tx.db.run(
        "UPDATE eq_documents SET conflict=?, resolved='', updated_at=?, version=version+1 WHERE id=?",
        note,
        now,
        id,
      );
      tx.audit(cmd.companyId, 'Ziddiyyət', 'E-qaimə', id, `${s.number}: ${note}`);
      conflicts++;
      continue;
    }
    let changed = false;
    if (old.status !== s.status || old.dvx_status !== s.dvxStatus) {
      let state = String(old.state);
      let reason = String(old.reason);
      const cancel = dvxReason[s.status];
      if (cancel && state === 'waiting') {
        state = 'ignored';
        reason = cancel;
      } else if (!cancel && state === 'ignored' && Object.values(dvxReason).includes(reason)) {
        state = 'waiting';
        reason = '';
      }
      tx.db.run(
        "UPDATE eq_documents SET status=?, dvx_status=?, state=?, reason=?, resolved='' WHERE id=?",
        s.status,
        s.dvxStatus,
        state,
        reason,
        id,
      );
      history(id, String(old.status), s);
      tx.audit(
        cmd.companyId,
        'DVX statusu dəyişdi',
        'E-qaimə',
        id,
        `${s.number}: ${String(old.dvx_status) || '—'} → ${s.dvxStatus || '—'}`,
      );
      changed = true;
    }
    if (old.lines === '' && s.lines) {
      tx.db.run('UPDATE eq_documents SET lines=? WHERE id=?', s.lines, id);
      changed = true;
    }
    if (old.header_full === 0n && cmd.report === 'invoices') {
      tx.db.run(
        `UPDATE eq_documents SET kind=?, kind_text=?, ref_key=?, total=?, base_18=?, base_0=?, base_exempt=?,
           base_nontaxable=?, excise=?, road_tax=?, note=?, header_full=1 WHERE id=?`,
        s.kind,
        s.kindText,
        s.refKey,
        s.total,
        ...s.bases,
        s.excise,
        s.roadTax,
        s.note,
        id,
      );
      // Booked from the goods report alone, as an ordinary e-qaimə: DVX now says it is not one
      // (a correction booked beside its original, a return, an advance, excise or road tax).
      if (old.state === 'posted' && (s.kind !== 'main' || s.excise || s.roadTax)) {
        const note = `${BOOKING_CONFLICT}${now.slice(0, 10)} · ${fileName}: adi e-qaimə kimi uçota alınıb, DVX-də isə ${s.kindText || s.kind}${s.excise || s.roadTax ? ' (aksiz / yol vergisi ilə)' : ''}`;
        tx.db.run(
          "UPDATE eq_documents SET conflict=CASE WHEN conflict='' THEN ? ELSE conflict END, resolved='' WHERE id=?",
          note,
          id,
        );
        tx.audit(cmd.companyId, 'Ziddiyyət', 'E-qaimə', id, `${s.number}: ${note}`);
        conflicts++;
      }
      changed = true;
    }
    if (changed) {
      tx.db.run(
        'UPDATE eq_documents SET last_import_id=?, updated_at=?, version=version+1 WHERE id=?',
        importId,
        now,
        id,
      );
      updated++;
    } else same++;
  }
  tx.db.run(
    'UPDATE eq_imports SET added=?, updated=?, same=?, conflicts=? WHERE id=?',
    added,
    updated,
    same,
    conflicts,
    importId,
  );
  tx.audit(
    cmd.companyId,
    'E-qaimələr yükləndi',
    'DVX',
    importId,
    `${fileName} · ${label[cmd.direction]} · ${dates[0]}–${dates[dates.length - 1]} · yeni ${added}, yenilənən ${updated}, dəyişməyən ${same}, ziddiyyət ${conflicts}, rədd ${rejected.length}`,
  );
  return { id: importId, added, updated, same, conflicts, rejected };
}

function document(tx: Tx, companyId: string, id: string): Row {
  const r = tx.db.get('SELECT * FROM eq_documents WHERE company_id=? AND id=?', companyId, id);
  if (!r) throw new DomainError('E-qaimə tapılmadı.', 'documentId', 'not-found');
  return r;
}

export function ignoreEq(tx: Tx, cmd: CommandOf<'eqaime.ignore'>): CommandResult {
  tx.company(cmd.companyId);
  const r = document(tx, cmd.companyId, cmd.documentId);
  const reason = parseText(cmd.reason, 'Səbəb');
  if (r.state !== 'waiting')
    throw new DomainError(
      r.state === 'posted'
        ? 'E-qaimə uçota alınıb; əvvəlcə qaiməni ləğv edin.'
        : 'E-qaimə artıq kənara qoyulub.',
      undefined,
      'conflict',
    );
  tx.db.run(
    "UPDATE eq_documents SET state='ignored', reason=?, version=version+1, updated_at=? WHERE id=?",
    reason,
    tx.clock.now(),
    cmd.documentId,
  );
  tx.audit(
    cmd.companyId,
    'Kənara qoyuldu',
    'E-qaimə',
    cmd.documentId,
    `${String(r.eq_number)} · ${reason}`,
  );
  return { id: cmd.documentId };
}

/**
 * Settles a conflict the books cannot follow (QERARLAR 2026-10-16 §2): a booking in a closed
 * period whose reversal the accountant made in the open one, or other amounts from DVX the
 * accountant reviewed. A booked e-qaimə DVX cancelled in an open period is settled by cancelling
 * its invoice, not by a note.
 */
export function resolveEq(tx: Tx, cmd: CommandOf<'eqaime.resolve'>): CommandResult {
  const company = tx.company(cmd.companyId);
  const r = document(tx, cmd.companyId, cmd.documentId);
  const note = parseText(cmd.note, 'Qeyd');
  if (!flagged(r) || r.resolved !== '')
    throw new DomainError('E-qaimədə açıq ziddiyyət yoxdur.', undefined, 'conflict');
  const closed = String(company.closed_through);
  const invoice = r.invoice_id
    ? tx.db.get(
        'SELECT date FROM invoices WHERE company_id=? AND id=?',
        cmd.companyId,
        String(r.invoice_id),
      )
    : undefined;
  const inClosed = String(invoice?.date ?? r.date) <= closed;
  if (r.conflict === '' && !inClosed)
    throw new DomainError(
      'Qaimə açıq dövrdədir: əvvəlcə qaiməni ləğv edin və ya düzəldin.',
      undefined,
      'conflict',
    );
  const resolved = `${tx.clock.now().slice(0, 10)} · ${tx.ctx.actor}: ${note}`;
  tx.db.run(
    'UPDATE eq_documents SET resolved=?, version=version+1, updated_at=? WHERE id=?',
    resolved,
    tx.clock.now(),
    cmd.documentId,
  );
  tx.audit(
    cmd.companyId,
    'Ziddiyyət qəbul edildi',
    'E-qaimə',
    cmd.documentId,
    `${String(r.eq_number)} · ${note}`,
  );
  return { id: cmd.documentId };
}

export function restoreEq(tx: Tx, cmd: CommandOf<'eqaime.restore'>): CommandResult {
  tx.company(cmd.companyId);
  const r = document(tx, cmd.companyId, cmd.documentId);
  if (r.state !== 'ignored')
    throw new DomainError('E-qaimə kənara qoyulmayıb.', undefined, 'conflict');
  const cancel = dvxReason[r.status as EqStatus];
  if (cancel) throw new DomainError(`${cancel}; uçota alına bilməz.`, undefined, 'conflict');
  // Set aside by DVX itself (e.g. replaced by its correction), not by the accountant.
  if (String(r.reason).startsWith('DVX:'))
    throw new DomainError(`${String(r.reason)}; geri qaytarılmır.`, undefined, 'conflict');
  tx.db.run(
    "UPDATE eq_documents SET state='waiting', reason='', version=version+1, updated_at=? WHERE id=?",
    tx.clock.now(),
    cmd.documentId,
  );
  tx.audit(cmd.companyId, 'Geri qaytarıldı', 'E-qaimə', cmd.documentId, String(r.eq_number));
  return { id: cmd.documentId };
}

// ---------------------------------------------------------------------------------------------
// Queries

/**
 * A conflict: other amounts came for a known e-qaimə, or it is in the books while DVX no longer
 * shows it accepted (cancelled, corrected, waiting, unknown).
 */
const flagged = (r: Row) =>
  r.conflict !== '' || (r.state === 'posted' && (r.status as EqStatus) !== 'accepted');

export function eqBucket(r: Row, proposal: EqProposal | null): EqBucket {
  const status = r.status as EqStatus;
  // Until the accountant settles it (QERARLAR 2026-10-16 §2).
  if (flagged(r) && r.resolved === '') return 'conflict';
  if (r.state === 'posted') return r.posted_by === 'auto' ? 'auto' : 'posted';
  if (r.state === 'ignored') return 'ignored';
  if (status !== 'accepted') return 'dvx';
  return proposal?.state === 'unknown' ? 'unknown' : 'proposal';
}

function view(r: Row, invoiceNumber: string, ctx: EqContext | null): EqDocumentView {
  const lines = String(r.lines);
  const proposal = ctx && r.state === 'waiting' && r.status === 'accepted' ? propose(ctx, r) : null;
  return {
    id: String(r.id),
    direction: r.direction as EqDirection,
    number: String(r.eq_number),
    date: String(r.date),
    taxId: String(r.tax_id),
    name: String(r.name),
    kind: r.kind as EqDocumentView['kind'],
    kindText: String(r.kind_text),
    refNumber: String(r.ref_key),
    status: r.status as EqStatus,
    dvxStatus: String(r.dvx_status),
    net: money(r.net as bigint),
    vat: money(r.vat as bigint),
    total: money(r.total as bigint),
    lineCount: lines ? (JSON.parse(lines) as unknown[]).length : 0,
    bucket: eqBucket(r, proposal),
    state: r.state as EqDocumentView['state'],
    invoiceId: r.invoice_id ? String(r.invoice_id) : '',
    invoiceNumber,
    conflict: String(r.conflict),
    resolved: String(r.resolved),
    reason: String(r.reason),
    autoNote: String(r.auto_note),
    proposal,
  };
}

export function eqImports(db: Db, companyId: string, direction: EqDirection): EqImportView[] {
  return db
    .all(
      'SELECT * FROM eq_imports WHERE company_id=? AND direction=? ORDER BY imported_at DESC, rowid DESC LIMIT 200',
      companyId,
      direction,
    )
    .map((r) => ({
      id: String(r.id),
      source: r.source as EqImportView['source'],
      direction: r.direction as EqDirection,
      report: r.report as EqImportView['report'],
      fileName: String(r.file_name),
      from: String(r.period_from),
      to: String(r.period_to),
      importedAt: String(r.imported_at),
      rowsRead: Number(r.rows_read),
      added: Number(r.added),
      updated: Number(r.updated),
      same: Number(r.same),
      conflicts: Number(r.conflicts),
    }));
}

export function eqInbox(
  db: Db,
  companyId: string,
  direction: EqDirection,
  from: string,
  to: string,
): EqInboxView {
  const rows = db.all(
    `SELECT d.*, COALESCE(i.number,'') AS invoice_number FROM eq_documents d
       LEFT JOIN invoices i ON i.company_id=d.company_id AND i.id=d.invoice_id
     WHERE d.company_id=? AND d.direction=?${from ? ' AND d.date>=?' : ''}${to ? ' AND d.date<=?' : ''}
     ORDER BY d.date, d.eq_key`,
    companyId,
    direction,
    ...(from ? [from] : []),
    ...(to ? [to] : []),
  );
  const ctx = eqContext(db, companyId, direction);
  const counts: Record<EqBucket, number> = {
    proposal: 0,
    unknown: 0,
    dvx: 0,
    conflict: 0,
    auto: 0,
    posted: 0,
    ignored: 0,
  };
  const documents = rows.map((r) => {
    const v = view(r, String(r.invoice_number), ctx);
    counts[v.bucket]++;
    return v;
  });
  return { documents, counts };
}

export function eqDocument(db: Db, companyId: string, id: string): EqDocumentDetail {
  const r = db.get(
    `SELECT d.*, COALESCE(i.number,'') AS invoice_number FROM eq_documents d
       LEFT JOIN invoices i ON i.company_id=d.company_id AND i.id=d.invoice_id
     WHERE d.company_id=? AND d.id=?`,
    companyId,
    id,
  );
  if (!r) throw new DomainError('E-qaimə tapılmadı.', 'id', 'not-found');
  const lines = String(r.lines);
  return {
    ...view(r, String(r.invoice_number), eqContext(db, companyId, r.direction as EqDirection)),
    base18: money(r.base_18 as bigint),
    base0: money(r.base_0 as bigint),
    baseExempt: money(r.base_exempt as bigint),
    baseNontaxable: money(r.base_nontaxable as bigint),
    excise: money(r.excise as bigint),
    roadTax: money(r.road_tax as bigint),
    note: String(r.note),
    lines: lines ? (JSON.parse(lines) as EqLineView[]) : [],
    history: db
      .all(
        `SELECT h.at, h.dvx_status, m.file_name, m.period_from, m.period_to FROM eq_status_history h
           JOIN eq_imports m ON m.company_id=h.company_id AND m.id=h.import_id
         WHERE h.company_id=? AND h.document_id=? ORDER BY h.rowid`,
        companyId,
        id,
      )
      .map((h) => ({
        at: String(h.at),
        fileName: String(h.file_name),
        from: String(h.period_from),
        to: String(h.period_to),
        dvxStatus: String(h.dvx_status),
      })),
    version: Number(r.version),
  };
}

// ---------------------------------------------------------------------------------------------
// DVX ↔ books (stage 4c; docs/MERHELE-4-EQAIME.md §8.5)

const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Loaded DVX periods of a direction, merged where they touch or overlap. */
function coverage(db: Db, companyId: string, direction: EqDirection) {
  const out: { from: string; to: string }[] = [];
  for (const r of db.all(
    'SELECT period_from, period_to FROM eq_imports WHERE company_id=? AND direction=? ORDER BY period_from',
    companyId,
    direction,
  )) {
    const from = String(r.period_from);
    const to = String(r.period_to);
    const last = out[out.length - 1];
    if (last && from <= nextDay(last.to)) {
      if (to > last.to) last.to = to;
    } else out.push({ from, to });
  }
  return out;
}

/** VAT of an invoice in AZN, as its stored lines carry it. */
const invoiceVat = (lines: string) =>
  (JSON.parse(lines) as { vatAzn?: string }[]).reduce((s, l) => {
    const v = l.vatAzn ?? '';
    return s + (v ? (v.startsWith('-') ? -parseMoney(v.slice(1)) : parseMoney(v)) : 0n);
  }, 0n);

export function eqReconcile(
  db: Db,
  companyId: string,
  direction: EqDirection,
  from: string,
  to: string,
): EqReconcileView {
  const covered = coverage(db, companyId, direction);
  const inCovered = (d: string) => covered.some((c) => d >= c.from && d <= c.to);
  const months = new Map<string, { dc: number; dn: bigint; dv: bigint; bc: number; bv: bigint }>();
  const month = (d: string) => {
    const m = d.slice(0, 7);
    let x = months.get(m);
    if (!x) months.set(m, (x = { dc: 0, dn: 0n, dv: 0n, bc: 0, bv: 0n }));
    return x;
  };
  const notBooked: EqReconcileView['notBooked'] = [];
  // An e-qaimə replaced by its correction is no longer DVX's word (whatever its status says).
  const replaced = new Set(
    db
      .all(
        `SELECT tax_id, ref_key FROM eq_documents WHERE company_id=? AND direction=? AND kind='correction'
           AND status='accepted' AND ref_key<>''`,
        companyId,
        direction,
      )
      .map((r) => `${String(r.tax_id)}|${String(r.ref_key)}`),
  );
  // A correction belongs to the period of the e-qaimə it corrects (QERARLAR 2026-10-16 §1): the
  // books change that invoice on its own date, so DVX's side is counted there too.
  for (const d of db.all(
    `SELECT d.id, d.eq_number, d.eq_key, d.date, d.name, d.tax_id, d.net, d.vat, d.total, d.status, d.kind,
       d.state, COALESCE(o.date, d.date) AS period
     FROM eq_documents d
       LEFT JOIN eq_documents o ON d.kind='correction' AND d.ref_key<>'' AND o.company_id=d.company_id
         AND o.direction=d.direction AND o.tax_id=d.tax_id AND o.eq_key=d.ref_key
     WHERE d.company_id=? AND d.direction=? AND COALESCE(o.date, d.date) BETWEEN ? AND ?
     ORDER BY d.date, d.eq_key`,
    companyId,
    direction,
    from,
    to,
  )) {
    if (d.status !== 'accepted' || (d.kind !== 'main' && d.kind !== 'correction')) continue;
    if (d.kind === 'main' && replaced.has(`${String(d.tax_id)}|${String(d.eq_key)}`)) continue;
    const m = month(String(d.period));
    m.dc++;
    m.dn += d.net as bigint;
    m.dv += d.vat as bigint;
    if (d.state === 'waiting')
      notBooked.push({
        id: String(d.id),
        number: String(d.eq_number),
        date: String(d.date),
        name: String(d.name),
        taxId: String(d.tax_id),
        vat: money(d.vat as bigint),
        total: money(d.total as bigint),
      });
  }
  const notInDvx: EqReconcileView['notInDvx'] = [];
  const withoutEq: EqReconcileView['withoutEq'] = [];
  for (const i of db.all(
    `SELECT i.id, i.number, i.eq_number, i.eq_key, i.date, i.lines, i.total_azn, p.name AS partner,
       EXISTS(SELECT 1 FROM eq_documents d WHERE d.company_id=i.company_id AND d.invoice_id=i.id) AS bound,
       EXISTS(SELECT 1 FROM eq_documents d WHERE d.company_id=i.company_id AND d.direction=i.direction
         AND d.tax_id=p.tax_id AND d.eq_key=i.eq_key AND i.eq_key<>'') AS known
     FROM invoices i JOIN partners p ON p.company_id=i.company_id AND p.id=i.partner_id
     WHERE i.company_id=? AND i.direction=? AND i.status='posted' AND i.date BETWEEN ? AND ?
     ORDER BY i.date, i.number_key`,
    companyId,
    direction,
    from,
    to,
  )) {
    const vat = invoiceVat(String(i.lines));
    // Only invoices that carry an e-qaimə are compared with DVX (QERARLAR 2026-10-16 §4): sales to
    // individuals have none; numberless invoices are listed apart.
    if (i.bound === 1n || i.eq_key) {
      const m = month(String(i.date));
      m.bc++;
      m.bv += vat;
    }
    if (i.bound === 1n) continue;
    const row = {
      id: String(i.id),
      number: String(i.number),
      date: String(i.date),
      partner: String(i.partner),
      vat: money(vat),
      total: money(i.total_azn as bigint),
    };
    if (!i.eq_key) withoutEq.push(row);
    else if (i.known !== 1n && inCovered(String(i.date)))
      notInDvx.push({ ...row, eqNumber: String(i.eq_number) });
  }
  return {
    covered,
    months: [...months]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, x]) => ({
        month: m,
        dvxCount: x.dc,
        dvxNet: money(x.dn),
        dvxVat: money(x.dv),
        bookedCount: x.bc,
        bookedVat: money(x.bv),
        difference: money(x.dv - x.bv),
      })),
    notBooked,
    notInDvx,
    withoutEq,
  };
}

/**
 * İş masası signals of the e-qaimə boxes (open period only; a closed period is past change). The
 * month closing reads them up to the month's end (`today` = `to` = the last day).
 */
export function eqWarnings(
  db: Db,
  companyId: string,
  closed: string,
  today: string,
  to = '9999-12-31',
): HomeView['warnings'] {
  const out: HomeView['warnings'] = [];
  const from = closed ? nextDay(closed) : '2000-01-01';
  for (const direction of ['purchase', 'sale'] as const) {
    const box = direction === 'purchase' ? 'Alınan' : 'Göndərilən';
    const push = (kind: HomeView['warnings'][number]['kind'], text: string) =>
      out.push({ kind, text: `${box} e-qaimələr: ${text}`, account: '', sk: [], eq: direction });
    // Every open conflict, also in a closed period (QERARLAR 2026-10-16 §2): there it is settled
    // by a reversal in the open period and "Qəbul et" in the box.
    const conflicts = db.get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(date<=?),0) AS closed FROM eq_documents WHERE company_id=? AND direction=?
         AND resolved='' AND (conflict<>'' OR (state='posted' AND status<>'accepted'))`,
      closed,
      companyId,
      direction,
    )!;
    if (conflicts.n)
      push(
        'eqConflict',
        `${String(conflicts.n)} ziddiyyət — uçotda var, amma DVX-də ləğv, düzəliş edilib və ya təsdiqlənmiş görünmür, ya da fərqli məbləğlə gəlib${conflicts.closed ? ` (${String(conflicts.closed)} bağlı dövrdə: açıq dövrdə əks yazılışla düzəldib qutuda “Qəbul et”)` : ''}.`,
      );
    const waiting = db.get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(vat),0) AS vat FROM eq_documents WHERE company_id=? AND direction=?
         AND date BETWEEN ? AND ? AND state='waiting' AND status='accepted'
         -- An e-qaimə replaced by its correction is not DVX's word any more (as in eqReconcile).
         AND NOT (kind='main' AND EXISTS(SELECT 1 FROM eq_documents c WHERE c.company_id=eq_documents.company_id
           AND c.direction=eq_documents.direction AND c.tax_id=eq_documents.tax_id
           AND c.ref_key=eq_documents.eq_key AND c.kind='correction' AND c.status='accepted'))`,
      companyId,
      direction,
      from,
      to,
    )!;
    if (waiting.n)
      push(
        'eqWaiting',
        `${String(waiting.n)} e-qaimə DVX-də təsdiqlənib, uçota alınmayıb (ƏDV ${displayMinor(waiting.vat as bigint)}).`,
      );
    const r = eqReconcile(db, companyId, direction, from, today);
    const show = (v: string) =>
      displayMinor(v.startsWith('-') ? -parseMoney(v.slice(1)) : parseMoney(v));
    for (const m of r.months)
      if (
        m.difference !== '0.00' &&
        r.covered.some((c) => c.from.slice(0, 7) <= m.month && c.to.slice(0, 7) >= m.month)
      )
        push(
          'eqVat',
          `${m.month}: ƏDV DVX-də ${show(m.dvxVat)}, uçotdakı qaimələrdə ${show(m.bookedVat)} — fərq ${show(m.difference)}.`,
        );
    if (r.notInDvx.length)
      push(
        'eqMissing',
        `${r.notInDvx.length} qaimənin e-qaimə nömrəsi yüklənmiş DVX fayllarında yoxdur (${r.notInDvx
          .slice(0, 3)
          .map((x) => `${x.number} · ${x.eqNumber}`)
          .join(', ')}${r.notInDvx.length > 3 ? '…' : ''}).`,
      );
  }
  return out;
}
