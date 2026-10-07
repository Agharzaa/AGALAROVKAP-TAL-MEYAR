import { useState } from 'react';
import { FileDown } from 'lucide-react';
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
    if (l.sourceType === 'invoice' && l.direction)
      ws.open({ type: 'invoice', direction: l.direction, id: l.sourceId }, win.companyId);
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
        `Hesab kartı ${c.account} ${c.name}${c.filter ? ` · ${c.filter}` : ''}`,
        `${day(range.applied.from)} – ${day(range.applied.to)}`,
      ],
      header: [
        'Tarix',
        'Sənəd',
        'Məzmun',
        'Subkonto',
        'Müxabir hesab',
        'Müxabir subkonto',
        'Debet',
        'Kredit',
        'Miqdar',
        'Qalıq',
      ],
      widths: [11, 14, 30, 34, 10, 34, 15, 15, 10, 16],
      rows: [
        ['', '', 'Dövrün əvvəlinə qalıq', '', '', '', '', '', '', { money: c.opening }],
        ...c.lines.map((l) => [
          day(l.date),
          `${l.number}${l.storno ? ' (storno)' : ''}`,
          l.memo,
          l.sk,
          l.corrAccount,
          l.corrSk,
          { money: l.debit },
          { money: l.credit },
          { qty: l.qty },
          { money: l.balance },
        ]),
        [
          '',
          '',
          'Dövriyyə və sona qalıq',
          '',
          '',
          '',
          { money: c.turnDt },
          { money: c.turnKt },
          '',
          { money: c.closing },
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
  const balance = (v: string) => {
    if (!v || v === '0.00') return '0,00';
    return v.startsWith('-') ? `${money(v.slice(1))} Kt` : `${money(v)} Dt`;
  };
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
            <Notice kind="info">
              Siyahı 20 000 sətirlə məhdudlaşdırılıb; cəmlər tamdır. Dövrü daraldın.
            </Notice>
          )}
        </>
      }
    >
      {!account && <p className="panel-empty">Hesab seçin (məsələn 223.01 və ya 211).</p>}
      {c && (
        <div className="table-scroll">
          <table className="grid card">
            <thead>
              <tr>
                <th scope="col">Tarix</th>
                <th scope="col">Sənəd</th>
                <th scope="col">Məzmun</th>
                <th scope="col">Subkonto</th>
                <th scope="col">Müxabir hesab</th>
                <th scope="col" className="num">
                  Debet
                </th>
                <th scope="col" className="num">
                  Kredit
                </th>
                <th scope="col" className="num">
                  Qalıq
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="opening">
                <td colSpan={5}>Dövrün əvvəlinə qalıq</td>
                <td />
                <td />
                <td className="num strong">{balance(c.opening)}</td>
              </tr>
              {c.lines.map((l, i) => (
                <tr
                  key={i}
                  className={l.storno ? 'storno' : ''}
                  onDoubleClick={() => openSource(l)}
                >
                  <td>{day(l.date)}</td>
                  <td>
                    {l.sourceType === 'operation' || l.sourceType === 'invoice' ? (
                      <button type="button" className="link" onClick={() => openSource(l)}>
                        {l.number}
                      </button>
                    ) : (
                      l.number
                    )}
                    {l.storno && <small className="storno-tag">storno</small>}
                  </td>
                  <td className="ellipsis" title={l.memo}>
                    {l.memo}
                  </td>
                  <td className="ellipsis" title={l.sk}>
                    {l.sk}
                    {l.qty && <small> · {qty(l.qty)}</small>}
                  </td>
                  <td className="ellipsis" title={`${l.corrAccount} ${l.corrSk}`}>
                    <span className="code">{l.corrAccount}</span> {l.corrSk}
                  </td>
                  <td className="num">{l.debit ? money(l.debit) : ''}</td>
                  <td className="num">{l.credit ? money(l.credit) : ''}</td>
                  <td className="num">{balance(l.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Dövriyyə və sona qalıq</td>
                <td className="num">{money(c.turnDt)}</td>
                <td className="num">{money(c.turnKt)}</td>
                <td className="num">{balance(c.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ModuleFrame>
  );
}
