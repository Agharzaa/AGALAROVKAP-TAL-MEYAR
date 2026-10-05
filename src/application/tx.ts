import { randomUUID } from 'node:crypto';
import { Chart, type Account, type AnalyticKind } from '../domain/accounts.js';
import { DomainError } from '../domain/errors.js';
import type { JournalLine } from '../domain/posting.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';

export interface Clock {
  /** ISO timestamp. */
  now(): string;
  /** Local calendar date YYYY-MM-DD. */
  today(): string;
}
export const systemClock: Clock = {
  now: () => new Date().toISOString(),
  today: () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
};
export interface Context {
  actor: string;
  correlationId: string;
}

export type SourceType = 'invoice' | 'payment';

/** Everything a command handler may touch, scoped to one write transaction. */
export class Tx {
  constructor(
    readonly db: Db,
    readonly ctx: Context,
    readonly clock: Clock,
  ) {}
  id(): string {
    return randomUUID();
  }
  company(companyId: string): Row {
    const company = this.db.get('SELECT * FROM companies WHERE id=?', companyId);
    if (!company) throw new DomainError('Şirkət tapılmadı.', 'companyId', 'not-found');
    return company;
  }
  chart(companyId: string): Chart {
    return new Chart(
      this.db.all('SELECT * FROM accounts WHERE company_id=?', companyId).map(toAccount),
    );
  }
  /** Refuses dates on or before the company's closing date. */
  open(companyId: string, date: string, field = 'date') {
    const closed = String(this.company(companyId).closed_through);
    if (date <= closed)
      throw new DomainError(
        `Uçot dövrü ${closed} tarixinədək bağlanıb; ${date} tarixli dəyişiklik edilə bilməz.`,
        field,
        'closed-period',
      );
  }
  partner(companyId: string, partnerId: string): Row {
    const p = this.db.get(
      'SELECT * FROM partners WHERE company_id=? AND id=?',
      companyId,
      partnerId,
    );
    if (!p) throw new DomainError('Bu şirkətdə kontragent tapılmadı.', 'partnerId', 'not-found');
    return p;
  }
  audit(companyId: string, action: string, entity: string, entityId: string, detail: string) {
    this.db.run(
      'INSERT INTO audit(company_id,at,actor,correlation_id,action,entity,entity_id,detail) VALUES(?,?,?,?,?,?,?,?)',
      companyId,
      this.clock.now(),
      this.ctx.actor,
      this.ctx.correlationId,
      action,
      entity,
      entityId,
      detail,
    );
  }
  history(
    companyId: string,
    type: SourceType,
    id: string,
    version: number,
    status: string,
    payload: unknown,
  ) {
    this.db.run(
      'INSERT INTO document_history VALUES(?,?,?,?,?,?,?,?)',
      companyId,
      type,
      id,
      version,
      status,
      JSON.stringify(payload),
      this.clock.now(),
      this.ctx.actor,
    );
  }
  /** Appends one balanced entry; the lines were validated by the domain posting rules. */
  post(
    companyId: string,
    source: { type: SourceType; id: string; number: string; version: number },
    date: string,
    reversal: boolean,
    lines: readonly JournalLine[],
  ) {
    const entryId = this.id();
    this.db.run(
      'INSERT INTO journal_entries VALUES(?,?,?,?,?,?,?,?,?)',
      entryId,
      companyId,
      date,
      source.type,
      source.id,
      source.number,
      source.version,
      reversal ? 1 : 0,
      this.clock.now(),
    );
    lines.forEach((l, i) =>
      this.db.run(
        'INSERT INTO journal_lines VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        entryId,
        i + 1,
        companyId,
        l.account,
        l.debit,
        l.credit,
        l.partnerId ?? null,
        l.warehouseId ?? null,
        l.productId ?? null,
        l.expenseItemId ?? null,
        l.quantity ?? null,
        l.memo,
      ),
    );
  }
  /** Lines of the original (non-reversal) entry of one document version. */
  entryLines(
    companyId: string,
    type: SourceType,
    id: string,
    version: number,
  ): { date: string; lines: JournalLine[] } {
    const entry = this.db.get(
      'SELECT id,date FROM journal_entries WHERE company_id=? AND source_type=? AND source_id=? AND source_version=? AND reversal=0',
      companyId,
      type,
      id,
      version,
    );
    if (!entry) throw new DomainError('Sənədin ilkin yazılışı tapılmadı.', undefined, 'not-found');
    const lines = this.db
      .all('SELECT * FROM journal_lines WHERE entry_id=? ORDER BY line_no', String(entry.id))
      .map((r): JournalLine => ({
        account: String(r.account),
        debit: r.debit as bigint,
        credit: r.credit as bigint,
        ...(r.partner_id ? { partnerId: String(r.partner_id) } : {}),
        ...(r.warehouse_id ? { warehouseId: String(r.warehouse_id) } : {}),
        ...(r.product_id ? { productId: String(r.product_id) } : {}),
        ...(r.expense_item_id ? { expenseItemId: String(r.expense_item_id) } : {}),
        ...(r.quantity !== null ? { quantity: r.quantity as bigint } : {}),
        memo: String(r.memo),
      }));
    return { date: String(entry.date), lines };
  }
}

export function toAccount(r: Row): Account {
  return {
    code: String(r.code),
    name: String(r.name),
    parentCode: r.parent_code === null ? null : String(r.parent_code),
    nature: r.nature as Account['nature'],
    analytics: JSON.parse(String(r.analytics)) as AnalyticKind[],
    quantitative: r.quantitative === 1n,
    system: r.system === 1n,
    archived: r.archived === 1n,
  };
}

export function expectVersion(row: Row, expected: number | undefined, label: string) {
  if (expected === undefined || BigInt(expected) !== (row.version as bigint))
    throw new DomainError(
      `${label} başqa pəncərədə və ya istifadəçi tərəfindən dəyişdirilib. Ən son versiyanı açıb dəyişikliyinizi yenidən tətbiq edin.`,
      'version',
      'stale',
    );
}
