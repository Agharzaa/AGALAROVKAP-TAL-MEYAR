import { createHash } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import { commandSchema, type Command, type CommandResult } from '../contracts/commands.js';
import { querySchema } from '../contracts/queries.js';
import type { Db } from '../infrastructure/sqlite/db.js';
import {
  createAccount,
  createCompany,
  saveNamed,
  savePartner,
  saveProduct,
  saveUnit,
} from './catalog.js';
import { cancelInvoice, saveInvoice } from './invoices.js';
import { ignoreStatement, importStatement, postStatement } from './statements.js';
import {
  autoAllocateCommand,
  cancelAllocation,
  cancelPayment,
  closePeriod,
  createAllocations,
  savePayment,
} from './payments.js';
import { runQuery } from './reports.js';
import { systemClock, Tx, type Clock, type Context } from './tx.js';

/**
 * The single entry point for changes. Each command is validated, de-duplicated by its
 * idempotency key and executed inside one write transaction: either every effect — document,
 * journal, settlement, history and audit — is stored, or none is.
 */
export class Ledger {
  constructor(
    readonly db: Db,
    private readonly clock: Clock = systemClock,
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
    return this.db.read(() => runQuery(this.db, parsed.data));
  }

  private dispatch(tx: Tx, c: Command): CommandResult {
    switch (c.type) {
      case 'company.create':
        return createCompany(tx, c);
      case 'partner.save':
        return savePartner(tx, c);
      case 'account.create':
        return createAccount(tx, c);
      case 'expenseItem.save':
        return saveNamed(tx, 'expense_items', 'Xərc maddəsi', c);
      case 'warehouse.save':
        return saveNamed(tx, 'warehouses', 'Anbar', c);
      case 'unit.save':
        return saveUnit(tx, c);
      case 'product.save':
        return saveProduct(tx, c);
      case 'invoice.save':
        return saveInvoice(tx, c);
      case 'invoice.cancel':
        return cancelInvoice(tx, c);
      case 'payment.save':
        return savePayment(tx, c);
      case 'payment.cancel':
        return cancelPayment(tx, c);
      case 'allocation.create':
        return createAllocations(tx, c);
      case 'allocation.cancel':
        return cancelAllocation(tx, c);
      case 'allocation.auto':
        return autoAllocateCommand(tx, c);
      case 'bankStatement.import':
        return importStatement(tx, c);
      case 'bankStatement.post':
        return postStatement(tx, c);
      case 'bankStatement.ignore':
        return ignoreStatement(tx, c);
      case 'period.close':
        return closePeriod(tx, c);
    }
  }
}
