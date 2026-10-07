import type { TestContext } from 'node:test';
import { Db } from '../../src/infrastructure/sqlite/db.js';
import { Ledger } from '../../src/application/ledger.js';
import type { Command, CommandResult, OperationLineInput } from '../../src/contracts/commands.js';
import type {
  AccountCard,
  Catalog,
  HomeView,
  TrialBalance,
  TrialRow,
} from '../../src/contracts/queries.js';

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type Cmd = Without<Command, 'key'>;

let counter = 0;
export const newKey = () => `test-${String(++counter).padStart(8, '0')}`;

export function fixture(t: TestContext, path = ':memory:', today = '2026-12-31') {
  const db = new Db(path);
  t.after(() => {
    try {
      db.close();
    } catch {
      /* closed by the test */
    }
  });
  const ledger = new Ledger(db, { now: () => '2026-10-07T12:00:00.000Z', today: () => today });
  const ctx = { actor: 'test', correlationId: 'test' };
  const exec = (cmd: Cmd, key = newKey()) => ledger.execute({ key, ...cmd }, ctx) as CommandResult;
  const query = <T>(q: object) => ledger.query(q) as T;
  const companyId = exec({
    type: 'company.create',
    name: 'Agalarov Kapital MMC',
    taxId: '1234567890',
    vatPayer: true,
  }).id;
  const catalog = () => query<Catalog>({ type: 'catalog', companyId });
  const item = (kind: string, name: string) =>
    catalog().items.find((i) => i.kind === kind && i.name === name)!.id;
  const partner = (
    name: string,
    taxId: string,
    kind: 'legal' | 'individual' | 'foreign' | 'state' = 'legal',
  ) => exec({ type: 'partner.save', companyId, name, taxId, kind, note: '', archived: false }).id;
  const contract = (
    partnerId: string,
    number: string,
    kind: 'sale' | 'purchase' | 'loan' | 'other',
    currency = 'AZN',
  ) =>
    exec({
      type: 'contract.save',
      companyId,
      partnerId,
      number,
      date: '2026-01-01',
      kind,
      currency,
      note: '',
      archived: false,
    }).id;
  const bankAccount = (
    bankId: string,
    iban: string,
    account = '223.01',
    currency = 'AZN',
    name = '',
  ) =>
    exec({
      type: 'bankAccount.save',
      companyId,
      bankId,
      iban,
      currency,
      account,
      name,
      archived: false,
    }).id;
  const product = (name: string, unit = 'ədəd') =>
    exec({ type: 'product.save', companyId, code: '', name, unit, kind: 'goods', archived: false })
      .id;
  const line = (
    dtAccount: string,
    dtSk: string[],
    ktAccount: string,
    ktSk: string[],
    amount: string,
    extra: Partial<OperationLineInput> = {},
  ): OperationLineInput => ({
    dtAccount,
    dtSk,
    ktAccount,
    ktSk,
    amount,
    memo: '',
    ...extra,
  });
  const operation = (
    date: string,
    lines: OperationLineInput[],
    memo = '',
    extra: Partial<Extract<Cmd, { type: 'operation.save' }>> = {},
  ) => exec({ type: 'operation.save', companyId, number: '', date, memo, lines, ...extra });
  const trial = (from: string, to: string, expand: string[] = [], extra: object = {}) =>
    query<TrialBalance>({ type: 'trialBalance', companyId, from, to, expand, ...extra });
  const row = (tb: TrialBalance, key: string): TrialRow | undefined =>
    tb.rows.find((r) => r.key === key);
  const card = (account: string, from: string, to: string, sk: string[] = []) =>
    query<AccountCard>({ type: 'accountCard', companyId, account, from, to, sk });
  const home = () => query<HomeView>({ type: 'home', companyId });
  return {
    db,
    ledger,
    exec,
    query,
    companyId,
    catalog,
    item,
    partner,
    contract,
    bankAccount,
    product,
    line,
    operation,
    trial,
    row,
    card,
    home,
  };
}
