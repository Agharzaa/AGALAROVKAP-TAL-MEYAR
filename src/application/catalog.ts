import { baseChart, newSubAccount } from '../domain/accounts.js';
import { DomainError } from '../domain/errors.js';
import { formatQty, parseQty } from '../domain/quantity.js';
import { parseTaxId, parseText } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import { expectVersion, type Tx } from './tx.js';

/** Parents the user may extend with sub-accounts in stage A (see docs/ACCOUNTING.md). */
export const SUBACCOUNT_PARENTS = ['113', '201', '205', '601', '721'];
const defaultUnits = [
  ['pcs', 'Ədəd'],
  ['l', 'Litr'],
  ['kg', 'Kq'],
  ['m', 'Metr'],
  ['m2', 'm²'],
  ['pair', 'Cüt'],
  ['set', 'Dəst'],
  ['box', 'Qutu'],
] as const;
const defaultExpenseItems = ['Rabitə', 'Nəqliyyat', 'Yemək', 'Ofis xərcləri', 'Bank xidmətləri'];

export function createCompany(tx: Tx, cmd: CommandOf<'company.create'>): CommandResult {
  const name = parseText(cmd.name, 'Şirkətin adı', 200);
  const taxId = parseTaxId(cmd.taxId);
  if (tx.db.get('SELECT 1 AS x FROM companies WHERE tax_id=?', taxId))
    throw new DomainError('Bu VÖEN ilə şirkət artıq var.', 'taxId', 'conflict');
  const id = tx.id();
  tx.db.run(
    'INSERT INTO companies(id,name,tax_id,created_at) VALUES(?,?,?,?)',
    id,
    name,
    taxId,
    tx.clock.now(),
  );
  for (const a of baseChart)
    tx.db.run(
      'INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?,0)',
      id,
      a.code,
      a.name,
      a.parentCode,
      a.nature,
      JSON.stringify(a.analytics),
      a.quantitative ? 1 : 0,
      1,
    );
  for (const [code, unitName] of defaultUnits)
    tx.db.run('INSERT INTO units VALUES(?,?,?)', id, code, unitName);
  tx.db.run('INSERT INTO warehouses VALUES(?,?,?)', tx.id(), id, 'Əsas anbar');
  for (const item of defaultExpenseItems)
    tx.db.run('INSERT INTO expense_items(id,company_id,name) VALUES(?,?,?)', tx.id(), id, item);
  tx.audit(id, 'Yaradıldı', 'Şirkət', id, `${name} · VÖEN ${taxId}`);
  return { id };
}

export function savePartner(tx: Tx, cmd: CommandOf<'partner.save'>): CommandResult {
  tx.company(cmd.companyId);
  const name = parseText(cmd.name, 'Kontragentin adı');
  const taxId = parseTaxId(cmd.taxId);
  const sameTax = tx.db.get(
    'SELECT * FROM partners WHERE company_id=? AND tax_id=?',
    cmd.companyId,
    taxId,
  );
  if (!cmd.id) {
    if (sameTax)
      throw new DomainError(
        `Bu VÖEN ilə kontragent artıq var: ${sameTax.name}.`,
        'taxId',
        'conflict',
      );
    const id = tx.id();
    tx.db.run(
      'INSERT INTO partners(id,company_id,name,tax_id) VALUES(?,?,?,?)',
      id,
      cmd.companyId,
      name,
      taxId,
    );
    tx.audit(cmd.companyId, 'Yaradıldı', 'Kontragent', id, `${name} · VÖEN ${taxId}`);
    return { id, version: 1 };
  }
  const existing = tx.partner(cmd.companyId, cmd.id);
  expectVersion(existing, cmd.version, 'Kontragent');
  if (sameTax && sameTax.id !== existing.id)
    throw new DomainError(
      `Bu VÖEN başqa kontragentdə istifadə olunur: ${sameTax.name}.`,
      'taxId',
      'conflict',
    );
  if (existing.name === name && existing.tax_id === taxId)
    return { id: cmd.id, version: Number(existing.version) };
  const version = Number(existing.version) + 1;
  tx.db.run(
    'UPDATE partners SET name=?,tax_id=?,version=? WHERE id=?',
    name,
    taxId,
    version,
    cmd.id,
  );
  tx.audit(
    cmd.companyId,
    'Dəyişdirildi',
    'Kontragent',
    cmd.id,
    `${existing.name} · ${existing.tax_id} → ${name} · ${taxId}`,
  );
  return { id: cmd.id, version };
}

export function createAccount(tx: Tx, cmd: CommandOf<'account.create'>): CommandResult {
  tx.company(cmd.companyId);
  const chart = tx.chart(cmd.companyId);
  const root = cmd.parentCode.split('.')[0]!;
  if (!SUBACCOUNT_PARENTS.includes(root))
    throw new DomainError(
      `Bu mərhələdə subhesab yalnız ${SUBACCOUNT_PARENTS.join(', ')} hesablarına açılır.`,
      'parentCode',
    );
  const parent = chart.get(cmd.parentCode);
  const parentUsed =
    parent &&
    chart.postable(parent.code) &&
    tx.db.get(
      'SELECT 1 AS x FROM journal_lines WHERE company_id=? AND account=? LIMIT 1',
      cmd.companyId,
      parent.code,
    );
  if (parentUsed)
    throw new DomainError(
      `${parent.code} hesabında artıq yazılış var. Subhesab açılsa, əsas hesab yazılış üçün bağlanar; əvvəl mühasiblə uçot siyasətini razılaşdırın.`,
      'parentCode',
      'conflict',
    );
  const account = newSubAccount(
    parent,
    cmd.code,
    cmd.name,
    new Set(chart.all().map((a) => a.code)),
  );
  tx.db.run(
    'INSERT INTO accounts VALUES(?,?,?,?,?,?,?,0,0)',
    cmd.companyId,
    account.code,
    account.name,
    account.parentCode,
    account.nature,
    JSON.stringify(account.analytics),
    account.quantitative ? 1 : 0,
  );
  tx.audit(cmd.companyId, 'Yaradıldı', 'Hesab', account.code, `${account.code} · ${account.name}`);
  return { id: account.code };
}

export function saveNamed(
  tx: Tx,
  table: 'expense_items' | 'warehouses',
  entity: string,
  cmd: { companyId: string; id?: string | undefined; name: string },
): CommandResult {
  tx.company(cmd.companyId);
  const name = parseText(cmd.name, `${entity} adı`, 160);
  const clash = tx.db.get(
    `SELECT id FROM ${table} WHERE company_id=? AND name=?`,
    cmd.companyId,
    name,
  );
  if (clash && clash.id !== cmd.id)
    throw new DomainError(`Bu adla ${entity.toLowerCase()} artıq var.`, 'name', 'conflict');
  if (cmd.id) {
    const row = tx.db.get(
      `SELECT * FROM ${table} WHERE company_id=? AND id=?`,
      cmd.companyId,
      cmd.id,
    );
    if (!row) throw new DomainError(`${entity} tapılmadı.`, 'id', 'not-found');
    if (row.name !== name) {
      tx.db.run(`UPDATE ${table} SET name=? WHERE id=?`, name, cmd.id);
      tx.audit(cmd.companyId, 'Dəyişdirildi', entity, cmd.id, `${row.name} → ${name}`);
    }
    return { id: cmd.id };
  }
  const id = tx.id();
  tx.db.run(`INSERT INTO ${table}(id,company_id,name) VALUES(?,?,?)`, id, cmd.companyId, name);
  tx.audit(cmd.companyId, 'Yaradıldı', entity, id, name);
  return { id };
}

export function saveUnit(tx: Tx, cmd: CommandOf<'unit.save'>): CommandResult {
  tx.company(cmd.companyId);
  const code = parseText(cmd.code, 'Vahid kodu', 20).toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(code))
    throw new DomainError('Vahid kodunda latın hərfləri və rəqəmlər olsun.', 'code');
  const name = parseText(cmd.name, 'Vahidin adı', 40);
  if (
    tx.db.get(
      'SELECT 1 AS x FROM units WHERE company_id=? AND (code=? OR name=?)',
      cmd.companyId,
      code,
      name,
    )
  )
    throw new DomainError('Bu kod və ya adla vahid artıq var.', 'code', 'conflict');
  tx.db.run('INSERT INTO units VALUES(?,?,?)', cmd.companyId, code, name);
  tx.audit(cmd.companyId, 'Yaradıldı', 'Ölçü vahidi', code, name);
  return { id: code };
}

/** Accounts a product card may default to. */
const productFamilies = ['205', '201', '113'];

export function saveProduct(tx: Tx, cmd: CommandOf<'product.save'>): CommandResult {
  tx.company(cmd.companyId);
  const code = parseText(cmd.code, 'Məhsul kodu', 40);
  const name = parseText(cmd.name, 'Məhsulun adı');
  const group = parseText(cmd.group, 'Qrup', 120, false);
  const barcode = parseText(cmd.barcode, 'Barkod', 64, false);
  if (barcode && !/^[0-9A-Za-z-]+$/.test(barcode))
    throw new DomainError('Barkodda yalnız rəqəm və hərflər olsun.', 'barcode');
  const unit = (value: string, field: string) => {
    if (!tx.db.get('SELECT 1 AS x FROM units WHERE company_id=? AND code=?', cmd.companyId, value))
      throw new DomainError('Ölçü vahidi tapılmadı.', field, 'not-found');
    return value;
  };
  const baseUnit = unit(cmd.baseUnit, 'baseUnit');
  const purchaseUnit = unit(cmd.purchaseUnit, 'purchaseUnit');
  const factor = parseQty(cmd.factor, 'Çevirmə əmsalı');
  if (baseUnit === purchaseUnit && factor !== 1_000_000n)
    throw new DomainError('Alış vahidi əsas vahidlə eynidirsə, əmsal 1 olmalıdır.', 'factor');
  const chart = tx.chart(cmd.companyId);
  const family = productFamilies.find((f) => cmd.account === f || cmd.account.startsWith(`${f}.`));
  if (!family)
    throw new DomainError('İlkin uçot hesabı 205, 201 və ya 113 qrupundan olmalıdır.', 'account');
  chart.requirePostable(cmd.account, family, 'account');
  const clash = tx.db.get(
    'SELECT id FROM products WHERE company_id=? AND code=?',
    cmd.companyId,
    code,
  );
  if (clash && clash.id !== cmd.id)
    throw new DomainError('Bu kodla məhsul artıq var.', 'code', 'conflict');
  if (barcode) {
    const sameBarcode = tx.db.get(
      'SELECT id,name FROM products WHERE company_id=? AND barcode=?',
      cmd.companyId,
      barcode,
    );
    if (sameBarcode && sameBarcode.id !== cmd.id)
      throw new DomainError(
        `Bu barkod artıq "${sameBarcode.name}" məhsulundadır.`,
        'barcode',
        'conflict',
      );
  }
  if (!cmd.id) {
    const id = tx.id();
    tx.db.run(
      'INSERT INTO products(id,company_id,code,name,group_name,barcode,base_unit,purchase_unit,factor,account) VALUES(?,?,?,?,?,?,?,?,?,?)',
      id,
      cmd.companyId,
      code,
      name,
      group,
      barcode,
      baseUnit,
      purchaseUnit,
      factor,
      cmd.account,
    );
    tx.audit(cmd.companyId, 'Yaradıldı', 'Nomenklatura', id, `${code} · ${name}`);
    return { id, version: 1 };
  }
  const existing = tx.db.get(
    'SELECT * FROM products WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!existing) throw new DomainError('Məhsul tapılmadı.', 'id', 'not-found');
  expectVersion(existing, cmd.version, 'Məhsul kartı');
  const moved = tx.db.get(
    'SELECT 1 AS x FROM journal_lines WHERE company_id=? AND product_id=? LIMIT 1',
    cmd.companyId,
    cmd.id,
  );
  if (moved && existing.base_unit !== baseUnit)
    throw new DomainError(
      'Hərəkəti olan məhsulun əsas vahidi dəyişdirilə bilməz; yeni kart açın.',
      'baseUnit',
      'conflict',
    );
  const same =
    existing.code === code &&
    existing.name === name &&
    existing.group_name === group &&
    existing.barcode === barcode &&
    existing.base_unit === baseUnit &&
    existing.purchase_unit === purchaseUnit &&
    existing.factor === factor &&
    existing.account === cmd.account;
  if (same) return { id: cmd.id, version: Number(existing.version) };
  const version = Number(existing.version) + 1;
  tx.db.run(
    'UPDATE products SET code=?,name=?,group_name=?,barcode=?,base_unit=?,purchase_unit=?,factor=?,account=?,version=? WHERE id=?',
    code,
    name,
    group,
    barcode,
    baseUnit,
    purchaseUnit,
    factor,
    cmd.account,
    version,
    cmd.id,
  );
  tx.audit(
    cmd.companyId,
    'Dəyişdirildi',
    'Nomenklatura',
    cmd.id,
    `${code} · ${name} · ${formatQty(factor)} ${baseUnit}/${purchaseUnit} · ${cmd.account}`,
  );
  return { id: cmd.id, version };
}
