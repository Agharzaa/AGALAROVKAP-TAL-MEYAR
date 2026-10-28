import { useMemo, useState, type KeyboardEvent } from 'react';
import { FileDown } from '../icons';
import type { TrialBalance, TrialRow } from '../../contracts/queries';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { PeriodSteps, RangeFields, useRange } from '../filters';
import { day, money, qty } from '../format';
import { useQuery } from '../hooks';
import { pages } from '../pages';
import { Picker } from '../picker';
import { usePrint } from '../print';
import { Notice } from '../ui';
import { useWindow, useWorkspace } from '../workspace';
import { workbook } from '../xlsx';

const cell = (v: string) => (v ? money(v) : '');

type Detail = 'accounts' | 'subaccounts' | 'partners' | 'all';
/** 1C's detail level: what is open without a click. */
const details: [Detail, string][] = [
  ['accounts', 'Hesablar'],
  ['subaccounts', 'Subhesablar'],
  ['partners', 'Kontragentlər'],
  ['all', 'Hamısı'],
];

const TITLE = 'Hesablar üzrə dövriyyə-saldo cədvəli';
const SIDES = ['Debet', 'Kredit', 'Debet', 'Kredit', 'Debet', 'Kredit'];
const amounts = (
  r: Pick<TrialRow, 'openDt' | 'openKt' | 'turnDt' | 'turnKt' | 'closeDt' | 'closeKt'>,
) => [r.openDt, r.openKt, r.turnDt, r.turnKt, r.closeDt, r.closeKt];

/** The printed form (and the PDF): the rows as open on screen, A4 landscape. */
function TrialSheet({ tb, company }: { tb: TrialBalance; company: string }) {
  return (
    <div className="trial-sheet">
      <p>{company}</p>
      <h1>{TITLE}</h1>
      <p>
        Dövr: {day(tb.from)} – {day(tb.to)}
      </p>
      <table>
        <thead>
          <tr>
            <th rowSpan={2}>Hesab</th>
            <th colSpan={2}>Dövrün əvvəlinə saldo</th>
            <th colSpan={2}>Dövr üzrə dövriyyə</th>
            <th colSpan={2}>Dövrün sonuna saldo</th>
          </tr>
          <tr>
            {SIDES.map((t, i) => (
              <th key={i} className="num">
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tb.rows.map((r) => (
            <tr key={r.key} className={`lvl${Math.min(r.level, 4)} ${r.kind}`}>
              <td style={{ paddingLeft: `${2 + r.level * 4}mm` }}>
                {r.kind === 'account' ? `${r.account} ${r.label}` : r.label}
              </td>
              {amounts(r).map((v, i) => (
                <td key={i} className="num">
                  {cell(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Cəmi</td>
            {amounts(tb.totals).map((v, i) => (
              <td key={i} className="num">
                {money(v)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function TrialPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const range = useRange(ws.period);
  const printer = usePrint();
  const [detail, setDetail] = useState<Detail>('accounts');
  const [expand, setExpand] = useState<string[]>([]);
  const [collapse, setCollapse] = useState<string[]>([]);
  const [onlyMoved, setOnlyMoved] = useState(false);
  const [onlyArising, setOnlyArising] = useState(false);
  const [accountsText, setAccountsText] = useState('');
  const [accounts, setAccounts] = useState<string[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [selected, setSelected] = useState(0);
  const [exportMsg, setExportMsg] = useState('');
  const result = useQuery<TrialBalance>({
    type: 'trialBalance',
    companyId: win.companyId,
    ...range.applied,
    expand,
    collapse,
    detail,
    onlyMoved,
    onlyArising,
    accounts,
    ...(partnerId ? { partnerId } : {}),
  });
  const tb = result.data;
  const rows = tb?.rows ?? [];
  const toggle = (r: TrialRow) => {
    if (!r.expandable) return;
    if (r.expanded) {
      // Closing drops what was opened inside (its subaccounts and subkonto) and keeps the row
      // closed even where the detail level would open it.
      const inside = (k: string) =>
        k === r.key || k.startsWith(`${r.key}|`) || k.startsWith(`${r.key}.`);
      setExpand((list) => list.filter((k) => !inside(k)));
      setCollapse((list) => [...list.filter((k) => k !== r.key), r.key]);
    } else {
      setExpand((list) => [...list, r.key]);
      setCollapse((list) => list.filter((k) => k !== r.key));
    }
  };
  const chooseDetail = (d: Detail) => {
    setDetail(d);
    setExpand([]);
    setCollapse([]);
  };
  const openCard = (r: TrialRow) =>
    ws.open(
      {
        type: 'accountCard',
        account: r.account,
        sk: r.sk,
        from: range.applied.from,
        to: range.applied.to,
      },
      win.companyId,
    );
  const partners = useMemo(
    () =>
      (catalog?.partners ?? []).map((p) => ({
        value: p.id,
        label: p.name,
        ...(p.taxId ? { hint: p.taxId } : {}),
      })),
    [catalog],
  );
  const onKey = (e: KeyboardEvent) => {
    const r = rows[selected];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'ArrowRight' && r?.expandable && !r.expanded) {
      e.preventDefault();
      toggle(r);
    } else if (e.key === 'ArrowLeft' && r?.expanded) {
      e.preventDefault();
      toggle(r);
    } else if (e.key === 'Enter' && r) {
      e.preventDefault();
      openCard(r);
    }
  };
  const company = `${catalog?.company.name ?? ''} · VÖEN ${catalog?.company.taxId ?? ''}`;
  const exportXlsx = async () => {
    if (!tb) return;
    const bytes = workbook({
      name: 'Dövriyyə balansı',
      title: [company, `${TITLE}: ${day(tb.from)} – ${day(tb.to)}`],
      header: [
        'Hesab',
        'Ad / subkonto',
        'Dövrün əvvəlinə saldo Dt',
        'Dövrün əvvəlinə saldo Kt',
        'Dövr üzrə dövriyyə Dt',
        'Dövr üzrə dövriyyə Kt',
        'Dövrün sonuna saldo Dt',
        'Dövrün sonuna saldo Kt',
        'Miqdar (son)',
        'Valyuta (son)',
      ],
      widths: [10, 48, 16, 16, 16, 16, 16, 16, 12, 14],
      rows: [
        ...tb.rows.map((r) => [
          r.kind === 'account' ? r.account : '',
          `${'   '.repeat(r.level)}${r.label}`,
          ...amounts(r).map((money) => ({ money })),
          { qty: r.closeQty },
          r.closeCur ? `${money(r.closeCur)} ${r.currency}` : '',
        ]),
        ['', 'Cəmi', ...amounts(tb.totals).map((money) => ({ money })), '', ''],
      ],
    });
    try {
      const file = await api.saveFile(`DBC ${tb.from} ${tb.to}.xlsx`, bytes);
      if (file) setExportMsg(`Saxlanıldı: ${file}`);
    } catch (e) {
      setExportMsg((e as Error).message);
    }
  };
  const savePdf = () =>
    tb &&
    printer.pdf(<TrialSheet tb={tb} company={company} />, `DBC ${tb.from} ${tb.to}.pdf`, (o) =>
      'error' in o ? setExportMsg(o.error) : o.file && setExportMsg(`Saxlanıldı: ${o.file}`),
    );
  return (
    <ModuleFrame
      title={pages.trial.title}
      hint={tb ? `${day(tb.from)} – ${day(tb.to)} · ${tb.ms} ms` : pages.trial.hint}
      onRefresh={result.reload}
      onFilter={() => {
        range.apply();
        setAccounts(
          accountsText
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }}
      actions={
        <>
          <div className="segmented" role="group" aria-label="Detallaşdırma">
            {details.map(([d, label]) => (
              <button
                key={d}
                type="button"
                aria-pressed={detail === d}
                onClick={() => chooseDetail(d)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={!tb}
            onClick={() => void exportXlsx()}
          >
            <FileDown size={15} /> Excel
          </button>
          {api.canSavePdf() && (
            <button type="button" className="button secondary" disabled={!tb} onClick={savePdf}>
              <FileDown size={15} /> PDF
            </button>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={!tb}
            onClick={() => tb && printer.print(<TrialSheet tb={tb} company={company} />)}
          >
            Çap et
          </button>
        </>
      }
      filters={
        <>
          <RangeFields range={range} />
          <PeriodSteps range={range} />
          <label className="filter-text">
            <span>Hesablar</span>
            <input
              aria-label="Hesablar"
              placeholder="211, 531…"
              value={accountsText}
              onChange={(e) => setAccountsText(e.target.value)}
            />
          </label>
          <span className="filter-picker">
            <Picker
              ariaLabel="Kontragent filtri"
              value={partnerId}
              options={partners}
              onChange={setPartnerId}
              emptyLabel="Bütün kontragentlər"
            />
          </span>
          <label className="check">
            <input
              type="checkbox"
              checked={onlyMoved}
              onChange={(e) => setOnlyMoved(e.target.checked)}
            />{' '}
            Yalnız dövriyyəsi olanlar
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={onlyArising}
              onChange={(e) => setOnlyArising(e.target.checked)}
            />{' '}
            Yalnız dövrdə yaranan
          </label>
        </>
      }
      notices={
        <>
          {result.error && <Notice>{result.error}</Notice>}
          {exportMsg && (
            <Notice kind="success" onClose={() => setExportMsg('')}>
              {exportMsg}
            </Notice>
          )}
        </>
      }
    >
      <div
        className="table-scroll"
        tabIndex={0}
        onKeyDown={onKey}
        aria-label="Dövriyyə balansı cədvəli"
      >
        {/* As in 1C: the report sheet with the company, the title and the period. */}
        <div className="report-head">
          <b>{catalog?.company.name}</b>
          <h2>{TITLE}</h2>
          {tb && (
            <p>
              Dövr: {day(tb.from)} – {day(tb.to)}
            </p>
          )}
        </div>
        <table className="grid trial onec">
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="gut" aria-label="Qruplama" />
              <th scope="col" rowSpan={2} className="trial-name">
                Hesab
              </th>
              <th scope="colgroup" colSpan={2}>
                Dövrün əvvəlinə saldo
              </th>
              <th scope="colgroup" colSpan={2}>
                Dövr üzrə dövriyyə
              </th>
              <th scope="colgroup" colSpan={2}>
                Dövrün sonuna saldo
              </th>
            </tr>
            <tr>
              {SIDES.map((t, i) => (
                <th key={i} scope="col" className="num">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.key}
                className={`lvl${Math.min(r.level, 4)} ${r.kind}${i === selected ? ' selected' : ''}`}
                onClick={() => setSelected(i)}
                onDoubleClick={() => openCard(r)}
              >
                <td className="gut">
                  {r.expandable && (
                    <button
                      type="button"
                      className="group-mark"
                      aria-label={`${r.expanded ? 'Bağla' : 'Aç'}: ${r.label}`}
                      aria-expanded={r.expanded}
                      onClick={(e) => (e.stopPropagation(), toggle(r))}
                    >
                      {r.expanded ? '⊟' : '⊞'}
                    </button>
                  )}
                </td>
                <td className="trial-name">
                  <span className="tree-cell" style={{ paddingLeft: `${r.level * 16}px` }}>
                    {r.kind === 'account' && <span className="code">{r.account}</span>}
                    <span
                      className="label"
                      title={r.kind === 'subkonto' ? `${r.hint}: ${r.label}` : r.label}
                    >
                      {r.label}
                    </span>
                    {r.closeQty && (
                      <span className="sub" title="Miqdar qalığı">
                        {qty(r.closeQty)}
                      </span>
                    )}
                    {r.closeCur && (
                      <span className="sub">
                        {money(r.closeCur)} {r.currency}
                      </span>
                    )}
                  </span>
                </td>
                <td className="num">{cell(r.openDt)}</td>
                <td className="num">{cell(r.openKt)}</td>
                <td className="num">
                  {cell(r.turnDt)}
                  {r.turnQtyDt && <small>{qty(r.turnQtyDt)}</small>}
                </td>
                <td className="num">
                  {cell(r.turnKt)}
                  {r.turnQtyKt && <small>{qty(r.turnQtyKt)}</small>}
                </td>
                <td className="num">{cell(r.closeDt)}</td>
                <td className="num">{cell(r.closeKt)}</td>
              </tr>
            ))}
            {tb && !rows.length && (
              <tr>
                <td colSpan={8} className="panel-empty">
                  Bu dövrdə və seçilən filtrdə qalıq və dövriyyə yoxdur.
                </td>
              </tr>
            )}
          </tbody>
          {tb && (
            <tfoot>
              <tr>
                <td className="gut" />
                <td>Cəmi</td>
                {amounts(tb.totals).map((v, i) => (
                  <td key={i} className="num">
                    {money(v)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="table-hint">
        Sətrə iki dəfə vurun və ya Enter basın — hesab kartı açılır. ← → açır/bağlayır. Hesabı
        açanda kontragentli subhesabları da açıq gəlir. Debitor və kreditor qalıqları açıq saldo ilə
        göstərilir.
      </p>
      {printer.sheet}
    </ModuleFrame>
  );
}
