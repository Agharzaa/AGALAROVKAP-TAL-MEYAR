/**
 * Fixed assets (stage 7a; docs/MERHELE-7-ESAS-VESAITLER.md, QERARLAR 2026-10-26): the catalog,
 * putting into service (Dt 111 / Kt 113, the cost split by quantity) and opening balances
 * (Dt 111 / Kt counter account, Dt counter account / Kt 112). Every line keeps the asset's
 * depreciation terms; the month closing depreciates by them (stage 7b).
 *
 * Saving posts at once; a correction stornoes the previous entry and posts the new one; cancelling
 * stornoes it. An asset is in service through one posted document only.
 */
import {
  assetGroups,
  depreciationFor,
  monthAfter,
  monthlyAmount,
  type AssetGroup,
  type DepreciationTerms,
} from '../domain/assets.js';
import type { Chart } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney, roundHalfAwayFromZero, type Minor } from '../domain/money.js';
import { checkPostings, storno, type Posting } from '../domain/posting.js';
import { formatQty, parseQty } from '../domain/quantity.js';
import { numberKey, parseDate, parseText } from '../domain/values.js';
import type { AssetLineInput, CommandOf, CommandResult } from '../contracts/commands.js';
import type {
  AssetDocumentDetail,
  AssetDocumentView,
  AssetLineView,
  DepreciationSchedule,
  FixedAssetRow,
  FixedAssetView,
} from '../contracts/queries.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import { documentEntry, Names } from './reports.js';
import { checkSideValues } from './subkonto.js';
import { expectVersion, loadChart, type Tx } from './tx.js';

export const ASSET = 'asset';
type Kind = 'commission' | 'opening';
const prefix: Record<Kind, string> = { commission: 'ƏV', opening: 'ƏB' };
const label: Record<Kind, string> = {
  commission: 'İstismara vermə',
  opening: 'Əsas vəsaitlərin başlanğıc qalığı',
};
/** Depreciation goes to an expense account with an expense item (QERARLAR 2026-10-26 §3). */
const expenseFamilies = ['202', '701', '711', '721', '731'];

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

// ---------------------------------------------------------------------------------------------
// Catalog

export function saveFixedAsset(tx: Tx, cmd: CommandOf<'fixedAsset.save'>): CommandResult {
  tx.company(cmd.companyId);
  const name = parseText(cmd.name, 'Ad', 240);
  let inventoryNo = parseText(cmd.inventoryNo, 'İnventar nömrəsi', 40, false);
  if (!inventoryNo && cmd.id) {
    const row = tx.db.get(
      'SELECT inventory_no FROM fixed_assets WHERE company_id=? AND id=?',
      cmd.companyId,
      cmd.id,
    );
    inventoryNo = str(row?.inventory_no);
  }
  if (!inventoryNo) {
    const n =
      Number(
        tx.db.get('SELECT COUNT(*) AS n FROM fixed_assets WHERE company_id=?', cmd.companyId)!.n,
      ) + 1;
    for (let i = n; ; i++) {
      const candidate = `İN-${String(i).padStart(6, '0')}`;
      if (
        !tx.db.get(
          'SELECT 1 AS x FROM fixed_assets WHERE company_id=? AND inventory_no=?',
          cmd.companyId,
          candidate,
        )
      ) {
        inventoryNo = candidate;
        break;
      }
    }
  }
  const same = tx.db.get(
    'SELECT id FROM fixed_assets WHERE company_id=? AND inventory_no=?',
    cmd.companyId,
    inventoryNo,
  );
  if (same && same.id !== cmd.id)
    throw new DomainError(
      'Bu inventar nömrəsi ilə əsas vəsait artıq var.',
      'inventoryNo',
      'conflict',
    );
  const values = {
    name,
    inventory_no: inventoryNo,
    asset_group: cmd.group,
    plate: parseText(cmd.plate, 'Dövlət nömrəsi', 40, false),
    note: parseText(cmd.note, 'Qeyd', 500, false),
    archived: cmd.archived ? 1 : 0,
  };
  const describe = `${inventoryNo} ${name}${cmd.archived ? ' · arxiv' : ''}`;
  if (!cmd.id) {
    const id = tx.id();
    tx.db.run(
      `INSERT INTO fixed_assets(id,company_id,name,inventory_no,asset_group,plate,note,archived)
       VALUES(?,?,?,?,?,?,?,?)`,
      id,
      cmd.companyId,
      ...Object.values(values),
    );
    tx.audit(cmd.companyId, 'Yaradıldı', 'Əsas vəsait', id, describe);
    return { id, version: 1 };
  }
  const row = tx.db.get(
    'SELECT * FROM fixed_assets WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('Əsas vəsait tapılmadı.', 'id', 'not-found');
  expectVersion(row, cmd.version, 'Əsas vəsait');
  if (Object.entries(values).every(([k, v]) => String(row[k]) === String(v)))
    return { id: cmd.id, version: Number(row.version) };
  const version = Number(row.version) + 1;
  tx.db.run(
    'UPDATE fixed_assets SET name=?,inventory_no=?,asset_group=?,plate=?,note=?,archived=?,version=? WHERE id=?',
    ...Object.values(values),
    version,
    cmd.id,
  );
  tx.audit(cmd.companyId, 'Dəyişdirildi', 'Əsas vəsait', cmd.id, describe);
  return { id: cmd.id, version };
}

// ---------------------------------------------------------------------------------------------
// Documents

function nextNumber(tx: Tx, companyId: string, kind: Kind): string {
  const n =
    Number(
      tx.db.get(
        'SELECT COUNT(*) AS n FROM asset_documents WHERE company_id=? AND kind=?',
        companyId,
        kind,
      )!.n,
    ) + 1;
  for (let i = n; ; i++) {
    const candidate = `${prefix[kind]}-${String(i).padStart(6, '0')}`;
    if (
      !tx.db.get(
        'SELECT 1 AS x FROM asset_documents WHERE company_id=? AND kind=? AND number_key=?',
        companyId,
        kind,
        numberKey(candidate),
      )
    )
      return candidate;
  }
}

/** 111 / 112 are kept by fixed asset (sxem v15); a company that had postings there keeps them. */
function requireAssetAccounts(chart: Chart) {
  for (const code of ['111', '112']) {
    const a = chart.get(code);
    if (!a || a.subkonto.length !== 1 || a.subkonto[0] !== 'fixedAsset')
      throw new DomainError(
        `${code} hesabının subkontosu "Əsas vəsait" deyil (hesabda köhnə yazılışlar var). Hesablar planında ${code}-in subkontosunu "Əsas vəsait" edin.`,
        undefined,
        'conflict',
      );
  }
}

/** Balance (amount, quantity) of 113 for a nomenclature, up to a day ('' = everything). */
function balance113(tx: Tx, companyId: string, productId: string, through: string) {
  const r = tx.db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN dt_account='113' AND dt_s1=? THEN amount ELSE 0 END),0)
         - COALESCE(SUM(CASE WHEN kt_account='113' AND kt_s1=? THEN amount ELSE 0 END),0) AS amount,
       COALESCE(SUM(CASE WHEN dt_account='113' AND dt_s1=? THEN dt_qty ELSE 0 END),0)
         - COALESCE(SUM(CASE WHEN kt_account='113' AND kt_s1=? THEN kt_qty ELSE 0 END),0) AS qty
     FROM postings WHERE company_id=? AND (dt_account='113' OR kt_account='113')${through ? ' AND date<=?' : ''}`,
    productId,
    productId,
    productId,
    productId,
    companyId,
    ...(through ? [through] : []),
  )!;
  return { amount: r.amount as bigint, qty: r.qty as bigint };
}

interface Line {
  assetId: string;
  assetName: string;
  productId: string;
  quantity: bigint;
  cost: Minor;
  accumulated: Minor;
  salvage: Minor;
  lifeMonths: number;
  months: number;
  expenseAccount: string;
  expenseSk: string[];
  counterAccount: string;
  counterSk: string[];
}

function readLines(
  tx: Tx,
  companyId: string,
  chart: Chart,
  kind: Kind,
  id: string,
  date: string,
  input: readonly AssetLineInput[],
): { lines: Line[]; postings: Posting[] } {
  const seen = new Set<string>();
  // 113 taken by the lines before this one (two assets from one purchase line).
  const taken = new Map<string, { amount: Minor; qty: bigint }>();
  const lines: Line[] = [];
  const postings: Posting[] = [];
  input.forEach((l, i) => {
    const f = `lines.${i}`;
    const where = `Sətir ${i + 1}`;
    const asset = tx.db.get(
      'SELECT * FROM fixed_assets WHERE company_id=? AND id=?',
      companyId,
      l.assetId,
    );
    if (!asset) throw new DomainError(`${where}: əsas vəsait tapılmadı.`, `${f}.assetId`);
    const assetName = `${str(asset.inventory_no)} ${str(asset.name)}`;
    if (asset.archived === 1n)
      throw new DomainError(`${where}: ${assetName} arxivdədir.`, `${f}.assetId`);
    if (seen.has(l.assetId))
      throw new DomainError(`${where}: ${assetName} sənəddə ikinci dəfədir.`, `${f}.assetId`);
    seen.add(l.assetId);
    const busy = tx.db.get(
      `SELECT d.number FROM asset_lines l JOIN asset_documents d ON d.id=l.document_id
       WHERE l.company_id=? AND l.asset_id=? AND d.status='posted' AND d.id<>?`,
      companyId,
      l.assetId,
      id,
    );
    if (busy)
      throw new DomainError(
        `${where}: ${assetName} artıq istismardadır (${str(busy.number)}).`,
        `${f}.assetId`,
        'conflict',
      );
    // Depreciation terms.
    const expense = chart.require(l.expenseAccount.trim(), `${f}.expenseAccount`);
    if (
      !expenseFamilies.some((fam) => expense.code === fam || expense.code.startsWith(`${fam}.`)) ||
      !expense.subkonto.includes('expenseItem')
    )
      throw new DomainError(
        `${where}: amortizasiyanın xərc hesabı 701, 711, 721, 731 və ya 202 olmalıdır (xərc maddəsi ilə).`,
        `${f}.expenseAccount`,
      );
    const expenseSk = expense.subkonto.map((_, j) => (l.expenseSk[j] ?? '').trim());
    checkSideValues(tx.db, companyId, expense, expenseSk, `${f}.expenseSk`, '');
    const salvage = parseMoney(l.salvage || '0', `${where}: ləğv dəyəri`);
    if (salvage < 0n)
      throw new DomainError(`${where}: ləğv dəyəri mənfi ola bilməz.`, `${f}.salvage`);
    const memo = `${label[kind]}: ${assetName}`;
    const side = { account: '111', sk: [l.assetId] };
    checkSideValues(tx.db, companyId, chart.get('111')!, side.sk, `${f}.assetId`, '');
    if (kind === 'commission') {
      const productId = l.productId.trim();
      if (!productId)
        throw new DomainError(`${where}: 113-dən hansı nomenklatura keçir?`, `${f}.productId`);
      checkSideValues(tx.db, companyId, chart.get('113')!, [productId], `${f}.productId`, '');
      const quantity = parseQty(l.quantity, `${where}: miqdar`);
      const before = taken.get(productId) ?? { amount: 0n, qty: 0n };
      const onDay = balance113(tx, companyId, productId, date);
      const ever = balance113(tx, companyId, productId, '');
      const have =
        onDay.qty < ever.qty || (onDay.qty === ever.qty && onDay.amount <= ever.amount)
          ? onDay
          : ever;
      const left = { amount: have.amount - before.amount, qty: have.qty - before.qty };
      if (quantity > left.qty || left.amount <= 0n)
        throw new DomainError(
          `${where}: 113 hesabında bu nomenklaturanın qalığı ${formatQty(left.qty > 0n ? left.qty : 0n)}-dir, ${formatQty(quantity)} keçirilə bilməz.`,
          `${f}.quantity`,
        );
      // The whole rest moves when the whole quantity does; otherwise the cost by quantity.
      const cost =
        quantity === left.qty
          ? left.amount
          : roundHalfAwayFromZero(left.amount * quantity, left.qty);
      taken.set(productId, { amount: before.amount + cost, qty: before.qty + quantity });
      if (salvage > cost)
        throw new DomainError(`${where}: ləğv dəyəri ilkin dəyərdən böyükdür.`, `${f}.salvage`);
      postings.push({
        dt: side,
        kt: { account: '113', sk: [productId] },
        amount: cost,
        quantity,
        memo,
      });
      lines.push({
        assetId: l.assetId,
        assetName,
        productId,
        quantity,
        cost,
        accumulated: 0n,
        salvage,
        lifeMonths: l.lifeMonths,
        months: l.lifeMonths,
        expenseAccount: expense.code,
        expenseSk,
        counterAccount: '',
        counterSk: [],
      });
      return;
    }
    // Opening balance.
    const cost = parseMoney(l.cost, `${where}: ilkin dəyər`);
    if (cost <= 0n) throw new DomainError(`${where}: ilkin dəyəri yazın.`, `${f}.cost`);
    const accumulated = parseMoney(l.accumulated || '0', `${where}: yığılmış amortizasiya`);
    if (accumulated < 0n || accumulated + salvage > cost)
      throw new DomainError(
        `${where}: yığılmış amortizasiya ilə ləğv dəyərinin cəmi ilkin dəyərdən böyük ola bilməz.`,
        `${f}.accumulated`,
      );
    const months = l.remainingMonths ?? 0;
    if (months > l.lifeMonths)
      throw new DomainError(
        `${where}: qalan ay faydalı istifadə müddətindən çox ola bilməz.`,
        `${f}.remainingMonths`,
      );
    if (months === 0 && accumulated + salvage < cost)
      throw new DomainError(
        `${where}: amortizasiya olunacaq dəyər qalıb — qalan ayları yazın.`,
        `${f}.remainingMonths`,
      );
    const counter = chart.require(l.counterAccount.trim(), `${f}.counterAccount`);
    if (['111', '112', '113'].includes(counter.code))
      throw new DomainError(`${where}: qarşı hesab başqa olmalıdır.`, `${f}.counterAccount`);
    const counterSk = counter.subkonto.map((_, j) => (l.counterSk[j] ?? '').trim());
    checkSideValues(tx.db, companyId, counter, counterSk, `${f}.counterSk`, '');
    const other = { account: counter.code, sk: counterSk };
    postings.push({ dt: side, kt: other, amount: cost, memo });
    if (accumulated)
      postings.push({
        dt: other,
        kt: { account: '112', sk: [l.assetId] },
        amount: accumulated,
        memo: `Yığılmış amortizasiya: ${assetName}`,
      });
    lines.push({
      assetId: l.assetId,
      assetName,
      productId: '',
      quantity: 0n,
      cost,
      accumulated,
      salvage,
      lifeMonths: l.lifeMonths,
      months,
      expenseAccount: expense.code,
      expenseSk,
      counterAccount: counter.code,
      counterSk,
    });
  });
  checkPostings(chart, postings, 'lines');
  return { lines, postings };
}

const describeLines = (lines: readonly Line[]) =>
  lines.map((l) => ({
    asset: l.assetName,
    ...(l.productId ? { productId: l.productId, quantity: formatQty(l.quantity) } : {}),
    cost: formatMinor(l.cost),
    accumulated: formatMinor(l.accumulated),
    salvage: formatMinor(l.salvage),
    lifeMonths: l.lifeMonths,
    months: l.months,
    expense: [l.expenseAccount, ...l.expenseSk],
    ...(l.counterAccount ? { counter: [l.counterAccount, ...l.counterSk] } : {}),
  }));

export function saveAssetDocument(tx: Tx, cmd: CommandOf<'asset.save'>): CommandResult {
  tx.company(cmd.companyId);
  const kind = cmd.kind;
  const date = parseDate(cmd.date);
  const memo = parseText(cmd.memo, 'Məzmun', 500, false);
  const existing = cmd.id
    ? tx.db.get('SELECT * FROM asset_documents WHERE company_id=? AND id=?', cmd.companyId, cmd.id)
    : undefined;
  if (cmd.id && !existing) throw new DomainError('Sənəd tapılmadı.', 'id', 'not-found');
  if (existing) {
    expectVersion(existing, cmd.version, label[kind]);
    if (existing.kind !== kind)
      throw new DomainError('Sənədin növü dəyişdirilmir.', undefined, 'conflict');
    if (existing.status !== 'posted')
      throw new DomainError('Ləğv edilmiş sənəd dəyişdirilmir.', undefined, 'conflict');
  }
  const number =
    parseText(cmd.number, 'Nömrə', 40, false) ||
    (existing ? str(existing.number) : nextNumber(tx, cmd.companyId, kind));
  const key = numberKey(number);
  const same = tx.db.get(
    'SELECT id FROM asset_documents WHERE company_id=? AND kind=? AND number_key=?',
    cmd.companyId,
    kind,
    key,
  );
  if (same && same.id !== cmd.id)
    throw new DomainError('Bu nömrə ilə sənəd artıq var.', 'number', 'conflict');
  const id = existing ? str(existing.id) : tx.id();
  const chart = tx.chart(cmd.companyId);
  requireAssetAccounts(chart);
  tx.open(cmd.companyId, date);
  const now = tx.clock.now();
  // A correction gives 113 back first (storno), then takes it again.
  if (existing) {
    const before = tx.entryPostings(cmd.companyId, ASSET, id, Number(existing.version));
    tx.open(cmd.companyId, before.date);
    tx.post(
      cmd.companyId,
      chart,
      { type: ASSET, id, number: str(existing.number), version: Number(existing.version) },
      before.date,
      true,
      storno(before.postings),
    );
    tx.db.run('DELETE FROM asset_lines WHERE document_id=?', id);
  }
  const { lines, postings } = readLines(tx, cmd.companyId, chart, kind, id, date, cmd.lines);
  const version = existing ? Number(existing.version) + 1 : 1;
  if (existing)
    tx.db.run(
      'UPDATE asset_documents SET number=?,number_key=?,date=?,memo=?,version=?,updated_at=? WHERE id=?',
      number,
      key,
      date,
      memo,
      version,
      now,
      id,
    );
  else
    tx.db.run(
      "INSERT INTO asset_documents VALUES(?,?,?,?,?,?,?,'posted',?,?,?)",
      id,
      cmd.companyId,
      kind,
      number,
      key,
      date,
      memo,
      version,
      now,
      now,
    );
  lines.forEach((l, i) =>
    tx.db.run(
      `INSERT INTO asset_lines(company_id,document_id,line_no,asset_id,product_id,quantity,cost,accumulated,
         salvage,life_months,months,expense_account,expense_sk,counter_account,counter_sk)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      cmd.companyId,
      id,
      i + 1,
      l.assetId,
      l.productId,
      l.quantity,
      l.cost,
      l.accumulated,
      l.salvage,
      l.lifeMonths,
      l.months,
      l.expenseAccount,
      JSON.stringify(l.expenseSk),
      l.counterAccount,
      JSON.stringify(l.counterSk),
    ),
  );
  tx.post(cmd.companyId, chart, { type: ASSET, id, number, version }, date, false, postings);
  tx.history(cmd.companyId, ASSET, id, version, 'posted', {
    kind,
    number,
    date,
    memo,
    lines: describeLines(lines),
  });
  const total = lines.reduce((s, l) => s + l.cost, 0n);
  tx.audit(
    cmd.companyId,
    existing ? 'Düzəliş edildi (storno + yeni yazılış)' : 'Uçota alındı',
    label[kind],
    id,
    `${number} · ${date} · ${lines.length} əsas vəsait · ${formatMinor(total)} AZN`,
  );
  return { id, version, number };
}

export function cancelAssetDocument(tx: Tx, cmd: CommandOf<'asset.cancel'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = parseText(cmd.reason, 'Ləğv səbəbi');
  const row = tx.db.get(
    'SELECT * FROM asset_documents WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('Sənəd tapılmadı.', 'id', 'not-found');
  const kind = row.kind as Kind;
  expectVersion(row, cmd.version, label[kind]);
  if (row.status !== 'posted')
    throw new DomainError('Sənəd artıq ləğv edilib.', undefined, 'conflict');
  const before = tx.entryPostings(cmd.companyId, ASSET, cmd.id, Number(row.version));
  tx.open(cmd.companyId, before.date);
  tx.post(
    cmd.companyId,
    tx.chart(cmd.companyId),
    { type: ASSET, id: cmd.id, number: str(row.number), version: Number(row.version) },
    before.date,
    true,
    storno(before.postings),
  );
  const version = Number(row.version) + 1;
  tx.db.run(
    "UPDATE asset_documents SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  tx.history(cmd.companyId, ASSET, cmd.id, version, 'cancelled', { reason });
  tx.audit(
    cmd.companyId,
    'Ləğv edildi (storno)',
    label[kind],
    cmd.id,
    `${str(row.number)} · ${reason}`,
  );
  return { id: cmd.id, version };
}

// ---------------------------------------------------------------------------------------------
// Queries

export function fixedAssetView(r: Row): FixedAssetView {
  return {
    id: str(r.id),
    version: Number(r.version),
    name: str(r.name),
    inventoryNo: str(r.inventory_no),
    group: str(r.asset_group) as AssetGroup,
    plate: str(r.plate),
    note: str(r.note),
    archived: r.archived === 1n,
  };
}

/** The depreciation terms of a line of a posted document. */
export function termsOf(line: Row, documentDate: string): DepreciationTerms {
  return {
    cost: line.cost as bigint,
    salvage: line.salvage as bigint,
    accumulated: line.accumulated as bigint,
    months: Number(line.months),
    start: monthAfter(documentDate),
  };
}

/** The fixed assets on a day: 111 / 112 balances and the terms of the document in force. */
export function fixedAssets(db: Db, companyId: string, date: string): FixedAssetRow[] {
  const day = parseDate(date);
  const names = new Names(db, companyId);
  const chart = loadChart(db, companyId);
  const sums = new Map<string, { cost: bigint; depreciated: bigint }>();
  for (const r of db.all(
    `SELECT asset, SUM(cost) AS cost, SUM(dep) AS dep FROM (
       SELECT dt_s1 AS asset, amount AS cost, 0 AS dep FROM postings WHERE company_id=? AND dt_account='111' AND date<=?
       UNION ALL SELECT kt_s1, -amount, 0 FROM postings WHERE company_id=? AND kt_account='111' AND date<=?
       UNION ALL SELECT kt_s1, 0, amount FROM postings WHERE company_id=? AND kt_account='112' AND date<=?
       UNION ALL SELECT dt_s1, 0, -amount FROM postings WHERE company_id=? AND dt_account='112' AND date<=?)
     GROUP BY asset`,
    companyId,
    day,
    companyId,
    day,
    companyId,
    day,
    companyId,
    day,
  ))
    sums.set(str(r.asset), { cost: r.cost as bigint, depreciated: r.dep as bigint });
  const terms = new Map<string, Row>();
  for (const l of db.all(
    `SELECT l.*, d.date AS doc_date, d.kind AS doc_kind FROM asset_lines l JOIN asset_documents d ON d.id=l.document_id
     WHERE l.company_id=? AND d.status='posted' AND d.date<=?`,
    companyId,
    day,
  ))
    terms.set(str(l.asset_id), l);
  return db
    .all('SELECT * FROM fixed_assets WHERE company_id=? ORDER BY inventory_no', companyId)
    .map((r): FixedAssetRow => {
      const v = fixedAssetView(r);
      const s = sums.get(v.id) ?? { cost: 0n, depreciated: 0n };
      const l = terms.get(v.id);
      const t = l ? termsOf(l, str(l.doc_date)) : undefined;
      // Months already depreciated by the month closings (stage 7b) since the start.
      const done = t
        ? Number(
            db.get(
              `SELECT COUNT(*) AS n FROM registers WHERE company_id=? AND account='112' AND s1=?
                 AND month>=? AND month<=? AND credit-debit>0`,
              companyId,
              v.id,
              t.start,
              day.slice(0, 7),
            )!.n,
          )
        : 0;
      const monthsLeft = t ? Math.max(0, t.months - done) : 0;
      const expenseSk = l ? (JSON.parse(str(l.expense_sk)) as string[]) : [];
      const expenseAccount = l ? str(l.expense_account) : '';
      return {
        ...v,
        inService: l ? str(l.doc_date) : '',
        documentId: l ? str(l.document_id) : '',
        documentKind: l ? (str(l.doc_kind) as Kind) : '',
        cost: formatMinor(s.cost),
        depreciated: formatMinor(s.depreciated),
        net: formatMinor(s.cost - s.depreciated),
        monthly: formatMinor(t && monthsLeft ? monthlyAmount(t) : 0n),
        monthsLeft,
        lifeMonths: l ? Number(l.life_months) : 0,
        salvage: formatMinor(l ? (l.salvage as bigint) : 0n),
        expenseAccount,
        expenseSk,
        expenseNames: expenseSk.map((id, i) => {
          const kind = chart.get(expenseAccount)?.subkonto[i];
          return kind ? names.name(kind, id) : id;
        }),
      };
    });
}

function documentView(db: Db, r: Row): AssetDocumentView {
  const names = new Map(
    db
      .all('SELECT id,name,inventory_no FROM fixed_assets WHERE company_id=?', str(r.company_id))
      .map((a) => [str(a.id), `${str(a.inventory_no)} ${str(a.name)}`]),
  );
  const products = new Map(
    db
      .all('SELECT id,name FROM products WHERE company_id=?', str(r.company_id))
      .map((p) => [str(p.id), str(p.name)]),
  );
  const lines = db
    .all('SELECT * FROM asset_lines WHERE document_id=? ORDER BY line_no', str(r.id))
    .map((l): AssetLineView => ({
      assetId: str(l.asset_id),
      assetName: names.get(str(l.asset_id)) ?? '',
      productId: str(l.product_id),
      productName: products.get(str(l.product_id)) ?? '',
      quantity: (l.quantity as bigint) ? formatQty(l.quantity as bigint) : '',
      cost: formatMinor(l.cost as bigint),
      accumulated: formatMinor(l.accumulated as bigint),
      salvage: formatMinor(l.salvage as bigint),
      lifeMonths: Number(l.life_months),
      remainingMonths: Number(l.months),
      monthly: formatMinor(monthlyAmount(termsOf(l, str(r.date)))),
      expenseAccount: str(l.expense_account),
      expenseSk: JSON.parse(str(l.expense_sk)) as string[],
      counterAccount: str(l.counter_account),
      counterSk: JSON.parse(str(l.counter_sk)) as string[],
    }));
  return {
    id: str(r.id),
    version: Number(r.version),
    kind: r.kind as Kind,
    number: str(r.number),
    date: str(r.date),
    memo: str(r.memo),
    status: r.status as AssetDocumentView['status'],
    total: formatMinor(lines.reduce((s, l) => s + parseMoney(l.cost), 0n)),
    lines,
  };
}

export function assetDocuments(db: Db, companyId: string, kind: Kind): AssetDocumentView[] {
  return db
    .all(
      'SELECT * FROM asset_documents WHERE company_id=? AND kind=? ORDER BY date DESC, rowid DESC',
      companyId,
      kind,
    )
    .map((r) => documentView(db, r));
}

export function assetDocument(db: Db, companyId: string, id: string): AssetDocumentDetail {
  const r = db.get('SELECT * FROM asset_documents WHERE company_id=? AND id=?', companyId, id);
  if (!r) throw new DomainError('Sənəd tapılmadı.', 'id', 'not-found');
  return { ...documentView(db, r), postings: documentEntry(db, companyId, ASSET, id).postings };
}

/** Stage 7b: depreciation of a year by asset and month (posted, then forecast). */
export function depreciationSchedule(
  db: Db,
  companyId: string,
  year: number,
): DepreciationSchedule {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const closedThrough = str(
    db.get('SELECT closed_through FROM companies WHERE id=?', companyId)!.closed_through,
  );
  const closedMonth = closedThrough.slice(0, 7);
  // What the month closings posted to 112 (their stornos included), by asset and month.
  const posted = new Map<string, bigint>();
  for (const r of db.all(
    `SELECT p.kt_s1 AS asset, substr(p.date,1,7) AS month, SUM(p.amount) AS amount
       FROM postings p JOIN entries e ON e.id=p.entry_id
     WHERE p.company_id=? AND e.source_type='closing' AND p.kt_account='112' AND p.date>=? AND p.date<=?
     GROUP BY asset, month`,
    companyId,
    `${year}-01-01`,
    `${year}-12-31`,
  ))
    posted.set(`${str(r.asset)}|${str(r.month)}`, r.amount as bigint);
  const terms = new Map<string, Row>();
  for (const l of db.all(
    `SELECT l.*, d.date AS doc_date FROM asset_lines l JOIN asset_documents d ON d.id=l.document_id
     WHERE l.company_id=? AND d.status='posted' AND d.date<=?`,
    companyId,
    `${year}-12-31`,
  ))
    terms.set(str(l.asset_id), l);
  const totals = months.map(() => 0n);
  const rows: DepreciationSchedule['rows'] = [];
  for (const a of db.all(
    'SELECT * FROM fixed_assets WHERE company_id=? ORDER BY inventory_no',
    companyId,
  )) {
    const id = str(a.id);
    const l = terms.get(id);
    const t = l ? termsOf(l, str(l.doc_date)) : undefined;
    let sum = 0n;
    const cells = months.map((m, i) => {
      const forecast = m > closedMonth;
      const amount = forecast ? (t ? depreciationFor(t, m) : 0n) : (posted.get(`${id}|${m}`) ?? 0n);
      sum += amount;
      totals[i] = totals[i]! + amount;
      return { amount: formatMinor(amount), forecast };
    });
    if (!sum && !l) continue;
    rows.push({
      assetId: id,
      inventoryNo: str(a.inventory_no),
      name: str(a.name),
      expenseAccount: l ? str(l.expense_account) : '',
      cells,
      total: formatMinor(sum),
    });
  }
  return {
    year,
    months,
    closedThrough,
    rows,
    totals: totals.map(formatMinor),
    total: formatMinor(totals.reduce((s, x) => s + x, 0n)),
  };
}

export const assetGroupName = (g: AssetGroup) => assetGroups.find((x) => x.id === g)!.name;
