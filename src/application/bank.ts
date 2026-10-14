/**
 * Bank documents (stage 3a; docs/QERARLAR.md 2026-10-14, docs/MERHELE-3-BANK.md §3–4).
 *
 * Receipt ("Bank daxilolması"), per line:  Dt 223.xx / 224.04 (bank account) / Kt counter account
 * Payment ("Bank məxarici"), per line:     Dt counter account / Kt 223.xx / 224.04 (bank account)
 *
 * The bank account decides the ledger account and the currency. The counter account is any
 * postable account; its subkonto are entered as for a manual operation and checked the same way.
 * A 211 line of a receipt (a 531 line of a payment) without a settlement document is matched to
 * the partner's open invoices of that contract, oldest first, and the rest becomes an advance
 * (543 / 243) of this document. A VAT deposit document (224.04) settles only the VAT of each
 * invoice, a current-account document only the rest.
 *
 * Like invoices, saving posts at once, a correction stornoes the previous entry before the new one
 * is computed (so matching sees the ledger without this document) and cancelling stornoes it. An
 * advance of this document that a later invoice has already used is never taken back.
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
import { checkPostings, storno, type Posting, type Side } from '../domain/posting.js';
import { formatPrice, parsePrice } from '../domain/quantity.js';
import { numberKey, parseDate, parseText } from '../domain/values.js';
import type { BankLineInput, CommandOf, CommandResult } from '../contracts/commands.js';
import type { Row } from '../infrastructure/sqlite/db.js';
import { refreshPair } from './bank-pair.js';
import { bindStatementLine, releaseStatementLine } from './statements.js';
import { checkSideValues } from './subkonto.js';
import { expectVersion, type Tx } from './tx.js';

export const BANK = 'bank';
type Direction = 'in' | 'out';
type SaveBank = CommandOf<'bank.save'>;

const label = { in: 'Bank daxilolması', out: 'Bank məxarici' } as const;
const prefix = { in: 'BD', out: 'BX' } as const;
const money = (m: Minor) => formatMinor(m);

/** Stored, canonical form of a line: what the user entered, resolved and validated. */
interface StoredLine {
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

function nextNumber(tx: Tx, companyId: string, direction: Direction): string {
  const n =
    Number(
      tx.db.get(
        'SELECT COUNT(*) AS n FROM bank_documents WHERE company_id=? AND direction=?',
        companyId,
        direction,
      )!.n,
    ) + 1;
  for (let i = n; ; i++) {
    const candidate = `${prefix[direction]}-${String(i).padStart(6, '0')}`;
    if (
      !tx.db.get(
        'SELECT 1 AS x FROM bank_documents WHERE company_id=? AND direction=? AND number_key=?',
        companyId,
        direction,
        numberKey(candidate),
      )
    )
      return candidate;
  }
}

/** Receipts settle customer invoices on 211, payments supplier invoices on 531. */
const settlementFamily = { in: '211', out: '531' } as const;
const advanceFamily = { in: '543', out: '243' } as const;

function normalize(tx: Tx, cmd: SaveBank, chart: Chart) {
  tx.company(cmd.companyId);
  const bank = tx.db.get(
    'SELECT * FROM bank_accounts WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.bankAccountId,
  );
  if (!bank) throw new DomainError('Bank hesabını seçin.', 'bankAccountId', 'not-found');
  if (bank.archived === 1n) throw new DomainError('Bank hesabı arxivdədir.', 'bankAccountId');
  const bankAccount = chart.require(String(bank.account), 'bankAccountId');
  const currency = String(bank.currency) as CurrencyCode;
  const foreign = currency !== 'AZN';
  let rate = AZN_RATE;
  if (foreign) rate = parsePrice(cmd.rate, `${currency} məzənnəsi`);
  else if (cmd.rate.trim() && parsePrice(cmd.rate, 'Məzənnə') !== AZN_RATE)
    throw new DomainError('Manat hesabında məzənnə yazılmır.', 'rate');
  if (rate <= 0n) throw new DomainError('Məzənnə müsbət olmalıdır.', 'rate');

  const lines = cmd.lines.map((l: BankLineInput, i) => {
    const where = `Sətir ${i + 1}`;
    const f = (x: string) => `lines.${i}.${x}`;
    const account = chart.require(l.account.trim(), f('account'));
    if (account.code === bankAccount.code && (l.sk[0] ?? '') === String(bank.id))
      throw new DomainError(`${where}: müxabir hesab bank hesabının özüdür.`, f('account'));
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
      inFamily(account.code, settlementFamily[cmd.direction]) &&
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
          `${where}: valyuta məbləği bank hesabının valyutasındadır; ayrıca yazılmır.`,
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
        cmd.companyId,
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
  const total = lines.reduce((s, l) => s + l.amount, 0n);
  const totalAzn = lines.reduce((s, l) => s + l.amountAzn, 0n);
  return {
    bank,
    bankAccount,
    currency,
    foreign,
    rate,
    lines,
    total,
    totalAzn,
    header: {
      direction: cmd.direction,
      date: parseDate(cmd.date),
      bankAccountId: String(bank.id),
      currency,
      rate: formatPrice(rate),
      bankReference: parseText(cmd.bankReference, 'Bank sənədinin nömrəsi', 80, false),
      counterpartyName: parseText(cmd.counterpartyName, 'Kontragent (bankda)', 240, false),
      counterpartyTaxId: parseText(cmd.counterpartyTaxId, 'VÖEN (bankda)', 20, false),
      purpose: parseText(cmd.purpose, 'Ödənişin təyinatı', 500, false),
    },
  };
}

type Normalized = ReturnType<typeof normalize>;
type NormalizedLine = Normalized['lines'][number];

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

/** Builds the entry of a bank document against the current ledger (this document reversed). */
function buildPostings(
  tx: Tx,
  companyId: string,
  chart: Chart,
  id: string,
  n: Normalized,
): Posting[] {
  const self = `${BANK}:${id}`;
  const { header, foreign, currency } = n;
  const direction = header.direction;
  const out: Posting[] = [];

  const bankSide = (cur: Minor): Side => ({
    account: n.bankAccount.code,
    sk: [header.bankAccountId],
    ...(foreign ? { currency, curAmount: cur } : {}),
  });
  const push = (counter: Side, amount: Minor, bankCur: Minor, memo: string) =>
    out.push(
      direction === 'in'
        ? { dt: bankSide(bankCur), kt: counter, amount, memo }
        : { dt: counter, kt: bankSide(bankCur), amount, memo },
    );

  n.lines.forEach((l, i) => {
    const where = `Sətir ${i + 1}`;
    const field = `lines.${i}.sk`;
    const memo = l.stored.memo || header.purpose || label[direction];
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
            `${where}: müqavilənin valyutası (${checked.currency}) bank hesabının valyutasından (${currency}) fərqlidir.`,
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
    autoSettle(tx, companyId, chart, n, l, values, where, field, memo, counterCurrency, push, self);
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
  n: Normalized,
  l: NormalizedLine,
  values: string[],
  where: string,
  field: string,
  memo: string,
  counterCurrency: (cur: Minor) => Pick<Side, 'currency' | 'curAmount'>,
  push: (counter: Side, amount: Minor, bankCur: Minor, memo: string) => void,
  self: string,
) {
  const direction = n.header.direction;
  const [partner, contract] = values as [string, string];
  const contractCurrency = String(
    tx.db.get('SELECT currency FROM contracts WHERE company_id=? AND id=?', companyId, contract)!
      .currency,
  );
  if (contractCurrency !== n.currency)
    throw new DomainError(
      `${where}: bank hesabının valyutası (${n.currency}) müqavilənin valyutasından (${contractCurrency}) fərqlidir; hesablaşma sənədini əl ilə seçin.`,
      field,
    );
  // A deposit document pays VAT, a current account the rest; currency invoices as a whole.
  const part: SettlementPart = n.foreign
    ? 'whole'
    : inFamily(n.bankAccount.code, '224')
      ? 'vat'
      : 'net';
  const invoices = openInvoices(
    tx,
    companyId,
    direction,
    l.account,
    partner,
    contract,
    n.header.date,
  );
  const { allocations, left } = allocatePayment(invoices, l.amount, part);
  const pieces = [...allocations.map((a) => a.amount), ...(left > 0n ? [left] : [])];
  // AZN value of each piece; on an AZN account the pieces are AZN already.
  const azn = n.foreign ? splitProportionally(pieces, l.amount, l.amountAzn) : pieces;
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
        ...(advance.currency ? { currency: n.currency, curAmount: left } : {}),
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
function guardAdvances(tx: Tx, companyId: string, id: string, previous: readonly Posting[]) {
  const self = `${BANK}:${id}`;
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
    const r = tx.db.get(
      `SELECT COALESCE(SUM(a),0) AS a, COALESCE(SUM(c),0) AS c FROM (
         SELECT amount AS a, kt_cur AS c FROM postings
           WHERE company_id=? AND kt_account=? AND kt_s1=? AND kt_s2=? AND kt_s3=?
         UNION ALL
         SELECT -amount, -dt_cur FROM postings
           WHERE company_id=? AND dt_account=? AND dt_s1=? AND dt_s2=? AND dt_s3=?
       )`,
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
    )!;
    const amount = (r.a as bigint) * k.sign;
    const cur = (r.c as bigint) * k.sign;
    if (amount >= 0n && cur >= 0n) continue;
    const users = tx.db
      .all(
        `SELECT DISTINCT e.source_number AS n FROM postings p JOIN entries e ON e.id=p.entry_id
         WHERE p.company_id=? AND e.storno=0 AND NOT (e.source_type=? AND e.source_id=?)
           AND ((p.dt_account=? AND p.dt_s1=? AND p.dt_s2=? AND p.dt_s3=?)
             OR (p.kt_account=? AND p.kt_s1=? AND p.kt_s2=? AND p.kt_s3=?))`,
        companyId,
        BANK,
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
      `Bu sənədin avansı (${k.account}) ${users.join(', ') || 'başqa sənəddə'} əvəzləşdirilib; dəyişiklik avansı ${money(-(amount < 0n ? amount : 0n))} AZN mənfiyə salardı. Əvvəlcə həmin sənədi düzəldin.`,
      undefined,
      'conflict',
    );
  }
}

function payload(number: string, n: Normalized) {
  return { number, ...n.header, lines: n.lines.map((l) => l.stored) };
}

export function saveBankDocument(tx: Tx, cmd: SaveBank): CommandResult {
  const chart = tx.chart(cmd.companyId);
  const n = normalize(tx, cmd, chart);
  const existing = cmd.id
    ? tx.db.get('SELECT * FROM bank_documents WHERE company_id=? AND id=?', cmd.companyId, cmd.id)
    : undefined;
  if (cmd.id && !existing) throw new DomainError('Bank sənədi tapılmadı.', 'id', 'not-found');
  if (existing) {
    expectVersion(existing, cmd.version, label[cmd.direction]);
    if (existing.status !== 'posted')
      throw new DomainError('Ləğv edilmiş sənəd dəyişdirilmir.', undefined, 'conflict');
    if (existing.direction !== cmd.direction)
      throw new DomainError('Sənədin növü (daxilolma / məxaric) dəyişdirilmir.', 'direction');
  }
  const number =
    parseText(cmd.number, 'Nömrə', 40, false) ||
    (existing ? String(existing.number) : nextNumber(tx, cmd.companyId, cmd.direction));
  const key = numberKey(number);
  const same = tx.db.get(
    'SELECT id FROM bank_documents WHERE company_id=? AND direction=? AND number_key=?',
    cmd.companyId,
    cmd.direction,
    key,
  );
  if (same && same.id !== cmd.id)
    throw new DomainError('Bu nömrə ilə sənəd artıq var.', 'number', 'conflict');
  const id = existing ? String(existing.id) : tx.id();
  const data = payload(number, n);
  if (existing) {
    const last = tx.db.get(
      "SELECT payload FROM document_history WHERE company_id=? AND doc_type=? AND doc_id=? AND version=? AND status='posted'",
      cmd.companyId,
      BANK,
      id,
      existing.version as bigint,
    );
    // Unchanged content is not posted again; binding a statement row is done by statement.link.
    if (last && String(last.payload) === JSON.stringify(data)) {
      if (cmd.statementLineId && cmd.statementLineId !== existing.statement_line_id)
        throw new DomainError(
          'Mövcud sənədi çıxarış sətrinə bağlamaq üçün çıxarışda “Bu sənədlə bağla” seçin.',
          'statementLineId',
        );
      return { id, version: Number(existing.version), number };
    }
    tx.open(cmd.companyId, String(existing.date));
  }
  tx.open(cmd.companyId, n.header.date);
  const version = existing ? Number(existing.version) + 1 : 1;
  const now = tx.clock.now();
  // Reverse the previous version first: invoice matching must not see this document twice.
  let previous: Posting[] = [];
  if (existing) {
    const prev = tx.entryPostings(cmd.companyId, BANK, id, Number(existing.version));
    previous = prev.postings;
    tx.post(
      cmd.companyId,
      chart,
      { type: BANK, id, number: String(existing.number), version: Number(existing.version) },
      prev.date,
      true,
      storno(prev.postings),
    );
  }
  const values = [
    number,
    key,
    n.header.date,
    n.header.bankAccountId,
    n.currency,
    n.rate,
    n.total,
    n.totalAzn,
    n.header.bankReference,
    n.header.counterpartyName,
    n.header.counterpartyTaxId,
    n.header.purpose,
    JSON.stringify(data.lines),
    version,
    now,
  ] as const;
  if (existing)
    tx.db.run(
      `UPDATE bank_documents SET number=?,number_key=?,date=?,bank_account_id=?,currency=?,rate=?,amount=?,
         amount_azn=?,bank_reference=?,counterparty_name=?,counterparty_tax_id=?,purpose=?,lines=?,version=?,
         updated_at=? WHERE id=?`,
      ...values,
      id,
    );
  else
    tx.db.run(
      `INSERT INTO bank_documents(number,number_key,date,bank_account_id,currency,rate,amount,amount_azn,
         bank_reference,counterparty_name,counterparty_tax_id,purpose,lines,version,updated_at,
         id,company_id,direction,status,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'posted',?)`,
      ...values,
      id,
      cmd.companyId,
      cmd.direction,
      now,
    );
  const postings = buildPostings(tx, cmd.companyId, chart, id, n);
  tx.post(
    cmd.companyId,
    chart,
    { type: BANK, id, number, version },
    n.header.date,
    false,
    postings,
  );
  guardAdvances(tx, cmd.companyId, id, previous);
  // The statement row stays what the bank wrote: account, direction, date and amount.
  const bound =
    existing?.statement_line_id &&
    tx.db.get(
      "SELECT 1 AS x FROM statement_lines WHERE company_id=? AND id=? AND state='posted' AND document_id=?",
      cmd.companyId,
      String(existing.statement_line_id),
      id,
    )
      ? String(existing.statement_line_id)
      : undefined;
  bindStatementLine(
    tx,
    cmd.companyId,
    tx.db.get('SELECT * FROM bank_documents WHERE company_id=? AND id=?', cmd.companyId, id)!,
    cmd.statementLineId,
    bound,
  );
  refreshPair(tx, cmd.companyId, id);
  tx.history(cmd.companyId, BANK, id, version, 'posted', data);
  tx.audit(
    cmd.companyId,
    existing ? 'Düzəliş edildi (storno + yeni yazılış)' : 'Uçota alındı',
    label[cmd.direction],
    id,
    `${number} · ${n.header.date} · ${String(n.bank.name) || String(n.bank.iban)} · ${money(n.total)} ${n.currency}`,
  );
  return { id, version, number };
}

export function cancelBankDocument(tx: Tx, cmd: CommandOf<'bank.cancel'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = parseText(cmd.reason, 'Ləğv səbəbi');
  const row: Row | undefined = tx.db.get(
    'SELECT * FROM bank_documents WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('Bank sənədi tapılmadı.', 'id', 'not-found');
  const direction = row.direction as Direction;
  expectVersion(row, cmd.version, label[direction]);
  if (row.status !== 'posted')
    throw new DomainError('Sənəd artıq ləğv edilib.', undefined, 'conflict');
  const prev = tx.entryPostings(cmd.companyId, BANK, cmd.id, Number(row.version));
  tx.open(cmd.companyId, prev.date);
  const chart = tx.chart(cmd.companyId);
  tx.post(
    cmd.companyId,
    chart,
    { type: BANK, id: cmd.id, number: String(row.number), version: Number(row.version) },
    prev.date,
    true,
    storno(prev.postings),
  );
  const version = Number(row.version) + 1;
  tx.db.run(
    "UPDATE bank_documents SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  guardAdvances(tx, cmd.companyId, cmd.id, prev.postings);
  refreshPair(tx, cmd.companyId, cmd.id);
  releaseStatementLine(tx, cmd.companyId, cmd.id);
  tx.history(cmd.companyId, BANK, cmd.id, version, 'cancelled', { reason });
  tx.audit(
    cmd.companyId,
    'Ləğv edildi (storno)',
    label[direction],
    cmd.id,
    `${row.number} · ${reason}`,
  );
  return { id: cmd.id, version };
}
