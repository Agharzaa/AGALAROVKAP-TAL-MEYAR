/**
 * DVX e-qaimə box (stages 4a–4b; docs/MERHELE-4-EQAIME.md §8). Load an e-taxes.gov.az export
 * ("Qaimələr üzrə" or "Mallar üzrə"), see what was read and which direction the file is before
 * anything is stored, then go through the e-qaimələr by where they stand: confirmed map entries
 * book by themselves, the rest open as an invoice prefilled from the e-qaimə (Enter, then
 * Ctrl+Enter), an invoice typed by hand is linked instead of booked twice.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from '../icons';
import { readEqTable, type EqReadResult } from '../../domain/eqaime';
import type {
  EqReconcileView,
  InvoiceDetail,
  EqBucket,
  EqDocumentDetail,
  EqDocumentView,
  EqImportView,
  EqInboxView,
} from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { addAmounts, day, money, qty } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages } from '../pages';
import { readSheet, SheetError } from '../sheet-reader';
import { Amount, Confirm, DataTable, Empty, Field, Modal, Notice, type Column } from '../ui';
import { api } from '../api';
import { useWindow, useWorkspace } from '../workspace';

type Direction = 'sale' | 'purchase';
const tabs: { id: EqBucket; label: string }[] = [
  { id: 'proposal', label: 'Təklif' },
  { id: 'unknown', label: 'Naməlum' },
  { id: 'dvx', label: 'DVX-də gözləyir' },
  { id: 'conflict', label: 'Ziddiyyət' },
  { id: 'auto', label: 'Avtomatik' },
  { id: 'posted', label: 'Uçota alınıb' },
  { id: 'ignored', label: 'Kənar qoyulub' },
];
const directionLabel = { purchase: 'Gələnlər (alış)', sale: 'Göndərilənlər (satış)' } as const;
const statusLabel: Record<EqDocumentView['status'], string> = {
  accepted: 'təsdiqlənib',
  pending: 'gözləyir',
  cancelled: 'ləğv edilib',
  corrected: 'düzəliş edilib',
  rejected: 'imtina edilib',
  unknown: 'naməlum status',
};

interface Preview {
  fileName: string;
  hash: string;
  /** file: chosen on disk; portal: exported in the DVX cabinet window. */
  source: 'file' | 'portal';
  read: EqReadResult;
}

/** The box (window) that last opened the DVX cabinet: the cabinet's exports go there only. */
let cabinetBox = '';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function EqaimePage({ direction }: { direction: Direction }) {
  const win = useWindow();
  const ws = useWorkspace();
  const { company } = useCatalog(win.companyId);
  const page = pages[direction === 'purchase' ? 'eqPurchase' : 'eqSale'];
  const box = useQuery<EqInboxView>({
    type: 'eqInbox',
    companyId: win.companyId,
    direction,
    from: '',
    to: '',
  });
  const imports = useQuery<EqImportView[]>({
    type: 'eqImports',
    companyId: win.companyId,
    direction,
  });
  const [tab, setTab] = useState<EqBucket>('proposal');
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [partnersOpen, setPartnersOpen] = useState(false);
  const [withContracts, setWithContracts] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => setConfirmed(false), [preview]);
  const [readError, setReadError] = useState('');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState<string>('');
  const [ignore, setIgnore] = useState<EqDocumentView | null>(null);
  const [settle, setSettle] = useState<EqDocumentView | null>(null);
  const [reason, setReason] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const m = useMutation();
  const detail = useQuery<EqDocumentDetail>(
    open ? { type: 'eqDocument', companyId: win.companyId, id: open } : null,
  );

  async function choose(f: File) {
    await read(f.name, new Uint8Array(await f.arrayBuffer()), 'file');
  }
  async function read(name: string, bytes: Uint8Array, source: Preview['source']) {
    setReadError('');
    setMessage('');
    m.clear();
    try {
      const read = readEqTable(await readSheet(name, bytes), name);
      if (!read.documents.length)
        setReadError(read.problems[0]?.message ?? 'Faylda e-qaimə tapılmadı.');
      else setPreview({ fileName: name, hash: await sha256(bytes), read, source });
    } catch (e) {
      setReadError(e instanceof SheetError ? e.message : `Fayl oxunmadı: ${(e as Error).message}`);
    }
  }

  // Exports made in the DVX cabinet window come, as a preview, only to the box that opened it:
  // boxes of other companies (or the other direction) may be open at the same time.
  useEffect(
    () =>
      api.onDvxFile((f) => {
        if (cabinetBox === win.id && f.direction === direction)
          void read(f.name, f.bytes, 'portal');
      }),
    [direction, win.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(
    () =>
      api.onDvxRefused((message) => {
        if (cabinetBox === win.id) setReadError(message);
      }),
    [win.id],
  );
  async function openCabinet() {
    setReadError('');
    cabinetBox = win.id;
    try {
      await api.dvxOpen(direction);
      setMessage(
        'DVX kabineti ayrıca pəncərədə açıldı. Daxil olun (ASAN İmza, SİMA və ya PIN — Meyar onları görmür), e-qaimələr → ' +
          (direction === 'purchase' ? 'Gələnlər' : 'Göndərilənlər') +
          ' → dövr → Excel-ə ixrac. Fayl burada ilkin baxışda görünəcək. Pəncərəni bağlayanda sessiya silinir.',
      );
    } catch (e) {
      setReadError((e as Error).message);
    }
  }

  async function load() {
    if (!preview?.read.report) return;
    const r = await m.run({
      type: 'eqaime.import',
      companyId: win.companyId,
      direction,
      ...(preview.read.directionHint ? { fileDirection: preview.read.directionHint } : {}),
      ...(preview.read.ownerTaxId ? { fileOwnerTaxId: preview.read.ownerTaxId } : {}),
      directionConfirmed: confirmed,
      report: preview.read.report,
      source: preview.source,
      fileName: preview.fileName,
      fileHash: preview.hash,
      documents: preview.read.documents,
    });
    if (!r) return;
    setPreview(null);
    setMessage(
      `Yükləndi: yeni ${r.added ?? 0} e-qaimə` +
        (r.updated ? `, ${r.updated} e-qaimənin DVX statusu və ya sətirləri yeniləndi` : '') +
        (r.same ? `, ${r.same} dəyişməyib (təkrar yaradılmadı)` : '') +
        (r.conflicts ? `, ${r.conflicts} ziddiyyət (bax “Ziddiyyət”)` : '') +
        (r.rejected?.length ? `, ${r.rejected.length} sətir qəbul olunmadı` : '') +
        (r.posted
          ? `. ${r.posted} e-qaimə təsdiqlənmiş uyğunluqlarla avtomatik uçota alındı və ya əl ilə yazılmış qaiməyə bağlandı`
          : '. Heç nə avtomatik uçota alınmayıb') +
        (r.failed?.length ? `; ${r.failed.length} alınmadı (səbəb sətirdə)` : '') +
        '.',
    );
    imports.reload();
  }

  const docs = box.data?.documents;
  const rows = useMemo(() => (docs ?? []).filter((d) => d.bucket === tab), [docs, tab]);
  async function restore(d: EqDocumentView) {
    const r = await m.run({ type: 'eqaime.restore', companyId: win.companyId, documentId: d.id });
    if (r) setMessage(`${d.number} geri qaytarıldı.`);
  }
  /** A correction of a booked e-qaimə opens that invoice, with the correction's lines. */
  const book = (d: EqDocumentView) =>
    ws.open(
      d.proposal?.corrects?.invoiceId
        ? { type: 'invoice', direction, id: d.proposal.corrects.invoiceId, eqDocumentId: d.id }
        : { type: 'invoice', direction, eqDocumentId: d.id },
      win.companyId,
    );
  /** DVX cancelled (or the buyer rejected) a booked e-qaimə: its invoice is cancelled by storno. */
  async function cancelInvoice(d: EqDocumentView) {
    setMessage('');
    let version: number;
    try {
      version = (
        await api.query<InvoiceDetail>({
          type: 'invoice',
          companyId: win.companyId,
          id: d.invoiceId,
        })
      ).version;
    } catch (e) {
      setMessage((e as Error).message);
      return;
    }
    const r = await m.run({
      type: 'invoice.cancel',
      companyId: win.companyId,
      id: d.invoiceId,
      version,
      reason: `DVX-də ${statusLabel[d.status]} (e-qaimə ${d.number})`,
    });
    if (r) setMessage(`${d.invoiceNumber} storno ilə ləğv edildi; ${d.number} kənara qoyuldu.`);
  }
  const openInvoice = (d: EqDocumentView) =>
    ws.open({ type: 'invoice', direction, id: d.invoiceId }, win.companyId);
  async function link(d: EqDocumentView, invoiceId: string, number: string) {
    const r = await m.run({
      type: 'eqaime.link',
      companyId: win.companyId,
      documentId: d.id,
      invoiceId,
    });
    if (r)
      setMessage(`${d.number} əl ilə yazılmış ${number} qaiməsinə bağlandı; yazılışlar dəyişmədi.`);
  }
  async function apply() {
    const r = await m.run({ type: 'eqaime.apply', companyId: win.companyId, direction });
    if (r)
      setMessage(
        r.posted || r.failed?.length
          ? `Avtomatik uçota alındı / bağlandı: ${r.posted ?? 0}${r.failed?.length ? `; alınmadı: ${r.failed.length} (səbəb sətirdə)` : ''}.`
          : 'Təsdiqlənmiş uyğunluqlarla uçota alına bilən e-qaimə yoxdur.',
      );
  }
  /** Undoing an automatic booking: the invoice is cancelled (storno), the e-qaimə waits. */
  async function undo(d: EqDocumentView) {
    setMessage('');
    let version: number;
    try {
      version = (
        await api.query<InvoiceDetail>({
          type: 'invoice',
          companyId: win.companyId,
          id: d.invoiceId,
        })
      ).version;
    } catch (e) {
      setMessage((e as Error).message);
      return;
    }
    const r = await m.run({
      type: 'invoice.cancel',
      companyId: win.companyId,
      id: d.invoiceId,
      version,
      reason: `Avtomatik uçot geri qaytarıldı (e-qaimə ${d.number})`,
    });
    if (r) setMessage(`${d.invoiceNumber} storno edildi; ${d.number} sizi gözləyir.`);
  }
  const ready = (docs ?? []).filter((d) => d.proposal?.state === 'auto').length;
  // Partners DVX names that the catalog lacks, and known partners without a contract of this kind.
  const newPartners = new Set(
    (docs ?? []).flatMap((d) => (d.proposal?.newPartner ? [d.proposal.newPartner.taxId] : [])),
  ).size;
  const noContract = new Set(
    (docs ?? [])
      .filter((d) =>
        d.proposal?.reasons.some((r) => /aktiv (alış|satış) müqaviləsi yoxdur/.test(r)),
      )
      .map((d) => d.taxId),
  ).size;
  async function createPartners() {
    const r = await m.run({
      type: 'eqaime.partners',
      companyId: win.companyId,
      direction,
      contracts: withContracts,
    });
    if (r) {
      setPartnersOpen(false);
      setMessage(
        `Yaradıldı: ${r.partners ?? 0} kontragent${withContracts ? `, ${r.contracts ?? 0} “Əsas” müqavilə` : ''}. Nömrə və tarixi sonra “Kontragentlər və müqavilələr”də düzəldə bilərsiniz.`,
      );
    }
  }

  const columns: Column<EqDocumentView>[] = [
    { key: 'date', label: 'Tarix', render: (d) => day(d.date) },
    { key: 'number', label: 'E-qaimə', className: 'nowrap', render: (d) => d.number },
    {
      key: 'who',
      label: direction === 'purchase' ? 'Satıcı' : 'Alıcı',
      className: 'clip',
      render: (d) => (
        <span title={`${d.name} · VÖEN ${d.taxId}`}>
          {d.name || '—'} <small>· {d.taxId}</small>
        </span>
      ),
    },
    { key: 'net', label: 'ƏDV-siz', align: 'end', render: (d) => <Amount value={d.net} /> },
    { key: 'vat', label: 'ƏDV', align: 'end', render: (d) => <Amount value={d.vat} /> },
    { key: 'total', label: 'Cəmi', align: 'end', render: (d) => <Amount value={d.total} strong /> },
    {
      key: 'dvx',
      label: 'DVX',
      className: 'clip',
      render: (d) => (
        <span title={d.dvxStatus}>
          {statusLabel[d.status]}
          {d.kind !== 'main' && <small> · {d.kindText}</small>}
        </span>
      ),
    },
    {
      key: 'what',
      label:
        tab === 'posted' || tab === 'auto'
          ? 'Qaimə'
          : tab === 'proposal' || tab === 'unknown'
            ? 'Nə tanındı / nə lazımdır'
            : 'Səbəb',
      className: 'clip',
      render: (d) =>
        d.bucket === 'posted' || d.bucket === 'auto' ? (
          <span>
            <button type="button" className="link" onClick={() => openInvoice(d)}>
              {d.invoiceNumber}
            </button>
            {d.bucket === 'auto' && <small> · təsdiqlənmiş uyğunluqlarla</small>}
            {d.resolved && (
              <small title={d.resolved}> · ziddiyyət qəbul edilib: {d.resolved}</small>
            )}
          </span>
        ) : d.bucket === 'conflict' ? (
          <span title={d.conflict}>
            <b className="chip chip-bad">Ziddiyyət</b>{' '}
            {d.conflict || `DVX-də ${statusLabel[d.status]}, uçotda ${d.invoiceNumber}`}
          </span>
        ) : d.bucket === 'ignored' ? (
          <span title={d.reason}>{d.reason}</span>
        ) : d.proposal ? (
          <span title={[d.autoNote, ...d.proposal.reasons].filter(Boolean).join('\n')}>
            {d.autoNote ? (
              <b className="chip chip-bad">Alınmadı</b>
            ) : d.proposal.state === 'auto' ? (
              <b className="chip chip-ok">Hazır</b>
            ) : null}{' '}
            {d.proposal.reasons[0] ??
              (d.proposal.state === 'auto' ? 'Avtomatik uçota hazırdır' : '')}
            {d.proposal.reasons.length > 1 && <small> (+{d.proposal.reasons.length - 1})</small>}
          </span>
        ) : (
          <small>{d.lineCount ? `${d.lineCount} mal sətri` : 'yalnız yekunlar'}</small>
        ),
    },
    {
      key: 'actions',
      label: 'Əməliyyat',
      className: 'nowrap',
      render: (d) =>
        d.state === 'waiting' ? (
          <>
            {[
              ...(d.proposal?.sameNumber ? [d.proposal.sameNumber] : []),
              ...(d.proposal?.candidates ?? []),
            ].map((c) => (
              <button
                key={c.id}
                type="button"
                className="button secondary small"
                disabled={m.busy}
                onClick={() => void link(d, c.id, c.number)}
              >
                Bağla: {c.number}
              </button>
            ))}
            {d.status === 'accepted' && (
              <button
                type="button"
                className="button primary small"
                aria-label={`${d.number}: uçota al`}
                onClick={() => book(d)}
              >
                Uçota al
              </button>
            )}
            <button
              type="button"
              className="button secondary small"
              aria-label={`${d.number}: kənara qoy`}
              onClick={() => (setReason(''), setIgnore(d))}
            >
              Kənara qoy
            </button>
          </>
        ) : d.bucket === 'conflict' ? (
          <>
            {d.state === 'posted' && (d.status === 'cancelled' || d.status === 'rejected') && (
              <button
                type="button"
                className="button secondary small"
                disabled={m.busy}
                aria-label={`${d.number}: qaiməni ləğv et`}
                onClick={() => void cancelInvoice(d)}
              >
                Qaiməni ləğv et
              </button>
            )}
            {d.state === 'posted' && d.status === 'corrected' && (
              <small>düzəliş e-qaiməsini uçota alın </small>
            )}
            {/* A closed period (reversed by hand in the open one) or amounts the accountant reviewed. */}
            <button
              type="button"
              className="button secondary small"
              aria-label={`${d.number}: ziddiyyəti qəbul et`}
              onClick={() => (setReason(''), setSettle(d))}
            >
              Qəbul et
            </button>
          </>
        ) : d.bucket === 'auto' ? (
          <button
            type="button"
            className="button secondary small"
            disabled={m.busy}
            aria-label={`${d.number}: avtomatik uçotu geri qaytar`}
            onClick={() => void undo(d)}
          >
            Geri qaytar
          </button>
        ) : d.state === 'ignored' && !d.reason.startsWith('DVX:') ? (
          <button
            type="button"
            className="button secondary small"
            disabled={m.busy}
            onClick={() => void restore(d)}
          >
            Geri qaytar
          </button>
        ) : null,
    },
  ];

  const p = preview?.read;
  const d = detail.data;
  const wrongDirection =
    (p?.directionHint && p.directionHint !== direction) ||
    (!!p?.ownerTaxId && !!company && p.ownerTaxId !== company.taxId);
  // Neither a title nor seller/buyer VÖEN columns: only the user can say which box it is for.
  const unproven =
    !!p && !p.directionHint && !p.documents.some((d) => d.sellerTaxId || d.buyerTaxId);
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      onRefresh={() => (box.reload(), imports.reload())}
      actions={
        <>
          <input
            ref={file}
            type="file"
            accept=".xlsx,.csv,.txt"
            hidden
            aria-label="DVX faylı"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void choose(f);
            }}
          />
          <button type="button" className="button primary" onClick={() => file.current?.click()}>
            <Upload size={15} /> DVX faylını yüklə
          </button>
          {api.hasDvx && (
            <button type="button" className="button secondary" onClick={() => void openCabinet()}>
              DVX kabinetini aç
            </button>
          )}
        </>
      }
      notices={
        <>
          {readError && <Notice onClose={() => setReadError('')}>{readError}</Notice>}
          {m.error && <Notice onClose={m.clear}>{m.error.message}</Notice>}
          {message && (
            <Notice kind="success" onClose={() => setMessage('')}>
              {message}
            </Notice>
          )}
          {box.error && <Notice>{box.error}</Notice>}
        </>
      }
    >
      {preview && p && (
        <section className="history statement-preview" aria-label="İlkin baxış">
          <h2>
            İlkin baxış · {preview.fileName}
            {preview.source === 'portal' && ' (DVX kabinetindən)'}
          </h2>
          <ul>
            <li>
              Hesabat:{' '}
              <b>{p.report === 'goods' ? 'Mallar üzrə (mal sətirləri)' : 'Qaimələr üzrə'}</b> ·
              istiqamət: <b>{directionLabel[direction]}</b>
              {p.directionHint && !wrongDirection && (
                <b className="pair-ok"> — faylın başlığı ilə uyğundur</b>
              )}
              {wrongDirection && (
                <b className="pair-bad">
                  {' '}
                  — faylın başlığında {directionLabel[p.directionHint!]} yazılıb; fayl yüklənməyəcək
                </b>
              )}
              {unproven && (
                <label className="pair-bad">
                  {' '}
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{' '}
                  Faylda istiqamət görünmür — bunun {directionLabel[direction]} faylı olduğunu
                  təsdiq edirəm
                </label>
              )}
            </li>
            <li>
              Dövr: {day(p.from ?? '')} – {day(p.to ?? '')} · {p.documents.length} e-qaimə · cəmi{' '}
              {money(addAmounts(p.documents.map((x) => x.total)))}
            </li>
            {p.ownerTaxId && (
              <li>
                Faylın şirkəti: VÖEN <b>{p.ownerTaxId}</b>
                {company && p.ownerTaxId !== company.taxId ? (
                  <b className="pair-bad">
                    {' '}
                    — bu şirkət deyil ({company.taxId}); fayl yüklənməyəcək
                  </b>
                ) : (
                  <b className="pair-ok"> — bu şirkətdir</b>
                )}
              </li>
            )}
            <li>Tanınan sütunlar: {Object.values(p.columns).filter(Boolean).join(', ')}</li>
            {p.problems.length > 0 && (
              <li className="pair-bad">
                Oxunmayan sətirlər:{' '}
                {p.problems
                  .slice(0, 5)
                  .map((x) => `${x.row} (${x.message})`)
                  .join('; ')}
                {p.problems.length > 5 ? ` və daha ${p.problems.length - 5}` : ''}
              </li>
            )}
          </ul>
          <p className="doc-hint">
            Yükləmə heç nəyi uçota almır. Hər e-qaimə bir dəfə saxlanılır: eyni faylı yenidən
            yükləmək heç nəyi dəyişmir, yalnız DVX statusu yenilənir. Şirkətin VÖEN-i faylda
            {direction === 'purchase' ? ' alıcı' : ' satıcı'} yerində olmalıdır.
          </p>
          <div className="row-actions">
            <button
              type="button"
              className="button primary"
              disabled={m.busy || !!wrongDirection || (unproven && !confirmed)}
              onClick={() => void load()}
            >
              {m.busy ? 'Yüklənir…' : 'Yüklə'}
            </button>
            <button type="button" className="button secondary" onClick={() => setPreview(null)}>
              İmtina
            </button>
          </div>
        </section>
      )}
      {!docs?.length && !preview ? (
        <Empty title="Hələ e-qaimə yüklənməyib">
          <p className="doc-hint">
            e-taxes.gov.az → E-qaimələr → {direction === 'purchase' ? 'Gələnlər' : 'Göndərilənlər'}{' '}
            → dövrü seçin → Excel-ə ixrac. Əvvəl “Qaimələr üzrə”, sonra “Mallar üzrə” hesabatını
            yükləyin.
          </p>
        </Empty>
      ) : docs?.length ? (
        <>
          {imports.data?.[0] && (
            <p className="doc-hint">
              Son yükləmə: {imports.data[0].fileName} · {day(imports.data[0].from)}–
              {day(imports.data[0].to)} · yeni {imports.data[0].added}, yenilənən{' '}
              {imports.data[0].updated}, dəyişməyən {imports.data[0].same}
            </p>
          )}
          <p>
            <button
              type="button"
              className="button secondary small"
              aria-expanded={reconcileOpen}
              onClick={() => setReconcileOpen(!reconcileOpen)}
            >
              DVX ↔ uçot ({day(ws.period.from)}–{day(ws.period.to)})
            </button>
          </p>
          {reconcileOpen && <Reconcile direction={direction} />}
          {newPartners + noContract > 0 && (
            <p>
              <button
                type="button"
                className="button secondary small"
                disabled={m.busy}
                onClick={() => setPartnersOpen(true)}
              >
                Yeni kontragentləri yarat ({newPartners}
                {noContract ? ` · müqaviləsiz ${noContract}` : ''})
              </button>
            </p>
          )}
          {partnersOpen && (
            <Confirm
              title="Kontragentləri e-qaimələrdən yarat"
              confirmLabel="Yarat"
              onCancel={() => setPartnersOpen(false)}
              onConfirm={() => void createPartners()}
            >
              <p>
                Gözləyən e-qaimələrdə kitabçada olmayan {newPartners} VÖEN var. Hər biri DVX-dəki
                adı ilə yaradılacaq (VÖEN-in son rəqəmi 2 olanlar fiziki şəxs, qalanları hüquqi
                şəxs). Mövcud kontragentlərə toxunulmur.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={withContracts}
                  onChange={(e) => setWithContracts(e.target.checked)}
                />{' '}
                Aktiv {direction === 'purchase' ? 'alış' : 'satış'} müqaviləsi olmayan hər
                kontragentə “Əsas” müqavilə də aç
              </label>
              {m.error && <Notice>{m.error.message}</Notice>}
            </Confirm>
          )}
          {ready > 0 && (
            <p>
              <button
                type="button"
                className="button secondary small"
                disabled={m.busy}
                onClick={() => void apply()}
              >
                Avtomatik uyğunluqları tətbiq et ({ready} hazır)
              </button>
            </p>
          )}
          <div className="tabs" role="tablist" aria-label="E-qaimələrin vəziyyəti">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label} <small>{box.data?.counts[t.id] ?? 0}</small>
              </button>
            ))}
          </div>
          <DataTable
            label={`E-qaimələr · ${tabs.find((t) => t.id === tab)!.label}`}
            rows={rows}
            columns={columns}
            rowKey={(x) => x.id}
            onOpen={(x) =>
              x.state === 'posted'
                ? openInvoice(x)
                : x.state === 'waiting' && x.status === 'accepted'
                  ? book(x)
                  : setOpen(x.id)
            }
            empty={<Empty title="Bu vəziyyətdə e-qaimə yoxdur" />}
          />
        </>
      ) : null}
      {open && d && (
        <Modal
          title={`E-qaimə ${d.number}`}
          subtitle={`${day(d.date)} · ${d.name} · VÖEN ${d.taxId} · DVX: ${d.dvxStatus || '—'}`}
          onClose={() => setOpen('')}
          size="large"
        >
          <div className="modal-body">
            <p>
              ƏDV-siz <b>{money(d.net)}</b> · ƏDV <b>{money(d.vat)}</b> · cəmi{' '}
              <b>{money(d.total)}</b>
              {d.kind !== 'main' && <> · növ: {d.kindText}</>}
              {d.refNumber && <> · əsas e-qaimə: {d.refNumber}</>}
            </p>
            <p className="doc-hint">
              ƏDV bazaları: 18% {money(d.base18)} · 0% {money(d.base0)} · azad {money(d.baseExempt)}{' '}
              · cəlb olunmayan {money(d.baseNontaxable)}
              {d.excise !== '0.00' && <> · aksiz {money(d.excise)}</>}
              {d.roadTax !== '0.00' && <> · yol vergisi {money(d.roadTax)}</>}
            </p>
            {d.conflict && <Notice kind="warning">{d.conflict}</Notice>}
            {d.lines.length ? (
              <table className="grid" aria-label="Mal sətirləri">
                <thead>
                  <tr>
                    <th>Kod</th>
                    <th>Ad</th>
                    <th>Vahid</th>
                    <th className="num">Miqdar</th>
                    <th className="num">Qiymət</th>
                    <th className="num">ƏDV-siz</th>
                    <th className="num">ƏDV</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.code}</td>
                      <td>{l.name}</td>
                      <td>{l.unit}</td>
                      <td className="num">{qty(l.quantity)}</td>
                      <td className="num">{l.price}</td>
                      <td className="num">{money(l.net)}</td>
                      <td className="num">{money(l.vat)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="doc-hint">Mal sətirləri yoxdur: “Mallar üzrə” hesabatını yükləyin.</p>
            )}
            <h3>DVX statusunun tarixçəsi</h3>
            <ul>
              {d.history.map((h, i) => (
                <li key={i}>
                  {h.at.slice(0, 10)} · {h.fileName} ({day(h.from)}–{day(h.to)}):{' '}
                  {h.dvxStatus || '—'}
                </li>
              ))}
            </ul>
          </div>
        </Modal>
      )}
      {settle && (
        <Confirm
          title={`Ziddiyyəti qəbul et · ${settle.number}`}
          confirmLabel="Qəbul et"
          onCancel={() => setSettle(null)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'eqaime.resolve',
              companyId: win.companyId,
              documentId: settle.id,
              note: reason,
            });
            if (r) {
              setSettle(null);
              setMessage(`${settle.number}: ziddiyyət qeydlə qəbul edildi.`);
            }
          }}
        >
          <p>
            Bağlı dövrdə qaimə dəyişdirilmir: əks yazılışı açıq dövrdə aparın və burada nə
            etdiyinizi yazın. Qeyd audit jurnalına düşür; DVX-də yeni dəyişiklik olsa, ziddiyyət
            yenidən açılır.
          </p>
          <Field label="Qeyd">
            <input
              autoFocus
              required
              maxLength={240}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {m.error && <Notice>{m.error.message}</Notice>}
        </Confirm>
      )}
      {ignore && (
        <Confirm
          title={`E-qaiməni kənara qoy · ${ignore.number}`}
          confirmLabel="Kənara qoy"
          onCancel={() => setIgnore(null)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'eqaime.ignore',
              companyId: win.companyId,
              documentId: ignore.id,
              reason,
            });
            if (r) {
              setIgnore(null);
              setMessage('E-qaimə kənara qoyuldu.');
            }
          }}
        >
          <p>
            E-qaimə uçota alınmır, amma qutuda qalır və geri qaytarıla bilər. Səbəb audit jurnalına
            yazılır.
          </p>
          <Field label="Səbəb">
            <input
              autoFocus
              required
              maxLength={240}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {m.error && <Notice>{m.error.message}</Notice>}
        </Confirm>
      )}
    </ModuleFrame>
  );
}

/**
 * DVX ↔ books for the working period (§8.5): VAT by month, e-qaimələr not booked, invoices whose
 * e-qaimə number the loaded DVX files do not hold, invoices without an e-qaimə number.
 */
function Reconcile({ direction }: { direction: Direction }) {
  const win = useWindow();
  const ws = useWorkspace();
  const r = useQuery<EqReconcileView>({
    type: 'eqReconcile',
    companyId: win.companyId,
    direction,
    from: ws.period.from,
    to: ws.period.to,
  });
  const v = r.data;
  const open = (id: string) => ws.open({ type: 'invoice', direction, id }, win.companyId);
  if (!v) return <p className="doc-hint">{r.error || 'Hesablanır…'}</p>;
  return (
    <section className="history" aria-label="DVX ilə uçotun tutuşdurulması">
      <h2>DVX ↔ uçot</h2>
      <p className="doc-hint">
        Yüklənmiş DVX dövrləri:{' '}
        {v.covered.length
          ? v.covered.map((c) => `${day(c.from)}–${day(c.to)}`).join(', ')
          : 'yoxdur'}
        . “DVX-də yoxdur” yalnız bu dövrlər üçün deyilir.
      </p>
      <table className="grid" aria-label="Aylar üzrə ƏDV">
        <thead>
          <tr>
            <th>Ay</th>
            <th className="num">DVX: e-qaimə</th>
            <th className="num">DVX: ƏDV</th>
            <th className="num">Uçot: qaimə</th>
            <th className="num">Uçot: ƏDV</th>
            <th className="num">Fərq</th>
          </tr>
        </thead>
        <tbody>
          {v.months.map((m) => (
            <tr key={m.month}>
              <td>{m.month}</td>
              <td className="num">{m.dvxCount}</td>
              <td className="num">{money(m.dvxVat)}</td>
              <td className="num">{m.bookedCount}</td>
              <td className="num">{money(m.bookedVat)}</td>
              <td className={`num ${m.difference === '0.00' ? 'pair-ok' : 'pair-bad'}`}>
                {m.difference === '0.00' ? 'uyğundur' : money(m.difference)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul>
        <li>
          DVX-də təsdiqlənib, uçota alınmayıb: <b>{v.notBooked.length}</b> (bax “Təklif” və
          “Naməlum”)
        </li>
        <li>
          Uçotda var, yüklənmiş DVX fayllarında yoxdur: <b>{v.notInDvx.length}</b>
          {v.notInDvx.slice(0, 10).map((x) => (
            <span key={x.id}>
              {' '}
              <button type="button" className="link" onClick={() => open(x.id)}>
                {x.number}
              </button>{' '}
              <small>({x.eqNumber})</small>
            </span>
          ))}
        </li>
        <li>
          E-qaimə nömrəsi olmayan qaimələr: <b>{v.withoutEq.length}</b>
          {v.withoutEq.slice(0, 10).map((x) => (
            <span key={x.id}>
              {' '}
              <button type="button" className="link" onClick={() => open(x.id)}>
                {x.number}
              </button>
            </span>
          ))}
        </li>
      </ul>
    </section>
  );
}
