/** Reading learned rules (shared by the statement view and the rule commands). */
import type { Rule, RuleLine, RuleRow } from '../domain/rules.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';

export function toRule(r: Row): Rule {
  return {
    id: String(r.id),
    name: String(r.name),
    direction: r.direction as Rule['direction'],
    bankAccountId: r.bank_account_id ? String(r.bank_account_id) : '',
    counterpartyTaxId: String(r.counterparty_tax_id),
    terms: JSON.parse(String(r.terms)) as string[],
    amountMin: r.amount_min === null ? null : (r.amount_min as bigint),
    amountMax: r.amount_max === null ? null : (r.amount_max as bigint),
    lines: JSON.parse(String(r.lines)) as RuleLine[],
    mode: r.mode as Rule['mode'],
    version: Number(r.version),
  };
}

export function activeRules(db: Db, companyId: string): Rule[] {
  return db
    .all('SELECT * FROM bank_rules WHERE company_id=? AND archived=0 ORDER BY rowid', companyId)
    .map(toRule);
}

/** A statement row as the rules see it. */
export const ruleRow = (r: Row): RuleRow => ({
  direction: r.direction as RuleRow['direction'],
  bankAccountId: String(r.bank_account_id),
  amount: r.amount as bigint,
  counterparty: String(r.counterparty),
  counterpartyTaxId: String(r.counterparty_tax_id),
  purpose: String(r.purpose),
});
