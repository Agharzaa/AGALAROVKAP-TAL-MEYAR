import { backup, DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { DomainError } from '../../domain/errors.js';
import { migrations, SCHEMA_VERSION } from './schema.js';

export type Row = Record<string, string | bigint | null>;
export type Param = string | bigint | number | null;

/**
 * Thin, synchronous SQLite wrapper. Integers are always read as bigint so money and quantities
 * never pass through floating point. Statements are cached per SQL text.
 */
export class Db {
  readonly raw: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;
  constructor(path: string, options: { readOnly?: boolean } = {}) {
    this.raw = new DatabaseSync(path, { readOnly: !!options.readOnly });
    try {
      if (options.readOnly) {
        // A second, read-only connection (integrity checks) beside the writer; WAL lets it read
        // a consistent snapshot without blocking or being blocked.
        this.raw.exec('PRAGMA busy_timeout=5000; PRAGMA query_only=1;');
        return;
      }
      this.raw.exec(
        'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;',
      );
      this.migrate();
    } catch (error) {
      this.raw.close();
      throw error;
    }
  }
  private statement(sql: string): StatementSync {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      s.setReadBigInts(true);
      this.statements.set(sql, s);
    }
    return s;
  }
  get<T extends Row = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.statement(sql).get(...(params as SQLInputValue[])) as T | undefined;
  }
  all<T extends Row = Row>(sql: string, ...params: Param[]): T[] {
    return this.statement(sql).all(...(params as SQLInputValue[])) as T[];
  }
  run(sql: string, ...params: Param[]) {
    return this.statement(sql).run(...(params as SQLInputValue[]));
  }
  version(): number {
    return Number(
      (this.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    );
  }
  /** Write transaction (BEGIN IMMEDIATE); nested calls join the outer transaction. */
  write<T>(fn: () => T): T {
    return this.transaction('BEGIN IMMEDIATE', fn);
  }
  /** Read transaction: every SELECT inside sees one consistent snapshot. */
  read<T>(fn: () => T): T {
    return this.transaction('BEGIN DEFERRED', fn);
  }
  private transaction<T>(begin: string, fn: () => T): T {
    if (this.depth > 0) return fn();
    this.raw.exec(begin);
    this.depth++;
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw translate(error);
    } finally {
      this.depth--;
    }
  }
  private migrate() {
    const current = this.version();
    if (current > SCHEMA_VERSION)
      throw new DomainError(
        'Bu baza Meyar-ın daha yeni versiyası ilə yaradılıb. Proqramı yeniləyin; baza dəyişdirilmədi.',
        undefined,
        'conflict',
      );
    for (const m of migrations.filter((m) => m.version > current)) {
      // Table rebuilds follow SQLite's procedure: foreign keys off outside the transaction,
      // integrity checked inside it before commit, foreign keys back on afterwards.
      if (m.foreignKeysOff) this.raw.exec('PRAGMA foreign_keys=OFF');
      try {
        this.write(() => {
          this.raw.exec(m.sql);
          if (m.foreignKeysOff) {
            const broken = this.raw.prepare('PRAGMA foreign_key_check').all();
            if (broken.length)
              throw new Error(`Miqrasiya ${m.version}: ${broken.length} əlaqə pozulub.`);
          }
          this.raw.exec(`PRAGMA user_version=${m.version}`);
        });
      } finally {
        if (m.foreignKeysOff) this.raw.exec('PRAGMA foreign_keys=ON');
      }
    }
  }
  /** Consistent online copy through SQLite's backup API (never a raw file copy). */
  async backup(target: string): Promise<void> {
    await backup(this.raw, target);
  }
  close() {
    this.statements.clear();
    this.raw.close();
  }
}

/** Database guard messages become user-facing domain errors; anything else stays a bug. */
function translate(error: unknown): unknown {
  if (error instanceof DomainError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const guard = /guard: (.+)$/.exec(message);
  if (guard) return new DomainError(guard[1]!, undefined, 'conflict');
  if (/FOREIGN KEY constraint failed/.test(message))
    return new DomainError('Əlaqəli məlumat bu şirkətdə tapılmadı.', undefined, 'conflict');
  if (/UNIQUE constraint failed/.test(message))
    return new DomainError('Bu məlumat artıq mövcuddur.', undefined, 'conflict');
  return error;
}
