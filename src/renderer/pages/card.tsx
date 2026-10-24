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
  const openSource = (l: AccountCard['lines'][number]) => {
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
    const bytes = workbook({
      name: `Hesab kartı ${c.account}`,
      title: [
        `${catalog?.company.name ?? ''}`,
        `${c.account} hesabının kartı · ${c.name}${c.filter ? ` · ${c.filter}` : ''}`,
        `${day(range.applied.from)} – ${day(range.applied.to)}`,
      ],
      header: [
        'Tarix',
        'Sənəd',
        'Məzmun',
        'Debet (hesab, subkonto)',
        'Kredit (hesab, subkonto)',
        'Dövriyyə Debet',
        'Dövriyyə Kredit',
        'Miqdar',
        'Saldo',
        'Cari saldo',
      ],
      widths: [11, 16, 30, 40, 40, 15, 15, 10, 6, 16],
      rows: [
        [
          '',
          '',
          'Dövrün əvvəlinə saldo',
          '',
          '',
          '',
          '',
          '',
          side(c.opening),
          { money: c.opening.replace('-', '') },
        ],
        ...c.lines.map((l) => {
          const own = `${l.account} ${l.sk}`.trim();
          const corr = `${l.corrAccount} ${l.corrSk}`.trim();
          return [
            day(l.date),
            `${l.number}${l.storno ? ' (storno)' : ''}`,
            l.memo,
            l.debit ? own : corr,
            l.debit ? corr : own,
            { money: l.debit },
            { money: l.credit },
            { qty: l.qty },
            side(l.balance),
            { money: l.balance.replace('-', '') },
          ];
        }),
        ['', '', 'Dövriyyə', '', '', { money: c.turnDt }, { money: c.turnKt }, '', '', ''],
        [
          '',
          '',
          'Dövrün sonuna saldo',
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
    try {
      const file = await api.saveFile(`Hesab kartı ${c.account}.xlsx`, bytes);
      if (file) setMsg(`Saxlanıldı: ${file}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
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
          <table className="grid card onec">
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>
                  Tarix
                </th>
                <th scope="col" rowSpan={2}>
                  Sənəd
                </th>
                <th scope="colgroup" colSpan={2}>
                  Əməliyyat
                </th>
                <th scope="colgroup" colSpan={2}>
                  Dövriyyə
                </th>
                <th scope="colgroup" colSpan={2}>
                  Cari saldo
                </th>
              </tr>
              <tr>
                <th scope="col">Debet (hesab, subkonto)</th>
                <th scope="col">Kredit (hesab, subkonto)</th>
                <th scope="col" className="num">
                  Debet
                </th>
                <th scope="col" className="num">
                  Kredit
                </th>
                <th scope="col" className="side" aria-label="Saldonun tərəfi" />
                <th scope="col" className="num">
                  Məbləğ
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="opening">
                <td colSpan={6}>Dövrün əvvəlinə saldo</td>
                <td className="side">{side(c.opening)}</td>
                <td className="num">{amount(c.opening)}</td>
              </tr>
              {c.lines.map((l, i) => {
                // This account on the side of the line's amount, the corresponding one opposite.
                const own = (
                  <>
                    <span className="code">{l.account}</span>
                    <small>{l.sk}</small>
                  </>
                );
                const corr = (
                  <>
                    <span className="code">{l.corrAccount}</span>
                    <small>{l.corrSk}</small>
                  </>
                );
                return (
                  <tr
                    key={i}
                    className={l.storno ? 'storno' : ''}
                    onDoubleClick={() => openSource(l)}
                  >
                    <td>{day(l.date)}</td>
                    <td>
                      {['operation', 'invoice', 'bank', 'cash'].includes(l.sourceType) ? (
                        <button type="button" className="link" onClick={() => openSource(l)}>
                          {l.number}
                        </button>
                      ) : (
                        l.number
                      )}
                      {l.storno && <small className="storno-tag">storno</small>}
                      {l.memo && <small className="memo">{l.memo}</small>}
                    </td>
                    <td className="entry">{l.debit ? own : corr}</td>
                    <td className="entry">{l.debit ? corr : own}</td>
                    <td className="num">
                      {l.debit ? money(l.debit) : ''}
                      {l.qty && l.debit && <small>{qty(l.qty)}</small>}
                    </td>
                    <td className="num">
                      {l.credit ? money(l.credit) : ''}
                      {l.qty && l.credit && <small>{qty(l.qty)}</small>}
                    </td>
                    <td className="side">{side(l.balance)}</td>
                    <td className="num">{amount(l.balance)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Dövriyyə</td>
                <td className="num">{money(c.turnDt)}</td>
                <td className="num">{money(c.turnKt)}</td>
                <td />
                <td />
              </tr>
              <tr>
                <td colSpan={6}>Dövrün sonuna saldo</td>
                <td className="side">{side(c.closing)}</td>
                <td className="num">{amount(c.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ModuleFrame>
  );
}
