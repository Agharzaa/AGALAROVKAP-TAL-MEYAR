/**
 * The money-document core shared by bank documents (stage 3a) and cash orders (stage 5a;
 * docs/MERHELE-5-AY-BAGLANISI.md §4.1). A money document has one "holder" — a bank account or a
 * cashbox — that gives one side of every posting; each line names the counter account:
 *
 * Receipt, per line:  Dt holder account / Kt counter account
 * Payment, per line:  Dt counter account / Kt holder account
 *
 * The holder decides the ledger account and the currency. A 211 line of a receipt (a 531 line of
 * a payment) without a settlement document is matched to the partner's open invoices of that
 * contract, oldest first, and the rest becomes an advance (543 / 243) of this document.
 */
import {
  allocatePayment,
  splitProportionally,
  type OpenInvoice,
  type SettlementPart,
} from '../domain/bank.js';
import {
  inFamily,
  subkontoLabel,
  type Account,
  type Chart,
  type CurrencyCode,
} from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { AZN_RATE, toAzn } from '../domain/invoice.js';
import { formatMinor, parseMoney, type Minor } from '../domain/money.js';
import { checkPostings, type Posting, type Side } from '../domain/posting.js';
import { parsePrice } from '../domain/quantity.js';
import { numberKey, parseText } from '../domain/values.js';
import type { BankLineInput } from '../contracts/commands.js';
import type { Row } from '../infrastructure/sqlite/db.js';
import { checkSideValues } from './subkonto.js';
import type { Tx } from './tx.js';

export type Direction = 'in' | 'out';
/** Journal source type; also the prefix of the document's own settlement value ("bank:<id>"). */
export type MoneyType = 'bank' | 'cash';

export const money = (m: Minor) => formatMinor(m);

/** Stored, canonical form of a line: what the user entered, resolved and validated. */
export interface StoredLine {
  account: string;
  sk: string[];
  amount: string;
  amountAzn: string;
  curAmount: string;
  /** "auto": matched to open invoices when posted; the postings show the result. */
  settle: 'auto' | '';
  /** Cash-flow item (an attribute, not a subkonto); absent when not chosen. */
  cashFlowItem?: string;
  memo: string;
}

/** The bank account or cashbox of a document. */
export interface Holder {
  id: string;
  /** Ledger account it is bound to (223.01 / 224.04 / 221.01 …). */
  account: Account;
  currency: CurrencyCode;
  /** Genitive for messages: "bank hesabının" / "kassanın". */
  of: string;
}

/** Receipts settle customer invoices on 211, payments supplier invoices on 531. */
export const settlementFamily = { in: '211', out: '531' } as const;
export const advanceFamily = { in: '543', out: '243' } as const;

export function nextNumber(
  tx: Tx,
  table: 'bank_documents' | 'cash_documents',
  companyId: string,
  direction: Direction,
  prefix: string,
): string {
  const n =
    Number(
      tx.db.get(
        `SELECT COUNT(*) AS n FROM ${table} WHERE company_id=? AND direction=?`,
        companyId,
        direction,
      )!.n,
    ) + 1;
  for (let i = n; ; i++) {
    const candidate = `${prefix}-${String(i).padStart(6, '0')}`;
    if (
      !tx.db.get(
        `SELECT 1 AS x FROM ${table} WHERE company_id=? AND direction=? AND number_key=?`,
        companyId,
        direction,
        numberKey(candidate),
      )
    )
      return candidate;
  }
}

/** The document rate: none for AZN, the AMB rate (4 decimals) for a currency holder. */
export function documentRate(input: string, currency: CurrencyCode, aznMessage: string): Minor {
  let rate = AZN_RATE;
  if (currency !== 'AZN') rate = parsePrice(input, `${currency} məzənnəsi`);
  else if (input.trim() && parsePrice(input, 'Məzənnə') !== AZN_RATE)
    throw new DomainError(aznMessage, 'rate');
  if (rate <= 0n) throw new DomainError('Məzənnə müsbət olmalıdır.', 'rate');
  return rate;
}

export function normalizeLines(
  tx: Tx,
  companyId: string,
  chart: Chart,
  direction: Direction,
  holder: Holder,
  rate: Minor,
  input: readonly BankLineInput[],
) {
  const foreign = holder.currency !== 'AZN';
  const lines = input.map((l, i) => {
    const where = `Sətir ${i + 1}`;
    const f = (x: string) => `lines.${i}.${x}`;
    const account = chart.require(l.account.trim(), f('account'));
    if (account.code === holder.account.code && (l.sk[0] ?? '') === holder.id)
      throw new DomainError(`${where}: müxabir hesab ${holder.of} özüdür.`, f('account'));
    const amount = parseMoney(l.amount, `${where}: məbləğ`);
    if (amount <= 0n) throw new DomainError(`${where}: məbləğ müsbət olmalıdır.`, f('amount'));
    const amountAzn = toAzn(amount, rate);
    if (amountAzn <= 0n)
      throw new DomainError(`${where}: manatla məbləğ sıfıra yuvarlaqlaşır.`, f('amount'));
    if (account.quantitative)
      throw new DomainError(
        `${where}: ${account.code} miqdar uçotu olan hesabdır; mal hərəkəti qaimə ilə aparılır.`,
        f('account'),
      );
    const sk = account.subkonto.map((_, j) => (l.sk[j] ?? '').trim());
    const settle =
      inFamily(account.code, settlementFamily[direction]) &&
      account.subkonto[2] === 'document' &&
      !sk[2]
        ? ('auto' as const)
        : ('' as const);
    let curInput: Minor | undefined;
    if (l.curAmount?.trim()) {
      if (!account.currency)
        throw new DomainError(`${where}: ${account.code} valyuta hesabı deyil.`, f('curAmount'));
      if (foreign)
        throw new DomainError(
          `${where}: valyuta məbləği ${holder.of} valyutasındadır; ayrıca yazılmır.`,
          f('curAmount'),
        );
      curInput = parseMoney(l.curAmount, `${where}: valyuta məbləği`);
      if (curInput <= 0n)
        throw new DomainError(`${where}: valyuta məbləği müsbət olmalıdır.`, f('curAmount'));
    }
    const cashFlowItem = l.cashFlowItem.trim();
    if (cashFlowItem) {
      const item = tx.db.get(
        "SELECT archived FROM items WHERE company_id=? AND id=? AND kind='cashFlowItem'",
        companyId,
        cashFlowItem,
      );
      if (!item)
        throw new DomainError(
          `${where}: pul vəsaitlərinin hərəkəti maddəsi tapılmadı.`,
          f('cashFlowItem'),
          'not-found',
        );
      if (item.archived === 1n)
        throw new DomainError(
          `${where}: pul vəsaitlərinin hərəkəti maddəsi arxivdədir.`,
          f('cashFlowItem'),
        );
    }
    const stored: StoredLine = {
      account: account.code,
      sk,
      amount: money(amount),
      amountAzn: money(amountAzn),
      curAmount: curInput !== undefined ? money(curInput) : '',
      settle,
      ...(cashFlowItem ? { cashFlowItem } : {}),
      memo: parseText(l.memo, `${where}: məzmun`, 300, false),
    };
    return { account, amount, amountAzn, sk, settle, curInput, stored };
  });
  return {
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0n),
    totalAzn: lines.reduce((s, l) => s + l.amountAzn, 0n),
  };
}

export type MoneyLine = ReturnType<typeof normalizeLines>['lines'][number];

/** What the posting builder needs to know about a document. */
export interface MoneyDocument {
  type: MoneyType;
  direction: Direction;
  date: string;
  holder: Holder;
  rate: Minor;
  lines: MoneyLine[];
  /** Line memo when the line has none: the purpose / basis, else the document's name. */
  memo: string;
  /** Which part of an invoice an automatic match settles (a VAT deposit pays only VAT). */
  part: (partnerKind: string | undefined) => SettlementPart;
}

/**
 * Invoices of one partner and contract that the document can still settle, oldest first: posted,
 * dated on or before the document, with a balance owed on their settlement key.
 */
function openInvoices(
  tx: Tx,
  companyId: string,
  direction: Direction,
  account: Account,
  partner: string,
  contract: string,
  date: string,
): OpenInvoice[] {
  // Receipts reduce a debit balance (211), payments a credit balance (531).
  const sign = direction === 'in' ? '' : '-';
  const measure = account.currency ? 'c' : 'a';
  const balances = tx.db.all(
    `SELECT s, ${sign}SUM(a) AS a, ${sign}SUM(c) AS c FROM (
       SELECT dt_s3 AS s, amount AS a, dt_cur AS c FROM postings
         WHERE company_id=? AND dt_account=? AND dt_s1=? AND dt_s2=? AND dt_s3 LIKE 'invoice:%'
       UNION ALL
       SELECT kt_s3, -amount, -kt_cur FROM postings
         WHERE company_id=? AND kt_account=? AND kt_s1=? AND kt_s2=? AND kt_s3 LIKE 'invoice:%'
     ) GROUP BY s HAVING ${sign}SUM(${measure})>0`,
    companyId,
    account.code,
    partner,
    contract,
    companyId,
    account.code,
    partner,
    contract,
  );
  if (!balances.length) return [];
  const invoices = new Map(
    tx.db
      .all(
        `SELECT id, date, rowid AS seq, vat, currency FROM invoices
         WHERE company_id=? AND partner_id=? AND contract_id=? AND status='posted' AND date<=?`,
        companyId,
        partner,
        contract,
        date,
      )
      .map((r) => [`invoice:${r.id}`, r]),
  );
  const out: (OpenInvoice & { date: string; seq: bigint })[] = [];
  for (const b of balances) {
    const inv = invoices.get(String(b.s));
    if (!inv) continue;
    const open = (account.currency ? b.c : b.a) as bigint;
    // The VAT part is tracked for AZN invoices; a currency invoice is settled as a whole.
    const vat = inv.currency === 'AZN' ? (inv.vat as bigint) : 0n;
    const vatOpen =
      vat > 0n
        ? vat - depositPaid(tx, companyId, direction, account, partner, contract, String(b.s))
        : 0n;
    out.push({
      document: String(b.s),
      open,
      vatOpen,
      date: String(inv.date),
      seq: inv.seq as bigint,
    });
  }
  out.sort((x, y) => x.date.localeCompare(y.date) || Number(x.seq - y.seq));
  return out.map(({ document, open, vatOpen }) => ({ document, open, vatOpen }));
}

/**
 * What has reached an invoice through the VAT deposit: settlements whose other side is a 224
 * account, and advance offsets whose advance came from a bank document on a 224 account.
 */
function depositPaid(
  tx: Tx,
  companyId: string,
  direction: Direction,
  account: Account,
  partner: string,
  contract: string,
  document: string,
): Minor {
  const [own, other] = direction === 'in' ? (['kt', 'dt'] as const) : (['dt', 'kt'] as const);
  return tx.db.get(
    `SELECT COALESCE(SUM(p.amount),0) AS a FROM postings p
     WHERE p.company_id=? AND p.${own}_account=? AND p.${own}_s1=? AND p.${own}_s2=? AND p.${own}_s3=?
       AND (p.${other}_account='224' OR p.${other}_account LIKE '224.%'
         OR (p.${other}_s3 LIKE 'bank:%' AND EXISTS(
           SELECT 1 FROM bank_documents b JOIN bank_accounts x ON x.company_id=b.company_id AND x.id=b.bank_account_id
           WHERE b.company_id=p.company_id AND 'bank:'||b.id=p.${other}_s3
             AND (x.account='224' OR x.account LIKE '224.%'))))`,
    companyId,
    account.code,
    partner,
    contract,
    document,
  )!.a as bigint;
}

function sameFamilyAccount(
  chart: Chart,
  account: Account,
  from: string,
  to: string,
  field: string,
) {
  const code = `${to}${account.code.slice(from.length)}`;
  const target = chart.get(code);
  if (!target || !chart.postable(code))
    throw new DomainError(`${code} hesabı hesab planında yoxdur və ya qrupdur.`, field);
  return target;
}

/** Builds the entry of a money document against the current ledger (this document reversed). */
export function buildMoneyPostings(
  tx: Tx,
  companyId: string,
  chart: Chart,
  id: string,
  d: MoneyDocument,
): Posting[] {
  const self = `${d.type}:${id}`;
  const currency = d.holder.currency;
  const foreign = currency !== 'AZN';
  const out: Posting[] = [];

  const holderSide = (cur: Minor): Side => ({
    account: d.holder.account.code,
    sk: [d.holder.id],
    ...(foreign ? { currency, curAmount: cur } : {}),
  });
  const push = (counter: Side, amount: Minor, holderCur: Minor, memo: string) =>
    out.push(
      d.direction === 'in'
        ? { dt: holderSide(holderCur), kt: counter, amount, memo }
        : { dt: counter, kt: holderSide(holderCur), amount, memo },
    );

  d.lines.forEach((l, i) => {
    const where = `Sətir ${i + 1}`;
    const field = `lines.${i}.sk`;
    const memo = l.stored.memo || d.memo;
    // Subkonto: an empty settlement document means this document (also for an advance remainder).
    const values = l.account.subkonto.map((kind, j) =>
      kind === 'document' && !l.sk[j] ? self : l.sk[j]!,
    );
    const checked = checkSideValues(tx.db, companyId, l.account, values, field, self);
    const counterCurrency = (cur: Minor): Pick<Side, 'currency' | 'curAmount'> => {
      if (!l.account.currency) return {};
      if (foreign) {
        if (checked.currency && checked.currency !== currency)
          throw new DomainError(
            `${where}: müqavilənin valyutası (${checked.currency}) ${d.holder.of} valyutasından (${currency}) fərqlidir.`,
            field,
          );
        return { currency, curAmount: cur };
      }
      const lineCurrency = checked.currency;
      if (!lineCurrency)
        throw new DomainError(
          `${where}: ${l.account.code} üçün valyutanı müəyyən etmək olmur.`,
          field,
        );
      if (l.curInput === undefined)
        throw new DomainError(
          `${where}: ${l.account.code} valyuta hesabıdır; ${lineCurrency} məbləğini yazın.`,
          `lines.${i}.curAmount`,
        );
      return { currency: lineCurrency, curAmount: cur };
    };

    if (l.settle !== 'auto') {
      push(
        { account: l.account.code, sk: values, ...counterCurrency(l.curInput ?? l.amount) },
        l.amountAzn,
        l.amount,
        memo,
      );
      return;
    }
    autoSettle(tx, companyId, chart, d, l, values, where, field, memo, counterCurrency, push, self);
  });

  out.forEach((p, i) => {
    for (const which of ['dt', 'kt'] as const) {
      const s = p[which];
      checkSideValues(
        tx.db,
        companyId,
        chart.get(s.account)!,
        s.sk,
        `postings.${i}.${which}`,
        self,
      );
    }
  });
  checkPostings(chart, out, 'postings');
  return out;
}

/**
 * Matches one 211 (receipt) or 531 (payment) line to open invoices; the rest is an advance of
 * this document on 543 / 243 of the same currency kind.
 */
function autoSettle(
  tx: Tx,
  companyId: string,
  chart: Chart,
  d: MoneyDocument,
  l: MoneyLine,
  values: string[],
  where: string,
  field: string,
  memo: string,
  counterCurrency: (cur: Minor) => Pick<Side, 'currency' | 'curAmount'>,
  push: (counter: Side, amount: Minor, holderCur: Minor, memo: string) => void,
  self: string,
) {
  const direction = d.direction;
  const currency = d.holder.currency;
  const [partner, contract] = values as [string, string];
  const contractCurrency = String(
    tx.db.get('SELECT currency FROM contracts WHERE company_id=? AND id=?', companyId, contract)!
      .currency,
  );
  if (contractCurrency !== currency)
    throw new DomainError(
      `${where}: ${d.holder.of} valyutası (${currency}) müqavilənin valyutasından (${contractCurrency}) fərqlidir; hesablaşma sənədini əl ilə seçin.`,
      field,
    );
  const kind = tx.db.get(
    'SELECT kind FROM partners WHERE company_id=? AND id=?',
    companyId,
    partner,
  )?.kind;
  const invoices = openInvoices(tx, companyId, direction, l.account, partner, contract, d.date);
  const { allocations, left } = allocatePayment(
    invoices,
    l.amount,
    d.part(kind === undefined ? undefined : String(kind)),
  );
  const pieces = [...allocations.map((a) => a.amount), ...(left > 0n ? [left] : [])];
  // AZN value of each piece; on an AZN holder the pieces are AZN already.
  const azn = currency !== 'AZN' ? splitProportionally(pieces, l.amount, l.amountAzn) : pieces;
  allocations.forEach((a, k) =>
    push(
      {
        account: l.account.code,
        sk: [partner, contract, a.document],
        ...counterCurrency(a.amount),
      },
      azn[k]!,
      a.amount,
      memo,
    ),
  );
  if (left > 0n) {
    const advance = sameFamilyAccount(
      chart,
      l.account,
      settlementFamily[direction],
      advanceFamily[direction],
      field,
    );
    if (advance.subkonto.join('|') !== 'partner|contract|document')
      throw new DomainError(
        `${where}: ${advance.code} hesabının subkontosu ${advance.subkonto.map((k) => subkontoLabel[k]).join(' → ')}; avans üçün Kontragent → Müqavilə → Hesablaşma sənədi lazımdır.`,
        field,
      );
    push(
      {
        account: advance.code,
        sk: [partner, contract, self],
        ...(advance.currency ? { currency, curAmount: left } : {}),
      },
      azn[allocations.length]!,
      left,
      `Avans · ${memo}`,
    );
  }
}

/**
 * An advance of this document that a later invoice has already offset is not taken back: after
 * the change, no advance key of this document may fall below zero (543 credit, 243 debit).
 */
export function guardAdvances(
  tx: Tx,
  companyId: string,
  type: MoneyType,
  id: string,
  previous: readonly Posting[],
) {
  const self = `${type}:${id}`;
  const keys = new Map<
    string,
    { account: string; partner: string; contract: string; sign: 1n | -1n }
  >();
  for (const p of previous)
    for (const s of [p.dt, p.kt]) {
      const family = inFamily(s.account, '543') ? 1n : inFamily(s.account, '243') ? -1n : 0n;
      if (!family || s.sk[2] !== self) continue;
      keys.set(s.account + '|' + s.sk[0] + '|' + s.sk[1], {
        account: s.account,
        partner: s.sk[0]!,
        contract: s.sk[1]!,
        sign: family as 1n | -1n,
      });
    }
  for (const k of keys.values()) {
    // Day by day, as an invoice offsets only what the advance held on its own date: a document
    // moved past the invoice that used its advance takes it back as surely as a smaller amount.
    const days = tx.db.all(
      `SELECT date, COALESCE(SUM(a),0) AS a, COALESCE(SUM(c),0) AS c FROM (
         SELECT date, amount AS a, kt_cur AS c FROM postings
           WHERE company_id=? AND kt_account=? AND kt_s1=? AND kt_s2=? AND kt_s3=?
         UNION ALL
         SELECT date, -amount, -dt_cur FROM postings
           WHERE company_id=? AND dt_account=? AND dt_s1=? AND dt_s2=? AND dt_s3=?
       ) GROUP BY date ORDER BY date`,
      companyId,
      k.account,
      k.partner,
      k.contract,
      self,
      companyId,
      k.account,
      k.partner,
      k.contract,
      self,
    );
    let amount = 0n;
    let cur = 0n;
    let lowest = 0n;
    let negative = false;
    for (const d of days) {
      amount += (d.a as bigint) * k.sign;
      cur += (d.c as bigint) * k.sign;
      if (amount < lowest) lowest = amount;
      if (amount < 0n || cur < 0n) negative = true;
    }
    if (!negative) continue;
    const users = tx.db
      .all(
        `SELECT DISTINCT e.source_number AS n FROM postings p JOIN entries e ON e.id=p.entry_id
         WHERE p.company_id=? AND e.storno=0 AND NOT (e.source_type=? AND e.source_id=?)
           AND ((p.dt_account=? AND p.dt_s1=? AND p.dt_s2=? AND p.dt_s3=?)
             OR (p.kt_account=? AND p.kt_s1=? AND p.kt_s2=? AND p.kt_s3=?))`,
        companyId,
        type,
        id,
        k.account,
        k.partner,
        k.contract,
        self,
        k.account,
        k.partner,
        k.contract,
        self,
      )
      .map((u) => String(u.n));
    throw new DomainError(
      `Bu sənədin avansı (${k.account}) ${users.join(', ') || 'başqa sənəddə'} əvəzləşdirilib; dəyişiklik avansı ${money(-lowest)} AZN mənfiyə salardı. Əvvəlcə həmin sənədi düzəldin.`,
      undefined,
      'conflict',
    );
  }
}

/** A cashbox row as a holder (also used for the cashbox subkonto of a bank line). */
export function cashboxHolder(row: Row, chart: Chart, field: string): Holder {
  return {
    id: String(row.id),
    account: chart.require(String(row.account), field),
    currency: String(row.currency) as CurrencyCode,
    of: 'kassanın',
  };
}
