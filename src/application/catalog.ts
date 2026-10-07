/** Company, chart of accounts and the catalogs that subkonto values point to. */
import { baseChart, checkSubkonto, currencies, newAccount } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { numberKey, parseDate, parseTaxId, parseText } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type { Row } from '../infrastructure/sqlite/db.js';
import { expectVersion, type Tx } from './tx.js';

/** Seeded catalog elements; a role lets posting rules find an element after it is renamed. */
const seedItems: [kind: string, names: (string | [name: string, role: string])[]][] = [
  [
    'incomeType',
    [
      ['Məhsul satışı', 'goodsIncome'],
      ['Xidmət satışı', 'serviceIncome'],
    ],
  ],
  [
    'taxType',
    [
      'ƏDV',
      'Mənfəət vergisi',
      'Gəlir vergisi (ödəmə mənbəyində)',
      'Əmlak vergisi',
      'Torpaq vergisi',
      'Sadələşdirilmiş vergi',
      'Dövlət rüsumu',
    ],
  ],
  ['paymentKind', [['Vergi (haqq)', 'vatTax'], 'Faiz', 'Maliyyə sanksiyası']],
  ['fund', ['DSMF — məcburi dövlət sosial sığorta', 'İşsizlik sığortası', 'İcbari tibbi sığorta']],
  ['capitalChange', ['Nizamnamə kapitalına qoyuluş', 'Nizamnamə kapitalının azaldılması']],
  [
    'expenseItem',
    [
      'Bank xidmətləri',
      'Rabitə',
      'Nəqliyyat',
      'İcarə',
      'Kommunal xidmətlər',
      'Ofis xərcləri',
      'Əmək haqqı',
      ['Satılmış malların maya dəyəri', 'cogs'],
    ],
  ],
  ['cashbox', ['Əsas kassa']],
  ['productGroup', [['Əsas nomenklatura qrupu', 'defaultProductGroup']]],
];

export function createCompany(tx: Tx, cmd: CommandOf<'company.create'>): CommandResult {
  const name = parseText(cmd.name, 'Şirkətin adı', 200);
  const taxId = parseTaxId(cmd.taxId);
  if (tx.db.get('SELECT 1 AS x FROM companies WHERE tax_id=?', taxId))
    throw new DomainError('Bu VÖEN ilə şirkət artıq var.', 'taxId', 'conflict');
  const id = tx.id();
  tx.db.run(
    'INSERT INTO companies(id,name,tax_id,vat_payer,purchase_vat,created_at) VALUES(?,?,?,?,?,?)',
    id,
    name,
    taxId,
    cmd.vatPayer ? 1 : 0,
    cmd.vatPayer ? 'offset' : 'cost',
    tx.clock.now(),
  );
  for (const a of baseChart)
    tx.db.run(
      'INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?,1,0)',
      id,
      a.code,
      a.name,
      a.parentCode,
      a.nature,
      JSON.stringify(a.subkonto),
      a.quantitative ? 1 : 0,
      a.currency ? 1 : 0,
    );
  for (const [kind, names] of seedItems)
    for (const n of names) {
      const [name, role] = typeof n === 'string' ? [n, ''] : n;
      tx.db.run(
        'INSERT INTO items(id,company_id,kind,name,role) VALUES(?,?,?,?,?)',
        tx.id(),
        id,
        kind,
        name,
        role,
      );
    }
  tx.audit(id, 'Yaradıldı', 'Şirkət', id, `${name} · VÖEN ${taxId}`);
  return { id };
}

export function updateCompany(tx: Tx, cmd: CommandOf<'company.update'>): CommandResult {
  const row = tx.company(cmd.companyId);
  expectVersion(row, cmd.version, 'Şirkət');
  const name = parseText(cmd.name, 'Şirkətin adı', 200);
  const version = Number(row.version) + 1;
  tx.db.run(
    'UPDATE companies SET name=?,vat_payer=?,purchase_vat=?,version=? WHERE id=?',
    name,
    cmd.vatPayer ? 1 : 0,
    cmd.purchaseVat,
    version,
    cmd.companyId,
  );
  tx.audit(
    cmd.companyId,
    'Dəyişdirildi',
    'Şirkət',
    cmd.companyId,
    `${name} · ƏDV ödəyicisi: ${cmd.vatPayer ? 'bəli' : 'xeyr'}`,
  );
  return { id: cmd.companyId, version };
}

export function createAccount(tx: Tx, cmd: CommandOf<'account.create'>): CommandResult {
  tx.company(cmd.companyId);
  const account = newAccount(tx.chart(cmd.companyId), {
    code: cmd.code,
    name: cmd.name,
    ...(cmd.nature ? { nature: cmd.nature } : {}),
    ...(cmd.subkonto ? { subkonto: cmd.subkonto } : {}),
    ...(cmd.quantitative !== undefined ? { quantitative: cmd.quantitative } : {}),
    ...(cmd.currency !== undefined ? { currency: cmd.currency } : {}),
  });
  tx.db.run(
    'INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?,0,0)',
    cmd.companyId,
    account.code,
    account.name,
    account.parentCode,
    account.nature,
    JSON.stringify(account.subkonto),
    account.quantitative ? 1 : 0,
    account.currency ? 1 : 0,
  );
  tx.audit(cmd.companyId, 'Yaradıldı', 'Hesab', account.code, `${account.code} ${account.name}`);
  return { id: account.code };
}

export function updateAccount(tx: Tx, cmd: CommandOf<'account.update'>): CommandResult {
  tx.company(cmd.companyId);
  const chart = tx.chart(cmd.companyId);
  const current = chart.get(cmd.code);
  if (!current) throw new DomainError('Hesab tapılmadı.', 'code', 'not-found');
  const name = parseText(cmd.name, 'Hesabın adı', 200);
  const subkonto = checkSubkonto(cmd.subkonto);
  if (cmd.archived && !current.archived) {
    const balance = tx.db.get(
      'SELECT COALESCE(SUM(debit-credit),0) AS v, COUNT(*) AS n FROM registers WHERE company_id=? AND (account=? OR account LIKE ?)',
      cmd.companyId,
      cmd.code,
      `${cmd.code}.%`,
    )!;
    if (balance.v !== 0n)
      throw new DomainError('Qalığı olan hesab arxivləşdirilmir.', 'archived', 'conflict');
  }
  tx.db.run(
    'UPDATE accounts SET name=?,archived=? WHERE company_id=? AND code=?',
    name,
    cmd.archived ? 1 : 0,
    cmd.companyId,
    cmd.code,
  );
  const shapeChanged =
    current.nature !== cmd.nature ||
    JSON.stringify(current.subkonto) !== JSON.stringify(subkonto) ||
    current.quantitative !== cmd.quantitative ||
    current.currency !== cmd.currency;
  if (shapeChanged)
    tx.db.run(
      'UPDATE accounts SET nature=?,subkonto=?,quantitative=?,currency=? WHERE company_id=? AND code=?',
      cmd.nature,
      JSON.stringify(subkonto),
      cmd.quantitative ? 1 : 0,
      cmd.currency ? 1 : 0,
      cmd.companyId,
      cmd.code,
    );
  tx.audit(
    cmd.companyId,
    'Dəyişdirildi',
    'Hesab',
    cmd.code,
    `${cmd.code} ${name}${cmd.archived ? ' · arxiv' : ''}`,
  );
  return { id: cmd.code };
}

/**
 * Shared insert-or-update for catalogs: optimistic version check, no-op when nothing changed,
 * archive instead of delete, audit of every change.
 */
function saveRow(
  tx: Tx,
  table: string,
  label: string,
  companyId: string,
  cmd: { id?: string | undefined; version?: number | undefined },
  values: Record<string, string | number>,
  describe: string,
): CommandResult {
  const columns = Object.keys(values);
  if (!cmd.id) {
    const id = tx.id();
    tx.db.run(
      `INSERT INTO ${table}(id,company_id,${columns.join(',')}) VALUES(?,?,${columns.map(() => '?').join(',')})`,
      id,
      companyId,
      ...Object.values(values),
    );
    tx.audit(companyId, 'Yaradıldı', label, id, describe);
    return { id, version: 1 };
  }
  const row = tx.db.get(`SELECT * FROM ${table} WHERE company_id=? AND id=?`, companyId, cmd.id);
  if (!row) throw new DomainError(`${label} tapılmadı.`, 'id', 'not-found');
  expectVersion(row, cmd.version, label);
  if (columns.every((c) => String(row[c]) === String(values[c])))
    return { id: cmd.id, version: Number(row.version) };
  const version = Number(row.version) + 1;
  tx.db.run(
    `UPDATE ${table} SET ${columns.map((c) => `${c}=?`).join(',')},version=? WHERE id=?`,
    ...Object.values(values),
    version,
    cmd.id,
  );
  tx.audit(companyId, 'Dəyişdirildi', label, cmd.id, describe);
  return { id: cmd.id, version };
}

function optionalTaxId(value: string): string {
  const text = value.replace(/\s/g, '');
  return text ? parseTaxId(text) : '';
}

export function savePartner(tx: Tx, cmd: CommandOf<'partner.save'>): CommandResult {
  tx.company(cmd.companyId);
  const name = parseText(cmd.name, 'Kontragentin adı');
  const taxId = optionalTaxId(cmd.taxId);
  if (!taxId && cmd.kind === 'legal')
    throw new DomainError('Hüquqi şəxs üçün VÖEN yazılmalıdır.', 'taxId');
  if (taxId) {
    const same = tx.db.get(
      'SELECT id,name FROM partners WHERE company_id=? AND tax_id=?',
      cmd.companyId,
      taxId,
    );
    if (same && same.id !== cmd.id)
      throw new DomainError(`Bu VÖEN ilə kontragent artıq var: ${same.name}.`, 'taxId', 'conflict');
  }
  return saveRow(
    tx,
    'partners',
    'Kontragent',
    cmd.companyId,
    cmd,
    {
      name,
      tax_id: taxId,
      kind: cmd.kind,
      note: parseText(cmd.note, 'Qeyd', 500, false),
      archived: cmd.archived ? 1 : 0,
    },
    `${name}${taxId ? ` · VÖEN ${taxId}` : ''}${cmd.archived ? ' · arxiv' : ''}`,
  );
}

function partnerRow(tx: Tx, companyId: string, partnerId: string, field = 'partnerId'): Row {
  const p = tx.db.get('SELECT * FROM partners WHERE company_id=? AND id=?', companyId, partnerId);
  if (!p) throw new DomainError('Kontragent tapılmadı.', field, 'not-found');
  return p;
}

const currencyCode = (value: string, field: string) => {
  const c = value.trim().toUpperCase();
  if (c !== 'AZN' && !(currencies as readonly string[]).includes(c))
    throw new DomainError('Valyuta tanınmadı.', field);
  return c;
};

export function saveContract(tx: Tx, cmd: CommandOf<'contract.save'>): CommandResult {
  tx.company(cmd.companyId);
  const partner = partnerRow(tx, cmd.companyId, cmd.partnerId);
  const number = parseText(cmd.number, 'Müqavilənin nömrəsi', 80);
  const key = numberKey(number);
  const same = tx.db.get(
    'SELECT id FROM contracts WHERE company_id=? AND partner_id=? AND number_key=?',
    cmd.companyId,
    cmd.partnerId,
    key,
  );
  if (same && same.id !== cmd.id)
    throw new DomainError('Bu kontragentlə bu nömrəli müqavilə artıq var.', 'number', 'conflict');
  const currency = currencyCode(cmd.currency, 'currency');
  if (cmd.id) {
    const row = tx.db.get(
      'SELECT partner_id,currency FROM contracts WHERE company_id=? AND id=?',
      cmd.companyId,
      cmd.id,
    );
    if (row && row.partner_id !== cmd.partnerId)
      throw new DomainError('Müqavilənin kontragenti dəyişdirilmir.', 'partnerId');
    // Postings on currency accounts carry the contract's currency; it cannot change under them.
    const used = tx.db.get(
      'SELECT 1 AS x FROM registers WHERE company_id=? AND (s1=? OR s2=? OR s3=?) LIMIT 1',
      cmd.companyId,
      cmd.id,
      cmd.id,
      cmd.id,
    );
    if (row && used && row.currency !== currency)
      throw new DomainError('Hərəkəti olan müqavilənin valyutası dəyişdirilmir.', 'currency');
  }
  return saveRow(
    tx,
    'contracts',
    'Müqavilə',
    cmd.companyId,
    cmd,
    {
      partner_id: cmd.partnerId,
      number,
      number_key: key,
      date: parseDate(cmd.date, 'Müqavilənin tarixi'),
      kind: cmd.kind,
      currency,
      note: parseText(cmd.note, 'Qeyd', 500, false),
      archived: cmd.archived ? 1 : 0,
    },
    `${partner.name} · №${number}`,
  );
}

const IBAN = /^AZ\d{2}[A-Z]{4}[A-Z0-9]{20}$/;

export function saveBankAccount(tx: Tx, cmd: CommandOf<'bankAccount.save'>): CommandResult {
  tx.company(cmd.companyId);
  const bank = partnerRow(tx, cmd.companyId, cmd.bankId, 'bankId');
  const iban = cmd.iban.replace(/\s/g, '').toUpperCase();
  if (!IBAN.test(iban))
    throw new DomainError('IBAN AZ ilə başlayan 28 simvol olmalıdır (məsələn AZ12AIIB…).', 'iban');
  const currency = currencyCode(cmd.currency, 'currency');
  const chart = tx.chart(cmd.companyId);
  const account = chart.require(cmd.account, 'account');
  if (!account.subkonto.includes('bankAccount'))
    throw new DomainError(`${account.code} hesabında "Bank hesabı" subkontosu yoxdur.`, 'account');
  if (account.currency !== (currency !== 'AZN'))
    throw new DomainError(
      currency === 'AZN'
        ? `${account.code} valyuta hesabıdır; manat hesabı üçün 223.01 kimi hesab seçin.`
        : `${currency} hesabı valyuta hesabına (223.02) bağlanmalıdır.`,
      'account',
    );
  if (cmd.id) {
    const used = tx.db.get(
      'SELECT 1 AS x FROM registers WHERE company_id=? AND s1=? AND (debit<>0 OR credit<>0) LIMIT 1',
      cmd.companyId,
      cmd.id,
    );
    const row = tx.db.get(
      'SELECT account,currency FROM bank_accounts WHERE company_id=? AND id=?',
      cmd.companyId,
      cmd.id,
    );
    if (used && row && (row.account !== account.code || row.currency !== currency))
      throw new DomainError(
        'Hərəkəti olan bank hesabının hesabı və valyutası dəyişdirilmir.',
        'account',
      );
  }
  const name = parseText(cmd.name, 'Ad', 160, false) || `${bank.name} · ${currency}`;
  return saveRow(
    tx,
    'bank_accounts',
    'Bank hesabı',
    cmd.companyId,
    cmd,
    {
      bank_id: cmd.bankId,
      iban,
      currency,
      account: account.code,
      name,
      archived: cmd.archived ? 1 : 0,
    },
    `${name} · ${iban}`,
  );
}

export function saveProduct(tx: Tx, cmd: CommandOf<'product.save'>): CommandResult {
  tx.company(cmd.companyId);
  const name = parseText(cmd.name, 'Adı', 240);
  const code = parseText(cmd.code, 'Kod', 40, false);
  const same = tx.db.get(
    'SELECT id FROM products WHERE company_id=? AND name=?',
    cmd.companyId,
    name,
  );
  if (same && same.id !== cmd.id)
    throw new DomainError('Bu adla nomenklatura artıq var.', 'name', 'conflict');
  if (code) {
    const byCode = tx.db.get(
      'SELECT id FROM products WHERE company_id=? AND code=?',
      cmd.companyId,
      code,
    );
    if (byCode && byCode.id !== cmd.id)
      throw new DomainError('Bu kodla nomenklatura artıq var.', 'code', 'conflict');
  }
  const groupId = cmd.groupId.trim();
  if (
    groupId &&
    !tx.db.get(
      "SELECT 1 AS x FROM items WHERE company_id=? AND id=? AND kind='productGroup'",
      cmd.companyId,
      groupId,
    )
  )
    throw new DomainError('Nomenklatura qrupu tapılmadı.', 'groupId', 'not-found');
  return saveRow(
    tx,
    'products',
    'Nomenklatura',
    cmd.companyId,
    cmd,
    {
      code,
      name,
      unit: parseText(cmd.unit, 'Ölçü vahidi', 20),
      kind: cmd.kind,
      group_id: groupId,
      archived: cmd.archived ? 1 : 0,
    },
    name,
  );
}

export function saveEmployee(tx: Tx, cmd: CommandOf<'employee.save'>): CommandResult {
  tx.company(cmd.companyId);
  const name = parseText(cmd.name, 'Ad, soyad', 160);
  const fin = cmd.fin.trim().toUpperCase();
  if (fin && !/^[A-Z0-9]{7}$/.test(fin)) throw new DomainError('FİN 7 simvol olmalıdır.', 'fin');
  if (fin) {
    const same = tx.db.get(
      'SELECT id FROM employees WHERE company_id=? AND fin=?',
      cmd.companyId,
      fin,
    );
    if (same && same.id !== cmd.id)
      throw new DomainError('Bu FİN ilə işçi artıq var.', 'fin', 'conflict');
  }
  return saveRow(
    tx,
    'employees',
    'İşçi',
    cmd.companyId,
    cmd,
    {
      name,
      position: parseText(cmd.position, 'Vəzifə', 120, false),
      fin,
      archived: cmd.archived ? 1 : 0,
    },
    name,
  );
}

const itemLabels = {
  expenseItem: 'Xərc maddəsi',
  incomeType: 'Gəlir növü',
  taxType: 'Vergi növü',
  paymentKind: 'Ödəniş növü',
  fund: 'Fond',
  capitalChange: 'Kapitalda dəyişiklik növü',
  cashbox: 'Kassa',
  productGroup: 'Nomenklatura qrupu',
} as const;

/** Posting-rule roles of catalog elements and the kind each belongs to. */
const roleKind = {
  vatTax: 'paymentKind',
  cogs: 'expenseItem',
  defaultProductGroup: 'productGroup',
  goodsIncome: 'incomeType',
  serviceIncome: 'incomeType',
} as const;
const roleLabel = {
  vatTax: 'satışın ƏDV-si (521.01)',
  cogs: 'satılmış malların maya dəyəri (701)',
  defaultProductGroup: 'nomenklatura qrupu',
  goodsIncome: 'mal satışı',
  serviceIncome: 'xidmət satışı',
} as const;

export function saveItem(tx: Tx, cmd: CommandOf<'item.save'>): CommandResult {
  tx.company(cmd.companyId);
  const name = parseText(cmd.name, 'Ad', 160);
  const same = tx.db.get(
    'SELECT id FROM items WHERE company_id=? AND kind=? AND name=?',
    cmd.companyId,
    cmd.kind,
    name,
  );
  if (same && same.id !== cmd.id)
    throw new DomainError('Bu adla element artıq var.', 'name', 'conflict');
  if (cmd.id) {
    const row = tx.db.get(
      'SELECT kind FROM items WHERE company_id=? AND id=?',
      cmd.companyId,
      cmd.id,
    );
    if (row && row.kind !== cmd.kind)
      throw new DomainError('Elementin növü dəyişdirilmir.', 'kind');
  }
  const result = saveRow(
    tx,
    'items',
    itemLabels[cmd.kind],
    cmd.companyId,
    cmd,
    { kind: cmd.kind, name, archived: cmd.archived ? 1 : 0 },
    name,
  );
  if (cmd.role !== undefined) {
    const current = tx.db.get('SELECT role FROM items WHERE id=?', result.id)!;
    if (current.role !== cmd.role) {
      if (cmd.role && roleKind[cmd.role] !== cmd.kind)
        throw new DomainError('Bu rol bu növ elementə verilmir.', 'role');
      if (cmd.role && cmd.archived)
        throw new DomainError('Arxivdəki element standart ola bilməz.', 'role');
      if (cmd.role)
        tx.db.run(
          "UPDATE items SET role='' WHERE company_id=? AND role=? AND id<>?",
          cmd.companyId,
          cmd.role,
          result.id,
        );
      tx.db.run('UPDATE items SET role=? WHERE id=?', cmd.role, result.id);
      tx.audit(
        cmd.companyId,
        'Dəyişdirildi',
        itemLabels[cmd.kind],
        result.id,
        `${name} · ${cmd.role ? `standart: ${roleLabel[cmd.role]}` : 'standart deyil'}`,
      );
    }
  }
  return result;
}

export function closePeriod(tx: Tx, cmd: CommandOf<'period.close'>): CommandResult {
  const company = tx.company(cmd.companyId);
  const through = parseDate(cmd.through, 'Bağlanış tarixi');
  const current = String(company.closed_through);
  if (through === current) return { id: cmd.companyId };
  if (through >= tx.clock.today())
    throw new DomainError('Yalnız keçmiş tarixə qədər dövr bağlamaq olar.', 'through');
  const reopen = current && through < current;
  const reason = parseText(cmd.reason, 'Səbəb', 240, !!reopen);
  tx.db.run('UPDATE companies SET closed_through=? WHERE id=?', through, cmd.companyId);
  tx.audit(
    cmd.companyId,
    reopen ? 'Dövr yenidən açıldı' : 'Dövr bağlandı',
    'Şirkət',
    cmd.companyId,
    `${through} daxil olmaqla${reason ? ` · ${reason}` : ''}`,
  );
  return { id: cmd.companyId };
}
