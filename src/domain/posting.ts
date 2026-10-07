/**
 * Postings are Dt/Kt pairs, as accountants read them: "Dt 211 (Alıcı MMC, Müqavilə №7, SF-0001)
 * / Kt 601 (Məhsul satışı, 18%) 15 000,00". Each side carries the subkonto values its account
 * requires, a quantity when the account keeps quantities and a currency amount when it is a
 * currency account.
 *
 * Corrections and cancellations are red storno: the same pairs with negative amounts, so a
 * cancelled document disappears from turnovers instead of inflating both sides.
 */
import type { Account, Chart, CurrencyCode } from './chart.js';
import { DomainError } from './errors.js';
import { MAX_MINOR, type Minor } from './money.js';
import type { Qty } from './quantity.js';

export interface Side {
  account: string;
  /** One id per subkonto kind of the account, in the account's order. */
  sk: string[];
  /** Foreign-currency amount on currency accounts (same sign as the AZN amount). */
  currency?: CurrencyCode;
  curAmount?: Minor;
}
export interface Posting {
  dt: Side;
  kt: Side;
  amount: Minor;
  /** Quantity for quantitative accounts (both sides share it, e.g. 201 → 205). */
  quantity?: Qty;
  memo: string;
}

const sideName = { dt: 'Debet', kt: 'Kredit' } as const;

function checkSide(
  chart: Chart,
  side: Side,
  which: 'dt' | 'kt',
  field: string,
  sign: 1n | -1n,
): Account {
  const account = chart.require(side.account, `${field}.${which}.account`);
  if (side.sk.length !== account.subkonto.length)
    throw new DomainError(
      `${sideName[which]} ${account.code}: ${account.subkonto.length} subkonto tələb olunur.`,
      `${field}.${which}.sk`,
    );
  side.sk.forEach((v, i) => {
    if (!v)
      throw new DomainError(
        `${sideName[which]} ${account.code}: subkonto ${i + 1} seçilməyib.`,
        `${field}.${which}.sk.${i}`,
      );
  });
  if (account.currency) {
    if (!side.currency || side.curAmount === undefined || side.curAmount === 0n)
      throw new DomainError(
        `${sideName[which]} ${account.code} valyuta hesabıdır: valyuta məbləğini yazın.`,
        `${field}.${which}.curAmount`,
      );
    if (side.curAmount * sign < 0n)
      throw new DomainError(
        'Valyuta məbləğinin işarəsi məbləğə uyğun deyil.',
        `${field}.${which}.curAmount`,
      );
  } else if (side.currency || side.curAmount !== undefined)
    throw new DomainError(
      `${account.code} valyuta hesabı deyil; valyuta məbləği yazılmır.`,
      `${field}.${which}.curAmount`,
    );
  return account;
}

/** Structural rules of a complete entry. Subkonto ids are checked against catalogs by the caller. */
export function checkPostings(chart: Chart, postings: readonly Posting[], field = 'lines'): void {
  if (!postings.length) throw new DomainError('Ən azı bir yazılış sətri olmalıdır.', field);
  if (postings.length > 2000)
    throw new DomainError('Bir sənəddə ən çox 2000 yazılış ola bilər.', field);
  postings.forEach((p, i) => {
    const f = `${field}.${i}`;
    if (p.amount === 0n)
      throw new DomainError(`Sətir ${i + 1}: məbləğ sıfır ola bilməz.`, `${f}.amount`);
    if (p.amount > MAX_MINOR || -p.amount > MAX_MINOR)
      throw new DomainError(`Sətir ${i + 1}: məbləğ həddi keçir.`, `${f}.amount`);
    const sign = p.amount > 0n ? 1n : -1n;
    const dt = checkSide(chart, p.dt, 'dt', f, sign);
    const kt = checkSide(chart, p.kt, 'kt', f, sign);
    if (dt.code === kt.code && p.dt.sk.join('|') === p.kt.sk.join('|'))
      throw new DomainError(`Sətir ${i + 1}: debet və kredit eyni ola bilməz.`, f);
    const needsQty = dt.quantitative || kt.quantitative;
    if (needsQty && (p.quantity === undefined || p.quantity === 0n))
      throw new DomainError(
        `Sətir ${i + 1}: ${dt.quantitative ? dt.code : kt.code} hesabında miqdar yazılmalıdır.`,
        `${f}.quantity`,
      );
    if (!needsQty && p.quantity !== undefined)
      throw new DomainError(
        `Sətir ${i + 1}: bu hesablarda miqdar uçotu aparılmır.`,
        `${f}.quantity`,
      );
    if (p.quantity !== undefined && p.quantity * sign < 0n)
      throw new DomainError(
        `Sətir ${i + 1}: miqdarın işarəsi məbləğə uyğun deyil.`,
        `${f}.quantity`,
      );
  });
}

/** Red storno of an entry: same pairs, negated amounts, quantities and currency amounts. */
export function storno(postings: readonly Posting[]): Posting[] {
  return postings.map((p) => ({
    ...p,
    amount: -p.amount,
    ...(p.quantity !== undefined ? { quantity: -p.quantity } : {}),
    dt: { ...p.dt, ...(p.dt.curAmount !== undefined ? { curAmount: -p.dt.curAmount } : {}) },
    kt: { ...p.kt, ...(p.kt.curAmount !== undefined ? { curAmount: -p.kt.curAmount } : {}) },
  }));
}
