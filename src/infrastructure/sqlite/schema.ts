/**
 * Versioned schema. Each migration runs once in its own transaction; user_version records the
 * applied version and a newer database is refused by an older program.
 *
 * Tenant isolation is structural: every child row references its parent through the composite
 * key (company_id, id), so a document of company A cannot point at a partner, product,
 * warehouse or account of company B even if application checks were bypassed.
 */
export const SCHEMA_VERSION = 2;

const v1 = `
CREATE TABLE companies(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tax_id TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'AZN' CHECK(currency='AZN'),
  closed_through TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE partners(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  tax_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id,tax_id),
  UNIQUE(company_id,id)
);
CREATE TABLE accounts(
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_code TEXT,
  nature TEXT NOT NULL CHECK(nature IN('active','passive','active-passive')),
  analytics TEXT NOT NULL,
  quantitative INTEGER NOT NULL CHECK(quantitative IN(0,1)),
  system INTEGER NOT NULL CHECK(system IN(0,1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  PRIMARY KEY(company_id,code),
  FOREIGN KEY(company_id,parent_code) REFERENCES accounts(company_id,code)
);
CREATE TABLE expense_items(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE(company_id,name),
  UNIQUE(company_id,id)
);
CREATE TABLE warehouses(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  UNIQUE(company_id,name),
  UNIQUE(company_id,id)
);
CREATE TABLE units(
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY(company_id,code),
  UNIQUE(company_id,name)
);
CREATE TABLE products(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL DEFAULT '',
  base_unit TEXT NOT NULL,
  purchase_unit TEXT NOT NULL,
  factor INTEGER NOT NULL CHECK(typeof(factor)='integer' AND factor>0),
  account TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id,code),
  UNIQUE(company_id,id),
  FOREIGN KEY(company_id,base_unit) REFERENCES units(company_id,code),
  FOREIGN KEY(company_id,purchase_unit) REFERENCES units(company_id,code),
  FOREIGN KEY(company_id,account) REFERENCES accounts(company_id,code)
);
CREATE UNIQUE INDEX product_barcode ON products(company_id,barcode) WHERE barcode!='';
CREATE TABLE invoices(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  direction TEXT NOT NULL CHECK(direction IN('purchase','sale')),
  number TEXT NOT NULL,
  number_key TEXT NOT NULL,
  date TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('draft','posted','cancelled')),
  version INTEGER NOT NULL,
  net INTEGER NOT NULL CHECK(typeof(net)='integer' AND net>=0),
  vat INTEGER NOT NULL CHECK(typeof(vat)='integer' AND vat>=0),
  note TEXT NOT NULL DEFAULT '',
  lines TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,direction,partner_id,number_key),
  UNIQUE(company_id,id),
  FOREIGN KEY(company_id,partner_id) REFERENCES partners(company_id,id)
);
CREATE INDEX invoices_list ON invoices(company_id,direction,date);
CREATE TABLE payments(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  direction TEXT NOT NULL CHECK(direction IN('in','out')),
  bank_account TEXT NOT NULL,
  reference TEXT NOT NULL,
  reference_key TEXT NOT NULL,
  date TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
  status TEXT NOT NULL CHECK(status IN('posted','cancelled')),
  version INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,direction,bank_account,reference_key),
  UNIQUE(company_id,id),
  FOREIGN KEY(company_id,partner_id) REFERENCES partners(company_id,id),
  FOREIGN KEY(company_id,bank_account) REFERENCES accounts(company_id,code)
);
CREATE INDEX payments_list ON payments(company_id,direction,date);
CREATE TABLE allocations(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  payment_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
  status TEXT NOT NULL CHECK(status IN('active','cancelled')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(company_id,payment_id) REFERENCES payments(company_id,id),
  FOREIGN KEY(company_id,invoice_id) REFERENCES invoices(company_id,id)
);
CREATE INDEX allocations_invoice ON allocations(company_id,invoice_id,status);
CREATE INDEX allocations_payment ON allocations(company_id,payment_id,status);
CREATE TABLE document_history(
  company_id TEXT NOT NULL REFERENCES companies(id),
  source_type TEXT NOT NULL CHECK(source_type IN('invoice','payment')),
  source_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  PRIMARY KEY(source_type,source_id,version)
);
CREATE TABLE journal_entries(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  date TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN('invoice','payment')),
  source_id TEXT NOT NULL,
  source_number TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  reversal INTEGER NOT NULL CHECK(reversal IN(0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(company_id,source_type,source_id,source_version,reversal),
  UNIQUE(company_id,id)
);
CREATE INDEX journal_date ON journal_entries(company_id,date);
CREATE TABLE journal_lines(
  entry_id TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  company_id TEXT NOT NULL,
  account TEXT NOT NULL,
  debit INTEGER NOT NULL CHECK(typeof(debit)='integer' AND debit>=0),
  credit INTEGER NOT NULL CHECK(typeof(credit)='integer' AND credit>=0),
  partner_id TEXT,
  warehouse_id TEXT,
  product_id TEXT,
  expense_item_id TEXT,
  quantity INTEGER CHECK(quantity IS NULL OR typeof(quantity)='integer'),
  memo TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(entry_id,line_no),
  CHECK(NOT(debit>0 AND credit>0)),
  CHECK(debit>0 OR credit>0 OR quantity IS NOT NULL),
  FOREIGN KEY(company_id,entry_id) REFERENCES journal_entries(company_id,id),
  FOREIGN KEY(company_id,account) REFERENCES accounts(company_id,code),
  FOREIGN KEY(company_id,partner_id) REFERENCES partners(company_id,id),
  FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id),
  FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
  FOREIGN KEY(company_id,expense_item_id) REFERENCES expense_items(company_id,id)
);
CREATE INDEX journal_lines_account ON journal_lines(company_id,account);
CREATE INDEX journal_lines_partner ON journal_lines(company_id,partner_id);
CREATE INDEX journal_lines_stock ON journal_lines(company_id,product_id,warehouse_id,account);
CREATE TABLE audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX audit_company ON audit(company_id,id);
CREATE TABLE idempotency(
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY(scope,key)
);

-- Ledger history is append-only.
CREATE TRIGGER journal_entries_no_update BEFORE UPDATE ON journal_entries BEGIN SELECT RAISE(ABORT,'guard: Jurnal yazılışı dəyişdirilə bilməz.'); END;
CREATE TRIGGER journal_entries_no_delete BEFORE DELETE ON journal_entries BEGIN SELECT RAISE(ABORT,'guard: Jurnal yazılışı silinə bilməz.'); END;
CREATE TRIGGER journal_lines_no_update BEFORE UPDATE ON journal_lines BEGIN SELECT RAISE(ABORT,'guard: Jurnal sətri dəyişdirilə bilməz.'); END;
CREATE TRIGGER journal_lines_no_delete BEFORE DELETE ON journal_lines BEGIN SELECT RAISE(ABORT,'guard: Jurnal sətri silinə bilməz.'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'guard: Audit dəyişdirilə bilməz.'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'guard: Audit silinə bilməz.'); END;
CREATE TRIGGER history_no_update BEFORE UPDATE ON document_history BEGIN SELECT RAISE(ABORT,'guard: Sənəd tarixçəsi dəyişdirilə bilməz.'); END;
CREATE TRIGGER history_no_delete BEFORE DELETE ON document_history BEGIN SELECT RAISE(ABORT,'guard: Sənəd tarixçəsi silinə bilməz.'); END;

-- Closed periods: nothing is posted on or before the closing date, and closing never moves back.
CREATE TRIGGER journal_period BEFORE INSERT ON journal_entries
WHEN NEW.date<=(SELECT closed_through FROM companies WHERE id=NEW.company_id)
BEGIN SELECT RAISE(ABORT,'guard: Bu tarix üzrə uçot dövrü bağlanıb.'); END;
CREATE TRIGGER journal_lines_entry_company BEFORE INSERT ON journal_lines
WHEN NOT EXISTS(SELECT 1 FROM journal_entries WHERE id=NEW.entry_id AND company_id=NEW.company_id)
BEGIN SELECT RAISE(ABORT,'guard: Yazılış sətri başqa şirkətə aiddir.'); END;
CREATE TRIGGER company_period_forward BEFORE UPDATE OF closed_through ON companies
WHEN NEW.closed_through<OLD.closed_through
BEGIN SELECT RAISE(ABORT,'guard: Bağlanmış dövr bu versiyada açıla bilməz.'); END;
CREATE TRIGGER invoice_period BEFORE UPDATE ON invoices
WHEN OLD.status!='draft' AND (OLD.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id) OR NEW.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id))
BEGIN SELECT RAISE(ABORT,'guard: Bu tarix üzrə uçot dövrü bağlanıb.'); END;
CREATE TRIGGER payment_period BEFORE UPDATE ON payments
WHEN OLD.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id) OR NEW.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id)
BEGIN SELECT RAISE(ABORT,'guard: Bu tarix üzrə uçot dövrü bağlanıb.'); END;
CREATE TRIGGER invoice_no_delete BEFORE DELETE ON invoices WHEN OLD.status!='draft'
BEGIN SELECT RAISE(ABORT,'guard: Uçota alınmış qaimə silinmir; ləğv edin.'); END;
CREATE TRIGGER payment_no_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT,'guard: Ödəniş silinmir; ləğv edin.'); END;
CREATE TRIGGER company_immutable_identity BEFORE UPDATE OF id ON companies
BEGIN SELECT RAISE(ABORT,'guard: Şirkət identifikatoru dəyişmir.'); END;

-- Settlement register: linking never exceeds either side and never predates either document.
CREATE TRIGGER allocation_insert BEFORE INSERT ON allocations BEGIN
  SELECT CASE WHEN NEW.status!='active' THEN RAISE(ABORT,'guard: Yeni bağlantı aktiv olmalıdır.') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM payments p JOIN invoices i ON i.id=NEW.invoice_id
    WHERE p.id=NEW.payment_id AND p.status='posted' AND i.status='posted'
      AND i.partner_id=p.partner_id
      AND i.direction=CASE p.direction WHEN 'in' THEN 'sale' ELSE 'purchase' END)
    THEN RAISE(ABORT,'guard: Qaimə ödənişə uyğun deyil.') END;
  SELECT CASE WHEN NEW.date<(SELECT date FROM payments WHERE id=NEW.payment_id)
    OR NEW.date<(SELECT date FROM invoices WHERE id=NEW.invoice_id)
    THEN RAISE(ABORT,'guard: Bağlama tarixi sənəd tarixindən əvvəl ola bilməz.') END;
  SELECT CASE WHEN NEW.date<=(SELECT closed_through FROM companies WHERE id=NEW.company_id)
    THEN RAISE(ABORT,'guard: Bu tarix üzrə uçot dövrü bağlanıb.') END;
  SELECT CASE WHEN (SELECT COALESCE(SUM(amount),0) FROM allocations WHERE payment_id=NEW.payment_id AND status='active')+NEW.amount
    >(SELECT amount FROM payments WHERE id=NEW.payment_id)
    THEN RAISE(ABORT,'guard: Bağlanan məbləğ ödənişin qalığını aşır.') END;
  SELECT CASE WHEN (SELECT COALESCE(SUM(amount),0) FROM allocations WHERE invoice_id=NEW.invoice_id AND status='active')+NEW.amount
    >(SELECT net+vat FROM invoices WHERE id=NEW.invoice_id)
    THEN RAISE(ABORT,'guard: Bağlanan məbləğ qaimənin qalıq borcunu aşır.') END;
END;
CREATE TRIGGER allocation_update BEFORE UPDATE ON allocations BEGIN
  SELECT CASE WHEN OLD.status!='active' OR NEW.status!='cancelled' OR NEW.id!=OLD.id
    OR NEW.company_id!=OLD.company_id OR NEW.payment_id!=OLD.payment_id OR NEW.invoice_id!=OLD.invoice_id
    OR NEW.date!=OLD.date OR NEW.amount!=OLD.amount OR NEW.created_at!=OLD.created_at
    THEN RAISE(ABORT,'guard: Bağlantı yalnız ləğv edilə bilər.') END;
  SELECT CASE WHEN OLD.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id)
    THEN RAISE(ABORT,'guard: Bu tarix üzrə uçot dövrü bağlanıb.') END;
END;
CREATE TRIGGER allocation_no_delete BEFORE DELETE ON allocations
BEGIN SELECT RAISE(ABORT,'guard: Bağlantı silinmir; ləğv edin.'); END;
CREATE TRIGGER invoice_allocated BEFORE UPDATE OF status,net,vat,partner_id,direction,date ON invoices
WHEN EXISTS(SELECT 1 FROM allocations WHERE invoice_id=OLD.id AND status='active')
BEGIN SELECT RAISE(ABORT,'guard: Ödənişə bağlanmış qaimə dəyişdirilə bilməz; əvvəl bağlantını açın.'); END;
CREATE TRIGGER payment_allocated BEFORE UPDATE OF status,amount,partner_id,direction,date ON payments
WHEN EXISTS(SELECT 1 FROM allocations WHERE payment_id=OLD.id AND status='active')
BEGIN SELECT RAISE(ABORT,'guard: Əvvəl ödənişin qaimə bağlantıları ləğv edilməlidir.'); END;
`;


/**
 * v2 — bank operation kinds and bank statement import.
 * - Accounts the bank kinds post to are added to every existing company (222, 301, 511, 522,
 *   533, 611, 731); 521 becomes active-passive because overpaid tax is a debit balance.
 * - payments is rebuilt: partner_id becomes optional (tax, fee, transfer…), kind/counter_account/
 *   expense_item_id are added. Existing rows are stage-A settlements (211 / 531).
 * - Only settlement payments may be linked to invoices (allocation_insert).
 * - bank_statement_lines stages imported statement rows until they become payments.
 * Runs with foreign keys off (SQLite table-rebuild procedure) and is checked before commit.
 */
const v2 = `
INSERT OR IGNORE INTO accounts(company_id,code,name,parent_code,nature,analytics,quantitative,system,archived)
  SELECT id,'222','Yolda olan pul köçürmələri',NULL,'active','[]',0,1,0 FROM companies;
INSERT OR IGNORE INTO accounts(company_id,code,name,parent_code,nature,analytics,quantitative,system,archived)
  SELECT id,'301','Nominal (nizamnamə) kapital',NULL,'passive','["partner"]',0,1,0 FROM companies;
INSERT OR IGNORE INTO accounts(company_id,code,name,parent_code,nature,analytics,quantitative,system,archived)
  SELECT id,'511','Qısamüddətli bank kreditləri',NULL,'passive','["partner"]',0,1,0 FROM companies;
INSERT OR IGNORE INTO accounts(company_id,code,name,parent_code,nature,analytics,quantitative,system,archived)
  SELECT id,'522','Sosial sığorta və təminat üzrə öhdəliklər',NULL,'active-passive','[]',0,1,0 FROM companies;
INSERT OR IGNORE INTO accounts(company_id,code,name,parent_code,nature,analytics,quantitative,system,archived)
  SELECT id,'533','Əməyin ödənişi üzrə işçi heyətinə borclar',NULL,'active-passive','[]',0,1,0 FROM companies;
INSERT OR IGNORE INTO accounts(company_id,code,name,parent_code,nature,analytics,quantitative,system,archived)
  SELECT id,'611','Sair əməliyyat gəlirləri',NULL,'passive','[]',0,1,0 FROM companies;
INSERT OR IGNORE INTO accounts(company_id,code,name,parent_code,nature,analytics,quantitative,system,archived)
  SELECT id,'731','Sair əməliyyat xərcləri',NULL,'active','["expenseItem"]',0,1,0 FROM companies;
UPDATE accounts SET nature='active-passive' WHERE code='521' AND system=1;
INSERT OR IGNORE INTO expense_items(id,company_id,name)
  SELECT lower(hex(randomblob(16))),id,'Bank xidmətləri' FROM companies;

DROP TRIGGER allocation_insert;
CREATE TABLE payments_v2(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  direction TEXT NOT NULL CHECK(direction IN('in','out')),
  kind TEXT NOT NULL DEFAULT 'settlement' CHECK(kind IN('settlement','refund','capital','loan','tax','social','salary','transfer','fee','other')),
  bank_account TEXT NOT NULL,
  reference TEXT NOT NULL,
  reference_key TEXT NOT NULL,
  date TEXT NOT NULL,
  partner_id TEXT,
  counter_account TEXT NOT NULL,
  expense_item_id TEXT,
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
  status TEXT NOT NULL CHECK(status IN('posted','cancelled')),
  version INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(kind NOT IN('settlement','refund','capital','loan') OR partner_id IS NOT NULL),
  UNIQUE(company_id,direction,bank_account,reference_key),
  UNIQUE(company_id,id),
  FOREIGN KEY(company_id,partner_id) REFERENCES partners(company_id,id),
  FOREIGN KEY(company_id,bank_account) REFERENCES accounts(company_id,code),
  FOREIGN KEY(company_id,counter_account) REFERENCES accounts(company_id,code),
  FOREIGN KEY(company_id,expense_item_id) REFERENCES expense_items(company_id,id)
);
INSERT INTO payments_v2(id,company_id,direction,kind,bank_account,reference,reference_key,date,partner_id,counter_account,expense_item_id,amount,status,version,note,created_at,updated_at)
  SELECT id,company_id,direction,'settlement',bank_account,reference,reference_key,date,partner_id,
         CASE direction WHEN 'in' THEN '211' ELSE '531' END,NULL,amount,status,version,note,created_at,updated_at
  FROM payments;
DROP TABLE payments;
ALTER TABLE payments_v2 RENAME TO payments;
CREATE INDEX payments_list ON payments(company_id,direction,date);
CREATE INDEX payments_partner ON payments(company_id,partner_id,kind,status);
CREATE TRIGGER payment_period BEFORE UPDATE ON payments
WHEN OLD.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id) OR NEW.date<=(SELECT closed_through FROM companies WHERE id=OLD.company_id)
BEGIN SELECT RAISE(ABORT,'guard: Bu tarix üzrə uçot dövrü bağlanıb.'); END;
CREATE TRIGGER payment_no_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT,'guard: Ödəniş silinmir; ləğv edin.'); END;
CREATE TRIGGER payment_allocated BEFORE UPDATE OF status,amount,partner_id,direction,date,kind ON payments
WHEN EXISTS(SELECT 1 FROM allocations WHERE payment_id=OLD.id AND status='active')
BEGIN SELECT RAISE(ABORT,'guard: Əvvəl ödənişin qaimə bağlantıları ləğv edilməlidir.'); END;
CREATE TRIGGER allocation_insert BEFORE INSERT ON allocations BEGIN
  SELECT CASE WHEN NEW.status!='active' THEN RAISE(ABORT,'guard: Yeni bağlantı aktiv olmalıdır.') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM payments p JOIN invoices i ON i.id=NEW.invoice_id
    WHERE p.id=NEW.payment_id AND p.status='posted' AND i.status='posted' AND p.kind='settlement'
      AND i.partner_id=p.partner_id
      AND i.direction=CASE p.direction WHEN 'in' THEN 'sale' ELSE 'purchase' END)
    THEN RAISE(ABORT,'guard: Qaimə ödənişə uyğun deyil.') END;
  SELECT CASE WHEN NEW.date<(SELECT date FROM payments WHERE id=NEW.payment_id)
    OR NEW.date<(SELECT date FROM invoices WHERE id=NEW.invoice_id)
    THEN RAISE(ABORT,'guard: Bağlama tarixi sənəd tarixindən əvvəl ola bilməz.') END;
  SELECT CASE WHEN NEW.date<=(SELECT closed_through FROM companies WHERE id=NEW.company_id)
    THEN RAISE(ABORT,'guard: Bu tarix üzrə uçot dövrü bağlanıb.') END;
  SELECT CASE WHEN (SELECT COALESCE(SUM(amount),0) FROM allocations WHERE payment_id=NEW.payment_id AND status='active')+NEW.amount
    >(SELECT amount FROM payments WHERE id=NEW.payment_id)
    THEN RAISE(ABORT,'guard: Bağlanan məbləğ ödənişin qalığını aşır.') END;
  SELECT CASE WHEN (SELECT COALESCE(SUM(amount),0) FROM allocations WHERE invoice_id=NEW.invoice_id AND status='active')+NEW.amount
    >(SELECT net+vat FROM invoices WHERE id=NEW.invoice_id)
    THEN RAISE(ABORT,'guard: Bağlanan məbləğ qaimənin qalıq borcunu aşır.') END;
END;

CREATE TABLE bank_statement_lines(
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  bank_account TEXT NOT NULL,
  date TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN('in','out')),
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
  reference TEXT NOT NULL DEFAULT '',
  counterparty TEXT NOT NULL DEFAULT '',
  counterparty_tax_id TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL,
  source_file TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN('new','posted','ignored')),
  payment_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL,
  UNIQUE(company_id,bank_account,fingerprint),
  UNIQUE(company_id,id),
  FOREIGN KEY(company_id,bank_account) REFERENCES accounts(company_id,code),
  FOREIGN KEY(company_id,payment_id) REFERENCES payments(company_id,id),
  CHECK((status='posted')=(payment_id IS NOT NULL))
);
CREATE INDEX statement_list ON bank_statement_lines(company_id,bank_account,status,date);
CREATE INDEX statement_payment ON bank_statement_lines(company_id,payment_id);
CREATE TRIGGER statement_no_delete BEFORE DELETE ON bank_statement_lines
BEGIN SELECT RAISE(ABORT,'guard: Bank çıxarışının sətri silinmir; keçin.'); END;
`;

export const migrations: { version: number; sql: string; foreignKeysOff?: boolean }[] = [
  { version: 1, sql: v1 },
  { version: 2, sql: v2, foreignKeysOff: true },
];
