/**
 * Subkonto values are ids in the company's catalogs. The journal cannot hold a foreign key per
 * kind, so every value is checked here before it is posted: it exists in this company, it is
 * of the kind the account expects, it is active, a contract belongs to the partner in the slot
 * before it and a bank account is bound to the very account it is posted on.
 */
import type { Account, CurrencyCode, SubkontoKind } from '../domain/chart.js';
import { vatRates } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { subkontoLabel } from '../domain/chart.js';
import type { Db } from '../infrastructure/sqlite/db.js';

const tables: Partial<Record<SubkontoKind, { table: string; kind?: string }>> = {
  partner: { table: 'partners' },
  contract: { table: 'contracts' },
  bankAccount: { table: 'bank_accounts' },
  product: { table: 'products' },
  employee: { table: 'employees' },
  expenseItem: { table: 'items', kind: 'expenseItem' },
  incomeType: { table: 'items', kind: 'incomeType' },
  taxType: { table: 'items', kind: 'taxType' },
  paymentKind: { table: 'items', kind: 'paymentKind' },
  fund: { table: 'items', kind: 'fund' },
  capitalChange: { table: 'items', kind: 'capitalChange' },
  cashbox: { table: 'items', kind: 'cashbox' },
  productGroup: { table: 'items', kind: 'productGroup' },
};

export interface SideCheck {
  /** Currency implied by the subkonto (bank account or contract), if any. */
  currency?: CurrencyCode;
}

/** `document` values reference a document as "<type>:<id>". */
export function documentExists(db: Db, companyId: string, value: string): boolean {
  const [type, id] = value.split(':');
  if (type === 'operation' && id)
    return !!db.get('SELECT 1 AS x FROM operations WHERE company_id=? AND id=?', companyId, id);
  return false;
}

export function checkSideValues(
  db: Db,
  companyId: string,
  account: Account,
  values: readonly string[],
  field: string,
  allowSelf: string,
): SideCheck {
  const result: SideCheck = {};
  account.subkonto.forEach((kind, i) => {
    const value = values[i] ?? '';
    const where = `${field}.${i}`;
    const label = `${account.code} · ${subkontoLabel[kind]}`;
    if (kind === 'vatRate') {
      if (!vatRates.some((r) => r.id === value))
        throw new DomainError(`${label}: ƏDV dərəcəsi seçin.`, where);
      return;
    }
    if (kind === 'document') {
      if (value !== allowSelf && !documentExists(db, companyId, value))
        throw new DomainError(`${label}: sənəd tapılmadı.`, where, 'not-found');
      return;
    }
    const t = tables[kind]!;
    const row = db.get(
      `SELECT * FROM ${t.table} WHERE company_id=? AND id=?${t.kind ? ' AND kind=?' : ''}`,
      companyId,
      value,
      ...(t.kind ? [t.kind] : []),
    );
    if (!row) throw new DomainError(`${label}: seçilən element tapılmadı.`, where, 'not-found');
    if (row.archived === 1n) throw new DomainError(`${label}: element arxivdədir.`, where);
    if (kind === 'contract') {
      const partner = values[i - 1];
      if (row.partner_id !== partner)
        throw new DomainError(`${label}: müqavilə seçilən kontragentə aid deyil.`, where);
      if (row.currency !== 'AZN') result.currency = String(row.currency) as CurrencyCode;
    }
    if (kind === 'bankAccount') {
      if (row.account !== account.code)
        throw new DomainError(
          `${label}: bu bank hesabı ${row.account} hesabına bağlıdır, ${account.code} hesabına yox.`,
          where,
        );
      if (row.currency !== 'AZN') result.currency = String(row.currency) as CurrencyCode;
    }
  });
  return result;
}
