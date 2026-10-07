/**
 * Dt/Kt posting lines as the accountant types them: account and subkonto on each side, quantity
 * and currency amounts where the accounts keep them, amount and text. Used by the manual
 * operation and by an invoice's manual postings (1C "Əl ilə düzəliş").
 */
import { Copy, Plus, Trash2 } from 'lucide-react';
import { parseMoney } from '../domain/money';
import type { OperationLineInput } from '../contracts/commands';
import type { Catalog, PostingView } from '../contracts/queries';
import { addAmounts, money, toField } from './format';
import { AccountPicker, SubkontoFields } from './picker';

export interface EntryLine {
  key: number;
  dtAccount: string;
  dtSk: string[];
  ktAccount: string;
  ktSk: string[];
  amount: string;
  quantity: string;
  dtCur: string;
  ktCur: string;
  memo: string;
}
let keys = 0;
export const blankEntryLine = (): EntryLine => ({
  key: ++keys,
  dtAccount: '',
  dtSk: [],
  ktAccount: '',
  ktSk: [],
  amount: '',
  quantity: '',
  dtCur: '',
  ktCur: '',
  memo: '',
});

/** Lines of a posted entry; references to the document itself become the empty "this document". */
export function entryLinesFrom(postings: readonly PostingView[], self: string): EntryLine[] {
  const unself = (v: string[]) => v.map((x) => (x === self ? '' : x));
  return postings.map((p) => ({
    key: ++keys,
    dtAccount: p.dt.account,
    dtSk: unself(p.dt.sk),
    ktAccount: p.kt.account,
    ktSk: unself(p.kt.sk),
    amount: toField(p.amount),
    quantity: p.quantity.replace('.', ','),
    dtCur: toField(p.dt.curAmount),
    ktCur: toField(p.kt.curAmount),
    memo: p.memo,
  }));
}

export function toEntryInput(l: EntryLine): OperationLineInput {
  return {
    dtAccount: l.dtAccount,
    dtSk: l.dtSk,
    ktAccount: l.ktAccount,
    ktSk: l.ktSk,
    amount: l.amount.trim(),
    ...(l.quantity.trim() ? { quantity: l.quantity.trim() } : {}),
    ...(l.dtCur.trim() ? { dtCurAmount: l.dtCur.trim() } : {}),
    ...(l.ktCur.trim() ? { ktCurAmount: l.ktCur.trim() } : {}),
    memo: l.memo,
  };
}

/** Which line/side/slot a server error points at ("lines.2.kt.sk.1"). */
export function entryErrorAt(field: string | undefined, prefix = 'lines') {
  const m = new RegExp(
    `^${prefix}\\.(\\d+)(?:\\.(dt|kt))?(?:\\.(account|sk|amount|quantity|curAmount))?(?:\\.(\\d+))?`,
  ).exec(field ?? '');
  if (!m) return null;
  return {
    line: Number(m[1]),
    side: m[2] as 'dt' | 'kt' | undefined,
    part: m[3],
    slot: m[4] !== undefined ? Number(m[4]) : undefined,
  };
}

export function EntryGrid({
  catalog,
  companyId,
  lines,
  onChange,
  errorField,
  errorPrefix = 'lines',
  className = '',
}: {
  catalog: Catalog;
  companyId: string;
  lines: EntryLine[];
  onChange: (lines: EntryLine[]) => void;
  errorField?: string | undefined;
  errorPrefix?: string;
  className?: string;
}) {
  const setLine = (i: number, patch: Partial<EntryLine>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const err = entryErrorAt(errorField, errorPrefix);
  const acc = (code: string) => catalog.accounts.find((a) => a.code === code);
  const total = addAmounts(
    lines.map((l) => {
      try {
        const v = parseMoney(l.amount.trim());
        return `${v / 100n}.${String(v % 100n).padStart(2, '0')}`;
      } catch {
        return '0.00';
      }
    }),
  );
  const anyCurrency = lines.some((l) => acc(l.dtAccount)?.currency || acc(l.ktAccount)?.currency);
  const anyQty = lines.some(
    (l) => acc(l.dtAccount)?.quantitative || acc(l.ktAccount)?.quantitative,
  );
  return (
    <table className={`grid entry-grid ${className}`}>
      <thead>
        <tr>
          <th scope="col" className="n">
            №
          </th>
          <th scope="col">Debet hesabı və subkonto</th>
          <th scope="col">Kredit hesabı və subkonto</th>
          {anyQty && (
            <th scope="col" className="num narrow">
              Miqdar
            </th>
          )}
          {anyCurrency && (
            <th scope="col" className="num narrow">
              Valyuta
            </th>
          )}
          <th scope="col" className="num narrow">
            Məbləğ, AZN
          </th>
          <th scope="col">Məzmun</th>
          <th scope="col" className="n">
            <span className="sr-only">Əməliyyat</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => {
          const e = err && err.line === i ? err : null;
          const dt = acc(l.dtAccount);
          const kt = acc(l.ktAccount);
          return (
            <tr key={l.key} className={e ? 'has-error' : ''}>
              <td className="n">{i + 1}</td>
              <td className="side">
                <AccountPicker
                  catalog={catalog}
                  ariaLabel={`Sətir ${i + 1} debet hesabı`}
                  value={l.dtAccount}
                  invalid={e?.side === 'dt' && e.part === 'account'}
                  onChange={(dtAccount) => setLine(i, { dtAccount, dtSk: [], dtCur: '' })}
                />
                <SubkontoFields
                  catalog={catalog}
                  companyId={companyId}
                  account={l.dtAccount}
                  values={l.dtSk}
                  side={`Sətir ${i + 1} debet`}
                  onChange={(dtSk) => setLine(i, { dtSk })}
                  {...(e?.side === 'dt' && e.part === 'sk' && e.slot !== undefined
                    ? { errorIndex: e.slot }
                    : {})}
                />
              </td>
              <td className="side">
                <AccountPicker
                  catalog={catalog}
                  ariaLabel={`Sətir ${i + 1} kredit hesabı`}
                  value={l.ktAccount}
                  invalid={e?.side === 'kt' && e.part === 'account'}
                  onChange={(ktAccount) => setLine(i, { ktAccount, ktSk: [], ktCur: '' })}
                />
                <SubkontoFields
                  catalog={catalog}
                  companyId={companyId}
                  account={l.ktAccount}
                  values={l.ktSk}
                  side={`Sətir ${i + 1} kredit`}
                  onChange={(ktSk) => setLine(i, { ktSk })}
                  {...(e?.side === 'kt' && e.part === 'sk' && e.slot !== undefined
                    ? { errorIndex: e.slot }
                    : {})}
                />
              </td>
              {anyQty && (
                <td className="num narrow">
                  {(dt?.quantitative || kt?.quantitative) && (
                    <input
                      aria-label={`Sətir ${i + 1} miqdar`}
                      inputMode="decimal"
                      className={e?.part === 'quantity' ? 'invalid' : ''}
                      value={l.quantity}
                      onChange={(ev) => setLine(i, { quantity: ev.target.value })}
                    />
                  )}
                </td>
              )}
              {anyCurrency && (
                <td className="num narrow">
                  {dt?.currency && (
                    <input
                      aria-label={`Sətir ${i + 1} debet valyuta məbləği`}
                      placeholder="Dt val."
                      inputMode="decimal"
                      value={l.dtCur}
                      onChange={(ev) => setLine(i, { dtCur: ev.target.value })}
                    />
                  )}
                  {kt?.currency && (
                    <input
                      aria-label={`Sətir ${i + 1} kredit valyuta məbləği`}
                      placeholder="Kt val."
                      inputMode="decimal"
                      value={l.ktCur}
                      onChange={(ev) => setLine(i, { ktCur: ev.target.value })}
                    />
                  )}
                </td>
              )}
              <td className="num narrow">
                <input
                  aria-label={`Sətir ${i + 1} məbləğ`}
                  inputMode="decimal"
                  placeholder="0,00"
                  className={e?.part === 'amount' ? 'invalid' : ''}
                  value={l.amount}
                  onChange={(ev) => setLine(i, { amount: ev.target.value })}
                />
              </td>
              <td>
                <input
                  aria-label={`Sətir ${i + 1} məzmun`}
                  maxLength={300}
                  value={l.memo}
                  onChange={(ev) => setLine(i, { memo: ev.target.value })}
                />
              </td>
              <td className="n row-tools">
                <button
                  type="button"
                  className="icon-button"
                  title="Sətri köçür"
                  aria-label={`Sətir ${i + 1} köçür`}
                  onClick={() =>
                    onChange([
                      ...lines.slice(0, i + 1),
                      { ...l, key: ++keys },
                      ...lines.slice(i + 1),
                    ])
                  }
                >
                  <Copy size={13} />
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  title="Sətri sil"
                  aria-label={`Sətir ${i + 1} sil`}
                  disabled={lines.length === 1}
                  onClick={() => onChange(lines.filter((_, j) => j !== i))}
                >
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={3 + (anyQty ? 1 : 0) + (anyCurrency ? 1 : 0)}>
            <button
              type="button"
              className="button secondary small"
              onClick={() => onChange([...lines, blankEntryLine()])}
            >
              <Plus size={14} /> Sətir əlavə et
            </button>
          </td>
          <td className="num">
            <b>{money(total)}</b>
          </td>
          <td colSpan={2}>{lines.length} yazılış</td>
        </tr>
      </tfoot>
    </table>
  );
}
