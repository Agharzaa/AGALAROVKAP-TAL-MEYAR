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
  saveCashbox,
  saveContract,
  saveEmployee,
  saveItem,
  savePartner,
  saveProduct,
  updateAccount,
  updateCompany,
} from './catalog.js';
import { cancelBankDocument, saveBankDocument } from './bank.js';
import { pairBankDocuments } from './bank-pair.js';
import { cancelCashDocument, saveCashDocument } from './cash.js';
import { saveRates } from './rates.js';
import { cancelRevaluation, postRevaluation } from './revaluation.js';
import { cancelClosing, postClosing } from './closing.js';
import { applyRules, applyStatementRules, saveBudgetCode, saveRule } from './rules.js';
import {
  ignoreStatementLine,
  importStatement,
  linkStatementLine,
  restoreStatementLine,
} from './statements.js';
import { cancelInvoice, saveInvoice } from './invoices.js';
import { ignoreEq, importEq, recordDvxSync, resolveEq, restoreEq } from './eqaime.js';
import { applyEq, bulkEqMap, createEqPartners, learnEq, linkEq, saveEqMap } from './eqaime-book.js';
import { cancelOperation, saveOperation } from './operations.js';
import { cancelAssetDocument, saveAssetDocument, saveFixedAsset } from './assets.js';
import { closingControls, runQuery } from './reports.js';
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
      case 'cashbox.save':
        return saveCashbox(tx, c);
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
      case 'invoice.save':
        return saveInvoice(tx, c);
      case 'invoice.cancel':
        return cancelInvoice(tx, c);
      case 'bank.save':
        return saveBankDocument(tx, c);
      case 'bank.cancel':
        return cancelBankDocument(tx, c);
      case 'rates.save':
        return saveRates(tx, c);
      case 'revaluation.post':
        return postRevaluation(tx, c);
      case 'revaluation.cancel':
        return cancelRevaluation(tx, c);
      case 'closing.post':
        return postClosing(tx, c, closingControls(tx.db, c.companyId));
      case 'closing.cancel':
        return cancelClosing(tx, c);
      case 'cash.save':
        return saveCashDocument(tx, c);
      case 'cash.cancel':
        return cancelCashDocument(tx, c);
      case 'bank.pair':
        return pairBankDocuments(tx, c.companyId, c.id, c.pairId);
      case 'statement.import': {
        // New rows that an "auto" rule recognises are posted right away (each on its own).
        const loaded = importStatement(tx, c);
        const auto = applyRules(tx, c.companyId, { importId: loaded.id });
        return { ...loaded, posted: auto.posted, failed: auto.failed };
      }
      case 'statement.apply':
        return applyStatementRules(tx, c);
      case 'rule.save':
        return saveRule(tx, c);
      case 'budgetCode.save':
        return saveBudgetCode(tx, c);
      case 'statement.ignore':
        return ignoreStatementLine(tx, c);
      case 'statement.restore':
        return restoreStatementLine(tx, c);
      case 'statement.link':
        return linkStatementLine(tx, c);
      case 'eqaime.import': {
        // E-qaimələr that confirmed map entries cover are booked right away (each on its own).
        const loaded = importEq(tx, c);
        const auto = applyEq(tx, c.companyId, c.direction);
        return { ...loaded, posted: auto.posted + auto.linked, failed: auto.failed };
      }
      case 'fixedAsset.save':
        return saveFixedAsset(tx, c);
      case 'asset.save':
        return saveAssetDocument(tx, c);
      case 'asset.cancel':
        return cancelAssetDocument(tx, c);
      case 'eqaime.synced':
        return recordDvxSync(tx, c);
      case 'eqaime.apply': {
        tx.company(c.companyId);
        const auto = applyEq(tx, c.companyId, c.direction);
        return { id: c.companyId, posted: auto.posted + auto.linked, failed: auto.failed };
      }
      case 'eqaime.link':
        return linkEq(tx, c);
      case 'eqaime.learn':
        return learnEq(tx, c);
      case 'eqaime.partners':
        return createEqPartners(tx, c);
      case 'eqMap.save':
        return saveEqMap(tx, c);
      case 'eqMap.bulk':
        return bulkEqMap(tx, c);
      case 'eqaime.ignore':
        return ignoreEq(tx, c);
      case 'eqaime.restore':
        return restoreEq(tx, c);
      case 'eqaime.resolve':
        return resolveEq(tx, c);
      case 'period.close':
        return closePeriod(tx, c);
    }
  }
}
