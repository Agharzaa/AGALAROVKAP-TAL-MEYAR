/**
 * Sales and purchase invoices (stage 2; docs/QERARLAR.md "Satış və ƏDV", "Avanslar", "Alış",
 * "Alış ƏDV-sinin taleyi"; 2026-10-07 evening/night).
 *
 * Sale, per line:   Dt 211.01 (partner, contract, this invoice) / Kt 601 (income type, VAT rate) — gross
 *                   Dt 604.1 (VAT rate) / Kt 521.01 (payment kind "tax") — VAT, only at 18%
 *                   goods: Dt 701 (product group, cost of sales) / Kt 205 (product) — FIFO cost
 *                   then open advances: Dt 543.01 (…, advance document) / Kt 211.01 (…, this invoice)
 * Purchase, per line: Dt 721/201/205/113 / Kt 531.01 — net (gross when VAT goes to cost)
 *                   Dt 241 (partner, this invoice, VAT rate) / Kt 531.01 — VAT when offset
 *                   then open advances: Dt 531.01 (…, this invoice) / Kt 243.01 (…, advance)
 * Currency contracts use the .02 accounts with the currency amount beside the AZN amount.
 *
 * Like manual operations, saving posts at once, a correction stornoes the previous entry and
 * posts the new one, and cancelling stornoes it. The previous entry is reversed before the new
 * one is computed, so FIFO and the advance offset see the ledger without this invoice.
 */
import { DomainError } from '../domain/errors.js';
import { formatMinor, type Minor } from '../domain/money.js';
import { checkPostings, storno, type Posting, type Side } from '../domain/posting.js';
import { formatPrice, formatQty, parsePrice, parseQty } from '../domain/quantity.js';
import { numberKey, parseDate, parseText } from '../domain/values.js';
import {
  allocateAdvances,
  AZN_RATE,
  aznAmounts,
  fifoCost,
  lineAmounts,
  type InvoiceDirection,
  type LineAmounts,
} from '../domain/invoice.js';
import { subkontoLabel } from '../domain/chart.js';
import type { Account, Chart, CurrencyCode, SubkontoKind, VatRate } from '../domain/chart.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type { Row } from '../infrastructure/sqlite/db.js';
import { issuedBefore, openAdvances, stockLayers } from './stock.js';
import { checkSideValues } from './subkonto.js';
import { expectVersion, type Tx } from './tx.js';

export const INVOICE = 'invoice';
type SaveInvoice = CommandOf<'invoice.save'>;
type ProductKind = 'goods' | 'material' | 'asset' | 'service';

const label = { sale: 'Satış qaiməsi', purchase: 'Alış qaiməsi' } as const;
const prefix = { sale: 'SQ', purchase: 'AQ' } as const;

/** Stored, canonical form of a line (what the user entered, resolved and validated). */
interface StoredLine {
  productId: string;
  quantity: string;
  price: string;
  vatRate: VatRate;
  incomeTypeId: string;
  account: string;
  expenseItemId: string;
  vatTreatment: 'offset' | 'cost' | '';
  memo: string;
  net: string;
  vat: string;
  gross: string;
  netAzn: string;
  vatAzn: string;
  grossAzn: string;
}

interface Line {
  stored: StoredLine;
  product: Row;
  kind: ProductKind;
  quantity: bigint;
  doc: LineAmounts;
  azn: LineAmounts;
  account?: Account;
  treatment: 'offset' | 'cost';
}

function nextNumber(tx: Tx, companyId: string, direction: InvoiceDirection): string {
  const n =
    Number(
      tx.db.get(
        'SELECT COUNT(*) AS n FROM invoices WHERE company_id=? AND direction=?',
        companyId,
        direction,
      )!.n,
    ) + 1;
  for (let i = n; ; i++) {
    const candidate = `${prefix[direction]}-${String(i).padStart(6, '0')}`;
    if (
      !tx.db.get(
        'SELECT 1 AS x FROM invoices WHERE company_id=? AND direction=? AND number_key=?',
        companyId,
        direction,
        numberKey(candidate),
      )
    )
      return candidate;
  }
}

/** The first postable account of `codes` — "211.01" in today's chart, "211" in an older one. */
function pick(chart: Chart, codes: string[], field: string): Account {
  for (const c of codes) {
    const a = chart.get(c);
    if (a && chart.postable(c)) return a;
  }
  throw new DomainError(`${codes[0]} hesabı hesab planında yoxdur və ya qrupdur.`, field);
}

function role(tx: Tx, companyId: string, name: string, what: string): string {
  const r = tx.db.get(
    'SELECT id FROM items WHERE company_id=? AND role=? AND archived=0',
    companyId,
    name,
  );
  if (!r)
    throw new DomainError(
      `Kitabçada "${what}" elementi tapılmadı (arxivdə ola bilər). Kitabçalar bölməsində bərpa edin.`,
      undefined,
      'not-found',
    );
  return String(r.id);
}

/** Subkonto values of `account` from what the posting knows, in the account's order. */
function fill(
  account: Account,
  values: Partial<Record<SubkontoKind, string>>,
  where: string,
): string[] {
  return account.subkonto.map((kind) => {
    const v = values[kind];
    if (!v)
      throw new DomainError(
        `${where}: ${account.code} hesabının "${subkontoLabel[kind]}" subkontosu qaimədən doldurula bilmir; başqa hesab seçin.`,
      );
    return v;
  });
}

const money = (m: Minor) => formatMinor(m);

function normalize(tx: Tx, cmd: SaveInvoice, chart: Chart) {
  const company = tx.company(cmd.companyId);
  const vatPayer = company.vat_payer === 1n;
  const partner = tx.db.get(
    'SELECT * FROM partners WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.partnerId,
  );
  if (!partner) throw new DomainError('Kontragent tapılmadı.', 'partnerId', 'not-found');
  if (partner.archived === 1n) throw new DomainError('Kontragent arxivdədir.', 'partnerId');
  const contract = tx.db.get(
    'SELECT * FROM contracts WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.contractId,
  );
  if (!contract) throw new DomainError('Müqavilə seçin.', 'contractId', 'not-found');
  if (contract.partner_id !== partner.id)
    throw new DomainError('Müqavilə seçilən kontragentə aid deyil.', 'contractId');
  if (contract.archived === 1n) throw new DomainError('Müqavilə arxivdədir.', 'contractId');
  const currency = String(contract.currency) as CurrencyCode;
  const foreign = currency !== 'AZN';
  let rate = AZN_RATE;
  if (foreign) rate = parsePrice(cmd.rate, `${currency} məzənnəsi`);
  else if (cmd.rate.trim() && parsePrice(cmd.rate, 'Məzənnə') !== AZN_RATE)
    throw new DomainError('Manat müqaviləsində məzənnə yazılmır.', 'rate');
  const treatment: 'offset' | 'cost' = !vatPayer
    ? 'cost'
    : (cmd.vatTreatment ?? (company.purchase_vat as 'offset' | 'cost'));

  const lines: Line[] = cmd.lines.map((l, i) => {
    const where = `Sətir ${i + 1}`;
    const f = (x: string) => `lines.${i}.${x}`;
    const product = tx.db.get(
      'SELECT * FROM products WHERE company_id=? AND id=?',
      cmd.companyId,
      l.productId,
    );
    if (!product)
      throw new DomainError(`${where}: nomenklatura seçin.`, f('productId'), 'not-found');
    if (product.archived === 1n)
      throw new DomainError(`${where}: nomenklatura arxivdədir.`, f('productId'));
    const kind = String(product.kind) as ProductKind;
    const quantity = parseQty(l.quantity, `${where}: miqdar`);
    const price = parsePrice(l.price, `${where}: qiymət`);
    if (l.vatRate === '18' && !vatPayer)
      throw new DomainError(
        `${where}: şirkət ƏDV ödəyicisi deyil; 18% seçilə bilməz.`,
        f('vatRate'),
      );
    const doc = lineAmounts(quantity, price, l.vatRate, cmd.pricesIncludeVat);
    const azn = aznAmounts(doc, rate);
    let account: Account | undefined;
    let incomeTypeId = '';
    let expenseItemId = '';
    if (cmd.direction === 'sale') {
      if (kind === 'asset')
        throw new DomainError(
          `${where}: əsas vəsaitin satışı qaimə ilə yox, ayrıca sənədlə aparılır.`,
          f('productId'),
        );
      incomeTypeId =
        l.incomeTypeId ||
        role(
          tx,
          cmd.companyId,
          kind === 'service' ? 'serviceIncome' : 'goodsIncome',
          kind === 'service' ? 'Xidmət satışı' : 'Məhsul satışı',
        );
      if (kind !== 'service') {
        const code = l.account?.trim() || (kind === 'material' ? '201' : '205');
        account = chart.require(code, f('account'));
        if (!account.quantitative || account.subkonto[0] !== 'product')
          throw new DomainError(
            `${where}: ${account.code} anbar hesabı deyil (nomenklatura və miqdar uçotu yoxdur).`,
            f('account'),
          );
      }
    } else {
      const code =
        l.account?.trim() || { service: '721', material: '201', goods: '205', asset: '113' }[kind];
      account = chart.require(code, f('account'));
      if (account.currency)
        throw new DomainError(`${where}: ${account.code} valyuta hesabıdır.`, f('account'));
      if (account.subkonto.includes('expenseItem')) {
        if (!l.expenseItemId)
          throw new DomainError(`${where}: xərc maddəsini seçin.`, f('expenseItemId'));
        expenseItemId = l.expenseItemId;
      }
    }
    const lineTreatment: 'offset' | 'cost' =
      cmd.direction === 'purchase' ? (vatPayer ? (l.vatTreatment ?? treatment) : 'cost') : 'offset';
    return {
      product,
      kind,
      quantity,
      doc,
      azn,
      ...(account ? { account } : {}),
      treatment: lineTreatment,
      stored: {
        productId: String(product.id),
        quantity: formatQty(quantity),
        price: formatPrice(price),
        vatRate: l.vatRate,
        incomeTypeId,
        account: account?.code ?? '',
        expenseItemId,
        vatTreatment: cmd.direction === 'purchase' ? lineTreatment : '',
        memo: parseText(l.memo, `${where}: məzmun`, 300, false),
        net: money(doc.net),
        vat: money(doc.vat),
        gross: money(doc.gross),
        netAzn: money(azn.net),
        vatAzn: money(azn.vat),
        grossAzn: money(azn.gross),
      },
    };
  });
  const sum = (pick: (l: Line) => Minor) => lines.reduce((s, l) => s + pick(l), 0n);
  return {
    partner,
    contract,
    currency,
    foreign,
    rate,
    treatment,
    lines,
    totals: {
      net: sum((l) => l.doc.net),
      vat: sum((l) => l.doc.vat),
      total: sum((l) => l.doc.gross),
      totalAzn: sum((l) => l.azn.gross),
    },
    header: {
      direction: cmd.direction,
      date: parseDate(cmd.date),
      partnerId: String(partner.id),
      contractId: String(contract.id),
      currency,
      rate: formatPrice(rate),
      pricesIncludeVat: cmd.pricesIncludeVat,
      vatTreatment: treatment,
      eqSeries: parseText(cmd.eqSeries, 'E-qaimə seriyası', 20, false).toUpperCase(),
      eqNumber: parseText(cmd.eqNumber, 'E-qaimə nömrəsi', 40, false),
      memo: parseText(cmd.memo, 'Məzmun', 500, false),
    },
  };
}

type Normalized = ReturnType<typeof normalize>;

/** Builds the entry of an invoice against the current ledger (this invoice already reversed). */
function buildPostings(
  tx: Tx,
  companyId: string,
  chart: Chart,
  id: string,
  n: Normalized,
): Posting[] {
  const self = `${INVOICE}:${id}`;
  const { header, foreign, currency } = n;
  const partner = header.partnerId;
  const contract = header.contractId;
  const cur = (amount: Minor) => (foreign ? { currency, curAmount: amount } : {});
  const out: Posting[] = [];
  const side = (
    account: Account,
    values: Partial<Record<SubkontoKind, string>>,
    where: string,
  ) => ({
    account: account.code,
    sk: fill(account, values, where),
  });
  const settle = (code: '211' | '531' | '243' | '543') =>
    pick(chart, foreign ? [`${code}.02`] : [`${code}.01`, code], 'contractId');

  if (header.direction === 'sale') {
    const receivable = settle('211');
    const revenue = pick(chart, ['601'], 'lines');
    const vatOut = pick(chart, ['604.1', '604'], 'lines');
    const vatTax = pick(chart, ['521.01', '521'], 'lines');
    const cogs = pick(chart, ['701'], 'lines');
    const pv = { partner, contract, document: self };
    n.lines.forEach((l, i) => {
      const where = `Sətir ${i + 1}`;
      const memo = l.stored.memo || String(l.product.name);
      out.push({
        dt: { ...side(receivable, pv, where), ...cur(l.doc.gross) },
        kt: side(revenue, { incomeType: l.stored.incomeTypeId, vatRate: l.stored.vatRate }, where),
        amount: l.azn.gross,
        memo,
      });
      if (l.azn.vat > 0n)
        out.push({
          dt: side(vatOut, { vatRate: l.stored.vatRate }, where),
          kt: side(
            vatTax,
            {
              paymentKind: role(tx, companyId, 'vatTax', 'Vergi (haqq)'),
              taxType: tx.db.get(
                "SELECT id FROM items WHERE company_id=? AND kind='taxType' AND name='ƏDV'",
                companyId,
              )?.id as string,
            },
            where,
          ),
          amount: l.azn.vat,
          memo: `ƏDV · ${memo}`,
        });
      if (l.account) {
        const stock = l.account;
        const layers = stockLayers(tx.db, companyId, stock.code, l.stored.productId, header.date);
        const before = issuedBefore(
          tx.db,
          companyId,
          stock.code,
          l.stored.productId,
          header.date,
          self,
        );
        // Earlier lines of this invoice for the same product have already left the stock.
        const sameEarlier = n.lines
          .slice(0, i)
          .filter(
            (x) => x.account?.code === stock.code && x.stored.productId === l.stored.productId,
          )
          .reduce((s, x) => s + x.quantity, 0n);
        const cost = fifoCost(layers, before + sameEarlier, l.quantity, `${where} (${memo})`);
        if (cost <= 0n)
          throw new DomainError(`${where}: malın maya dəyəri sıfırdır; alış sənədini yoxlayın.`);
        const group =
          String(l.product.group_id) ||
          role(tx, companyId, 'defaultProductGroup', 'Əsas nomenklatura qrupu');
        out.push({
          dt: side(
            cogs,
            {
              productGroup: group,
              expenseItem: role(tx, companyId, 'cogs', 'Satılmış malların maya dəyəri'),
              product: l.stored.productId,
            },
            where,
          ),
          kt: side(stock, { product: l.stored.productId }, where),
          amount: cost,
          quantity: l.quantity,
          memo: `Maya dəyəri · ${memo}`,
        });
      }
    });
    const advance = settle('543');
    const total = n.lines.reduce((s, l) => s + l.azn.gross, 0n);
    const totalCur = foreign ? n.lines.reduce((s, l) => s + l.doc.gross, 0n) : null;
    const open = openAdvances(
      tx.db,
      companyId,
      advance.code,
      partner,
      contract,
      'credit',
      header.date,
    );
    for (const o of allocateAdvances(open, total, totalCur))
      out.push({
        dt: {
          ...side(advance, { partner, contract, document: o.document }, 'Avans'),
          ...cur(o.currency),
        },
        kt: { ...side(receivable, pv, 'Avans'), ...cur(o.currency) },
        amount: o.amount,
        memo: 'Avansın əvəzləşdirilməsi',
      });
  } else {
    const payable = settle('531');
    const vatIn = pick(chart, ['241'], 'lines');
    const pv = { partner, contract, document: self };
    n.lines.forEach((l, i) => {
      const where = `Sətir ${i + 1}`;
      const memo = l.stored.memo || String(l.product.name);
      const account = l.account!;
      const toCost = l.treatment === 'cost';
      const amount = toCost ? l.azn.gross : l.azn.net;
      const amountCur = toCost ? l.doc.gross : l.doc.net;
      if (amount <= 0n) throw new DomainError(`${where}: manatla məbləğ sıfıra yuvarlaqlaşır.`);
      out.push({
        dt: side(
          account,
          {
            product: l.stored.productId,
            expenseItem: l.stored.expenseItemId,
            productGroup:
              String(l.product.group_id) ||
              role(tx, companyId, 'defaultProductGroup', 'Əsas nomenklatura qrupu'),
          },
          where,
        ),
        kt: { ...side(payable, pv, where), ...cur(amountCur) },
        amount,
        ...(account.quantitative ? { quantity: l.quantity } : {}),
        memo,
      });
      if (!toCost && l.azn.vat > 0n)
        out.push({
          dt: side(vatIn, { partner, document: self, vatRate: l.stored.vatRate }, where),
          kt: { ...side(payable, pv, where), ...cur(l.doc.vat) },
          amount: l.azn.vat,
          memo: `ƏDV · ${memo}`,
        });
    });
    const advance = settle('243');
    const total = n.lines.reduce((s, l) => s + l.azn.gross, 0n);
    const totalCur = foreign ? n.lines.reduce((s, l) => s + l.doc.gross, 0n) : null;
    const open = openAdvances(
      tx.db,
      companyId,
      advance.code,
      partner,
      contract,
      'debit',
      header.date,
    );
    for (const o of allocateAdvances(open, total, totalCur))
      out.push({
        dt: { ...side(payable, pv, 'Avans'), ...cur(o.currency) },
        kt: {
          ...side(advance, { partner, contract, document: o.document }, 'Avans'),
          ...cur(o.currency),
        },
        amount: o.amount,
        memo: 'Verilmiş avansın əvəzləşdirilməsi',
      });
  }
  // Every value is also checked against the catalogs, as for a manual operation.
  out.forEach((p, i) => {
    for (const which of ['dt', 'kt'] as const) {
      const s: Side = p[which];
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

function payload(number: string, n: Normalized) {
  return { number, ...n.header, lines: n.lines.map((l) => l.stored) };
}

export function saveInvoice(tx: Tx, cmd: SaveInvoice): CommandResult {
  const chart = tx.chart(cmd.companyId);
  const n = normalize(tx, cmd, chart);
  const existing = cmd.id
    ? tx.db.get('SELECT * FROM invoices WHERE company_id=? AND id=?', cmd.companyId, cmd.id)
    : undefined;
  if (cmd.id && !existing) throw new DomainError('Qaimə tapılmadı.', 'id', 'not-found');
  if (existing) {
    expectVersion(existing, cmd.version, label[cmd.direction]);
    if (existing.status !== 'posted')
      throw new DomainError('Ləğv edilmiş qaimə dəyişdirilmir.', undefined, 'conflict');
    if (existing.direction !== cmd.direction)
      throw new DomainError('Qaimənin növü dəyişdirilmir.', 'direction');
  }
  const number =
    parseText(cmd.number, 'Nömrə', 40, false) ||
    (existing ? String(existing.number) : nextNumber(tx, cmd.companyId, cmd.direction));
  const key = numberKey(number);
  const same = tx.db.get(
    'SELECT id FROM invoices WHERE company_id=? AND direction=? AND number_key=?',
    cmd.companyId,
    cmd.direction,
    key,
  );
  if (same && same.id !== cmd.id)
    throw new DomainError('Bu nömrə ilə qaimə artıq var.', 'number', 'conflict');
  const eqKey = n.header.eqNumber ? numberKey(`${n.header.eqSeries}${n.header.eqNumber}`) : '';
  if (eqKey) {
    const dup = tx.db.get(
      cmd.direction === 'sale'
        ? "SELECT number FROM invoices WHERE company_id=? AND direction='sale' AND eq_key=? AND status='posted' AND id<>?"
        : "SELECT number FROM invoices WHERE company_id=? AND direction='purchase' AND eq_key=? AND status='posted' AND id<>? AND partner_id=?",
      cmd.companyId,
      eqKey,
      cmd.id ?? '',
      ...(cmd.direction === 'purchase' ? [n.header.partnerId] : []),
    );
    if (dup)
      throw new DomainError(
        `Bu e-qaimə artıq ${dup.number} nömrəli qaimədə uçota alınıb.`,
        'eqNumber',
        'conflict',
      );
  }
  const id = existing ? String(existing.id) : tx.id();
  const data = payload(number, n);
  if (existing) {
    const last = tx.db.get(
      "SELECT payload FROM document_history WHERE company_id=? AND doc_type=? AND doc_id=? AND version=? AND status='posted'",
      cmd.companyId,
      INVOICE,
      id,
      existing.version as bigint,
    );
    if (last && String(last.payload) === JSON.stringify(data))
      return { id, version: Number(existing.version), number };
    tx.open(cmd.companyId, String(existing.date));
  }
  tx.open(cmd.companyId, n.header.date);
  const version = existing ? Number(existing.version) + 1 : 1;
  const now = tx.clock.now();
  // Reverse the previous version first: FIFO and advances must not see this invoice twice.
  if (existing) {
    const prev = tx.entryPostings(cmd.companyId, INVOICE, id, Number(existing.version));
    tx.post(
      cmd.companyId,
      chart,
      { type: INVOICE, id, number: String(existing.number), version: Number(existing.version) },
      prev.date,
      true,
      storno(prev.postings),
    );
  }
  const postings = buildPostings(tx, cmd.companyId, chart, id, n);
  const stored = JSON.stringify(data.lines);
  const values = [
    number,
    key,
    n.header.date,
    n.header.partnerId,
    n.header.contractId,
    n.currency,
    n.rate,
    n.header.pricesIncludeVat ? 1 : 0,
    n.header.eqSeries,
    n.header.eqNumber,
    eqKey,
    n.header.memo,
    stored,
    n.totals.net,
    n.totals.vat,
    n.totals.total,
    n.totals.totalAzn,
    version,
    now,
  ] as const;
  if (existing)
    tx.db.run(
      `UPDATE invoices SET number=?,number_key=?,date=?,partner_id=?,contract_id=?,currency=?,rate=?,
         prices_include_vat=?,eq_series=?,eq_number=?,eq_key=?,memo=?,lines=?,net=?,vat=?,total=?,total_azn=?,
         version=?,updated_at=? WHERE id=?`,
      ...values,
      id,
    );
  else
    tx.db.run(
      `INSERT INTO invoices(number,number_key,date,partner_id,contract_id,currency,rate,prices_include_vat,
         eq_series,eq_number,eq_key,memo,lines,net,vat,total,total_azn,version,updated_at,id,company_id,direction,status,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'posted',?)`,
      ...values,
      id,
      cmd.companyId,
      cmd.direction,
      now,
    );
  tx.post(
    cmd.companyId,
    chart,
    { type: INVOICE, id, number, version },
    n.header.date,
    false,
    postings,
  );
  tx.history(cmd.companyId, INVOICE, id, version, 'posted', data);
  tx.audit(
    cmd.companyId,
    existing ? 'Düzəliş edildi (storno + yeni yazılış)' : 'Uçota alındı',
    label[cmd.direction],
    id,
    `${number} · ${n.header.date} · ${String(n.partner.name)} · ${money(n.totals.total)} ${n.currency}`,
  );
  return { id, version, number };
}

export function cancelInvoice(tx: Tx, cmd: CommandOf<'invoice.cancel'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = parseText(cmd.reason, 'Ləğv səbəbi');
  const row = tx.db.get(
    'SELECT * FROM invoices WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('Qaimə tapılmadı.', 'id', 'not-found');
  const direction = row.direction as InvoiceDirection;
  expectVersion(row, cmd.version, label[direction]);
  if (row.status !== 'posted')
    throw new DomainError('Qaimə artıq ləğv edilib.', undefined, 'conflict');
  const prev = tx.entryPostings(cmd.companyId, INVOICE, cmd.id, Number(row.version));
  tx.open(cmd.companyId, prev.date);
  tx.post(
    cmd.companyId,
    tx.chart(cmd.companyId),
    { type: INVOICE, id: cmd.id, number: String(row.number), version: Number(row.version) },
    prev.date,
    true,
    storno(prev.postings),
  );
  const version = Number(row.version) + 1;
  tx.db.run(
    "UPDATE invoices SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  tx.history(cmd.companyId, INVOICE, cmd.id, version, 'cancelled', { reason });
  tx.audit(
    cmd.companyId,
    'Ləğv edildi (storno)',
    label[direction],
    cmd.id,
    `${row.number} · ${reason}`,
  );
  return { id: cmd.id, version };
}
