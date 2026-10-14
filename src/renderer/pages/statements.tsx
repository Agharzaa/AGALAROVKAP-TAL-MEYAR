/**
 * Bank statement (stage 3c): load a bank's XLSX/CSV export, see what was read before anything is
 * stored, then go through the rows — book each by a bank document (prefilled with what the system
 * recognised), link it to a document typed by hand, or set it aside with a reason. The file's
 * balances are compared with the ledger, so a missing or doubled payment shows at once.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from '../icons';
import {
  readStatementTable,
  statementAddsUp,
  type StatementReadResult,
} from '../../domain/statement';
import type {
  BankDocumentDetail,
  StatementImportView,
  StatementLineView,
  StatementView,
} from '../../contracts/queries';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { day, isZero, money } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages } from '../pages';
import { readSheet, SheetError } from '../sheet-reader';
import { Amount, Confirm, DataTable, Empty, Field, Notice, type Column } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

type Tab = 'new' | 'posted' | 'ignored';
const tabs: { id: Tab; label: string }[] = [
  { id: 'new', label: 'Gözləyir' },
  { id: 'posted', label: 'Uçota alınıb' },
  { id: 'ignored', label: 'Kənara qoyulub' },
];

interface Preview {
  fileName: string;
  hash: string;
  read: StatementReadResult;
}

/** A few words for the row's proposal cell: what the system recognised it by. */
function summary(l: StatementLineView): string {
  const p = l.proposal;
  if (!p) return '';
  if (p.matches.length) return `Əl ilə daxil edilib: ${p.matches.map((m) => m.number).join(', ')}`;
  if (p.rule) return `Qayda: ${p.rule.name}${l.manualOnly ? ' (yalnız təklif)' : ''}`;
  if (p.budgetCode && p.account) return `Büdcə kodu ${p.budgetCode}`;
  if (p.newPartner) return `Yeni kontragent, VÖEN ${p.newPartner.taxId}`;
  // "VÖEN üzrə tanındı: Gilan Tekstil MMC." → the partner's name says it all.
  const known = /tanındı: ([^.]+)/.exec(p.reason)?.[1];
  if (known) return known;
  const first = p.reason.split(/(?<=[.:—])\s/)[0] ?? '';
  return first.replace(/[.:—]$/, '');
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function StatementsPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const page = pages.statements;
  const imports = useQuery<StatementImportView[]>({
    type: 'statementImports',
    companyId: win.companyId,
  });
  const [selected, setSelected] = useState('');
  const current = selected || imports.data?.[0]?.id || '';
  const statement = useQuery<StatementView>(
    current ? { type: 'statement', companyId: win.companyId, id: current } : null,
  );
  const [tab, setTab] = useState<Tab>('new');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [bankAccountId, setBankAccountId] = useState('');
  const [readError, setReadError] = useState('');
  const [message, setMessage] = useState('');
  const [ignore, setIgnore] = useState<StatementLineView | null>(null);
  const [reason, setReason] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const m = useMutation();

  useEffect(() => setTab('new'), [current]);

  async function choose(f: File) {
    setReadError('');
    setMessage('');
    m.clear();
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const read = readStatementTable(await readSheet(f.name, bytes));
      if (!read.lines.length)
        setReadError(read.problems[0]?.message ?? 'Faylda əməliyyat sətri tapılmadı.');
      else {
        const known = read.iban
          ? catalog?.bankAccounts.find((b) => b.iban === read.iban)
          : undefined;
        setBankAccountId(known?.id ?? '');
        setPreview({ fileName: f.name, hash: await sha256(bytes), read });
      }
    } catch (e) {
      setReadError(e instanceof SheetError ? e.message : `Fayl oxunmadı: ${(e as Error).message}`);
    }
  }

  async function load() {
    if (!preview) return;
    const r = await m.run({
      type: 'statement.import',
      companyId: win.companyId,
      iban: preview.read.iban ?? '',
      ...(preview.read.iban ? {} : { bankAccountId }),
      fileName: preview.fileName,
      fileHash: preview.hash,
      ...(preview.read.opening !== undefined ? { opening: preview.read.opening } : {}),
      ...(preview.read.closing !== undefined ? { closing: preview.read.closing } : {}),
      lines: preview.read.lines,
    });
    if (!r) return;
    setPreview(null);
    setSelected(r.id);
    setMessage(
      `Yükləndi: yeni ${r.added ?? 0} sətir${r.duplicates ? `, ${r.duplicates} sətir əvvəl yüklənmişdi (təkrar yaradılmadı)` : ''}${r.rejected?.length ? `, ${r.rejected.length} sətir oxunmadı` : ''}${r.posted ? `, ${r.posted} sətir qaydalarla avtomatik uçota alındı` : ''}${r.failed?.length ? `, ${r.failed.length} sətri qayda uçota ala bilmədi (səbəb sətirdə)` : ''}.`,
    );
    imports.reload();
  }

  const s = statement.data;
  const rows = useMemo(() => (s?.lines ?? []).filter((l) => l.state === tab), [s, tab]);
  const count = (t: Tab) => (s?.lines ?? []).filter((l) => l.state === t).length;
  const book = (l: StatementLineView) =>
    ws.open({ type: 'bank', direction: l.direction, statementLineId: l.id }, win.companyId);
  const openDoc = (l: StatementLineView) =>
    ws.open({ type: 'bank', direction: l.direction, id: l.documentId }, win.companyId);
  async function link(l: StatementLineView, documentId: string) {
    const r = await m.run({
      type: 'statement.link',
      companyId: win.companyId,
      lineId: l.id,
      documentId,
    });
    if (r) setMessage('Sətir mövcud sənədlə bağlandı.');
  }
  async function apply() {
    if (!s) return;
    const r = await m.run({ type: 'statement.apply', companyId: win.companyId, importId: s.id });
    if (r)
      setMessage(
        r.posted || r.failed?.length
          ? `Avtomatik qaydalarla uçota alındı: ${r.posted ?? 0}${r.failed?.length ? `; alınmadı: ${r.failed.length} (səbəb sətirdə)` : ''}.`
          : 'Avtomatik qaydaya uyğun gözləyən sətir yoxdur.',
      );
  }
  async function undo(l: StatementLineView) {
    setMessage('');
    let version: number;
    try {
      version = (
        await api.query<BankDocumentDetail>({
          type: 'bankDocument',
          companyId: win.companyId,
          id: l.documentId,
        })
      ).version;
    } catch (e) {
      setMessage((e as Error).message);
      return;
    }
    const r = await m.run({
      type: 'bank.cancel',
      companyId: win.companyId,
      id: l.documentId,
      version,
      reason: `Avtomatik uçot geri qaytarıldı (qayda: ${l.documentRule})`,
    });
    if (r)
      setMessage(
        `Avtomatik uçot geri qaytarıldı: ${l.documentNumber} storno edildi; sətir sizi gözləyir.`,
      );
  }
  async function restore(l: StatementLineView) {
    const r = await m.run({ type: 'statement.restore', companyId: win.companyId, lineId: l.id });
    if (r) setMessage('Sətir geri qaytarıldı.');
  }

  const columns: Column<StatementLineView>[] = [
    { key: 'row', label: 'Sətir', className: 'nowrap', render: (l) => l.row },
    { key: 'date', label: 'Tarix', render: (l) => day(l.date) },
    {
      key: 'in',
      label: 'Daxilolma',
      align: 'end',
      render: (l) => (l.direction === 'in' ? <Amount value={l.amount} strong /> : null),
    },
    {
      key: 'out',
      label: 'Məxaric',
      align: 'end',
      render: (l) => (l.direction === 'out' ? <Amount value={l.amount} strong /> : null),
    },
    {
      key: 'who',
      label: 'Qarşı tərəf',
      className: 'clip',
      render: (l) => (
        <span
          title={`${l.counterparty}${l.counterpartyTaxId ? ` · VÖEN ${l.counterpartyTaxId}` : ''}`}
        >
          {l.counterparty || '—'}
          {l.counterpartyTaxId && <small> · {l.counterpartyTaxId}</small>}
        </span>
      ),
    },
    {
      key: 'purpose',
      label: 'Təyinat',
      className: 'clip',
      render: (l) => <span title={l.purpose}>{l.purpose}</span>,
    },
    {
      key: 'what',
      label: tab === 'new' ? 'Təklif' : tab === 'posted' ? 'Sənəd' : 'Səbəb',
      className: 'clip',
      render: (l) =>
        l.state === 'posted' ? (
          <span>
            <button type="button" className="link" onClick={() => openDoc(l)}>
              {l.documentNumber}
            </button>
            {l.documentRule && <small> · avtomatik, qayda: {l.documentRule}</small>}
          </span>
        ) : l.state === 'ignored' ? (
          <span title={l.reason}>{l.reason}</span>
        ) : (
          // The cell names what was recognised in a few words; the full reason is on hover and
          // at the top of the form the row opens.
          <span title={l.proposal?.reason}>
            {l.autoNote ? (
              <b className="chip chip-bad">Alınmadı</b>
            ) : (
              <b className={`chip ${l.proposal?.state === 'proposal' ? 'chip-ok' : 'chip-wait'}`}>
                {l.proposal?.state === 'proposal' ? 'Təklif' : 'Naməlum'}
              </b>
            )}{' '}
            {l.proposal?.account && <b>{l.proposal.account}</b>} {summary(l)}
          </span>
        ),
    },
    {
      key: 'actions',
      label: 'Əməliyyat',
      className: 'nowrap',
      render: (l) =>
        l.state === 'new' ? (
          <>
            {l.proposal?.matches.map((d) => (
              <button
                key={d.id}
                type="button"
                className="button secondary small"
                disabled={m.busy}
                onClick={() => void link(l, d.id)}
              >
                Bağla: {d.number}
              </button>
            ))}
            <button
              type="button"
              className="button primary small"
              aria-label={`Sətir ${l.row}: uçota al`}
              onClick={() => book(l)}
            >
              Uçota al
            </button>
            <button
              type="button"
              className="button secondary small"
              aria-label={`Sətir ${l.row}: kənara qoy`}
              onClick={() => (setReason(''), setIgnore(l))}
            >
              Kənara qoy
            </button>
          </>
        ) : l.state === 'posted' && l.documentRule ? (
          <button
            type="button"
            className="button secondary small"
            disabled={m.busy}
            aria-label={`Sətir ${l.row}: avtomatik uçotu geri qaytar`}
            onClick={() => void undo(l)}
          >
            Geri qaytar
          </button>
        ) : l.state === 'ignored' ? (
          <button
            type="button"
            className="button secondary small"
            disabled={m.busy}
            onClick={() => void restore(l)}
          >
            Geri qaytar
          </button>
        ) : null,
    },
  ];

  const balance = (label: string, file: string, ledger: string, difference: string) => (
    <div className="statement-balance">
      <span>{label}</span>
      <span>
        Bankda <b>{file ? money(file) : '—'}</b>
      </span>
      <span>
        Uçotda <b>{money(ledger)}</b>
      </span>
      {difference && (
        <b className={isZero(difference) ? 'pair-ok' : 'pair-bad'}>
          {isZero(difference)
            ? 'uyğundur'
            : difference.startsWith('-')
              ? `uçotda ${money(difference.slice(1))} çox`
              : `bankda ${money(difference)} çox`}
        </b>
      )}
    </div>
  );

  const p = preview?.read;
  const addsUp = p ? statementAddsUp(p) : undefined;
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      onRefresh={() => (imports.reload(), statement.reload())}
      actions={
        <>
          <input
            ref={file}
            type="file"
            accept=".xlsx,.csv,.txt"
            hidden
            aria-label="Çıxarış faylı"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void choose(f);
            }}
          />
          <button type="button" className="button primary" onClick={() => file.current?.click()}>
            <Upload size={15} /> Çıxarışı yüklə
          </button>
          {(imports.data?.length ?? 0) > 0 && (
            <label className="filter-text">
              <span>Çıxarış</span>
              <select
                aria-label="Çıxarış"
                value={current}
                onChange={(e) => setSelected(e.target.value)}
              >
                {imports.data!.map((i) => {
                  const b = catalog?.bankAccounts.find((x) => x.id === i.bankAccountId);
                  return (
                    <option key={i.id} value={i.id}>
                      {day(i.from)}–{day(i.to)} · {b?.name || b?.iban || ''} · {i.fileName}
                      {i.waiting ? ` · gözləyir ${i.waiting}` : ''}
                    </option>
                  );
                })}
              </select>
            </label>
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
          {statement.error && <Notice>{statement.error}</Notice>}
        </>
      }
    >
      {preview && p && (
        <section className="history statement-preview" aria-label="İlkin baxış">
          <h2>İlkin baxış · {preview.fileName}</h2>
          <ul>
            <li>
              Hesab:{' '}
              {p.iban ? (
                <b>
                  {p.iban}
                  {catalog?.bankAccounts.some((b) => b.iban === p.iban)
                    ? ''
                    : ' — bank hesabları kitabçasında yoxdur'}
                </b>
              ) : (
                <>
                  faylda IBAN yoxdur —{' '}
                  <select
                    aria-label="Bank hesabı"
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                  >
                    <option value="">bank hesabını seçin…</option>
                    {(catalog?.bankAccounts ?? [])
                      .filter((b) => !b.archived)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.account} · {b.name || b.bankName} · {b.iban}
                        </option>
                      ))}
                  </select>
                </>
              )}
            </li>
            <li>
              Dövr: {day(p.from ?? '')} – {day(p.to ?? '')} · {p.lines.length} əməliyyat (daxilolma{' '}
              {p.lines.filter((l) => l.direction === 'in').length}, məxaric{' '}
              {p.lines.filter((l) => l.direction === 'out').length})
            </li>
            <li>
              Qalıqlar: əvvələ {p.opening !== undefined ? money(p.opening) : '—'}, sona{' '}
              {p.closing !== undefined ? money(p.closing) : '—'}
              {addsUp === true && <b className="pair-ok"> — fayl öz-özünə tarazdır</b>}
              {addsUp === false && (
                <b className="pair-bad">
                  {' '}
                  — əvvələ qalıq + daxilolma − məxaric sona qalığa bərabər deyil: bəzi sətirlər
                  oxunmayıb və ya fayl kəsilib
                </b>
              )}
            </li>
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
            Yükləmə heç nəyi uçota almır: sətirlər çıxarışda gözləyir, hər birini siz təsdiq
            edirsiniz. Əvvəl yüklənmiş sətirlər təkrar yaradılmır.
          </p>
          <div className="row-actions">
            <button
              type="button"
              className="button primary"
              disabled={m.busy || (!p.iban && !bankAccountId)}
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
      {!s && !preview ? (
        <Empty title="Hələ çıxarış yüklənməyib">
          <p className="doc-hint">
            Bankın internet-bankçılığından çıxarışı Excel (.xlsx) və ya CSV kimi endirin. Köhnə .xls
            faylını Excel-də “.xlsx” kimi yenidən saxlayın.
          </p>
        </Empty>
      ) : s ? (
        <>
          <section className="statement-head" aria-label="Çıxarış ilə uçotun tutuşdurulması">
            <p>
              <b>{s.bankAccount}</b> · {s.iban} · {day(s.from)}–{day(s.to)} · {s.currency}{' '}
              {s.waiting > 0 && (
                <button
                  type="button"
                  className="button secondary small"
                  disabled={m.busy}
                  onClick={() => void apply()}
                >
                  Avtomatik qaydaları tətbiq et
                </button>
              )}
            </p>
            {balance(
              'Əvvələ qalıq',
              s.balances.fileOpening,
              s.balances.ledgerOpening,
              s.balances.openingDifference,
            )}
            {balance(
              'Sona qalıq',
              s.balances.fileClosing,
              s.balances.ledgerClosing,
              s.balances.closingDifference,
            )}
          </section>
          <div className="tabs" role="tablist" aria-label="Sətirlərin vəziyyəti">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label} <small>{count(t.id)}</small>
              </button>
            ))}
          </div>
          <DataTable
            label={`Çıxarış sətirləri · ${tabs.find((t) => t.id === tab)!.label}`}
            rows={rows}
            columns={columns}
            rowKey={(l) => l.id}
            onOpen={(l) =>
              l.state === 'new' ? book(l) : l.state === 'posted' ? openDoc(l) : undefined
            }
            empty={
              <Empty
                title={
                  tab === 'new'
                    ? 'Gözləyən sətir yoxdur — çıxarış tam işlənib'
                    : tab === 'posted'
                      ? 'Hələ uçota alınan sətir yoxdur'
                      : 'Kənara qoyulan sətir yoxdur'
                }
              />
            }
          />
        </>
      ) : null}
      {ignore && (
        <Confirm
          title={`Sətri kənara qoy · ${ignore.row}`}
          confirmLabel="Kənara qoy"
          onCancel={() => setIgnore(null)}
          onConfirm={async () => {
            const r = await m.run({
              type: 'statement.ignore',
              companyId: win.companyId,
              lineId: ignore.id,
              reason,
            });
            if (r) {
              setIgnore(null);
              setMessage('Sətir kənara qoyuldu.');
            }
          }}
        >
          <p>
            Sətir uçota alınmır, amma çıxarışda qalır və geri qaytarıla bilər. Səbəb audit jurnalına
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
