/**
 * Booking DVX e-qaimələr (stage 4b; docs/MERHELE-4-EQAIME.md §4, §6; QERARLAR 2026-10-15,
 * mərhələ 4 §5, §11–§13).
 *
 * An e-qaimə is booked by an ordinary invoice — the same invoice.save, journal, FIFO, advances
 * and audit as an invoice typed by hand. What the system knows is a proposal: the partner by
 * VÖEN, the contract when it is the only active one (or the one the accountant chose for this
 * VÖEN), each goods line by the learned map. It is posted by itself only when every part comes
 * from entries the accountant switched to "auto" and Meyar's invoice reproduces DVX's amounts to
 * the qəpik. An invoice already typed by hand is linked, never booked twice.
 */
import { DomainError } from '../domain/errors.js';
import { foldKey } from '../domain/eqaime.js';
import { lineAmounts } from '../domain/invoice.js';
import { formatMinor, parseMoney, roundHalfAwayFromZero, type Minor } from '../domain/money.js';
import {
  formatPrice,
  formatQty,
  parsePrice,
  parseQty,
  PRICE_SCALE,
  QTY_SCALE,
} from '../domain/quantity.js';
import type { Chart, VatRate } from '../domain/chart.js';
import { parseText } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type { EqLineView, EqMapView, EqProposal, EqProposalLine } from '../contracts/queries.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import { saveInvoice } from './invoices.js';
import { loadChart, type Tx } from './tx.js';

/** Days between an e-qaimə and a numberless invoice typed by hand for it. */
export const LINK_DAYS = 5;

type Direction = 'sale' | 'purchase';
const money = (m: Minor) => formatMinor(m);
const RATES = new Set(['18', '0', 'exempt', 'nontaxable']);
const contractKind = { sale: 'sale', purchase: 'purchase' } as const;
const dvxCancelled = new Set(['cancelled', 'rejected']);

/** The normalised DVX goods name of a map entry ("A-95  Benzin" ≡ "a-95 benzin"). */
export const nameKey = (name: string) => foldKey(name);

interface MapEntry {
  id: string;
  version: number;
  taxId: string;
  code: string;
  nameKey: string;
  productId: string;
  account: string;
  expenseItemId: string;
  incomeTypeId: string;
  vatTreatment: '' | 'offset' | 'cost';
  contractId: string;
  mode: 'suggest' | 'auto';
}

/** Everything a proposal reads, loaded once per direction (a box may hold thousands). */
export interface EqContext {
  companyId: string;
  direction: Direction;
  closed: string;
  chart: Chart;
  partners: Map<string, Row>;
  contracts: Map<string, Row[]>;
  contractById: Map<string, Row>;
  products: Map<string, Row>;
  maps: MapEntry[];
  /** Posted invoices by e-qaimə key. */
  byNumber: Map<string, Row[]>;
  /** Posted numberless invoices not linked to an e-qaimə, by partner. */
  numberless: Map<string, Row[]>;
}

const group = <K, V>(rows: V[], key: (v: V) => K) => {
  const m = new Map<K, V[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
};

export function eqContext(db: Db, companyId: string, direction: Direction): EqContext {
  const company = db.get('SELECT * FROM companies WHERE id=?', companyId)!;
  const partners = db.all("SELECT * FROM partners WHERE company_id=? AND tax_id<>''", companyId);
  const contracts = db.all(
    'SELECT * FROM contracts WHERE company_id=? AND kind=?',
    companyId,
    contractKind[direction],
  );
  const invoices = db.all(
    `SELECT i.id, i.number, i.date, i.partner_id, i.eq_key, i.net, i.vat, i.total, i.total_azn, i.currency
     FROM invoices i WHERE i.company_id=? AND i.direction=? AND i.status='posted'
       AND NOT EXISTS(SELECT 1 FROM eq_documents d WHERE d.company_id=i.company_id AND d.invoice_id=i.id)`,
    companyId,
    direction,
  );
  return {
    companyId,
    direction,
    closed: String(company.closed_through),
    chart: loadChart(db, companyId),
    partners: new Map(partners.map((p) => [String(p.tax_id), p])),
    contracts: group(
      contracts.filter((c) => c.archived === 0n),
      (c) => String(c.partner_id),
    ),
    contractById: new Map(contracts.map((c) => [String(c.id), c])),
    products: new Map(
      db.all('SELECT * FROM products WHERE company_id=?', companyId).map((p) => [String(p.id), p]),
    ),
    maps: db
      .all(
        'SELECT * FROM eq_product_map WHERE company_id=? AND direction=? AND archived=0',
        companyId,
        direction,
      )
      .map((r) => ({
        id: String(r.id),
        version: Number(r.version),
        taxId: String(r.tax_id),
        code: String(r.dvx_code),
        nameKey: String(r.name_key),
        productId: String(r.product_id),
        account: String(r.account),
        expenseItemId: String(r.expense_item_id),
        incomeTypeId: String(r.income_type_id),
        vatTreatment: r.vat_treatment as MapEntry['vatTreatment'],
        contractId: String(r.contract_id),
        mode: r.mode as MapEntry['mode'],
      })),
    byNumber: group(
      invoices.filter((i) => i.eq_key !== ''),
      (i) => String(i.eq_key),
    ),
    numberless: group(
      invoices.filter((i) => i.eq_key === ''),
      (i) => String(i.partner_id),
    ),
  };
}

/**
 * The most specific entry for a goods line (§6.3): VÖEN + code + name, VÖEN + code, VÖEN + name,
 * code + name (any partner), code (any partner). Each rank is one key of the map's unique index,
 * so two active entries never tie.
 */
function findEntry(ctx: EqContext, taxId: string, line: EqLineView): MapEntry | undefined {
  const code = line.code.trim();
  const key = nameKey(line.name);
  const rank = (e: MapEntry): number => {
    if (!e.code && !e.nameKey) return 0; // header entry: the whole e-qaimə, not a line
    if (e.code && e.code !== code) return 0;
    if (e.nameKey && e.nameKey !== key) return 0;
    if (e.taxId === taxId) return e.code && e.nameKey ? 5 : e.code ? 4 : 3;
    if (e.taxId) return 0;
    return e.code && e.nameKey ? 2 : e.code ? 1 : 0;
  };
  let best: MapEntry | undefined;
  let bestRank = 0;
  for (const e of ctx.maps) {
    const r = rank(e);
    if (r > bestRank) [best, bestRank] = [e, r];
  }
  return best;
}

function headerEntry(ctx: EqContext, taxId: string): MapEntry | undefined {
  return ctx.maps.find((e) => e.taxId === taxId && !e.code && !e.nameKey);
}

/** The VAT rate of a DVX line; empty when the line does not say and the e-qaimə cannot tell. */
function rateOf(line: EqLineView, doc: Row): VatRate | '' {
  if (RATES.has(line.vatRate)) return line.vatRate as VatRate;
  if (parseMoney(line.vat.replace('-', '')) !== 0n) return '18';
  const bases: [VatRate, bigint][] = [
    ['0', doc.base_0 as bigint],
    ['exempt', doc.base_exempt as bigint],
    ['nontaxable', doc.base_nontaxable as bigint],
  ];
  const used = bases.filter(([, v]) => v !== 0n);
  return used.length === 1 ? used[0]![0] : '';
}

/**
 * Quantity and price that make Meyar's line equal DVX's to the qəpik: DVX's own price first,
 * then the price derived from the amount (4 decimals). Empty price when neither does.
 */
function priced(net: Minor, vat: Minor, quantity: bigint, dvxPrice: string, rate: VatRate) {
  const tries: bigint[] = [];
  try {
    tries.push(parsePrice(dvxPrice));
  } catch {
    /* more than 4 decimals or empty: derive it */
  }
  if (quantity > 0n && net > 0n)
    tries.push(roundHalfAwayFromZero(net * (PRICE_SCALE / 100n) * QTY_SCALE, quantity));
  for (const price of tries) {
    if (price <= 0n) continue;
    const a = lineAmounts(quantity, price, rate, false);
    if (a.net === net && a.vat === vat) return { price: formatPrice(price), fits: true };
  }
  const a = tries.length ? lineAmounts(quantity, tries[tries.length - 1]!, rate, false) : null;
  return {
    price: tries.length ? formatPrice(tries[tries.length - 1]!) : '',
    fits: false,
    got: a,
  };
}

const dvxLine = (doc: Row): EqLineView[] =>
  String(doc.lines) ? (JSON.parse(String(doc.lines)) as EqLineView[]) : [];

/** How a waiting e-qaimə would be booked. Pure: reads the context only. */
export function propose(ctx: EqContext, doc: Row): EqProposal {
  const reasons: string[] = [];
  const taxId = String(doc.tax_id);
  const name = String(doc.name);
  const out: EqProposal = {
    state: 'unknown',
    reasons,
    partnerId: '',
    contractId: '',
    lines: [],
    candidates: [],
  };
  if (doc.kind !== 'main') {
    reasons.push(
      `${String(doc.kind_text) || 'Bu növ'} e-qaimə avtomatik uçota alınmır (düzəliş — mərhələ 4c; qaytarma, avans — əl ilə).`,
    );
    return out;
  }
  if (doc.excise !== 0n || doc.road_tax !== 0n) {
    reasons.push('E-qaimədə aksiz və ya yol vergisi var: əl ilə uçota alınır.');
    return out;
  }
  const partner = ctx.partners.get(taxId);
  let known = false;
  if (!partner) {
    reasons.push(`Yeni kontragent: VÖEN ${taxId} kitabçada yoxdur.`);
    out.newPartner = {
      name: name || `VÖEN ${taxId}`,
      taxId,
      // The last digit of a VÖEN: 1 — legal entity, 2 — individual (a hint only).
      kind: taxId.endsWith('2') ? 'individual' : 'legal',
    };
  } else {
    known = true;
    out.partnerId = String(partner.id);
    if (partner.archived === 1n) reasons.push(`${String(partner.name)} arxivdədir.`);
    // The same e-qaimə already typed by hand: link it, never book it twice.
    const same = (ctx.byNumber.get(String(doc.eq_key)) ?? []).find(
      (i) => i.partner_id === partner.id,
    );
    if (same) {
      out.sameNumber = {
        id: String(same.id),
        number: String(same.number),
        total: money(same.total_azn as bigint),
      };
      reasons.push(`Bu e-qaimə artıq ${String(same.number)} qaiməsində uçotdadır: bağlanacaq.`);
      out.state = 'auto';
      return out;
    }
    const days = (d: string) => Math.abs(Date.parse(d) - Date.parse(String(doc.date))) / 86_400_000;
    out.candidates = (ctx.numberless.get(String(partner.id)) ?? [])
      .filter((i) => i.total_azn === doc.total && days(String(i.date)) <= LINK_DAYS)
      .map((i) => ({
        id: String(i.id),
        number: String(i.number),
        date: String(i.date),
        total: money(i.total_azn as bigint),
      }));
    if (out.candidates.length)
      reasons.push(
        `Əl ilə yazılmış, e-qaimə nömrəsiz qaimə var (${out.candidates.map((c) => c.number).join(', ')}): ikinci dəfə uçota almayın — nömrəni ona yazın.`,
      );
  }

  // Contract: the one the accountant chose for this VÖEN, else the only active one.
  const header = headerEntry(ctx, taxId);
  let contractAuto = false;
  if (partner) {
    const active = ctx.contracts.get(String(partner.id)) ?? [];
    const chosen = header?.contractId ? ctx.contractById.get(header.contractId) : undefined;
    if (chosen && chosen.archived === 0n && chosen.partner_id === partner.id) {
      out.contractId = String(chosen.id);
      contractAuto = header!.mode === 'auto';
      if (!contractAuto) reasons.push('Müqavilə uyğunluqdan götürülüb (təklif rejimi).');
    } else if (active.length === 1) {
      out.contractId = String(active[0]!.id);
      contractAuto = true;
    } else
      reasons.push(
        active.length
          ? `${String(partner.name)} ilə ${active.length} aktiv ${ctx.direction === 'sale' ? 'satış' : 'alış'} müqaviləsi var: müqaviləni seçin.`
          : `${String(partner.name)} ilə aktiv ${ctx.direction === 'sale' ? 'satış' : 'alış'} müqaviləsi yoxdur.`,
      );
    const contract = out.contractId ? ctx.contractById.get(out.contractId) : undefined;
    if (contract && contract.currency !== 'AZN') {
      reasons.push(`Müqavilə ${String(contract.currency)} ilədir: məzənnəni yazın.`);
      contractAuto = false;
    }
  }

  // Lines.
  let linesAuto = true;
  const goods = dvxLine(doc);
  if (goods.length) {
    goods.forEach((g, i) => {
      const where = `Sətir ${i + 1} (${g.name})`;
      const found = findEntry(ctx, taxId, g);
      const line: EqProposalLine = {
        dvx: g,
        productId: '',
        quantity: '',
        price: '',
        vatRate: rateOf(g, doc),
        account: '',
        expenseItemId: '',
        incomeTypeId: '',
        vatTreatment: '',
        mapId: found?.id ?? '',
        mapMode: found?.mode ?? '',
        problem: '',
      };
      if (!found) line.problem = 'uyğunluq yoxdur — nomenklaturanı seçin';
      else {
        known = true;
        Object.assign(line, {
          productId: found.productId,
          account: found.account,
          expenseItemId: found.expenseItemId,
          incomeTypeId: found.incomeTypeId,
          vatTreatment: found.vatTreatment,
        });
        if (found.mode === 'suggest') line.problem = 'uyğunluq təklif rejimindədir';
      }
      fill(ctx, line, g.quantity, g.price, parseMoney(g.net.replace('-', '')), g.net, g.vat);
      if (line.problem) {
        linesAuto = false;
        reasons.push(`${where}: ${line.problem}.`);
      }
      out.lines.push(line);
    });
  } else if (header?.productId) {
    known = true;
    // The whole e-qaimə on one product (services, expenses): one line per VAT base.
    const bases: [VatRate, bigint][] = [
      ['18', doc.base_18 as bigint],
      ['0', doc.base_0 as bigint],
      ['exempt', doc.base_exempt as bigint],
      ['nontaxable', doc.base_nontaxable as bigint],
    ];
    const used = bases.filter(([, v]) => v !== 0n);
    if (!used.length && doc.header_full === 0n) used.push(['18', doc.net as bigint]);
    const baseSum = used.reduce((s, [, v]) => s + v, 0n);
    if (baseSum !== doc.net) {
      linesAuto = false;
      reasons.push(
        `ƏDV bazalarının cəmi (${money(baseSum)}) ƏDV-siz məbləğə (${money(doc.net as bigint)}) bərabər deyil.`,
      );
    }
    for (const [rate, base] of used) {
      const vat = rate === '18' ? (doc.vat as bigint) : 0n;
      const line: EqProposalLine = {
        dvx: null,
        productId: header.productId,
        quantity: '',
        price: '',
        vatRate: rate,
        account: header.account,
        expenseItemId: header.expenseItemId,
        incomeTypeId: header.incomeTypeId,
        vatTreatment: header.vatTreatment,
        mapId: header.id,
        mapMode: header.mode,
        problem: header.mode === 'suggest' ? 'uyğunluq təklif rejimindədir' : '',
      };
      fill(ctx, line, '1', '', base, money(base), money(vat));
      if (line.problem) {
        linesAuto = false;
        reasons.push(`Bütün qaimə (${rate === '18' ? '18%' : rate}): ${line.problem}.`);
      }
      out.lines.push(line);
    }
    if (used.filter(([r]) => r === '18').length === 0 && doc.vat !== 0n) {
      linesAuto = false;
      reasons.push('E-qaimədə ƏDV var, amma 18% bazası yoxdur.');
    }
  } else {
    linesAuto = false;
    reasons.push(
      'Mal sətirləri yoxdur: “Mallar üzrə” hesabatını yükləyin və ya qaiməni əl ilə doldurun.',
    );
  }
  if (out.lines.length) {
    const sum = (pick: (l: EqProposalLine) => string) =>
      out.lines.reduce((s, l) => s + (pick(l) ? parseMoney(pick(l)) : 0n), 0n);
    const net = sum((l) => l.dvx?.net ?? '');
    if (goods.length && net !== doc.net) {
      linesAuto = false;
      reasons.push('Mal sətirlərinin cəmi e-qaimənin məbləğinə bərabər deyil.');
    }
  }
  if (doc.total !== (doc.net as bigint) + (doc.vat as bigint)) {
    linesAuto = false;
    reasons.push(
      `Yekun məbləğ (${money(doc.total as bigint)}) ƏDV-siz məbləğ + ƏDV-yə bərabər deyil.`,
    );
  }
  if (String(doc.date) <= ctx.closed) {
    linesAuto = false;
    reasons.push(`Uçot dövrü ${ctx.closed} tarixinədək bağlanıb.`);
  }
  if (doc.manual_only === 1n) {
    linesAuto = false;
    reasons.push('Avtomatik uçot geri qaytarılıb: bu e-qaimə yalnız təklif olunur.');
  }
  out.state = !known
    ? 'unknown'
    : reasons.length === 0 && linesAuto && contractAuto && !!out.partnerId
      ? 'auto'
      : 'proposal';
  return out;
}

/** Product checks, quantity and price of a proposed line (problems go to the line). */
function fill(
  ctx: EqContext,
  line: EqProposalLine,
  quantity: string,
  dvxPrice: string,
  net: Minor,
  netText: string,
  vatText: string,
) {
  const problem = (p: string) => {
    if (!line.problem) line.problem = p;
  };
  if (netText.startsWith('-')) return problem('mənfi məbləğ');
  const product = line.productId ? ctx.products.get(line.productId) : undefined;
  if (line.productId && !product) problem('uyğunluqdakı nomenklatura tapılmadı');
  if (product?.archived === 1n) problem(`${String(product.name)} arxivdədir`);
  const kind = product ? String(product.kind) : '';
  const account =
    line.account ||
    (kind
      ? ctx.direction === 'purchase'
        ? ({ service: '721', material: '201', goods: '205', asset: '113' } as const)[
            kind as 'service'
          ]
        : kind === 'material'
          ? '201'
          : kind === 'goods'
            ? '205'
            : ''
      : '');
  const acc = account ? ctx.chart.get(account) : undefined;
  if (account && !acc) problem(`${account} hesabı yoxdur`);
  if (acc?.subkonto.includes('expenseItem') && !line.expenseItemId)
    problem(`${account} hesabında xərc maddəsi lazımdır`);
  let qty = 0n;
  try {
    qty = parseQty(quantity || '1');
  } catch {
    problem('miqdar oxunmadı');
  }
  if (!quantity && acc?.quantitative) problem('DVX miqdar göstərmir, malın miqdarı lazımdır');
  if (!line.vatRate) return problem('ƏDV dərəcəsi müəyyən deyil');
  line.quantity = qty ? formatQty(qty) : '';
  if (!qty) return;
  const vat = vatText ? parseMoney(vatText.replace('-', '')) : 0n;
  const p = priced(net, vat, qty, dvxPrice, line.vatRate);
  line.price = p.price;
  if (!p.fits)
    problem(
      p.got
        ? `Meyar ${money(p.got.net)} / ƏDV ${money(p.got.vat)} hesablayır, DVX-də ${money(net)} / ${money(vat)}`
        : 'qiymət müəyyən edilmədi',
    );
}

// ---------------------------------------------------------------------------------------------
// Binding an invoice to its e-qaimə

function eqRow(tx: Tx, companyId: string, id: string): Row {
  const r = tx.db.get('SELECT * FROM eq_documents WHERE company_id=? AND id=?', companyId, id);
  if (!r) throw new DomainError('E-qaimə tapılmadı.', 'eqDocumentId', 'not-found');
  return r;
}

/**
 * Why `inv` does not book e-qaimə `doc`; empty text when it does. `identity` marks another
 * document (direction, partner, number) as opposed to the same one with other amounts or date.
 */
function check(
  tx: Tx,
  companyId: string,
  doc: Row,
  inv: Row,
  days: number,
): { text: string; identity: boolean } {
  const other = (text: string) => ({ text, identity: true });
  const differs = (text: string) => ({ text, identity: false });
  if (inv.direction !== doc.direction)
    return other(doc.direction === 'sale' ? 'e-qaimə satışdır' : 'e-qaimə alışdır');
  const partner = tx.db.get(
    'SELECT tax_id FROM partners WHERE company_id=? AND id=?',
    companyId,
    String(inv.partner_id),
  );
  if (String(partner?.tax_id ?? '') !== doc.tax_id)
    return other(
      `kontragentin VÖEN-i ${String(partner?.tax_id ?? '') || 'yoxdur'}, e-qaimədə ${String(doc.tax_id)}`,
    );
  if (inv.eq_key !== doc.eq_key)
    return other(
      `e-qaimə nömrəsi ${String(inv.eq_number) || 'yazılmayıb'}, DVX-də ${String(doc.eq_number)}`,
    );
  const gross = (doc.net as bigint) + (doc.vat as bigint);
  if (inv.total_azn !== gross)
    return differs(`cəmi ${money(inv.total_azn as bigint)}, DVX-də ${money(gross)}`);
  if (inv.currency === 'AZN' && inv.vat !== doc.vat)
    return differs(`ƏDV ${money(inv.vat as bigint)}, DVX-də ${money(doc.vat as bigint)}`);
  const d = Math.abs(Date.parse(String(inv.date)) - Date.parse(String(doc.date))) / 86_400_000;
  if (d > days) return differs(`tarix ${String(inv.date)}, DVX-də ${String(doc.date)}`);
  return differs('');
}
const mismatch = (tx: Tx, companyId: string, doc: Row, inv: Row, days: number) =>
  check(tx, companyId, doc, inv, days).text;

/**
 * Called by invoice.save: an invoice saved for an e-qaimə (or already booking one) must stay
 * what DVX wrote — partner, number, date and amounts.
 */
export function bindEq(
  tx: Tx,
  companyId: string,
  invoiceId: string,
  requested: string | undefined,
  postedBy: 'auto' | 'hand' = 'hand',
  usedMaps = '',
): void {
  const previous = tx.db.get(
    'SELECT * FROM eq_documents WHERE company_id=? AND invoice_id=?',
    companyId,
    invoiceId,
  );
  if (requested && previous && previous.id !== requested)
    throw new DomainError('Qaimə artıq başqa e-qaiməni uçota alır.', 'eqDocumentId', 'conflict');
  const docId = requested ?? (previous ? String(previous.id) : undefined);
  if (!docId) return;
  const doc = eqRow(tx, companyId, docId);
  const inv = tx.db.get(
    'SELECT * FROM invoices WHERE company_id=? AND id=?',
    companyId,
    invoiceId,
  )!;
  if (!previous) {
    if (doc.state === 'ignored')
      throw new DomainError(
        'E-qaimə kənara qoyulub; əvvəlcə geri qaytarın.',
        'eqDocumentId',
        'conflict',
      );
    if (doc.state === 'posted')
      throw new DomainError('E-qaimə artıq uçota alınıb.', 'eqDocumentId', 'conflict');
    if (doc.status !== 'accepted')
      throw new DomainError(
        `E-qaimə DVX-də təsdiqlənməyib (${String(doc.dvx_status) || 'status yoxdur'}); uçota alınmır.`,
        'eqDocumentId',
        'conflict',
      );
  }
  // A linked hand-typed invoice may lie a few days apart; a booked one keeps DVX's date.
  const why = mismatch(tx, companyId, doc, inv, previous?.posted_by === 'link' ? LINK_DAYS : 0);
  if (why)
    throw new DomainError(
      `Qaimə e-qaimə ${String(doc.eq_number)} ilə uyğun deyil: ${why}.`,
      'eqDocumentId',
    );
  if (previous) return;
  tx.db.run(
    `UPDATE eq_documents SET state='posted', invoice_id=?, posted_by=?, used_maps=?, auto_note='',
       version=version+1, updated_at=? WHERE id=?`,
    invoiceId,
    postedBy,
    usedMaps,
    tx.clock.now(),
    docId,
  );
  tx.db.run(
    "UPDATE invoices SET origin='eqaime', eq_document_id=? WHERE company_id=? AND id=?",
    docId,
    companyId,
    invoiceId,
  );
}

/** Called when an invoice is cancelled: its e-qaimə waits again (or stays aside, if DVX cancelled it). */
export function releaseEq(tx: Tx, companyId: string, invoiceId: string): void {
  const doc = tx.db.get(
    'SELECT * FROM eq_documents WHERE company_id=? AND invoice_id=?',
    companyId,
    invoiceId,
  );
  if (!doc) return;
  const cancelled = dvxCancelled.has(String(doc.status));
  tx.db.run(
    `UPDATE eq_documents SET state=?, reason=?, invoice_id=NULL, posted_by='', used_maps='',
       manual_only=CASE WHEN posted_by='auto' THEN 1 ELSE manual_only END,
       version=version+1, updated_at=? WHERE id=?`,
    cancelled ? 'ignored' : 'waiting',
    cancelled ? 'DVX: e-qaimə ləğv edilib; uçotdakı qaimə ləğv edildi' : '',
    tx.clock.now(),
    String(doc.id),
  );
}

export function linkEq(tx: Tx, cmd: CommandOf<'eqaime.link'>): CommandResult {
  tx.company(cmd.companyId);
  const doc = eqRow(tx, cmd.companyId, cmd.documentId);
  if (doc.state !== 'waiting')
    throw new DomainError('E-qaimə uçota alınıb və ya kənara qoyulub.', undefined, 'conflict');
  if (doc.status !== 'accepted')
    throw new DomainError('E-qaimə DVX-də təsdiqlənməyib.', undefined, 'conflict');
  const inv = tx.db.get(
    'SELECT * FROM invoices WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.invoiceId,
  );
  if (!inv) throw new DomainError('Qaimə tapılmadı.', 'invoiceId', 'not-found');
  if (inv.status !== 'posted') throw new DomainError('Qaimə ləğv edilib.', 'invoiceId');
  if (
    tx.db.get(
      'SELECT 1 FROM eq_documents WHERE company_id=? AND invoice_id=?',
      cmd.companyId,
      cmd.invoiceId,
    )
  )
    throw new DomainError('Qaimə artıq başqa e-qaimə ilə bağlıdır.', 'invoiceId', 'conflict');
  let conflict = '';
  if (inv.eq_key === '') {
    // The e-qaimə number is written into the invoice; its postings do not change.
    const probe: Row = { ...inv, eq_key: String(doc.eq_key), eq_number: String(doc.eq_number) };
    const why = mismatch(tx, cmd.companyId, doc, probe, LINK_DAYS);
    if (why) throw new DomainError(`Qaimə e-qaiməyə uyğun deyil: ${why}.`, 'invoiceId');
    tx.db.run(
      'UPDATE invoices SET eq_number=?, eq_key=? WHERE id=?',
      String(doc.eq_number),
      String(doc.eq_key),
      cmd.invoiceId,
    );
  } else {
    const why = check(tx, cmd.companyId, doc, inv, LINK_DAYS);
    if (why.identity)
      throw new DomainError(`Qaimə e-qaiməyə uyğun deyil: ${why.text}.`, 'invoiceId');
    // The same number with other amounts: linked (the e-qaimə is in the books), flagged.
    if (why.text) conflict = `${String(inv.number)} qaiməsi ilə fərq: ${why.text}`;
  }
  tx.db.run(
    `UPDATE eq_documents SET state='posted', invoice_id=?, posted_by='link', auto_note='',
       conflict=CASE WHEN ?<>'' THEN ? ELSE conflict END, version=version+1, updated_at=? WHERE id=?`,
    cmd.invoiceId,
    conflict,
    conflict,
    tx.clock.now(),
    cmd.documentId,
  );
  tx.audit(
    cmd.companyId,
    'E-qaimə qaiməyə bağlandı',
    'E-qaimə',
    cmd.documentId,
    `${String(doc.eq_number)} → ${String(inv.number)}${conflict ? ` · ${conflict}` : ''}`,
  );
  return { id: cmd.documentId };
}

// ---------------------------------------------------------------------------------------------
// Automatic booking

function draftCommand(
  companyId: string,
  doc: Row,
  p: EqProposal,
  direction: Direction,
): CommandOf<'invoice.save'> {
  return {
    type: 'invoice.save',
    key: `eq-auto-${String(doc.id)}`,
    companyId,
    direction,
    number: '',
    date: String(doc.date),
    partnerId: p.partnerId,
    contractId: p.contractId,
    rate: '',
    pricesIncludeVat: false,
    eqSeries: '',
    eqNumber: String(doc.eq_number),
    memo: parseText(String(doc.note).slice(0, 500), 'Məzmun', 500, false),
    lines: p.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      price: l.price,
      vatRate: l.vatRate as VatRate,
      ...(l.incomeTypeId ? { incomeTypeId: l.incomeTypeId } : {}),
      ...(l.account ? { account: l.account } : {}),
      ...(l.expenseItemId ? { expenseItemId: l.expenseItemId } : {}),
      ...(l.vatTreatment ? { vatTreatment: l.vatTreatment } : {}),
      memo: l.dvx ? l.dvx.name.slice(0, 300) : '',
    })),
    eqDocumentId: String(doc.id),
  };
}

/**
 * Books the waiting e-qaimələr that confirmed entries cover, and links those already typed by
 * hand under the same number. Each in its own savepoint: one that fails (closed period, stock,
 * an archived element…) waits with the reason; the others go on.
 */
export function applyEq(
  tx: Tx,
  companyId: string,
  direction: Direction,
): { posted: number; linked: number; failed: { row: number; message: string }[] } {
  const docs = tx.db.all(
    `SELECT * FROM eq_documents WHERE company_id=? AND direction=? AND state='waiting'
       AND status='accepted' AND kind='main' ORDER BY date, eq_key`,
    companyId,
    direction,
  );
  let posted = 0;
  let linked = 0;
  const failed: { row: number; message: string }[] = [];
  const ctx = eqContext(tx.db, companyId, direction);
  for (const doc of docs) {
    const p = propose(ctx, doc);
    if (p.state !== 'auto') continue;
    try {
      tx.db.savepoint(() => {
        if (p.sameNumber) {
          linkEq(tx, {
            type: 'eqaime.link',
            key: 'auto-link-0000',
            companyId,
            documentId: String(doc.id),
            invoiceId: p.sameNumber.id,
          });
          linked++;
          return;
        }
        const used = [...new Set(p.lines.map((l) => l.mapId).filter(Boolean))];
        const versions = used.map((id) => `${id}:${ctx.maps.find((m) => m.id === id)?.version}`);
        const r = saveInvoice(tx, draftCommand(companyId, doc, p, direction), {
          postedBy: 'auto',
          usedMaps: versions.join(','),
        });
        for (const id of used)
          tx.db.run(
            'UPDATE eq_product_map SET uses=uses+1, last_used_at=? WHERE id=?',
            tx.clock.now(),
            id,
          );
        tx.audit(
          companyId,
          'Avtomatik uçota alındı',
          'E-qaimə',
          String(doc.id),
          `${String(doc.eq_number)} → ${r.number} · uyğunluqlar: ${versions.join(', ')}`,
        );
        posted++;
      });
      // A linked invoice is taken: no later e-qaimə links to it.
      if (p.sameNumber) ctx.byNumber.delete(String(doc.eq_key));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      tx.db.run(
        'UPDATE eq_documents SET auto_note=? WHERE id=?',
        `Avtomatik uçota alınmadı: ${e.message}`,
        String(doc.id),
      );
      failed.push({ row: 0, message: `${String(doc.eq_number)}: ${e.message}` });
    }
  }
  return { posted, linked, failed };
}

// ---------------------------------------------------------------------------------------------
// The map

const MAP = 'eqMap';

export function saveEqMap(tx: Tx, cmd: CommandOf<'eqMap.save'>): CommandResult {
  tx.company(cmd.companyId);
  const taxId = cmd.taxId.replace(/\s/g, '');
  if (taxId && !/^\d{10}$/.test(taxId))
    throw new DomainError('VÖEN 10 rəqəmdən ibarət olmalıdır.', 'taxId');
  const code = parseText(cmd.dvxCode, 'DVX kodu', 80, false);
  const name = parseText(cmd.name, 'DVX adı', 500, false);
  const header = !code && !name;
  if (header && !taxId)
    throw new DomainError('Bütün qaimə üçün uyğunluq yalnız konkret VÖEN üzrə olur.', 'taxId');
  if (!taxId && !code)
    throw new DomainError(
      'İstənilən kontragent üçün uyğunluq DVX mal kodu ilə olur (ad təkcə kifayət deyil).',
      'dvxCode',
    );
  const chart = tx.chart(cmd.companyId);
  if (!header && !cmd.productId) throw new DomainError('Nomenklaturanı seçin.', 'productId');
  let kind = '';
  if (cmd.productId) {
    const product = tx.db.get(
      'SELECT * FROM products WHERE company_id=? AND id=?',
      cmd.companyId,
      cmd.productId,
    );
    if (!product) throw new DomainError('Nomenklatura tapılmadı.', 'productId', 'not-found');
    if (product.archived === 1n && !cmd.archived)
      throw new DomainError('Nomenklatura arxivdədir.', 'productId');
    kind = String(product.kind);
  }
  if (cmd.account) {
    const acc = chart.require(cmd.account, 'account');
    if (header && cmd.productId && acc.quantitative)
      throw new DomainError(
        'Bütün qaimə bir sətirlə yalnız xidmət və xərc hesabına yazılır (miqdar lazım deyil).',
        'account',
      );
  } else if (header && cmd.productId && kind !== 'service')
    throw new DomainError(
      'Bütün qaimə bir sətirlə yalnız xidmətə yazılır; mal, material, əsas vəsait üçün “Mallar üzrə” hesabatı lazımdır.',
      'productId',
    );
  if (cmd.contractId) {
    if (!header)
      throw new DomainError('Müqavilə yalnız bütün qaimə uyğunluğunda seçilir.', 'contractId');
    const c = tx.db.get(
      `SELECT c.*, p.tax_id FROM contracts c JOIN partners p ON p.company_id=c.company_id AND p.id=c.partner_id
       WHERE c.company_id=? AND c.id=?`,
      cmd.companyId,
      cmd.contractId,
    );
    if (!c) throw new DomainError('Müqavilə tapılmadı.', 'contractId', 'not-found');
    if (c.tax_id !== taxId || c.kind !== cmd.direction)
      throw new DomainError('Müqavilə bu VÖEN-in bu növ müqaviləsi deyil.', 'contractId');
  }
  if (header && !cmd.productId && !cmd.contractId)
    throw new DomainError(
      'Bütün qaimə uyğunluğunda nomenklatura və ya müqavilə seçin.',
      'productId',
    );
  const key = nameKey(name);
  const now = tx.clock.now();
  const values = [
    cmd.direction,
    taxId,
    code,
    key,
    name,
    parseText(cmd.unit, 'Vahid', 40, false),
    cmd.productId,
    cmd.account,
    cmd.expenseItemId,
    cmd.incomeTypeId,
    cmd.vatTreatment,
    cmd.contractId,
    cmd.mode,
    cmd.archived ? 1 : 0,
  ] as const;
  const clash = cmd.archived
    ? undefined
    : tx.db.get(
        `SELECT id FROM eq_product_map WHERE company_id=? AND direction=? AND tax_id=? AND dvx_code=? AND name_key=?
           AND archived=0 AND id<>?`,
        cmd.companyId,
        cmd.direction,
        taxId,
        code,
        key,
        cmd.id ?? '',
      );
  if (clash)
    throw new DomainError('Bu şərtlə uyğunluq artıq var; onu düzəldin.', 'dvxCode', 'conflict');
  let id = cmd.id;
  let version = 1;
  if (id) {
    const old = tx.db.get(
      'SELECT * FROM eq_product_map WHERE company_id=? AND id=?',
      cmd.companyId,
      id,
    );
    if (!old) throw new DomainError('Uyğunluq tapılmadı.', 'id', 'not-found');
    if (cmd.version === undefined || BigInt(cmd.version) !== old.version)
      throw new DomainError(
        'Uyğunluq başqa pəncərədə dəyişdirilib. Yenidən açın.',
        'version',
        'stale',
      );
    version = Number(old.version) + 1;
    tx.db.run(
      `UPDATE eq_product_map SET direction=?,tax_id=?,dvx_code=?,name_key=?,name=?,unit=?,product_id=?,account=?,
         expense_item_id=?,income_type_id=?,vat_treatment=?,contract_id=?,mode=?,archived=?,version=?,updated_at=?
       WHERE id=?`,
      ...values,
      version,
      now,
      id,
    );
  } else {
    id = tx.id();
    tx.db.run(
      `INSERT INTO eq_product_map(direction,tax_id,dvx_code,name_key,name,unit,product_id,account,expense_item_id,
         income_type_id,vat_treatment,contract_id,mode,archived,id,company_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ...values,
      id,
      cmd.companyId,
      now,
      now,
    );
  }
  tx.history(cmd.companyId, MAP, id, version, cmd.archived ? 'archived' : cmd.mode, {
    ...cmd,
    key: undefined,
  });
  tx.audit(
    cmd.companyId,
    cmd.id ? 'Uyğunluq dəyişdirildi' : 'Uyğunluq yaradıldı',
    'E-qaimə uyğunluğu',
    id,
    `${taxId || 'istənilən VÖEN'} · ${code || '—'} · ${name || 'bütün qaimə'} → ${cmd.mode === 'auto' ? 'avtomatik' : 'təklif'}${cmd.archived ? ' (arxiv)' : ''}`,
  );
  return { id, version };
}

/** Map entries (suggest) from how the accountant booked an e-qaimə. */
export function learnEq(tx: Tx, cmd: CommandOf<'eqaime.learn'>): CommandResult {
  tx.company(cmd.companyId);
  const doc = eqRow(tx, cmd.companyId, cmd.documentId);
  if (doc.state !== 'posted' || !doc.invoice_id)
    throw new DomainError('E-qaimə hələ uçota alınmayıb.', undefined, 'conflict');
  const inv = tx.db.get(
    'SELECT * FROM invoices WHERE company_id=? AND id=?',
    cmd.companyId,
    String(doc.invoice_id),
  )!;
  const lines = JSON.parse(String(inv.lines)) as {
    productId: string;
    account: string;
    expenseItemId: string;
    incomeTypeId: string;
    vatTreatment: '' | 'offset' | 'cost';
  }[];
  const direction = doc.direction as Direction;
  const taxId = String(doc.tax_id);
  const goods = dvxLine(doc);
  let learned = 0;
  const exists = (code: string, key: string) =>
    !!tx.db.get(
      `SELECT 1 FROM eq_product_map WHERE company_id=? AND direction=? AND tax_id=? AND dvx_code=? AND name_key=? AND archived=0`,
      cmd.companyId,
      direction,
      taxId,
      code,
      key,
    );
  const save = (fields: Partial<CommandOf<'eqMap.save'>>) => {
    saveEqMap(tx, {
      type: 'eqMap.save',
      key: 'learn-000',
      companyId: cmd.companyId,
      archived: false,
      direction,
      taxId,
      dvxCode: '',
      name: '',
      unit: '',
      productId: '',
      account: '',
      expenseItemId: '',
      incomeTypeId: '',
      vatTreatment: '',
      contractId: '',
      mode: 'suggest',
      ...fields,
    });
    learned++;
  };
  const target = (l: (typeof lines)[number]) => ({
    productId: l.productId,
    // The stored account is the default one when the accountant left it: keep it explicit.
    account: l.account,
    expenseItemId: l.expenseItemId,
    incomeTypeId: direction === 'sale' ? l.incomeTypeId : '',
    vatTreatment: direction === 'purchase' ? l.vatTreatment : ('' as const),
  });
  if (goods.length) {
    if (goods.length !== lines.length)
      throw new DomainError(
        `Qaimədə ${lines.length} sətir, e-qaimədə ${goods.length}: uyğunluq sətir-sətir qurulur.`,
        undefined,
        'conflict',
      );
    goods.forEach((g, i) => {
      if (exists(g.code.trim(), nameKey(g.name))) return;
      save({ dvxCode: g.code.trim(), name: g.name, unit: g.unit, ...target(lines[i]!) });
    });
  } else if (!exists('', '')) {
    const products = new Set(lines.map((l) => l.productId));
    const product = tx.db.get(
      'SELECT kind FROM products WHERE company_id=? AND id=?',
      cmd.companyId,
      lines[0]!.productId,
    );
    if (products.size === 1 && product?.kind === 'service') save(target(lines[0]!));
  }
  // The contract of a VÖEN with several: remembered on its header entry.
  const active = tx.db.all(
    'SELECT id FROM contracts WHERE company_id=? AND partner_id=? AND kind=? AND archived=0',
    cmd.companyId,
    String(inv.partner_id),
    direction,
  );
  if (active.length > 1) {
    const h = tx.db.get(
      `SELECT * FROM eq_product_map WHERE company_id=? AND direction=? AND tax_id=? AND dvx_code='' AND name_key='' AND archived=0`,
      cmd.companyId,
      direction,
      taxId,
    );
    if (!h) save({ contractId: String(inv.contract_id) });
    else if (!h.contract_id) {
      saveEqMap(tx, {
        ...mapCommand(h),
        key: 'learn-001',
        companyId: cmd.companyId,
        contractId: String(inv.contract_id),
      });
      learned++;
    }
  }
  return { id: cmd.documentId, learned };
}

function mapCommand(r: Row): CommandOf<'eqMap.save'> {
  return {
    type: 'eqMap.save',
    key: 'map-0000',
    companyId: String(r.company_id),
    id: String(r.id),
    version: Number(r.version),
    archived: r.archived === 1n,
    direction: r.direction as Direction,
    taxId: String(r.tax_id),
    dvxCode: String(r.dvx_code),
    name: String(r.name),
    unit: String(r.unit),
    productId: String(r.product_id),
    account: String(r.account),
    expenseItemId: String(r.expense_item_id),
    incomeTypeId: String(r.income_type_id),
    vatTreatment: r.vat_treatment as '' | 'offset' | 'cost',
    contractId: String(r.contract_id),
    mode: r.mode as 'suggest' | 'auto',
  };
}

export function eqMaps(db: Db, companyId: string): EqMapView[] {
  return db
    .all(
      `SELECT m.*, COALESCE(p.name,'') AS product, COALESCE(q.name,'') AS partner FROM eq_product_map m
         LEFT JOIN products p ON p.company_id=m.company_id AND p.id=m.product_id
         LEFT JOIN partners q ON q.company_id=m.company_id AND q.tax_id=m.tax_id AND m.tax_id<>''
       WHERE m.company_id=? ORDER BY m.archived, m.direction, q.name, m.name`,
      companyId,
    )
    .map((r) => ({
      id: String(r.id),
      version: Number(r.version),
      direction: r.direction as Direction,
      taxId: String(r.tax_id),
      partner: String(r.partner),
      dvxCode: String(r.dvx_code),
      name: String(r.name),
      unit: String(r.unit),
      productId: String(r.product_id),
      product: String(r.product),
      account: String(r.account),
      expenseItemId: String(r.expense_item_id),
      incomeTypeId: String(r.income_type_id),
      vatTreatment: r.vat_treatment as EqMapView['vatTreatment'],
      contractId: String(r.contract_id),
      mode: r.mode as EqMapView['mode'],
      archived: r.archived === 1n,
      uses: Number(r.uses),
      lastUsedAt: String(r.last_used_at),
    }));
}
