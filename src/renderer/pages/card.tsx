import { useState } from 'react';
import { FileDown } from '../icons';
import type { AccountCard } from '../../contracts/queries';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { RangeFields, useRange } from '../filters';
import { day, money, qty } from '../format';
import { useQuery } from '../hooks';
import { pages } from '../pages';
import { Picker, subkontoOptions } from '../picker';
import { Notice } from '../ui';
import { useWindow, useWorkspace } from '../workspace';
import { workbook } from '../xlsx';
import { subkontoLabel } from '../../domain/chart';

export function CardPage({
  initial,
}: {
  initial?: { account: string; sk?: string[]; from?: string; to?: string };
}) {
  const win = useWindow();
  const ws = useWorkspace();
  const openSource = (
    l: Pick<AccountCard['lines'][number], 'sourceType' | 'sourceId' | 'direction'>,
  ) => {
    if (l.sourceType === 'operation') ws.open({ type: 'operation', id: l.sourceId }, win.companyId);
    if (l.sourceType === 'invoice' && (l.direction === 'sale' || l.direction === 'purchase'))
      ws.open({ type: 'invoice', direction: l.direction, id: l.sourceId }, win.companyId);
    if (l.sourceType === 'bank' && (l.direction === 'in' || l.direction === 'out'))
      ws.open({ type: 'bank', direction: l.direction, id: l.sourceId }, win.companyId);
    if (l.sourceType === 'cash' && (l.direction === 'in' || l.direction === 'out'))
      ws.open({ type: 'cash', direction: l.direction, id: l.sourceId }, win.companyId);
  };
  const { catalog } = useCatalog(win.companyId);
  const range = useRange({
    from: initial?.from ?? ws.period.from,
    to: initial?.to ?? ws.period.to,
  });
  const [account, setAccount] = useState(initial?.account ?? '');
  const [sk, setSk] = useState<string[]>(initial?.sk ?? []);
  const [msg, setMsg] = useState('');
  // The card by levels (05.11.2026): partner, contract, invoice, documents; ⊞ / ⊟ open a level.
  // "Müxabir hesablarla" shows every posting with its accounts instead.
  const [postings, setPostings] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const card = useQuery<AccountCard>(
    account
      ? { type: 'accountCard', companyId: win.companyId, account, sk, ...range.applied }
      : null,
  );
  const acc = catalog?.accounts.find((a) => a.code === account);
  const accountOptions = (catalog?.accounts ?? [])
    .filter((a) => !a.archived)
    .map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }));
  const c = card.data;
  const exportXlsx = async () => {
    if (!c) return;
    const bytes = postings ? detailedBook(c) : treeBook(c);
    try {
      const file = await api.saveFile(`Hesab kartı ${c.account}.xlsx`, bytes);
      if (file) setMsg(`Saxlanıldı: ${file}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const treeBook = (c: AccountCard) =>
    workbook({
      name: `Hesab kartı ${c.account}`,
      title: [
        `${catalog?.company.name ?? ''}`,
        `${c.account} hesabının kartı · ${c.name}${c.filter ? ` · ${c.filter}` : ''}`,
        `${day(range.applied.from)} – ${day(range.applied.to)}`,
      ],
      header: ['Analitika / sənəd', 'Əvvələ saldo', '', 'Debet', 'Kredit', 'Sonuna saldo', ''],
      widths: [60, 6, 16, 16, 16, 6, 16],
      rows: [
        ...c.tree.map((n) => [
          `${'   '.repeat(n.level)}${n.label}`,
          n.kind === 'group' ? side(n.opening) : '',
          n.kind === 'group' ? { money: n.opening.replace('-', '') } : '',
          { money: n.debit },
          { money: n.credit },
          n.kind === 'group' ? side(n.closing) : '',
          n.kind === 'group' ? { money: n.closing.replace('-', '') } : '',
        ]),
        [
          'Cəmi',
          side(c.opening),
          { money: c.opening.replace('-', '') },
          { money: c.turnDt },
          { money: c.turnKt },
          side(c.closing),
          { money: c.closing.replace('-', '') },
        ],
      ],
    });
  const detailedBook = (c: AccountCard) =>
    workbook({
      name: `Hesab kartı ${c.account}`,
      title: [
        `${catalog?.company.name ?? ''}`,
        `${c.account} hesabının kartı · ${c.name}${c.filter ? ` · ${c.filter}` : ''}`,
        `${day(range.applied.from)} – ${day(range.applied.to)}`,
      ],
      header: [
        'Tarix',
        'Sənəd',
        'Analitika Dt',
        'Analitika Kt',
        'Debet: hesab',
        'Debet: məbləğ',
        'Kredit: hesab',
        'Kredit: məbləğ',
        'Miqdar',
        'Saldo',
        'Cari saldo',
      ],
      widths: [11, 26, 36, 36, 10, 15, 10, 15, 10, 6, 16],
      rows: [
        [
          '',
          'Dövrün əvvəlinə saldo',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          side(c.opening),
          { money: c.opening.replace('-', '') },
        ],
        ...c.lines.map((l) => [
          day(l.date),
          `${l.document}${l.storno ? ' (storno)' : ''}`,
          l.dtAnalytics.join(', '),
          l.ktAnalytics.join(', '),
          l.dtAccount,
          { money: l.debit },
          l.ktAccount,
          { money: l.credit },
          { qty: l.qty },
          side(l.balance),
          { money: l.balance.replace('-', '') },
        ]),
        [
          '',
          'Dövr üzrə dövriyyə',
          '',
          '',
          '',
          { money: c.turnDt },
          '',
          { money: c.turnKt },
          '',
          '',
          '',
        ],
        [
          '',
          'Dövrün sonuna saldo',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          side(c.closing),
          { money: c.closing.replace('-', '') },
        ],
      ],
    });
  // Cari saldo as in 1C: the side (D / K) and the amount apart.
  const side = (v: string) => (!v || v === '0.00' ? '' : v.startsWith('-') ? 'K' : 'D');
  const amount = (v: string) => (!v || v === '0.00' ? '0,00' : money(v.replace('-', '')));
  return (
    <ModuleFrame
      title={c ? `Hesab kartı ${c.account}` : pages.card.title}
      hint={c ? `${c.name}${c.filter ? ` · ${c.filter}` : ''}` : 'Hesabı seçin'}
      onRefresh={card.reload}
      onFilter={range.apply}
      actions={
        <button
          type="button"
          className="button secondary"
          disabled={!c}
          onClick={() => void exportXlsx()}
        >
          <FileDown size={15} /> Excel
        </button>
      }
      filters={
        <>
          <span className="filter-picker wide">
            <Picker
              ariaLabel="Hesab"
              placeholder="Hesab"
              value={account}
              options={accountOptions}
              onChange={(v) => (setAccount(v), setSk([]))}
            />
          </span>
          {catalog &&
            acc?.subkonto.map((kind, i) =>
              kind === 'document' ? null : (
                <span key={kind} className="filter-picker">
                  <Picker
                    ariaLabel={subkontoLabel[kind]}
                    value={sk[i] ?? ''}
                    emptyLabel={`Bütün: ${subkontoLabel[kind].toLowerCase()}`}
                    options={subkontoOptions(
                      catalog,
                      kind,
                      account,
                      sk[acc.subkonto.indexOf('partner')] ?? '',
                    )}
                    onChange={(v) => {
                      const next = acc.subkonto.map((_, j) =>
                        j < i ? (sk[j] ?? '') : j === i ? v : '',
                      );
                      while (next.length && !next[next.length - 1]) next.pop();
                      // A filter on a later slot needs the earlier ones (prefix).
                      setSk(
                        next.some((x, j) => !x && j < next.length)
                          ? next.slice(
                              0,
                              next.findIndex((x) => !x),
                            )
                          : next,
                      );
                    }}
                  />
                </span>
              ),
            )}
          <label className="check">
            <input
              type="checkbox"
              checked={postings}
              onChange={(e) => setPostings(e.target.checked)}
            />
            Müxabir hesablarla
          </label>
          <RangeFields range={range} />
        </>
      }
      notices={
        <>
          {card.error && <Notice>{card.error}</Notice>}
          {msg && (
            <Notice kind="success" onClose={() => setMsg('')}>
              {msg}
            </Notice>
          )}
          {c?.truncated && (
            <Notice kind="warning">
              Siyahı 20 000 sətirlə məhdudlaşdırılıb; cəmlər tamdır. Dövrü daraldın.
            </Notice>
          )}
        </>
      }
    >
      {!account && <p className="panel-empty">Hesab seçin (məsələn 223.01 və ya 211).</p>}
      {c && (
        <div className="table-scroll">
          {/* As in 1C: the report sheet with the company, the title, the period and the filter. */}
          <div className="report-head">
            <b>{catalog?.company.name}</b>
            <h2>{c.account} hesabının kartı</h2>
            <p>
              Dövr: {day(range.applied.from)} – {day(range.applied.to)}
              {c.filter ? ` · ${c.filter}` : ''}
            </p>
          </div>
          {!postings && <CardTree c={c} open={open} toggle={toggle} onOpen={openSource} />}
          {/* 1C's "Карточка счета": analytics apart, each amount beside its account. */}
          {postings && (
            <table className="grid card onec">
              <thead>
                <tr>
                  <th scope="col" rowSpan={2}>
                    Tarix
                  </th>
                  <th scope="col" rowSpan={2}>
                    Sənəd
                  </th>
                  <th scope="col" rowSpan={2}>
                    Analitika Dt
                  </th>
                  <th scope="col" rowSpan={2}>
                    Analitika Kt
                  </th>
                  <th scope="colgroup" colSpan={2}>
                    Debet
                  </th>
                  <th scope="colgroup" colSpan={2}>
                    Kredit
                  </th>
                  <th scope="colgroup" colSpan={2}>
                    Cari saldo
                  </th>
                </tr>
                <tr>
                  <th scope="col">Hesab</th>
                  <th scope="col" className="num">
                    Məbləğ
                  </th>
                  <th scope="col">Hesab</th>
                  <th scope="col" className="num">
                    Məbləğ
                  </th>
                  <th scope="col" className="side" aria-label="Saldonun tərəfi" />
                  <th scope="col" className="num">
                    Məbləğ
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="opening">
                  <td colSpan={8}>Dövrün əvvəlinə saldo</td>
                  <td className="side">{side(c.opening)}</td>
                  <td className="num">{amount(c.opening)}</td>
                </tr>
                {c.lines.map((l, i) => (
                  <tr
                    key={i}
                    className={l.storno ? 'storno' : ''}
                    onDoubleClick={() => openSource(l)}
                  >
                    <td>{day(l.date)}</td>
                    <td className="doc">
                      {['operation', 'invoice', 'bank', 'cash'].includes(l.sourceType) ? (
                        <button type="button" className="link" onClick={() => openSource(l)}>
                          {l.document}
                        </button>
                      ) : (
                        l.document
                      )}
                      {l.storno && <small className="storno-tag">storno</small>}
                    </td>
                    <td className="analytics">
                      {l.dtAnalytics.map((v, k) => (
                        <div key={k}>{v}</div>
                      ))}
                    </td>
                    <td className="analytics">
                      {l.ktAnalytics.map((v, k) => (
                        <div key={k}>{v}</div>
                      ))}
                    </td>
                    <td className="code">{l.dtAccount}</td>
                    <td className="num">
                      {l.debit ? money(l.debit) : ''}
                      {l.qty && l.debit && <small>{qty(l.qty)}</small>}
                    </td>
                    <td className="code">{l.ktAccount}</td>
                    <td className="num">
                      {l.credit ? money(l.credit) : ''}
                      {l.qty && l.credit && <small>{qty(l.qty)}</small>}
                    </td>
                    <td className="side">{side(l.balance)}</td>
                    <td className="num">{amount(l.balance)}</td>
                  </tr>
                ))}
                <tr className="turnover">
                  <td colSpan={5}>Dövr üzrə dövriyyə</td>
                  <td className="num">{money(c.turnDt)}</td>
                  <td />
                  <td className="num">{money(c.turnKt)}</td>
                  <td />
                  <td />
                </tr>
                <tr className="closing">
                  <td colSpan={8}>Dövrün sonuna saldo</td>
                  <td className="side">{side(c.closing)}</td>
                  <td className="num">{amount(c.closing)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </ModuleFrame>
  );
}

const sideOf = (v: string) => (!v || v === '0.00' ? '' : v.startsWith('-') ? 'K' : 'D');
const amountOf = (v: string) => (!v || v === '0.00' ? '0,00' : money(v.replace('-', '')));
type Source = Pick<AccountCard['lines'][number], 'sourceType' | 'sourceId' | 'direction'>;

/** The card by levels: each row a level of analytics with its saldo, the last level documents. */
function CardTree({
  c,
  open,
  toggle,
  onOpen,
}: {
  c: AccountCard;
  open: Set<string>;
  toggle: (key: string) => void;
  onOpen: (l: Source) => void;
}) {
  const shown = new Set<string>(['']);
  const kids = new Set(c.tree.map((n) => n.parent));
  const rows = c.tree.filter((n) => {
    const visible = shown.has(n.parent) && (n.parent === '' || open.has(n.parent));
    if (visible) shown.add(n.key);
    return visible;
  });
  return (
    <table className="grid card onec tree">
      <thead>
        <tr>
          <th scope="col">Kontragent / müqavilə / sənəd</th>
          <th scope="colgroup" colSpan={2}>
            Əvvələ saldo
          </th>
          <th scope="col" className="num">
            Debet
          </th>
          <th scope="col" className="num">
            Kredit
          </th>
          <th scope="colgroup" colSpan={2}>
            Sonuna saldo
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((n) =>
          n.kind === 'group' ? (
            <tr key={n.key} className={`lvl${n.level}`}>
              <td style={{ paddingLeft: `${6 + n.level * 18}px` }}>
                {kids.has(n.key) ? (
                  <button
                    type="button"
                    className="gut-mark"
                    aria-label={`${open.has(n.key) ? 'Bağla' : 'Aç'}: ${n.label}`}
                    onClick={() => toggle(n.key)}
                  >
                    {open.has(n.key) ? '⊟' : '⊞'}
                  </button>
                ) : (
                  <span className="gut-mark" />
                )}
                {n.label}
              </td>
              <td className="side">{sideOf(n.opening)}</td>
              <td className="num">{amountOf(n.opening)}</td>
              <td className="num">{n.debit ? money(n.debit) : ''}</td>
              <td className="num">{n.credit ? money(n.credit) : ''}</td>
              <td className="side">{sideOf(n.closing)}</td>
              <td className="num">{amountOf(n.closing)}</td>
            </tr>
          ) : (
            <tr key={n.key} className="move">
              <td style={{ paddingLeft: `${24 + n.level * 18}px` }}>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    onOpen({
                      sourceType: n.sourceType ?? '',
                      sourceId: n.sourceId ?? '',
                      direction: n.direction ?? '',
                    })
                  }
                >
                  {n.label}
                </button>
              </td>
              <td />
              <td />
              <td className="num">{n.debit ? money(n.debit) : ''}</td>
              <td className="num">{n.credit ? money(n.credit) : ''}</td>
              <td />
              <td />
            </tr>
          ),
        )}
        <tr className="closing">
          <td>Cəmi</td>
          <td className="side">{sideOf(c.opening)}</td>
          <td className="num">{amountOf(c.opening)}</td>
          <td className="num">{money(c.turnDt)}</td>
          <td className="num">{money(c.turnKt)}</td>
          <td className="side">{sideOf(c.closing)}</td>
          <td className="num">{amountOf(c.closing)}</td>
        </tr>
      </tbody>
    </table>
  );
}
