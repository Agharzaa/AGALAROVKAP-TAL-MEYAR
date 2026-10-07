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
export const SCHEMA_VERSION = 4;

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
UPDATE items SET role='vatTax' WHERE kind='paymentKind' AND name='Vergi (haqq)';
UPDATE items SET role='defaultProductGroup' WHERE kind='productGroup' AND name='Əsas nomenklatura qrupu';
UPDATE items SET role='goodsIncome' WHERE kind='incomeType' AND name='Məhsul satışı';
UPDATE items SET role='serviceIncome' WHERE kind='incomeType' AND name='Xidmət satışı';
UPDATE items SET role='cogs' WHERE kind='expenseItem' AND name='Satılmış malların maya dəyəri';
INSERT INTO items(id,company_id,kind,name,role)
  SELECT ${uuid},id,'expenseItem','Satılmış malların maya dəyəri','cogs'
  FROM (SELECT hex(randomblob(16)) AS h, id FROM companies c
    WHERE NOT EXISTS(SELECT 1 FROM items i WHERE i.company_id=c.id AND i.role='cogs'));

INSERT INTO audit(company_id,at,actor,correlation_id,action,entity,entity_id,detail)
  SELECT id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system','migration-4','Yeniləndi','Baza',id,
  'Qaimələr üçün baza hazırlandı: qaimə cədvəli, kitabça rolları, nomenklatura qrupu, FIFO indeksləri.'
  FROM companies;
`;

export const migrations: { version: number; sql: string; foreignKeysOff?: boolean }[] = [
  { version: 1, sql: v1 },
  { version: 2, sql: v2, foreignKeysOff: true },
  { version: 3, sql: v3, foreignKeysOff: true },
  { version: 4, sql: v4 },
];
