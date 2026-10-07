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
export const SCHEMA_VERSION = 1;

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

export const migrations: { version: number; sql: string; foreignKeysOff?: boolean }[] = [
  { version: 1, sql: v1 },
];
