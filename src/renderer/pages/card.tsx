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
          {/* 1C's "Карточка счета": analytics apart, each amount beside its account. */}
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
        </div>
      )}
    </ModuleFrame>
  );
}
