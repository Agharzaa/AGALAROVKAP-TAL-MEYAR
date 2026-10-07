import { createHash } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import { commandSchema, type Command, type CommandResult } from '../contracts/commands.js';
import { querySchema } from '../contracts/queries.js';
import type { Db } from '../infrastructure/sqlite/db.js';
import {
  closePeriod,
  createAccount,
  createCompany,
  saveBankAccount,
  saveContract,
  saveEmployee,
  saveItem,
  savePartner,
  saveProduct,
  updateAccount,
  updateCompany,
} from './catalog.js';
import { cancelOperation, saveOperation } from './operations.js';
import { runQuery } from './reports.js';
import { systemClock, Tx, type Clock, type Context } from './tx.js';

/**
 * The single entry point for changes. Each command is validated, de-duplicated by its
 * idempotency key and executed inside one write transaction: either every effect — document,
 * journal, registers, history and audit — is stored, or none is.
 */
export class Ledger {
  constructor(
    readonly db: Db,
    readonly clock: Clock = systemClock,
  ) {}

  execute(input: unknown, ctx: Context): CommandResult {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DomainError(
        `Sorğu düzgün deyil${issue ? `: ${issue.path.join('.') || 'əməliyyat'}` : ''}.`,
        issue?.path.join('.'),
      );
    }
    const command = parsed.data;
    const { key, ...request } = command;
    const scope = 'companyId' in command ? command.companyId : '*';
    const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    return this.db.write(() => {
      const previous = this.db.get('SELECT * FROM idempotency WHERE scope=? AND key=?', scope, key);
      if (previous) {
        if (previous.request_hash !== hash)
          throw new DomainError(
            'Bu sorğu açarı başqa məzmunla artıq istifadə olunub. Pəncərəni yenidən açın.',
            undefined,
            'conflict',
          );
        return { ...(JSON.parse(String(previous.result)) as CommandResult), replayed: true };
      }
      const result = this.dispatch(new Tx(this.db, ctx, this.clock), command);
      this.db.run(
        'INSERT INTO idempotency VALUES(?,?,?,?,?)',
        scope,
        key,
        hash,
        JSON.stringify(result),
        this.clock.now(),
      );
      return result;
    });
  }

  query(input: unknown): unknown {
    const parsed = querySchema.safeParse(input);
    if (!parsed.success) throw new DomainError('Sorğu düzgün deyil.');
    return this.db.read(() => runQuery(this.db, parsed.data, this.clock.today(), this.clock.now()));
  }

  private dispatch(tx: Tx, c: Command): CommandResult {
    switch (c.type) {
      case 'company.create':
        return createCompany(tx, c);
      case 'company.update':
        return updateCompany(tx, c);
      case 'account.create':
        return createAccount(tx, c);
      case 'account.update':
        return updateAccount(tx, c);
      case 'partner.save':
        return savePartner(tx, c);
      case 'contract.save':
        return saveContract(tx, c);
      case 'bankAccount.save':
        return saveBankAccount(tx, c);
      case 'product.save':
        return saveProduct(tx, c);
      case 'employee.save':
        return saveEmployee(tx, c);
      case 'item.save':
        return saveItem(tx, c);
      case 'operation.save':
        return saveOperation(tx, c);
      case 'operation.cancel':
        return cancelOperation(tx, c);
      case 'period.close':
        return closePeriod(tx, c);
    }
  }
}
