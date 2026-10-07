import { useMemo, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, FileDown, FoldVertical } from 'lucide-react';
import type { TrialBalance, TrialRow } from '../../contracts/queries';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { RangeFields, useRange } from '../filters';
import { day, money, qty } from '../format';
import { useQuery } from '../hooks';
import { pages } from '../pages';
import { Picker } from '../picker';
import { Notice } from '../ui';
import { useWindow, useWorkspace } from '../workspace';
import { workbook } from '../xlsx';

const cell = (v: string) => (v ? money(v) : '');

export function TrialPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const range = useRange(ws.period);
  const [expand, setExpand] = useState<string[]>([]);
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
    onlyMoved,
    onlyArising,
    accounts,
    ...(partnerId ? { partnerId } : {}),
  });
  const tb = result.data;
  const rows = tb?.rows ?? [];
  const toggle = (r: TrialRow) => {
    if (!r.expandable) return;
    setExpand((list) =>
      list.includes(r.key)
        ? list.filter((k) => k !== r.key && !k.startsWith(`${r.key}|`))
        : [...list, r.key],
    );
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
  const exportXlsx = async () => {
    if (!tb) return;
    const company = catalog?.company;
    const bytes = workbook({
      name: 'Dövriyyə balansı',
      title: [
        `${company?.name ?? ''} · VÖEN ${company?.taxId ?? ''}`,
        `Dövriyyə balansı: ${day(tb.from)} – ${day(tb.to)}`,
      ],
      header: [
        'Hesab',
        'Ad / subkonto',
        'Əvvələ qalıq Dt',
        'Əvvələ qalıq Kt',
        'Dövriyyə Dt',
        'Dövriyyə Kt',
        'Sona qalıq Dt',
        'Sona qalıq Kt',
        'Miqdar (son)',
        'Valyuta (son)',
      ],
      widths: [10, 48, 16, 16, 16, 16, 16, 16, 12, 14],
      rows: [
        ...tb.rows.map((r) => [
          r.kind === 'account' ? r.account : '',
          `${'   '.repeat(r.level)}${r.label}`,
          { money: r.openDt },
          { money: r.openKt },
          { money: r.turnDt },
          { money: r.turnKt },
          { money: r.closeDt },
          { money: r.closeKt },
          { qty: r.closeQty },
          r.closeCur ? `${money(r.closeCur)} ${r.currency}` : '',
        ]),
        [
          '',
          'Cəmi',
          { money: tb.totals.openDt },
          { money: tb.totals.openKt },
          { money: tb.totals.turnDt },
          { money: tb.totals.turnKt },
          { money: tb.totals.closeDt },
          { money: tb.totals.closeKt },
          '',
          '',
        ],
      ],
    });
    try {
      const file = await api.saveFile(`DBC ${tb.from} ${tb.to}.xlsx`, bytes);
      if (file) setExportMsg(`Saxlanıldı: ${file}`);
    } catch (e) {
      setExportMsg((e as Error).message);
    }
  };
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
          <button
            type="button"
            className="button secondary"
            disabled={!expand.length}
            onClick={() => setExpand([])}
          >
            <FoldVertical size={15} /> Hamısını yığ
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={!tb}
            onClick={() => void exportXlsx()}
          >
            <FileDown size={15} /> Excel
          </button>
        </>
      }
      filters={
        <>
          <RangeFields range={range} />
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
        <table className="grid trial">
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="trial-name">
                Hesab / subkonto
              </th>
              <th scope="colgroup" colSpan={2}>
                Əvvələ qalıq
              </th>
              <th scope="colgroup" colSpan={2} className="turn">
                Dövriyyə
              </th>
              <th scope="colgroup" colSpan={2}>
                Sona qalıq
              </th>
            </tr>
            <tr>
              <th scope="col" className="num">
                Debet
              </th>
              <th scope="col" className="num">
                Kredit
              </th>
              <th scope="col" className="num turn">
                Debet
              </th>
              <th scope="col" className="num turn">
                Kredit
              </th>
              <th scope="col" className="num">
                Debet
              </th>
              <th scope="col" className="num">
                Kredit
              </th>
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
                <td className="trial-name">
                  <span className="tree-cell" style={{ paddingLeft: `${r.level * 18}px` }}>
                    {r.expandable ? (
                      <button
                        type="button"
                        className="tree-toggle"
                        aria-label={`${r.expanded ? 'Bağla' : 'Aç'}: ${r.label}`}
                        aria-expanded={r.expanded}
                        onClick={(e) => (e.stopPropagation(), toggle(r))}
                      >
                        {r.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                    ) : (
                      <span className="tree-space" />
                    )}
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
                <td className="num turn">
                  {cell(r.turnDt)}
                  {r.turnQtyDt && <small>{qty(r.turnQtyDt)}</small>}
                </td>
                <td className="num turn">
                  {cell(r.turnKt)}
                  {r.turnQtyKt && <small>{qty(r.turnQtyKt)}</small>}
                </td>
                <td className="num strong">{cell(r.closeDt)}</td>
                <td className="num strong">{cell(r.closeKt)}</td>
              </tr>
            ))}
            {tb && !rows.length && (
              <tr>
                <td colSpan={7} className="panel-empty">
                  Bu dövrdə və seçilən filtrdə qalıq və dövriyyə yoxdur.
                </td>
              </tr>
            )}
          </tbody>
          {tb && (
            <tfoot>
              <tr>
                <td>Cəmi</td>
                <td className="num">{money(tb.totals.openDt)}</td>
                <td className="num">{money(tb.totals.openKt)}</td>
                <td className="num turn">{money(tb.totals.turnDt)}</td>
                <td className="num turn">{money(tb.totals.turnKt)}</td>
                <td className="num">{money(tb.totals.closeDt)}</td>
                <td className="num">{money(tb.totals.closeKt)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="table-hint">
        Sətrə iki dəfə vurun və ya Enter basın — hesab kartı açılır. ← → açır/bağlayır. Debitor və
        kreditor qalıqları açıq saldo ilə göstərilir.
      </p>
    </ModuleFrame>
  );
}
