import { randomUUID } from 'node:crypto';
import { Chart, type Account, type SubkontoKind } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import type { Posting } from '../domain/posting.js';
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

export function toAccount(r: Row): Account {
  return {
    code: String(r.code),
    name: String(r.name),
    parentCode: r.parent_code === null ? null : String(r.parent_code),
    nature: r.nature as Account['nature'],
    subkonto: JSON.parse(String(r.subkonto)) as SubkontoKind[],
    quantitative: r.quantitative === 1n,
    currency: r.currency === 1n,
    system: r.system === 1n,
    archived: r.archived === 1n,
  };
}

export function loadChart(db: Db, companyId: string): Chart {
  return new Chart(db.all('SELECT * FROM accounts WHERE company_id=?', companyId).map(toAccount));
}

export function expectVersion(row: Row, expected: number | undefined, label: string) {
  if (expected === undefined || BigInt(expected) !== (row.version as bigint))
    throw new DomainError(
      `${label} başqa pəncərədə və ya başqa istifadəçi tərəfindən dəyişdirilib. Ən son versiyanı açıb dəyişikliyinizi yenidən edin.`,
      'version',
      'stale',
    );
}

export interface Source {
  type: string;
  id: string;
  number: string;
  version: number;
}

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
    return loadChart(this.db, companyId);
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
    type: string,
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
  /**
   * Appends one entry. The postings were checked by the domain rules and the subkonto values
   * against the catalogs; registers follow through the database triggers.
   */
  post(
    companyId: string,
    chart: Chart,
    source: Source,
    date: string,
    storno: boolean,
    postings: readonly Posting[],
  ) {
    const entryId = this.id();
    this.db.run(
      'INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?)',
      entryId,
      companyId,
      date,
      source.type,
      source.id,
      source.number,
      source.version,
      storno ? 1 : 0,
      this.clock.now(),
      this.ctx.actor,
    );
    postings.forEach((p, i) => {
      const dt = chart.get(p.dt.account)!;
      const kt = chart.get(p.kt.account)!;
      const qty = p.quantity ?? 0n;
      this.db.run(
        `INSERT INTO postings(entry_id,line_no,company_id,date,dt_account,dt_s1,dt_s2,dt_s3,kt_account,kt_s1,kt_s2,kt_s3,
           amount,dt_qty,kt_qty,dt_currency,dt_cur,kt_currency,kt_cur,memo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        entryId,
        i + 1,
        companyId,
        date,
        p.dt.account,
        p.dt.sk[0] ?? '',
        p.dt.sk[1] ?? '',
        p.dt.sk[2] ?? '',
        p.kt.account,
        p.kt.sk[0] ?? '',
        p.kt.sk[1] ?? '',
        p.kt.sk[2] ?? '',
        p.amount,
        dt.quantitative ? qty : 0n,
        kt.quantitative ? qty : 0n,
        p.dt.currency ?? '',
        p.dt.curAmount ?? 0n,
        p.kt.currency ?? '',
        p.kt.curAmount ?? 0n,
        p.memo,
      );
    });
    return entryId;
  }
  /** Postings of the latest non-storno entry of a document version. */
  entryPostings(
    companyId: string,
    type: string,
    id: string,
    version: number,
  ): { date: string; postings: Posting[] } {
    const entry = this.db.get(
      'SELECT id,date FROM entries WHERE company_id=? AND source_type=? AND source_id=? AND source_version=? AND storno=0',
      companyId,
      type,
      id,
      version,
    );
    if (!entry) throw new DomainError('Sənədin yazılışı tapılmadı.', undefined, 'not-found');
    return {
      date: String(entry.date),
      postings: this.db
        .all('SELECT * FROM postings WHERE entry_id=? ORDER BY line_no', String(entry.id))
        .map(rowToPosting),
    };
  }
}

const trimSk = (...values: unknown[]) => {
  const list = values.map((v) => String(v ?? ''));
  while (list.length && !list[list.length - 1]) list.pop();
  return list;
};

export function rowToPosting(r: Row): Posting {
  const qty = (r.dt_qty as bigint) || (r.kt_qty as bigint);
  return {
    dt: {
      account: String(r.dt_account),
      sk: trimSk(r.dt_s1, r.dt_s2, r.dt_s3),
      ...(r.dt_currency
        ? { currency: String(r.dt_currency) as never, curAmount: r.dt_cur as bigint }
        : {}),
    },
    kt: {
      account: String(r.kt_account),
      sk: trimSk(r.kt_s1, r.kt_s2, r.kt_s3),
      ...(r.kt_currency
        ? { currency: String(r.kt_currency) as never, curAmount: r.kt_cur as bigint }
        : {}),
    },
    amount: r.amount as bigint,
    ...(qty ? { quantity: qty } : {}),
    memo: String(r.memo),
  };
}
