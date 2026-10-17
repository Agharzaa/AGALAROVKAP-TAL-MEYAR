/**
 * Ledger v3 schema (subkonto model). It lives in its own database file, so the stage-A test
 * database is never touched. Each migration runs once in its own transaction; user_version
 * records the applied version and a newer database is refused by an older program.
 *
 * Integrity is enforced by SQLite itself wherever it can be:
 * - tenant isolation through composite (company_id, id) foreign keys;
 * - the journal (entries, postings) and the audit trail are append-only;
 * - nothing is posted on or before the company's closing date;
 * - balance registers (account × subkonto × month) are maintained by triggers in the same
 *   transaction as each posting, so reports never scan the journal and can never drift from it
 *   through an application bug (the startup integrity check proves it).
 */
export const SCHEMA_VERSION = 11;

const v1 = `
CREATE TABLE companies(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tax_id TEXT NOT NULL UNIQUE,
  vat_payer INTEGER NOT NULL DEFAULT 1 CHECK(vat_payer IN(0,1)),
  purchase_vat TEXT NOT NULL DEFAULT 'offset' CHECK(purchase_vat IN('offset','cost')),
  closed_through TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE accounts(
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_code TEXT,
  nature TEXT NOT NULL CHECK(nature IN('active','passive','active-passive')),
  subkonto TEXT NOT NULL,
  quantitative INTEGER NOT NULL CHECK(quantitative IN(0,1)),
  currency INTEGER NOT NULL CHECK(currency IN(0,1)),
  system INTEGER NOT NULL CHECK(system IN(0,1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  PRIMARY KEY(company_id,code),
  FOREIGN KEY(company_id,parent_code) REFERENCES accounts(company_id,code)
);

CREATE TABLE partners(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  tax_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN('legal','individual','foreign','state')),
  note TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id,id)
);
CREATE UNIQUE INDEX partners_tax ON partners(company_id,tax_id) WHERE tax_id<>'';
CREATE INDEX partners_name ON partners(company_id,name);

CREATE TABLE contracts(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  partner_id TEXT NOT NULL,
  number TEXT NOT NULL,
  number_key TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('sale','purchase','loan','other')),
  currency TEXT NOT NULL DEFAULT 'AZN',
  note TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id,id),
  UNIQUE(company_id,partner_id,number_key),
  FOREIGN KEY(company_id,partner_id) REFERENCES partners(company_id,id)
);

CREATE TABLE bank_accounts(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  bank_id TEXT NOT NULL,
  iban TEXT NOT NULL,
  currency TEXT NOT NULL,
  account TEXT NOT NULL,
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id,id),
  UNIQUE(company_id,iban),
  FOREIGN KEY(company_id,bank_id) REFERENCES partners(company_id,id),
  FOREIGN KEY(company_id,account) REFERENCES accounts(company_id,code)
);

CREATE TABLE products(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('goods','material','asset','service')),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id,id),
  UNIQUE(company_id,name)
);
CREATE UNIQUE INDEX products_code ON products(company_id,code) WHERE code<>'';

CREATE TABLE employees(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT '',
  fin TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id,id)
);
CREATE UNIQUE INDEX employees_fin ON employees(company_id,fin) WHERE fin<>'';

CREATE TABLE items(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL CHECK(kind IN('expenseItem','incomeType','taxType','fund','cashbox')),
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id,id),
  UNIQUE(company_id,kind,name)
);

CREATE TABLE operations(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  number TEXT NOT NULL,
  number_key TEXT NOT NULL,
  date TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN('posted','cancelled')),
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,id),
  UNIQUE(company_id,number_key)
);
CREATE INDEX operations_date ON operations(company_id,date);

CREATE TABLE entries(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  date TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_number TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  storno INTEGER NOT NULL CHECK(storno IN(0,1)),
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  UNIQUE(company_id,id)
);
CREATE INDEX entries_source ON entries(company_id,source_type,source_id);

CREATE TABLE postings(
  entry_id TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  company_id TEXT NOT NULL,
  date TEXT NOT NULL,
  dt_account TEXT NOT NULL,
  dt_s1 TEXT NOT NULL DEFAULT '',
  dt_s2 TEXT NOT NULL DEFAULT '',
  dt_s3 TEXT NOT NULL DEFAULT '',
  kt_account TEXT NOT NULL,
  kt_s1 TEXT NOT NULL DEFAULT '',
  kt_s2 TEXT NOT NULL DEFAULT '',
  kt_s3 TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount<>0),
  dt_qty INTEGER NOT NULL DEFAULT 0,
  kt_qty INTEGER NOT NULL DEFAULT 0,
  dt_currency TEXT NOT NULL DEFAULT '',
  dt_cur INTEGER NOT NULL DEFAULT 0,
  kt_currency TEXT NOT NULL DEFAULT '',
  kt_cur INTEGER NOT NULL DEFAULT 0,
  memo TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(entry_id,line_no),
  FOREIGN KEY(company_id,entry_id) REFERENCES entries(company_id,id),
  FOREIGN KEY(company_id,dt_account) REFERENCES accounts(company_id,code),
  FOREIGN KEY(company_id,kt_account) REFERENCES accounts(company_id,code)
);
CREATE INDEX postings_dt ON postings(company_id,dt_account,date);
CREATE INDEX postings_kt ON postings(company_id,kt_account,date);
CREATE INDEX postings_date ON postings(company_id,date);

CREATE TABLE registers(
  company_id TEXT NOT NULL,
  account TEXT NOT NULL,
  s1 TEXT NOT NULL,
  s2 TEXT NOT NULL,
  s3 TEXT NOT NULL,
  month TEXT NOT NULL,
  debit INTEGER NOT NULL,
  credit INTEGER NOT NULL,
  qty_dt INTEGER NOT NULL,
  qty_kt INTEGER NOT NULL,
  cur_dt INTEGER NOT NULL,
  cur_kt INTEGER NOT NULL,
  PRIMARY KEY(company_id,account,s1,s2,s3,month)
) WITHOUT ROWID;

CREATE TRIGGER postings_period BEFORE INSERT ON postings
WHEN NEW.date<=(SELECT closed_through FROM companies WHERE id=NEW.company_id)
BEGIN SELECT RAISE(ABORT,'guard: Bu tarix üzrə uçot dövrü bağlanıb.'); END;

CREATE TRIGGER postings_registers AFTER INSERT ON postings BEGIN
  INSERT INTO registers VALUES(NEW.company_id,NEW.dt_account,NEW.dt_s1,NEW.dt_s2,NEW.dt_s3,substr(NEW.date,1,7),
    NEW.amount,0,NEW.dt_qty,0,NEW.dt_cur,0)
  ON CONFLICT(company_id,account,s1,s2,s3,month) DO UPDATE SET
    debit=debit+excluded.debit, qty_dt=qty_dt+excluded.qty_dt, cur_dt=cur_dt+excluded.cur_dt;
  INSERT INTO registers VALUES(NEW.company_id,NEW.kt_account,NEW.kt_s1,NEW.kt_s2,NEW.kt_s3,substr(NEW.date,1,7),
    0,NEW.amount,0,NEW.kt_qty,0,NEW.kt_cur)
  ON CONFLICT(company_id,account,s1,s2,s3,month) DO UPDATE SET
    credit=credit+excluded.credit, qty_kt=qty_kt+excluded.qty_kt, cur_kt=cur_kt+excluded.cur_kt;
END;

CREATE TRIGGER entries_no_update BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT,'guard: Jurnal dəyişdirilmir; storno edilir.'); END;
CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries BEGIN SELECT RAISE(ABORT,'guard: Jurnal silinmir; storno edilir.'); END;
CREATE TRIGGER postings_no_update BEFORE UPDATE ON postings BEGIN SELECT RAISE(ABORT,'guard: Yazılış dəyişdirilmir; storno edilir.'); END;
CREATE TRIGGER postings_no_delete BEFORE DELETE ON postings BEGIN SELECT RAISE(ABORT,'guard: Yazılış silinmir; storno edilir.'); END;
CREATE TRIGGER registers_no_delete BEFORE DELETE ON registers BEGIN SELECT RAISE(ABORT,'guard: Qalıq registri silinmir.'); END;
CREATE TRIGGER operations_no_delete BEFORE DELETE ON operations BEGIN SELECT RAISE(ABORT,'guard: Sənəd silinmir; ləğv edilir.'); END;
CREATE TRIGGER operations_period BEFORE UPDATE ON operations
WHEN OLD.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id)
  OR NEW.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id)
BEGIN SELECT RAISE(ABORT,'guard: Bu tarix üzrə uçot dövrü bağlanıb.'); END;

CREATE TRIGGER accounts_no_delete BEFORE DELETE ON accounts BEGIN SELECT RAISE(ABORT,'guard: Hesab silinmir; arxivləşdirilir.'); END;
CREATE TRIGGER accounts_shape BEFORE UPDATE OF subkonto,quantitative,currency,nature ON accounts
WHEN EXISTS(SELECT 1 FROM registers WHERE company_id=OLD.company_id AND account=OLD.code)
BEGIN SELECT RAISE(ABORT,'guard: Yazılışı olan hesabın subkontosu, növü və uçot qaydası dəyişdirilmir.'); END;
CREATE TRIGGER accounts_parent BEFORE INSERT ON accounts
WHEN NEW.parent_code IS NOT NULL AND EXISTS(SELECT 1 FROM registers WHERE company_id=NEW.company_id AND account=NEW.parent_code)
BEGIN SELECT RAISE(ABORT,'guard: Yazılışı olan hesaba subhesab açılmır; yeni hesab açın.'); END;

CREATE TRIGGER partners_no_delete BEFORE DELETE ON partners BEGIN SELECT RAISE(ABORT,'guard: Kontragent silinmir; arxivləşdirilir.'); END;
CREATE TRIGGER contracts_no_delete BEFORE DELETE ON contracts BEGIN SELECT RAISE(ABORT,'guard: Müqavilə silinmir; arxivləşdirilir.'); END;
CREATE TRIGGER bank_accounts_no_delete BEFORE DELETE ON bank_accounts BEGIN SELECT RAISE(ABORT,'guard: Bank hesabı silinmir; arxivləşdirilir.'); END;
CREATE TRIGGER products_no_delete BEFORE DELETE ON products BEGIN SELECT RAISE(ABORT,'guard: Nomenklatura silinmir; arxivləşdirilir.'); END;
CREATE TRIGGER employees_no_delete BEFORE DELETE ON employees BEGIN SELECT RAISE(ABORT,'guard: İşçi silinmir; arxivləşdirilir.'); END;
CREATE TRIGGER items_no_delete BEFORE DELETE ON items BEGIN SELECT RAISE(ABORT,'guard: Kitabça elementi silinmir; arxivləşdirilir.'); END;

CREATE TABLE document_history(
  company_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  PRIMARY KEY(company_id,doc_type,doc_id,version,status)
);
CREATE TRIGGER history_no_update BEFORE UPDATE ON document_history BEGIN SELECT RAISE(ABORT,'guard: Tarixçə dəyişdirilmir.'); END;
CREATE TRIGGER history_no_delete BEFORE DELETE ON document_history BEGIN SELECT RAISE(ABORT,'guard: Tarixçə silinmir.'); END;

CREATE TABLE audit(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX audit_company ON audit(company_id,seq);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'guard: Audit jurnalı dəyişdirilmir.'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'guard: Audit jurnalı silinmir.'); END;

CREATE TABLE idempotency(
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY(scope,key)
);
`;

// ---------------------------------------------------------------------------------------------
// v2 — chart of accounts aligned with a real 1C AzStandart chart (docs/QERARLAR.md, 2026-10-07
// evening) and the "Nomenklatura qrupu" catalog for 701.
//
// The lists below are a frozen snapshot of that change; later chart edits get their own
// migration. Existing companies are upgraded only where it is safe: an account whose family
// already has postings keeps its shape (the accounts_shape / accounts_parent guards would refuse
// it anyway), a user's renamed account keeps the user's name, and existing codes are never
// overwritten. New companies get the full chart from baseChart.

type ChartRow = [
  code: string,
  name: string,
  parent: string | null,
  nature: 'active' | 'passive' | 'active-passive',
  subkonto: string[],
  qty: 0 | 1,
  cur: 0 | 1,
];
const PCD = ['partner', 'contract', 'document'];
const AP = 'active-passive';
/** Accounts added in v2, parents before children. */
const v2New: ChartRow[] = [
  ['211.01', 'Alıcılar və sifarişçilərlə hesablaşmalar (manatla)', '211', AP, PCD, 0, 0],
  ['211.02', 'Alıcılar və sifarişçilərlə hesablaşmalar (valyuta ilə)', '211', AP, PCD, 0, 1],
  ['222.01', 'Yolda olan pul köçürmələri (manatla)', '222', 'active', [], 0, 0],
  ['222.02', 'Xarici valyutanın alınması', '222', 'active', PCD, 0, 0],
  ['222.03', 'Yolda olan pul köçürmələri (valyuta ilə)', '222', 'active', [], 0, 1],
  ['222.04', 'Xarici valyutanın satılması', '222', 'active', PCD, 0, 1],
  ['344', 'Elan edilmiş dividendlər', null, AP, [], 0, 0],
  ['422', 'Digər təxirə salınmış vergi öhdəlikləri', null, AP, ['partner', 'contract'], 0, 0],
  ['521.01', 'Əlavə dəyər vergisi', '521', AP, [], 0, 0],
  ['521.02', 'Əmlak vergisi', '521', AP, [], 0, 0],
  ['521.03', 'Gəlir vergisi', '521', AP, [], 0, 0],
  ['521.04', 'Mənfəət vergisi', '521', AP, [], 0, 0],
  ['521.05', 'Torpaq vergisi', '521', AP, [], 0, 0],
  ['521.06', 'Sanksiyalar', '521', AP, [], 0, 0],
  ['521.07', 'Ödəmə mənbəyindən vergi', '521', AP, ['partner'], 0, 0],
  ['521.08', 'Sadələşdirilmiş vergi', '521', AP, [], 0, 0],
  ['521.09', 'Sair vergi və rüsumlar', '521', AP, ['taxType'], 0, 0],
  ['521.10', 'Yol vergisi', '521', AP, [], 0, 0],
  ['521.11', 'Aksizlər', '521', AP, [], 0, 0],
  ['521.12', 'Mədən vergisi', '521', AP, [], 0, 0],
  ['521.13', 'ƏDV vergi agenti', '521', AP, PCD, 0, 0],
  ['522.01', 'Sosial sığorta və təminat üzrə öhdəliklər — əmək sazişi', '522', AP, [], 0, 0],
  ['522.02', 'Sosial sığorta və təminat üzrə öhdəliklər — xidmət müqaviləsi', '522', AP, [], 0, 0],
  ['522.03', 'İşsizlikdən sığorta haqları', '522', AP, [], 0, 0],
  ['522.03.1', 'İşsizlikdən sığorta haqları — işçi', '522.03', AP, [], 0, 0],
  ['522.03.2', 'İşsizlikdən sığorta haqları — işəgötürən', '522.03', AP, [], 0, 0],
  ['522.04', 'İcbari tibbi sığorta haqları', '522', AP, [], 0, 0],
  ['522.04.1', 'İcbari tibbi sığorta haqları — işçi', '522.04', AP, [], 0, 0],
  ['522.04.2', 'İcbari tibbi sığorta haqları — işəgötürən', '522.04', AP, [], 0, 0],
  [
    '531.01',
    'Malsatan və podratçılara qısamüddətli kreditor borcları (manatla)',
    '531',
    AP,
    PCD,
    0,
    0,
  ],
  [
    '531.02',
    'Malsatan və podratçılara qısamüddətli kreditor borcları (valyuta ilə)',
    '531',
    AP,
    PCD,
    0,
    1,
  ],
  ['534', 'Dividendlərin ödənilməsi üzrə təsisçilərə kreditor borcları', null, AP, [], 0, 0],
  ['534.01', 'Dividendlərin ödənilməsi üzrə təsisçilərə kreditor borcları', '534', AP, [], 0, 0],
];
/**
 * New subkonto of existing system accounts, applied only while the whole top-level family
 * (243 for 243.01) is unused, so sibling sub-accounts never end up with different subkonto.
 */
const v2Shape: [code: string, subkonto: string[]][] = [
  ['243', PCD],
  ['243.01', PCD],
  ['243.02', PCD],
  ['521', []],
  ['522', []],
  ['543', PCD],
  ['543.01', PCD],
  ['543.02', PCD],
  ['701', ['productGroup', 'expenseItem']],
];
/** Renames of system accounts, applied only where the name is still the old seeded one. */
const v2Names: [code: string, from: string, to: string][] = [
  [
    '211',
    'Alıcılar və sifarişçilərin qısamüddətli debitor borcları',
    'Alıcıların və sifarişçilərin qısamüddətli debitor borcları',
  ],
  ['243.01', 'Verilmiş avanslar (AZN)', 'Verilmiş avanslar üzrə hesablaşmalar (manatla)'],
  ['243.02', 'Verilmiş avanslar (valyuta)', 'Verilmiş avanslar üzrə hesablaşmalar (valyuta ilə)'],
  ['543.01', 'Alınmış avanslar (AZN)', 'Alınmış avanslar üzrə hesablaşmalar (manatla)'],
  ['543.02', 'Alınmış avanslar (valyuta)', 'Alınmış avanslar üzrə hesablaşmalar (valyuta ilə)'],
];

const q = (v: string | null) => (v === null ? 'NULL' : `'${v.replaceAll("'", "''")}'`);
/** Neither the account nor any of its sub-accounts has postings in company c. */
const unused = (code: string) =>
  `NOT EXISTS(SELECT 1 FROM registers r WHERE r.company_id=c.id AND (r.account=${q(code)} OR r.account LIKE ${q(`${code}.%`)}))`;
const uuid =
  "lower(substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-a'||substr(h,18,3)||'-'||substr(h,21,12))";

const v2 = [
  // Items: allow the new "productGroup" kind (SQLite cannot alter a CHECK; the table is rebuilt).
  `CREATE TABLE items_v2(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL CHECK(kind IN('expenseItem','incomeType','taxType','fund','cashbox','productGroup')),
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id,id),
  UNIQUE(company_id,kind,name)
);`,
  'INSERT INTO items_v2(id,company_id,kind,name,archived,version) SELECT id,company_id,kind,name,archived,version FROM items;',
  'DROP TABLE items;',
  'ALTER TABLE items_v2 RENAME TO items;',
  "CREATE TRIGGER items_no_delete BEFORE DELETE ON items BEGIN SELECT RAISE(ABORT,'guard: Kitabça elementi silinmir; arxivləşdirilir.'); END;",
  `INSERT INTO items(id,company_id,kind,name) SELECT ${uuid},id,'productGroup','Əsas nomenklatura qrupu'
  FROM (SELECT hex(randomblob(16)) AS h, id FROM companies);`,
  ...v2Shape.map(
    ([code, sk]) =>
      `UPDATE accounts SET subkonto=${q(JSON.stringify(sk))} WHERE code=${q(code)} AND system=1 AND EXISTS(SELECT 1 FROM companies c WHERE c.id=accounts.company_id AND ${unused(code.split('.')[0]!)});`,
  ),
  ...v2New.map(
    ([code, name, parent, nature, sk, qty, cur]) =>
      `INSERT INTO accounts(company_id,code,name,parent_code,nature,subkonto,quantitative,currency,system,archived)
  SELECT c.id,${q(code)},${q(name)},${q(parent)},${q(nature)},${q(JSON.stringify(sk))},${qty},${cur},1,0 FROM companies c
  WHERE NOT EXISTS(SELECT 1 FROM accounts a WHERE a.company_id=c.id AND a.code=${q(code)})${
    parent
      ? ` AND EXISTS(SELECT 1 FROM accounts a WHERE a.company_id=c.id AND a.code=${q(parent)} AND a.archived=0)
    AND NOT EXISTS(SELECT 1 FROM registers r WHERE r.company_id=c.id AND r.account=${q(parent)})`
      : ''
  };`,
  ),
  ...v2Names.map(
    ([code, from, to]) =>
      `UPDATE accounts SET name=${q(to)} WHERE code=${q(code)} AND system=1 AND name=${q(from)};`,
  ),
  `INSERT INTO audit(company_id,at,actor,correlation_id,action,entity,entity_id,detail)
  SELECT id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system','migration-2','Yeniləndi','Hesab planı',id,
  'Hesab planı 1C AzStandart ilə tutuşdurmaya görə yeniləndi (521/522 subhesabları, 211/531 .01/.02, 222.01–222.04, 344, 422, 534; 243/543 + hesablaşma sənədi; 701: nomenklatura qrupu → xərc maddəsi). Yazılışı olan hesablar dəyişdirilmədi.'
  FROM companies;`,
].join('\n');

// ---------------------------------------------------------------------------------------------
// v3 — second round of 1C alignment (docs/QERARLAR.md, 2026-10-07 night): 521/522 carry 1C's
// "payment kind" subkonto (tax / interest / sanction), 221 and 244 get 1C's sub-accounts, 301 gets
// "Kapitalda dəyişiklik növü". Same safety rules as v2; frozen snapshot.

const PK = ['paymentKind'];
const v3New: ChartRow[] = [
  ['221.01', 'Kassa (manatla)', '221', 'active', ['cashbox'], 0, 0],
  ['221.02', 'Əməliyyat kassası', '221', 'active', ['cashbox'], 0, 0],
  ['221.03', 'Pul sənədləri (manatla)', '221', 'active', [], 0, 0],
  ['221.04', 'Kassa (valyuta ilə)', '221', 'active', ['cashbox'], 0, 1],
  ['221.05', 'Pul sənədləri (valyuta ilə)', '221', 'active', [], 0, 1],
  ['244.01', 'Təhtəlhesab məbləğlər (manatla)', '244', AP, ['employee'], 0, 0],
  ['244.02', 'Təhtəlhesab məbləğlər (valyuta ilə)', '244', AP, ['employee'], 0, 1],
];
const v3Shape: [code: string, subkonto: string[]][] = [
  ...[
    '521',
    '521.01',
    '521.02',
    '521.03',
    '521.04',
    '521.05',
    '521.06',
    '521.08',
    '521.09',
    '521.10',
    '521.11',
    '521.12',
    '522',
    '522.01',
    '522.02',
    '522.03',
    '522.03.1',
    '522.03.2',
    '522.04',
    '522.04.1',
    '522.04.2',
  ].map((code): [string, string[]] => [code, PK]),
  ['521.07', [...PK, 'partner']],
  ['301', ['partner', 'capitalChange']],
];
const v3Kinds = [
  'expenseItem',
  'incomeType',
  'taxType',
  'paymentKind',
  'fund',
  'capitalChange',
  'cashbox',
  'productGroup',
];
const v3Items: [kind: string, name: string][] = [
  ['paymentKind', 'Vergi (haqq)'],
  ['paymentKind', 'Faiz'],
  ['paymentKind', 'Maliyyə sanksiyası'],
  ['capitalChange', 'Nizamnamə kapitalına qoyuluş'],
  ['capitalChange', 'Nizamnamə kapitalının azaldılması'],
];

const v3 = [
  `CREATE TABLE items_v3(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL CHECK(kind IN(${v3Kinds.map(q).join(',')})),
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id,id),
  UNIQUE(company_id,kind,name)
);`,
  'INSERT INTO items_v3(id,company_id,kind,name,archived,version) SELECT id,company_id,kind,name,archived,version FROM items;',
  'DROP TABLE items;',
  'ALTER TABLE items_v3 RENAME TO items;',
  "CREATE TRIGGER items_no_delete BEFORE DELETE ON items BEGIN SELECT RAISE(ABORT,'guard: Kitabça elementi silinmir; arxivləşdirilir.'); END;",
  ...v3Items.map(
    ([kind, name]) =>
      `INSERT INTO items(id,company_id,kind,name) SELECT ${uuid},id,${q(kind)},${q(name)}
  FROM (SELECT hex(randomblob(16)) AS h, id FROM companies c
    WHERE NOT EXISTS(SELECT 1 FROM items i WHERE i.company_id=c.id AND i.kind=${q(kind)} AND i.name=${q(name)}));`,
  ),
  ...v3Shape.map(
    ([code, sk]) =>
      `UPDATE accounts SET subkonto=${q(JSON.stringify(sk))} WHERE code=${q(code)} AND system=1 AND EXISTS(SELECT 1 FROM companies c WHERE c.id=accounts.company_id AND ${unused(code.split('.')[0]!)});`,
  ),
  ...v3New.map(
    ([code, name, parent, nature, sk, qty, cur]) =>
      `INSERT INTO accounts(company_id,code,name,parent_code,nature,subkonto,quantitative,currency,system,archived)
  SELECT c.id,${q(code)},${q(name)},${q(parent)},${q(nature)},${q(JSON.stringify(sk))},${qty},${cur},1,0 FROM companies c
  WHERE NOT EXISTS(SELECT 1 FROM accounts a WHERE a.company_id=c.id AND a.code=${q(code)})
    AND EXISTS(SELECT 1 FROM accounts a WHERE a.company_id=c.id AND a.code=${q(parent)} AND a.archived=0)
    AND NOT EXISTS(SELECT 1 FROM registers r WHERE r.company_id=c.id AND r.account=${q(parent)});`,
  ),
  `INSERT INTO audit(company_id,at,actor,correlation_id,action,entity,entity_id,detail)
  SELECT id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system','migration-3','Yeniləndi','Hesab planı',id,
  'Hesab planı 1C AzStandart ilə ikinci tutuşdurmaya görə yeniləndi (521/522: ödəniş növü subkontosu; 221.01–221.05, 244.01/244.02; 301: kapitalda dəyişiklik növü). Yazılışı olan hesablar dəyişdirilmədi.'
  FROM companies;`,
].join('\n');

// ---------------------------------------------------------------------------------------------
// v4 — invoices (stage 2). Items get a "role" so posting rules find their catalog elements
// (VAT payment kind, cost-of-sales item, default product group, default income types) even
// after the accountant renames them; products get a product group (701); two indexes serve
// FIFO, which reads one product's movements on one stock account.

const v4 = `
CREATE TABLE invoices(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  direction TEXT NOT NULL CHECK(direction IN('sale','purchase')),
  number TEXT NOT NULL,
  number_key TEXT NOT NULL,
  date TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  rate INTEGER NOT NULL CHECK(rate>0),
  prices_include_vat INTEGER NOT NULL CHECK(prices_include_vat IN(0,1)),
  eq_series TEXT NOT NULL DEFAULT '',
  eq_number TEXT NOT NULL DEFAULT '',
  eq_key TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  lines TEXT NOT NULL,
  net INTEGER NOT NULL,
  vat INTEGER NOT NULL,
  total INTEGER NOT NULL,
  total_azn INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN('posted','cancelled')),
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,id),
  UNIQUE(company_id,direction,number_key),
  FOREIGN KEY(company_id,partner_id) REFERENCES partners(company_id,id),
  FOREIGN KEY(company_id,contract_id) REFERENCES contracts(company_id,id)
);
CREATE INDEX invoices_date ON invoices(company_id,direction,date);
CREATE UNIQUE INDEX invoices_eq_sale ON invoices(company_id,eq_key)
  WHERE direction='sale' AND eq_key<>'' AND status='posted';
CREATE UNIQUE INDEX invoices_eq_purchase ON invoices(company_id,partner_id,eq_key)
  WHERE direction='purchase' AND eq_key<>'' AND status='posted';
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT,'guard: Sənəd silinmir; ləğv edilir.'); END;
CREATE TRIGGER invoices_period BEFORE UPDATE ON invoices
WHEN OLD.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id)
  OR NEW.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id)
BEGIN SELECT RAISE(ABORT,'guard: Bu tarix üzrə uçot dövrü bağlanıb.'); END;

CREATE INDEX postings_dt_s1 ON postings(company_id,dt_account,dt_s1,date);
CREATE INDEX postings_kt_s1 ON postings(company_id,kt_account,kt_s1,date);

ALTER TABLE products ADD COLUMN group_id TEXT NOT NULL DEFAULT '';

ALTER TABLE items ADD COLUMN role TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX items_role ON items(company_id,role) WHERE role<>'';
UPDATE items SET role='vatTax' WHERE kind='paymentKind' AND name='Vergi (haqq)' AND archived=0;
UPDATE items SET role='defaultProductGroup' WHERE kind='productGroup' AND name='Əsas nomenklatura qrupu' AND archived=0;
UPDATE items SET role='goodsIncome' WHERE kind='incomeType' AND name='Məhsul satışı' AND archived=0;
UPDATE items SET role='serviceIncome' WHERE kind='incomeType' AND name='Xidmət satışı' AND archived=0;
UPDATE items SET role='cogs' WHERE kind='expenseItem' AND name='Satılmış malların maya dəyəri' AND archived=0;
-- A renamed seed element keeps its seeding position (the first payment kind, the first and second
-- income types…). An archived one is not replaced by a guess: the accountant chooses in Siyahılar.
UPDATE items SET role='vatTax' WHERE role='' AND archived=0 AND rowid IN (
  SELECT (SELECT i.rowid FROM items i WHERE i.company_id=c.id AND i.kind='paymentKind' ORDER BY i.rowid LIMIT 1 OFFSET 0)
  FROM companies c WHERE NOT EXISTS(SELECT 1 FROM items j WHERE j.company_id=c.id AND j.role='vatTax'));
UPDATE items SET role='defaultProductGroup' WHERE role='' AND archived=0 AND rowid IN (
  SELECT (SELECT i.rowid FROM items i WHERE i.company_id=c.id AND i.kind='productGroup' ORDER BY i.rowid LIMIT 1 OFFSET 0)
  FROM companies c WHERE NOT EXISTS(SELECT 1 FROM items j WHERE j.company_id=c.id AND j.role='defaultProductGroup'));
UPDATE items SET role='goodsIncome' WHERE role='' AND archived=0 AND rowid IN (
  SELECT (SELECT i.rowid FROM items i WHERE i.company_id=c.id AND i.kind='incomeType' ORDER BY i.rowid LIMIT 1 OFFSET 0)
  FROM companies c WHERE NOT EXISTS(SELECT 1 FROM items j WHERE j.company_id=c.id AND j.role='goodsIncome'));
UPDATE items SET role='serviceIncome' WHERE role='' AND archived=0 AND rowid IN (
  SELECT (SELECT i.rowid FROM items i WHERE i.company_id=c.id AND i.kind='incomeType' ORDER BY i.rowid LIMIT 1 OFFSET 1)
  FROM companies c WHERE NOT EXISTS(SELECT 1 FROM items j WHERE j.company_id=c.id AND j.role='serviceIncome'));
INSERT INTO items(id,company_id,kind,name,role)
  SELECT ${uuid},id,'expenseItem','Satılmış malların maya dəyəri','cogs'
  FROM (SELECT hex(randomblob(16)) AS h, id FROM companies c
    WHERE NOT EXISTS(SELECT 1 FROM items i WHERE i.company_id=c.id AND i.role='cogs'));

INSERT INTO audit(company_id,at,actor,correlation_id,action,entity,entity_id,detail)
  SELECT id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system','migration-4','Yeniləndi','Baza',id,
  'Qaimələr üçün baza hazırlandı: qaimə cədvəli, kitabça rolları, nomenklatura qrupu, FIFO indeksləri.'
  FROM companies;
`;

// ---------------------------------------------------------------------------------------------
// v5 — the e-qaimə number is one value ("MT2610007"), as it is printed; manual postings of an
// invoice (1C "Əl ilə düzəliş"). Numbers typed in two fields under 0.4.0 are joined, unless the
// joined number already belongs to another invoice (then they stay as they were).

const v5 = `
ALTER TABLE invoices ADD COLUMN manual INTEGER NOT NULL DEFAULT 0 CHECK(manual IN(0,1));
UPDATE invoices SET eq_number=upper(replace(eq_series||eq_number,' ','')), eq_series='', eq_key=upper(replace(replace(replace(replace(eq_series||eq_number,' ',''),'i','I'),'ı','I'),'İ','I'))
WHERE eq_series<>'' AND NOT EXISTS(
  SELECT 1 FROM invoices o WHERE o.company_id=invoices.company_id AND o.id<>invoices.id
    AND o.direction=invoices.direction AND o.status='posted'
    AND (o.direction='sale' OR o.partner_id=invoices.partner_id)
    AND o.eq_key=upper(replace(replace(replace(replace(invoices.eq_series||invoices.eq_number,' ',''),'i','I'),'ı','I'),'İ','I')));
`;

// ---------------------------------------------------------------------------------------------
// v6 — bank documents (stage 3a; docs/MERHELE-3-BANK.md). The bank account decides the ledger
// account (223.01 / 223.02 / 224.04) and the currency; the lines are stored as the user entered
// them (resolved and validated), the journal holds what they posted.

const v6 = `
CREATE TABLE bank_documents(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  direction TEXT NOT NULL CHECK(direction IN('in','out')),
  number TEXT NOT NULL,
  number_key TEXT NOT NULL,
  date TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  rate INTEGER NOT NULL CHECK(rate>0),
  amount INTEGER NOT NULL CHECK(amount>0),
  amount_azn INTEGER NOT NULL CHECK(amount_azn>0),
  bank_reference TEXT NOT NULL DEFAULT '',
  counterparty_name TEXT NOT NULL DEFAULT '',
  counterparty_tax_id TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  pair_id TEXT,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN('manual','statement')),
  statement_line_id TEXT,
  rule_id TEXT,
  rule_version INTEGER,
  lines TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('posted','cancelled')),
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,id),
  UNIQUE(company_id,direction,number_key),
  FOREIGN KEY(company_id,bank_account_id) REFERENCES bank_accounts(company_id,id)
);
CREATE INDEX bank_documents_date ON bank_documents(company_id,direction,date);
CREATE INDEX bank_documents_account ON bank_documents(company_id,bank_account_id,date);
CREATE TRIGGER bank_documents_no_delete BEFORE DELETE ON bank_documents BEGIN SELECT RAISE(ABORT,'guard: Sənəd silinmir; ləğv edilir.'); END;
CREATE TRIGGER bank_documents_period BEFORE UPDATE ON bank_documents
WHEN OLD.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id)
  OR NEW.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id)
BEGIN SELECT RAISE(ABORT,'guard: Bu tarix üzrə uçot dövrü bağlanıb.'); END;

INSERT INTO audit(company_id,at,actor,correlation_id,action,entity,entity_id,detail)
  SELECT id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system','migration-6','Yeniləndi','Baza',id,
  'Bank sənədləri üçün baza hazırlandı.'
  FROM companies;
`;

// ---------------------------------------------------------------------------------------------
// v7 — the VAT deposit pair (stage 3b). Linking two bank documents is analytics, not a change of
// the document: the closed-period guard now watches the document's own fields only, so a pair
// can still be undone when its other half is cancelled in an open period.

const v7 = `
DROP TRIGGER bank_documents_period;
CREATE TRIGGER bank_documents_period
BEFORE UPDATE OF number,number_key,date,bank_account_id,currency,rate,amount,amount_azn,
  bank_reference,counterparty_name,counterparty_tax_id,purpose,lines,status,version ON bank_documents
WHEN OLD.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id)
  OR NEW.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id)
BEGIN SELECT RAISE(ABORT,'guard: Bu tarix üzrə uçot dövrü bağlanıb.'); END;
CREATE INDEX bank_documents_pair ON bank_documents(company_id,pair_id) WHERE pair_id IS NOT NULL;
`;

// ---------------------------------------------------------------------------------------------
// v8 — bank statement import (stage 3c; docs/MERHELE-3-BANK.md §3.2, §6). A loaded file and its
// rows are kept as they came; a row is booked by a bank document (state posted), set aside with
// a reason (ignored) or waits (new). The fingerprint makes a second load of the same rows a no-op.

/** Frozen snapshot of the starting cash-flow items (domain/bank.ts CASH_FLOW_ITEMS, 0.5.0). */
const v8CashFlow = [
  'Alıcılardan daxilolmalar',
  'Malsatan və podratçılara ödənişlər',
  'İşçilərə ödənişlər',
  'Vergi və məcburi ödənişlər',
  'Kreditlər və faizlər',
  'Təsisçilərlə əməliyyatlar',
  'Öz hesabları arasında köçürmələr',
  'Sair daxilolmalar və ödənişlər',
];
const v8 = `
CREATE TABLE statement_imports(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  bank_account_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  opening INTEGER,
  closing INTEGER,
  rows_read INTEGER NOT NULL,
  rows_added INTEGER NOT NULL,
  imported_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  UNIQUE(company_id,id),
  FOREIGN KEY(company_id,bank_account_id) REFERENCES bank_accounts(company_id,id)
);
CREATE INDEX statement_imports_account ON statement_imports(company_id,bank_account_id,imported_at);

CREATE TABLE statement_lines(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  import_id TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  row_no INTEGER NOT NULL,
  date TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN('in','out')),
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
  reference TEXT NOT NULL DEFAULT '',
  counterparty TEXT NOT NULL DEFAULT '',
  counterparty_tax_id TEXT NOT NULL DEFAULT '',
  counterparty_iban TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new' CHECK(state IN('new','posted','ignored')),
  document_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  UNIQUE(company_id,id),
  UNIQUE(company_id,bank_account_id,fingerprint),
  FOREIGN KEY(company_id,import_id) REFERENCES statement_imports(company_id,id),
  FOREIGN KEY(company_id,bank_account_id) REFERENCES bank_accounts(company_id,id),
  FOREIGN KEY(company_id,document_id) REFERENCES bank_documents(company_id,id),
  CHECK((state='posted')=(document_id IS NOT NULL)),
  CHECK(state<>'ignored' OR reason<>'')
);
CREATE INDEX statement_lines_import ON statement_lines(company_id,import_id,row_no);
CREATE INDEX statement_lines_account ON statement_lines(company_id,bank_account_id,date);
CREATE TRIGGER statement_imports_no_delete BEFORE DELETE ON statement_imports BEGIN SELECT RAISE(ABORT,'guard: Çıxarış silinmir.'); END;
CREATE TRIGGER statement_lines_no_delete BEFORE DELETE ON statement_lines BEGIN SELECT RAISE(ABORT,'guard: Çıxarış sətri silinmir; kənara qoyulur.'); END;
CREATE TRIGGER statement_lines_fixed BEFORE UPDATE OF company_id,import_id,bank_account_id,date,direction,amount,fingerprint ON statement_lines
BEGIN SELECT RAISE(ABORT,'guard: Çıxarış sətri bankın yazdığı kimi qalır.'); END;
CREATE INDEX bank_documents_statement ON bank_documents(company_id,statement_line_id) WHERE statement_line_id IS NOT NULL;

-- "Pul vəsaitlərinin hərəkəti maddəsi" (QERARLAR 2026-10-14 §6): a catalog for an attribute of
-- bank document lines, not a subkonto. SQLite cannot alter a CHECK; the items table is rebuilt
-- with its role column, role index and delete guard.
CREATE TABLE items_v8(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL CHECK(kind IN(${[...v3Kinds, 'cashFlowItem'].map(q).join(',')})),
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  role TEXT NOT NULL DEFAULT '',
  UNIQUE(company_id,id),
  UNIQUE(company_id,kind,name)
);
INSERT INTO items_v8(id,company_id,kind,name,archived,version,role)
  SELECT id,company_id,kind,name,archived,version,role FROM items;
DROP TABLE items;
ALTER TABLE items_v8 RENAME TO items;
CREATE TRIGGER items_no_delete BEFORE DELETE ON items BEGIN SELECT RAISE(ABORT,'guard: Kitabça elementi silinmir; arxivləşdirilir.'); END;
CREATE UNIQUE INDEX items_role ON items(company_id,role) WHERE role<>'';
${v8CashFlow
  .map(
    (
      name,
    ) => `INSERT INTO items(id,company_id,kind,name) SELECT ${uuid},id,'cashFlowItem',${q(name)}
  FROM (SELECT hex(randomblob(16)) AS h, id FROM companies);`,
  )
  .join('\n')}
INSERT INTO audit(company_id,at,actor,correlation_id,action,entity,entity_id,detail)
  SELECT id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system','migration-8','Yeniləndi','Baza',id,
  'Bank çıxarışlarının yüklənməsi və pul vəsaitlərinin hərəkəti maddələri kitabçası əlavə olundu.'
  FROM companies;
`;

// ---------------------------------------------------------------------------------------------
// v9 — learned rules (stage 3d; docs/MERHELE-3-BANK.md §3.3, §6.3) and the budget
// classification codes that name the 521 / 522 sub-account of a tax payment. A rule is
// archived, never deleted; a statement row whose automatic booking was undone is left to the
// accountant (manual_only) so the same rule does not post it again.

const v9 = `
CREATE TABLE bank_rules(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN('in','out')),
  bank_account_id TEXT,
  counterparty_tax_id TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '[]',
  amount_min INTEGER,
  amount_max INTEGER,
  lines TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'suggest' CHECK(mode IN('suggest','auto')),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  uses INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,id),
  FOREIGN KEY(company_id,bank_account_id) REFERENCES bank_accounts(company_id,id)
);
CREATE INDEX bank_rules_lookup ON bank_rules(company_id,direction,archived);
CREATE TRIGGER bank_rules_no_delete BEFORE DELETE ON bank_rules BEGIN SELECT RAISE(ABORT,'guard: Qayda silinmir; arxivləşdirilir.'); END;

CREATE TABLE budget_codes(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  account TEXT NOT NULL,
  payment_kind_id TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id,id),
  UNIQUE(company_id,code),
  FOREIGN KEY(company_id,account) REFERENCES accounts(company_id,code)
);
CREATE TRIGGER budget_codes_no_delete BEFORE DELETE ON budget_codes BEGIN SELECT RAISE(ABORT,'guard: Kod silinmir; arxivləşdirilir.'); END;

ALTER TABLE statement_lines ADD COLUMN manual_only INTEGER NOT NULL DEFAULT 0 CHECK(manual_only IN(0,1));
ALTER TABLE statement_lines ADD COLUMN auto_note TEXT NOT NULL DEFAULT '';
`;

// ---------------------------------------------------------------------------------------------
// v10 — DVX e-qaimələri (stage 4a; docs/MERHELE-4-EQAIME.md §3). An e-qaimə is kept once, as
// DVX wrote it: number, VÖEN, date and amounts never change; only its DVX status (with history),
// its goods lines (filled once, when the "Mallar üzrə" report arrives) and its booking do. The
// product map learns how DVX goods lines are booked; invoices remember the e-qaimə they came from.

const v10 = `
CREATE TABLE eq_imports(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  source TEXT NOT NULL CHECK(source IN('file','portal')),
  direction TEXT NOT NULL CHECK(direction IN('sale','purchase')),
  report TEXT NOT NULL CHECK(report IN('invoices','goods')),
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  rows_read INTEGER NOT NULL,
  added INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  same INTEGER NOT NULL DEFAULT 0,
  conflicts INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  UNIQUE(company_id,id)
);
CREATE INDEX eq_imports_time ON eq_imports(company_id,direction,imported_at);
CREATE TRIGGER eq_imports_no_delete BEFORE DELETE ON eq_imports BEGIN SELECT RAISE(ABORT,'guard: Yüklənmə silinmir.'); END;

CREATE TABLE eq_documents(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  direction TEXT NOT NULL CHECK(direction IN('sale','purchase')),
  eq_number TEXT NOT NULL,
  eq_key TEXT NOT NULL CHECK(eq_key<>''),
  tax_id TEXT NOT NULL CHECK(length(tax_id)=10),
  name TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('main','correction','return','advance','other')),
  kind_text TEXT NOT NULL DEFAULT '',
  ref_key TEXT NOT NULL DEFAULT '',
  dvx_status TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN('accepted','pending','cancelled','corrected','rejected','unknown')),
  net INTEGER NOT NULL,
  vat INTEGER NOT NULL,
  total INTEGER NOT NULL,
  base_18 INTEGER NOT NULL DEFAULT 0,
  base_0 INTEGER NOT NULL DEFAULT 0,
  base_exempt INTEGER NOT NULL DEFAULT 0,
  base_nontaxable INTEGER NOT NULL DEFAULT 0,
  excise INTEGER NOT NULL DEFAULT 0,
  road_tax INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  header_full INTEGER NOT NULL CHECK(header_full IN(0,1)),
  lines TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  conflict TEXT NOT NULL DEFAULT '',
  resolved TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'waiting' CHECK(state IN('waiting','posted','ignored')),
  invoice_id TEXT,
  posted_by TEXT NOT NULL DEFAULT '' CHECK(posted_by IN('','auto','hand','link')),
  used_maps TEXT NOT NULL DEFAULT '',
  manual_only INTEGER NOT NULL DEFAULT 0 CHECK(manual_only IN(0,1)),
  auto_note TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  first_import_id TEXT NOT NULL,
  last_import_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,id),
  UNIQUE(company_id,direction,tax_id,eq_key),
  FOREIGN KEY(company_id,first_import_id) REFERENCES eq_imports(company_id,id),
  FOREIGN KEY(company_id,last_import_id) REFERENCES eq_imports(company_id,id),
  FOREIGN KEY(company_id,invoice_id) REFERENCES invoices(company_id,id),
  CHECK((state='posted')=(invoice_id IS NOT NULL)),
  CHECK((state='posted')=(posted_by<>'')),
  CHECK(state<>'ignored' OR reason<>'')
);
CREATE INDEX eq_documents_date ON eq_documents(company_id,direction,date);
CREATE INDEX eq_documents_state ON eq_documents(company_id,direction,state);
CREATE INDEX eq_documents_invoice ON eq_documents(company_id,invoice_id) WHERE invoice_id IS NOT NULL;
CREATE TRIGGER eq_documents_no_delete BEFORE DELETE ON eq_documents BEGIN SELECT RAISE(ABORT,'guard: E-qaimə silinmir; kənara qoyulur.'); END;
CREATE TRIGGER eq_documents_fixed BEFORE UPDATE OF company_id,direction,eq_number,eq_key,tax_id,name,date,
  net,vat,content_hash,first_import_id,created_at ON eq_documents
BEGIN SELECT RAISE(ABORT,'guard: E-qaimə DVX-in yazdığı kimi qalır.'); END;
-- A goods report prints no kind or VAT bases: they are completed once, by the e-qaimə report.
CREATE TRIGGER eq_documents_header_once BEFORE UPDATE OF kind,kind_text,ref_key,total,base_18,base_0,
  base_exempt,base_nontaxable,excise,road_tax,note,header_full ON eq_documents WHEN OLD.header_full=1
BEGIN SELECT RAISE(ABORT,'guard: E-qaimə DVX-in yazdığı kimi qalır.'); END;
CREATE TRIGGER eq_documents_lines_once BEFORE UPDATE OF lines ON eq_documents WHEN OLD.lines<>''
BEGIN SELECT RAISE(ABORT,'guard: E-qaimənin mal sətirləri artıq yazılıb.'); END;

CREATE TABLE eq_status_history(
  company_id TEXT NOT NULL REFERENCES companies(id),
  document_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  at TEXT NOT NULL,
  old_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  dvx_status TEXT NOT NULL,
  FOREIGN KEY(company_id,document_id) REFERENCES eq_documents(company_id,id),
  FOREIGN KEY(company_id,import_id) REFERENCES eq_imports(company_id,id)
);
CREATE INDEX eq_status_history_doc ON eq_status_history(company_id,document_id);
CREATE TRIGGER eq_status_history_no_delete BEFORE DELETE ON eq_status_history BEGIN SELECT RAISE(ABORT,'guard: Status tarixçəsi silinmir.'); END;
CREATE TRIGGER eq_status_history_no_update BEFORE UPDATE ON eq_status_history BEGIN SELECT RAISE(ABORT,'guard: Status tarixçəsi dəyişdirilmir.'); END;

CREATE TABLE eq_product_map(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  direction TEXT NOT NULL CHECK(direction IN('sale','purchase')),
  tax_id TEXT NOT NULL DEFAULT '',
  dvx_code TEXT NOT NULL DEFAULT '',
  name_key TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL DEFAULT '',
  account TEXT NOT NULL DEFAULT '',
  expense_item_id TEXT NOT NULL DEFAULT '',
  income_type_id TEXT NOT NULL DEFAULT '',
  vat_treatment TEXT NOT NULL DEFAULT '' CHECK(vat_treatment IN('','offset','cost')),
  contract_id TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'suggest' CHECK(mode IN('suggest','auto')),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  uses INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,id)
);
CREATE UNIQUE INDEX eq_product_map_key ON eq_product_map(company_id,direction,tax_id,dvx_code,name_key) WHERE archived=0;
CREATE TRIGGER eq_product_map_no_delete BEFORE DELETE ON eq_product_map BEGIN SELECT RAISE(ABORT,'guard: Uyğunluq silinmir; arxivləşdirilir.'); END;

ALTER TABLE invoices ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN('manual','eqaime'));
ALTER TABLE invoices ADD COLUMN eq_document_id TEXT;

INSERT INTO audit(company_id,at,actor,correlation_id,action,entity,entity_id,detail)
  SELECT id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system','migration-10','Yeniləndi','Baza',id,
  'DVX e-qaimələri üçün baza hazırlandı: yüklənmələr, e-qaimə qutusu, status tarixçəsi, uyğunluq xəritəsi.'
  FROM companies;
`;

// ---------------------------------------------------------------------------------------------
// v11 — cash (stage 5a; docs/MERHELE-5-AY-BAGLANISI.md §3.1–3.2). A cashbox becomes a catalog of
// its own, bound to one ledger account (221.01 / 221.02 / 221.04) and currency like a bank
// account. The former "cashbox" items move over with the same ids, so every posting made on them
// stays valid; the account is the 221 account the cashbox was used on most (221.01 when unused,
// 221 itself in a company whose 221 was never split).

const v11 = `
CREATE TABLE cashboxes(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  account TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AZN',
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id,id),
  UNIQUE(company_id,name),
  FOREIGN KEY(company_id,account) REFERENCES accounts(company_id,code)
);
CREATE TRIGGER cashboxes_no_delete BEFORE DELETE ON cashboxes BEGIN SELECT RAISE(ABORT,'guard: Kassa silinmir; arxivləşdirilir.'); END;

INSERT INTO cashboxes(id,company_id,name,account,currency,archived,version)
  SELECT i.id, i.company_id, i.name, u.account,
    CASE WHEN a.currency=1 THEN COALESCE(
      (SELECT dt_currency FROM postings WHERE company_id=i.company_id AND dt_account=u.account AND dt_s1=i.id AND dt_currency<>'' LIMIT 1),
      (SELECT kt_currency FROM postings WHERE company_id=i.company_id AND kt_account=u.account AND kt_s1=i.id AND kt_currency<>'' LIMIT 1),
      'USD') ELSE 'AZN' END,
    i.archived, i.version
  FROM items i
  JOIN (SELECT x.id, x.company_id, COALESCE(
      (SELECT r.account FROM registers r WHERE r.company_id=x.company_id AND r.s1=x.id AND r.account LIKE '221%'
        GROUP BY r.account ORDER BY SUM(r.debit+r.credit) DESC, r.account LIMIT 1),
      (SELECT code FROM accounts WHERE company_id=x.company_id AND code IN('221.01','221')
        ORDER BY code DESC LIMIT 1)) AS account
    FROM items x WHERE x.kind='cashbox') u ON u.id=i.id
  JOIN accounts a ON a.company_id=i.company_id AND a.code=u.account
  WHERE i.kind='cashbox';
DROP TRIGGER items_no_delete;
DELETE FROM items WHERE kind='cashbox';
CREATE TRIGGER items_no_delete BEFORE DELETE ON items BEGIN SELECT RAISE(ABORT,'guard: Kitabça elementi silinmir; arxivləşdirilir.'); END;

CREATE TABLE cash_documents(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  direction TEXT NOT NULL CHECK(direction IN('in','out')),
  number TEXT NOT NULL,
  number_key TEXT NOT NULL,
  date TEXT NOT NULL,
  cashbox_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  rate INTEGER NOT NULL CHECK(rate>0),
  amount INTEGER NOT NULL CHECK(amount>0),
  amount_azn INTEGER NOT NULL CHECK(amount_azn>0),
  counterparty_name TEXT NOT NULL DEFAULT '',
  basis TEXT NOT NULL DEFAULT '',
  attachment TEXT NOT NULL DEFAULT '',
  lines TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('posted','cancelled')),
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,id),
  UNIQUE(company_id,direction,number_key),
  FOREIGN KEY(company_id,cashbox_id) REFERENCES cashboxes(company_id,id)
);
CREATE INDEX cash_documents_date ON cash_documents(company_id,direction,date);
CREATE INDEX cash_documents_cashbox ON cash_documents(company_id,cashbox_id,date);
CREATE TRIGGER cash_documents_no_delete BEFORE DELETE ON cash_documents BEGIN SELECT RAISE(ABORT,'guard: Sənəd silinmir; ləğv edilir.'); END;
CREATE TRIGGER cash_documents_period BEFORE UPDATE ON cash_documents
WHEN OLD.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id)
  OR NEW.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id)
BEGIN SELECT RAISE(ABORT,'guard: Bu tarix üzrə uçot dövrü bağlanıb.'); END;

INSERT INTO audit(company_id,at,actor,correlation_id,action,entity,entity_id,detail)
  SELECT id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system','migration-11','Yeniləndi','Baza',id,
  'Kassa sənədləri üçün baza hazırlandı: kassalar ayrıca kitabçaya köçürüldü (eyni id-lərlə).'
  FROM companies;
`;

export const migrations: { version: number; sql: string; foreignKeysOff?: boolean }[] = [
  { version: 1, sql: v1 },
  { version: 2, sql: v2, foreignKeysOff: true },
  { version: 3, sql: v3, foreignKeysOff: true },
  { version: 4, sql: v4 },
  { version: 5, sql: v5 },
  { version: 6, sql: v6 },
  { version: 7, sql: v7 },
  { version: 8, sql: v8, foreignKeysOff: true },
  { version: 9, sql: v9 },
  { version: 10, sql: v10 },
  { version: 11, sql: v11 },
];
