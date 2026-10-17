/**
 * The lines of a money document — bank document or cash order: counter account with its subkonto,
 * amount, memo and cash-flow item. One holder (bank account / cashbox) gives the other side of each
 * posting; the server matches a 211 line of a receipt (531 of a payment) left without a settlement
 * document to the open invoices.
 */
import { useMemo } from 'react';
import { Copy, Plus, Trash2 } from './icons';
import { formatMinor, parseMoney } from '../domain/money';
import { AZN_RATE, toAzn } from '../domain/invoice';
import { parsePrice } from '../domain/quantity';
import type { BankLineInput } from '../contracts/commands';
import type { BankLineView, Catalog } from '../contracts/queries';
import { entryErrorAt } from './entry-grid';
import { money, toField } from './format';
import { AccountPicker, Picker, SubkontoFields, type Option } from './picker';

export type Direction = 'in' | 'out';
export interface LineForm {
  key: number;
  account: string;
  sk: string[];
  amount: string;
  curAmount: string;
  cashFlowItem: string;
  memo: string;
}

let keys = 0;
export const blankLine = (account = ''): LineForm => ({
  key: ++keys,
  account,
  sk: [],
  amount: '',
  curAmount: '',
  cashFlowItem: '',
  memo: '',
});

export const linesFromView = (lines: readonly BankLineView[]): LineForm[] =>
  lines.map((l) => ({
    key: ++keys,
    account: l.account,
    sk: l.sk,
    amount: toField(l.amount),
    curAmount: toField(l.curAmount),
    cashFlowItem: l.cashFlowItem,
    memo: l.memo,
  }));

export const toLineInput = (l: LineForm): BankLineInput => ({
  account: l.account,
  sk: l.sk,
  amount: l.amount.trim(),
  ...(l.curAmount.trim() ? { curAmount: l.curAmount.trim() } : {}),
  cashFlowItem: l.cashFlowItem,
  memo: l.memo,
});

/** "Əməliyyat növü": a template only fills the counter account(s) of new lines. */
export interface Template {
  label: string;
  accounts: string[];
}
/** Settlement accounts follow the holder's currency: 211 → 211.01 (AZN) / 211.02 (currency). */
const currencyGroups = ['211', '531', '243', '543', '244'];
export const resolveTemplate = (code: string, foreign: boolean) =>
  currencyGroups.includes(code) ? `${code}.${foreign ? '02' : '01'}` : code;

/** Applies a template: replaces an empty form's lines, otherwise adds to them. */
export function withTemplate(lines: LineForm[], t: Template, foreign: boolean): LineForm[] {
  const empty = lines.every((l) => !l.account && !l.amount.trim());
  const added = t.accounts.map((code) => blankLine(resolveTemplate(code, foreign)));
  return empty ? added : [...lines, ...added];
}

const minor = (value: string): bigint | null => {
  try {
    return parseMoney(value.trim());
  } catch {
    return null;
  }
};

/** The document's rate as typed, AZN_RATE for an AZN holder, null while it does not parse. */
export function typedRate(foreign: boolean, input: string): bigint | null {
  if (!foreign) return AZN_RATE;
  try {
    return parsePrice(input.trim());
  } catch {
    return null;
  }
}

export function MoneyLines({
  catalog,
  companyId,
  direction,
  currency,
  rate,
  lines,
  onChange,
  errorField,
}: {
  catalog: Catalog;
  companyId: string;
  direction: Direction;
  currency: string;
  rate: bigint | null;
  lines: LineForm[];
  onChange: (lines: LineForm[]) => void;
  errorField: string | undefined;
}) {
  const incoming = direction === 'in';
  const foreign = currency !== 'AZN';
  const err = entryErrorAt(errorField);
  const acc = (code: string) => catalog.accounts.find((a) => a.code === code);
  const cashFlowOptions = useMemo(
    (): Option[] =>
      catalog.items
        .filter((i) => i.kind === 'cashFlowItem' && !i.archived)
        .map((i) => ({ value: i.id, label: i.name })),
    [catalog],
  );
  const setLine = (i: number, patch: Partial<LineForm>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const amounts = lines.map((l) => minor(l.amount));
  const total = amounts.reduce<bigint>((s, a) => s + (a ?? 0n), 0n);
  const totalAzn =
    rate === null ? null : amounts.reduce<bigint>((s, a) => s + (a ? toAzn(a, rate) : 0n), 0n);
  const showCur = !foreign && lines.some((l) => acc(l.account)?.currency);
  const autoMatch = (l: LineForm) => {
    const a = acc(l.account);
    return (
      !!a &&
      a.subkonto[2] === 'document' &&
      (incoming ? l.account.startsWith('211') : l.account.startsWith('531'))
    );
  };
  return (
    <table className="grid entry-grid">
      <thead>
        <tr>
          <th scope="col" className="n">
            №
          </th>
          <th scope="col">{incoming ? 'Kredit hesabı' : 'Debet hesabı'} və subkonto</th>
          {showCur && (
            <th scope="col" className="num narrow">
              Valyuta
            </th>
          )}
          <th scope="col" className="num narrow">
            Məbləğ, {currency}
          </th>
          <th scope="col">Məzmun · pul hərəkəti maddəsi</th>
          <th scope="col" className="n">
            <span className="sr-only">Əməliyyat</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => {
          const e = err && err.line === i ? err : null;
          const a = acc(l.account);
          return (
            <tr key={l.key} className={e ? 'has-error' : ''}>
              <td className="n">{i + 1}</td>
              <td className="side">
                <AccountPicker
                  catalog={catalog}
                  ariaLabel={`Sətir ${i + 1} hesab`}
                  value={l.account}
                  invalid={e?.part === 'account'}
                  onChange={(account) => setLine(i, { account, sk: [], curAmount: '' })}
                />
                <SubkontoFields
                  catalog={catalog}
                  companyId={companyId}
                  account={l.account}
                  values={l.sk}
                  side={`Sətir ${i + 1}`}
                  onChange={(sk) => setLine(i, { sk })}
                  documentEmptyLabel={
                    autoMatch(l) ? 'Açıq qaimələrə avtomatik' : 'Bu sənəd (avans)'
                  }
                  {...(e?.part === 'sk' && e.slot !== undefined ? { errorIndex: e.slot } : {})}
                />
              </td>
              {showCur && (
                <td className="num narrow">
                  {a?.currency && (
                    <input
                      aria-label={`Sətir ${i + 1} valyuta məbləği`}
                      inputMode="decimal"
                      className={e?.part === 'curAmount' ? 'invalid' : ''}
                      value={l.curAmount}
                      onChange={(ev) => setLine(i, { curAmount: ev.target.value })}
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
                <Picker
                  ariaLabel={`Sətir ${i + 1} pul vəsaitlərinin hərəkəti maddəsi`}
                  value={l.cashFlowItem}
                  options={cashFlowOptions}
                  emptyLabel="Pul hərəkəti maddəsi seçilməyib"
                  invalid={e?.part === 'cashFlowItem'}
                  onChange={(cashFlowItem) => setLine(i, { cashFlowItem })}
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
          <td colSpan={2 + (showCur ? 1 : 0)}>
            <button
              type="button"
              className="button secondary small"
              onClick={() => onChange([...lines, blankLine()])}
            >
              <Plus size={14} /> Sətir əlavə et
            </button>
          </td>
          <td className="num">
            <b>{money(formatMinor(total))}</b>
          </td>
          <td colSpan={2}>
            {foreign
              ? `Manatla: ${totalAzn === null ? '—' : money(formatMinor(totalAzn))}`
              : `${lines.length} sətir`}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
