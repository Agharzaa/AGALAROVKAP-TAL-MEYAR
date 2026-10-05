import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney, type Minor } from '../domain/money.js';
import {
  invoiceTotals,
  postInvoice,
  reverse,
  type InvoiceDoc,
  type InvoiceLine,
} from '../domain/posting.js';
import {
  formatPrice,
  formatQty,
  lineAmount,
  parsePrice,
  parseQty,
  toBaseQty,
} from '../domain/quantity.js';
import { issueCost } from '../domain/stock.js';
import { numberKey, parseDate, parseText } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type { InvoiceLineView } from '../contracts/queries.js';
import { guardChronology, guardNonNegative, stockBalance, type StockKey } from './stock.js';
import type { Row } from '../infrastructure/sqlite/db.js';
import { expectVersion, type Tx } from './tx.js';

type SaveInvoice = CommandOf<'invoice.save'>;

interface Normalized {
  header: {
    direction: 'purchase' | 'sale';
    number: string;
    date: string;
    partnerId: string;
    note: string;
  };
  lines: InvoiceLine[];
  stored: InvoiceLineView[];
}

/** Turns command input into exact domain lines plus their canonical stored form. */
function normalize(tx: Tx, cmd: SaveInvoice): Normalized {
  const partner = tx.partner(cmd.companyId, cmd.partnerId);
  const header = {
    direction: cmd.direction,
    number: parseText(cmd.number, 'Qaimə nömrəsi', 80),
    date: parseDate(cmd.date),
    partnerId: String(partner.id),
    note: parseText(cmd.note, 'Qeyd', 500, false),
  };
  const lines: InvoiceLine[] = [];
  const stored: InvoiceLineView[] = [];
  cmd.lines.forEach((input, i) => {
    const at = (field: string) => `lines.${i}.${field}`;
    const label = `Sətir ${i + 1}`;
    const description = parseText(input.description, `${label}: təsvir`, 240, false);
    const vat = parseMoney(input.vat, `${label}: ƏDV`);
    if (input.kind === 'service') {
      if (input.productId || input.warehouseId || input.quantity || input.unitPrice)
        throw new DomainError(
          `${label}: xidmət sətrində nomenklatura və miqdar olmur.`,
          at('kind'),
        );
      const net = parseMoney(input.net ?? '', `${label}: məbləğ`);
      let expenseItemId: string | undefined;
      if (input.expenseItemId) {
        if (
          !tx.db.get(
            'SELECT 1 AS x FROM expense_items WHERE company_id=? AND id=?',
            cmd.companyId,
            input.expenseItemId,
          )
        )
          throw new DomainError(
            `${label}: xərc maddəsi tapılmadı.`,
            at('expenseItemId'),
            'not-found',
          );
        expenseItemId = input.expenseItemId;
      }
      lines.push({
        kind: 'service',
        description,
        account: input.account,
        net,
        vat,
        ...(expenseItemId ? { expenseItemId } : {}),
      });
      stored.push({
        kind: 'service',
        description,
        account: input.account,
        net: formatMinor(net),
        vat: formatMinor(vat),
        ...(expenseItemId ? { expenseItemId } : {}),
      });
      return;
    }
    const product = tx.db.get(
      'SELECT * FROM products WHERE company_id=? AND id=?',
      cmd.companyId,
      input.productId ?? '',
    );
    if (!product)
      throw new DomainError(`${label}: nomenklatura seçin.`, at('productId'), 'not-found');
    if (
      !tx.db.get(
        'SELECT 1 AS x FROM warehouses WHERE company_id=? AND id=?',
        cmd.companyId,
        input.warehouseId ?? '',
      )
    )
      throw new DomainError(`${label}: anbar seçin.`, at('warehouseId'), 'not-found');
    const unit = input.unit ?? 'base';
    const quantity = parseQty(input.quantity, `${label}: miqdar`);
    const unitPrice = parsePrice(input.unitPrice, `${label}: qiymət`);
    const net = lineAmount(quantity, unitPrice);
    if (
      input.net !== undefined &&
      input.net !== '' &&
      parseMoney(input.net, `${label}: məbləğ`) !== net
    )
      throw new DomainError(
        `${label}: məbləğ miqdar × qiymətə bərabər olmalıdır (${formatMinor(net)}).`,
        at('net'),
      );
    const baseQuantity =
      unit === 'purchase' ? toBaseQty(quantity, product.factor as bigint) : quantity;
    const stockAccount =
      cmd.direction === 'sale' ? input.stockAccount || String(product.account) : undefined;
    lines.push({
      kind: 'stock',
      description: description || String(product.name),
      account: input.account,
      ...(stockAccount ? { stockAccount } : {}),
      productId: String(product.id),
      warehouseId: input.warehouseId!,
      quantity: baseQuantity,
      net,
      vat,
    });
    stored.push({
      kind: 'stock',
      description: description || String(product.name),
      account: input.account,
      ...(stockAccount ? { stockAccount } : {}),
      productId: String(product.id),
      warehouseId: input.warehouseId!,
      quantity: formatQty(quantity),
      unit,
      unitPrice: formatPrice(unitPrice),
      baseQuantity: formatQty(baseQuantity),
      net: formatMinor(net),
      vat: formatMinor(vat),
    });
  });
  return { header, lines, stored };
}

/** Stock keys moved by a set of domain lines. */
function keysOf(direction: 'purchase' | 'sale', lines: readonly InvoiceLine[]): StockKey[] {
  return lines
    .filter((l) => l.kind === 'stock')
    .map((l) => ({
      account: direction === 'sale' ? l.stockAccount! : l.account,
      warehouseId: l.warehouseId!,
      productId: l.productId!,
    }));
}

function storedLines(row: Row): InvoiceLineView[] {
  return JSON.parse(String(row.lines)) as InvoiceLineView[];
}

/** Rebuilds domain lines from a stored version (used to know what an old version moved). */
function domainFromStored(stored: InvoiceLineView[]): InvoiceLine[] {
  return stored.map((s) => ({
    kind: s.kind,
    description: s.description,
    account: s.account,
    ...(s.stockAccount ? { stockAccount: s.stockAccount } : {}),
    ...(s.productId ? { productId: s.productId } : {}),
    ...(s.warehouseId ? { warehouseId: s.warehouseId } : {}),
    ...(s.baseQuantity ? { quantity: parseQty(s.baseQuantity) } : {}),
    ...(s.expenseItemId ? { expenseItemId: s.expenseItemId } : {}),
    net: parseMoney(s.net),
    vat: parseMoney(s.vat),
  }));
}

export function saveInvoice(tx: Tx, cmd: SaveInvoice): CommandResult {
  tx.company(cmd.companyId);
  const { header, lines, stored } = normalize(tx, cmd);
  const key = numberKey(header.number);
  const existing = cmd.id
    ? tx.db.get('SELECT * FROM invoices WHERE company_id=? AND id=?', cmd.companyId, cmd.id)
    : undefined;
  if (cmd.id && !existing) throw new DomainError('Qaimə tapılmadı.', 'id', 'not-found');
  if (existing) expectVersion(existing, cmd.version, 'Qaimə');
  const duplicate = tx.db.get(
    'SELECT id,status FROM invoices WHERE company_id=? AND direction=? AND partner_id=? AND number_key=?',
    cmd.companyId,
    header.direction,
    header.partnerId,
    key,
  );
  if (duplicate && duplicate.id !== cmd.id)
    throw new DomainError(
      duplicate.status === 'cancelled'
        ? 'Bu nömrə ləğv olunmuş qaimədə istifadə olunub; təkrar istifadə edilmir.'
        : 'Bu kontragentdən bu nömrə ilə qaimə artıq var. Mövcud qaiməni açın.',
      'number',
      'conflict',
    );
  if (existing?.status === 'cancelled')
    throw new DomainError('Ləğv olunmuş qaimə dəyişdirilmir.', undefined, 'conflict');
  if (existing && existing.direction !== header.direction)
    throw new DomainError('Qaimənin istiqaməti dəyişdirilmir.', 'direction');
  const target = cmd.mode === 'post' ? 'posted' : 'draft';
  if (existing?.status === 'posted' && target === 'draft')
    throw new DomainError(
      'Uçota alınmış qaimə qaralamaya qaytarılmır; düzəliş edin və ya ləğv edin.',
      'mode',
    );
  const payload = { ...header, lines: stored };
  if (
    existing &&
    existing.status === target &&
    JSON.stringify({
      direction: existing.direction,
      number: existing.number,
      date: existing.date,
      partnerId: existing.partner_id,
      note: existing.note,
      lines: storedLines(existing),
    }) === JSON.stringify(payload)
  )
    return { id: String(existing.id), version: Number(existing.version) };

  const totals = invoiceTotals(lines);
  const id = existing ? String(existing.id) : tx.id();
  const version = existing ? Number(existing.version) + 1 : 1;
  const source = { type: 'invoice' as const, id };
  const partner = tx.partner(cmd.companyId, header.partnerId);
  const touched: StockKey[] = [];

  if (target === 'posted') {
    tx.open(cmd.companyId, header.date);
    if (!lines.length) throw new DomainError('Qaimədə ən azı bir sətir olmalıdır.', 'lines');
    if (existing?.status === 'posted') {
      tx.open(cmd.companyId, String(existing.date), 'date');
      if (tx.db.get("SELECT 1 AS x FROM allocations WHERE invoice_id=? AND status='active'", id))
        throw new DomainError(
          'Qaimə ödənişə bağlanıb. Düzəliş üçün əvvəl bank sənədində bağlantını açın.',
          undefined,
          'conflict',
        );
      const oldLines = domainFromStored(storedLines(existing));
      const oldKeys = keysOf(header.direction, oldLines);
      guardChronology(tx, cmd.companyId, oldKeys, String(existing.date), source);
      touched.push(...oldKeys);
      const original = tx.entryLines(cmd.companyId, 'invoice', id, Number(existing.version));
      tx.post(
        cmd.companyId,
        { ...source, number: String(existing.number), version: Number(existing.version) },
        original.date,
        true,
        reverse(original.lines),
      );
    }
    const newKeys = keysOf(header.direction, lines);
    guardChronology(tx, cmd.companyId, newKeys, header.date, source);
    touched.push(...newKeys);
    // Weighted-average cost per sale stock line, consuming the running balance in line order.
    const costs = new Map<number, Minor>();
    if (header.direction === 'sale') {
      const running = new Map<string, { quantity: bigint; value: bigint }>();
      lines.forEach((l, i) => {
        if (l.kind !== 'stock') return;
        const k: StockKey = {
          account: l.stockAccount!,
          warehouseId: l.warehouseId!,
          productId: l.productId!,
        };
        const stockId = `${k.account}|${k.warehouseId}|${k.productId}`;
        const balance = running.get(stockId) ?? stockBalance(tx, cmd.companyId, k);
        const cost = issueCost(balance, l.quantity!, `Sətir ${i + 1} (${l.description})`);
        costs.set(i, cost);
        running.set(stockId, {
          quantity: balance.quantity - l.quantity!,
          value: balance.value - cost,
        });
      });
    }
    const doc: InvoiceDoc = {
      direction: header.direction,
      number: header.number,
      partnerId: header.partnerId,
      partnerName: String(partner.name),
      lines,
    };
    const journal = postInvoice(tx.chart(cmd.companyId), doc, costs);
    tx.post(
      cmd.companyId,
      { ...source, number: header.number, version },
      header.date,
      false,
      journal,
    );
  }

  const now = tx.clock.now();
  if (existing)
    tx.db.run(
      'UPDATE invoices SET number=?,number_key=?,date=?,partner_id=?,status=?,version=?,net=?,vat=?,note=?,lines=?,updated_at=? WHERE id=?',
      header.number,
      key,
      header.date,
      header.partnerId,
      target,
      version,
      totals.net,
      totals.vat,
      header.note,
      JSON.stringify(stored),
      now,
      id,
    );
  else
    tx.db.run(
      'INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id,
      cmd.companyId,
      header.direction,
      header.number,
      key,
      header.date,
      header.partnerId,
      target,
      version,
      totals.net,
      totals.vat,
      header.note,
      JSON.stringify(stored),
      now,
      now,
    );
  guardNonNegative(tx, cmd.companyId, touched);
  tx.history(cmd.companyId, 'invoice', id, version, target, payload);
  tx.audit(
    cmd.companyId,
    target === 'draft'
      ? 'Qaralama saxlanıldı'
      : existing?.status === 'posted'
        ? 'Düzəliş edildi'
        : 'Uçota alındı',
    header.direction === 'sale' ? 'Satış qaiməsi' : 'Alış qaiməsi',
    id,
    `${header.number} · v${version} · ${formatMinor(totals.total)} AZN · ${partner.name}`,
  );
  return { id, version };
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
  expectVersion(row, cmd.version, 'Qaimə');
  if (row.status === 'cancelled')
    throw new DomainError('Qaimə artıq ləğv edilib.', undefined, 'conflict');
  if (tx.db.get("SELECT 1 AS x FROM allocations WHERE invoice_id=? AND status='active'", cmd.id))
    throw new DomainError(
      'Qaimə ödənişə bağlanıb. Əvvəl bank sənədində bağlantını açın.',
      undefined,
      'conflict',
    );
  const version = Number(row.version) + 1;
  const keys: StockKey[] = [];
  if (row.status === 'posted') {
    tx.open(cmd.companyId, String(row.date));
    const direction = row.direction as 'purchase' | 'sale';
    keys.push(...keysOf(direction, domainFromStored(storedLines(row))));
    guardChronology(tx, cmd.companyId, keys, String(row.date), { type: 'invoice', id: cmd.id });
    const original = tx.entryLines(cmd.companyId, 'invoice', cmd.id, Number(row.version));
    tx.post(
      cmd.companyId,
      { type: 'invoice', id: cmd.id, number: String(row.number), version: Number(row.version) },
      original.date,
      true,
      reverse(original.lines),
    );
  }
  tx.db.run(
    "UPDATE invoices SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  guardNonNegative(tx, cmd.companyId, keys);
  tx.history(cmd.companyId, 'invoice', cmd.id, version, 'cancelled', { reason });
  tx.audit(
    cmd.companyId,
    'Ləğv edildi',
    row.direction === 'sale' ? 'Satış qaiməsi' : 'Alış qaiməsi',
    cmd.id,
    `${row.number} · ${reason}`,
  );
  return { id: cmd.id, version };
}
