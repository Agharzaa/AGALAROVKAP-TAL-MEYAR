/**
 * Learned rules and budget classification codes (stage 3d; docs/QERARLAR.md 2026-10-14 §7–8,
 * docs/MERHELE-3-BANK.md §6.3).
 *
 * - A rule is made from the accountant's own booking of a statement row (`ruleDraft`), edited
 *   and saved by the accountant; it starts as "suggest" and posts by itself only once the
 *   accountant switches it to "auto". The system never switches a rule on its own.
 * - An "auto" rule posts a waiting row through an ordinary bank document — same checks, journal
 *   and audit as a document typed by hand — each row in its own savepoint, so one failure
 *   leaves the row waiting with the reason and never stops the others.
 * - Undoing an automatic booking (cancelling its document) leaves the row to the accountant:
 *   the rule only proposes it from then on.
 */
import { inFamily, type Account } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney, type Minor } from '../domain/money.js';
import {
  chooseRule,
  normalizeTerms,
  ruleAmounts,
  suggestTerms,
  type RuleLine,
} from '../domain/rules.js';
import { parseText } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type { BudgetCodeView, RuleDraft, RuleView } from '../contracts/queries.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import { saveBankDocument } from './bank.js';
import { activeRules, ruleRow, toRule } from './rule-store.js';
import { checkSideValues } from './subkonto.js';
import { expectVersion, loadChart, type Tx } from './tx.js';

const RULE = 'rule';
const SELF = 'rule:self';
const money = (m: Minor) => formatMinor(m);

// ---------------------------------------------------------------------------------------------
// Saving rules

function checkLine(
  tx: Tx,
  companyId: string,
  account: Account,
  sk: string[],
  cashFlowItem: string,
  field: string,
) {
  if (account.quantitative)
    throw new DomainError(
      `${account.code} miqdar uçotu olan hesabdır; qaydada istifadə olunmur.`,
      `${field}.account`,
    );
  // An empty settlement document is resolved when the rule posts (open invoices or the document).
  const values = account.subkonto.map((kind, i) =>
    kind === 'document' && !sk[i] ? SELF : (sk[i] ?? ''),
  );
  values.forEach((v, i) => {
    if (!v)
      throw new DomainError(`${account.code}: subkonto ${i + 1} seçilməyib.`, `${field}.sk.${i}`);
  });
  checkSideValues(tx.db, companyId, account, values, `${field}.sk`, SELF);
  if (cashFlowItem) {
    const item = tx.db.get(
      "SELECT archived FROM items WHERE company_id=? AND id=? AND kind='cashFlowItem'",
      companyId,
      cashFlowItem,
    );
    if (!item || item.archived === 1n)
      throw new DomainError(
        'Pul vəsaitlərinin hərəkəti maddəsi tapılmadı və ya arxivdədir.',
        `${field}.cashFlowItem`,
      );
  }
}

export function saveRule(tx: Tx, cmd: CommandOf<'rule.save'>): CommandResult {
  tx.company(cmd.companyId);
  const chart = tx.chart(cmd.companyId);
  const name = parseText(cmd.name, 'Qaydanın adı', 160);
  const existing = cmd.id
    ? tx.db.get('SELECT * FROM bank_rules WHERE company_id=? AND id=?', cmd.companyId, cmd.id)
    : undefined;
  if (cmd.id && !existing) throw new DomainError('Qayda tapılmadı.', 'id', 'not-found');
  if (existing) expectVersion(existing, cmd.version, 'Qayda');
  if (
    cmd.bankAccountId &&
    !tx.db.get(
      'SELECT 1 AS x FROM bank_accounts WHERE company_id=? AND id=?',
      cmd.companyId,
      cmd.bankAccountId,
    )
  )
    throw new DomainError('Bank hesabı tapılmadı.', 'bankAccountId', 'not-found');
  const taxId = cmd.counterpartyTaxId.replace(/\s/g, '');
  if (taxId && !/^\d{10}$/.test(taxId))
    throw new DomainError('VÖEN 10 rəqəmdən ibarət olmalıdır.', 'counterpartyTaxId');
  const terms = normalizeTerms(cmd.terms);
  if (!taxId && !terms.length)
    throw new DomainError(
      'Qayda ödəyicinin VÖEN-i və ya təyinatdakı söz(lər) ilə tanımalıdır; hər sətrə uyğun gələn qayda olmaz.',
      'terms',
    );
  const amount = (v: string, field: string) => (v.trim() ? parseMoney(v, field) : null);
  const amountMin = amount(cmd.amountMin, 'Ən az məbləğ');
  const amountMax = amount(cmd.amountMax, 'Ən çox məbləğ');
  if (amountMin !== null && amountMax !== null && amountMin > amountMax)
    throw new DomainError('Ən az məbləğ ən çoxdan böyük ola bilməz.', 'amountMin');
  let rest = 0;
  const lines: RuleLine[] = cmd.lines.map((l, i) => {
    const field = `lines.${i}`;
    const account = chart.require(l.account.trim(), `${field}.account`);
    const sk = account.subkonto.map((_, j) => (l.sk[j] ?? '').trim());
    const cashFlowItem = l.cashFlowItem.trim();
    checkLine(tx, cmd.companyId, account, sk, cashFlowItem, field);
    let fixed = '';
    if (l.amount.trim()) {
      const v = parseMoney(l.amount, `Sətir ${i + 1}: məbləğ`);
      if (v <= 0n)
        throw new DomainError(`Sətir ${i + 1}: məbləğ müsbət olmalıdır.`, `${field}.amount`);
      fixed = money(v);
    } else rest++;
    return {
      account: account.code,
      sk,
      amount: fixed,
      cashFlowItem,
      memo: parseText(l.memo, 'Məzmun', 300, false),
    };
  });
  if (rest !== 1)
    throw new DomainError(
      'Qaydada bir sətrin məbləği boş qalmalıdır — çıxarış sətrinin qalan məbləği ona yazılır.',
      'lines',
    );
  // Two rules with the same conditions would always be a conflict: one of them is enough.
  const twin = activeRules(tx.db, cmd.companyId).find(
    (r) =>
      r.id !== cmd.id &&
      r.direction === cmd.direction &&
      r.bankAccountId === cmd.bankAccountId &&
      r.counterpartyTaxId === taxId &&
      JSON.stringify([...r.terms].sort()) === JSON.stringify([...terms].sort()) &&
      r.amountMin === amountMin &&
      r.amountMax === amountMax,
  );
  if (twin && !cmd.archived)
    throw new DomainError(
      `Eyni şərtli qayda artıq var: “${twin.name}”. Onu düzəldin.`,
      'terms',
      'conflict',
    );
  const id = existing ? String(existing.id) : tx.id();
  const version = existing ? Number(existing.version) + 1 : 1;
  const now = tx.clock.now();
  const values = [
    name,
    cmd.direction,
    cmd.bankAccountId || null,
    taxId,
    JSON.stringify(terms),
    amountMin,
    amountMax,
    JSON.stringify(lines),
    cmd.mode,
    cmd.archived ? 1 : 0,
    version,
    now,
  ] as const;
  if (existing)
    tx.db.run(
      `UPDATE bank_rules SET name=?,direction=?,bank_account_id=?,counterparty_tax_id=?,terms=?,amount_min=?,
         amount_max=?,lines=?,mode=?,archived=?,version=?,updated_at=? WHERE id=?`,
      ...values,
      id,
    );
  else
    tx.db.run(
      `INSERT INTO bank_rules(name,direction,bank_account_id,counterparty_tax_id,terms,amount_min,amount_max,lines,
         mode,archived,version,updated_at,id,company_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ...values,
      id,
      cmd.companyId,
      now,
    );
  tx.history(cmd.companyId, RULE, id, version, cmd.archived ? 'archived' : cmd.mode, {
    name,
    direction: cmd.direction,
    bankAccountId: cmd.bankAccountId,
    counterpartyTaxId: taxId,
    terms,
    amountMin: amountMin === null ? '' : money(amountMin),
    amountMax: amountMax === null ? '' : money(amountMax),
    lines,
  });
  const modeChanged = existing && existing.mode !== cmd.mode;
  tx.audit(
    cmd.companyId,
    !existing
      ? 'Qayda yaradıldı'
      : cmd.archived
        ? 'Qayda arxivləşdirildi'
        : modeChanged
          ? cmd.mode === 'auto'
            ? 'Qayda avtomatik rejimə keçirildi'
            : 'Qayda təklif rejiminə qaytarıldı'
          : 'Qayda dəyişdirildi',
    'Bank qaydası',
    id,
    `${name} (v${version}) · ${cmd.mode === 'auto' ? 'avtomatik' : 'təklif'} · ${lines.map((l) => l.account).join(', ')}`,
  );
  return { id, version };
}

// ---------------------------------------------------------------------------------------------
// Draft from the accountant's decision

export function ruleDraft(db: Db, companyId: string, documentId: string): RuleDraft {
  const doc = db.get(
    'SELECT * FROM bank_documents WHERE company_id=? AND id=?',
    companyId,
    documentId,
  );
  if (!doc) throw new DomainError('Bank sənədi tapılmadı.', 'documentId', 'not-found');
  const stored = JSON.parse(String(doc.lines)) as {
    account: string;
    sk: string[];
    amount: string;
    cashFlowItem?: string;
    memo: string;
  }[];
  const taxId = String(doc.counterparty_tax_id);
  // Several lines: the largest takes what is left, the others keep their amounts (a loan's
  // interest varies — the accountant edits it; a fixed fee stays fixed).
  const largest = stored.reduce(
    (m, l, i) => (parseMoney(l.amount) > parseMoney(stored[m]!.amount) ? i : m),
    0,
  );
  const lines = stored.map((l, i) => ({
    account: l.account,
    sk: l.sk,
    amount: stored.length > 1 && i !== largest ? l.amount : '',
    cashFlowItem: l.cashFlowItem ?? '',
    memo: l.memo,
  }));
  const who =
    String(doc.counterparty_name) || String(doc.purpose).slice(0, 40) || String(doc.number);
  const draft: RuleDraft = {
    name: `${who} → ${[...new Set(lines.map((l) => l.account))].join(', ')}`,
    direction: doc.direction as RuleDraft['direction'],
    bankAccountId: '',
    counterpartyTaxId: taxId,
    terms: suggestTerms(String(doc.purpose), !!taxId),
    lines,
  };
  const choice = chooseRule(activeRules(db, companyId), {
    direction: draft.direction,
    bankAccountId: String(doc.bank_account_id),
    amount: doc.amount as bigint,
    counterparty: String(doc.counterparty_name),
    counterpartyTaxId: taxId,
    purpose: String(doc.purpose),
  });
  if (choice.kind === 'rule') draft.existing = { id: choice.rule.id, name: choice.rule.name };
  return draft;
}

// ---------------------------------------------------------------------------------------------
// Automatic posting

/**
 * Posts the waiting rows (of one statement, or the given rows) that an "auto" rule recognises
 * unambiguously. Rows the accountant took back from a rule (manual_only) are left alone.
 */
export function applyRules(
  tx: Tx,
  companyId: string,
  where: { importId: string } | { lineIds: string[] },
): { posted: number; failed: { row: number; message: string }[] } {
  const rules = activeRules(tx.db, companyId);
  const out = { posted: 0, failed: [] as { row: number; message: string }[] };
  if (!rules.some((r) => r.mode === 'auto')) return out;
  const rows =
    'importId' in where
      ? tx.db.all(
          "SELECT * FROM statement_lines WHERE company_id=? AND import_id=? AND state='new' AND manual_only=0 ORDER BY row_no",
          companyId,
          where.importId,
        )
      : where.lineIds
          .map((id) =>
            tx.db.get(
              "SELECT * FROM statement_lines WHERE company_id=? AND id=? AND state='new' AND manual_only=0",
              companyId,
              id,
            ),
          )
          .filter((r): r is Row => !!r);
  const banks = new Map<string, Row>();
  for (const row of rows) {
    const choice = chooseRule(rules, ruleRow(row));
    if (choice.kind !== 'rule' || choice.rule.mode !== 'auto') continue;
    const rule = choice.rule;
    const bankId = String(row.bank_account_id);
    if (!banks.has(bankId))
      banks.set(bankId, tx.db.get('SELECT * FROM bank_accounts WHERE id=?', bankId)!);
    try {
      if (banks.get(bankId)!.currency !== 'AZN')
        throw new DomainError('Valyuta hesabıdır: AMB məzənnəsini mühasib yazmalıdır.');
      const amounts = ruleAmounts(rule, row.amount as bigint, (v) => parseMoney(v));
      if (!amounts)
        throw new DomainError(
          `Qaydanın sabit məbləğləri sətrin məbləğindən (${money(row.amount as bigint)}) böyükdür.`,
        );
      const result = tx.db.savepoint(() => {
        const r = saveBankDocument(tx, {
          type: 'bank.save',
          key: 'rule-auto',
          companyId,
          direction: row.direction as 'in' | 'out',
          number: '',
          date: String(row.date),
          bankAccountId: bankId,
          rate: '',
          bankReference: String(row.reference),
          counterpartyName: String(row.counterparty),
          counterpartyTaxId: String(row.counterparty_tax_id),
          purpose: String(row.purpose),
          statementLineId: String(row.id),
          lines: rule.lines.map((l, i) => ({
            account: l.account,
            sk: l.sk,
            amount: money(amounts[i]!),
            cashFlowItem: l.cashFlowItem,
            memo: l.memo,
          })),
        });
        tx.db.run(
          'UPDATE bank_documents SET rule_id=?, rule_version=? WHERE company_id=? AND id=?',
          rule.id,
          rule.version,
          companyId,
          r.id,
        );
        return r;
      });
      tx.db.run(
        'UPDATE bank_rules SET uses=uses+1, last_used_at=? WHERE id=?',
        tx.clock.now(),
        rule.id,
      );
      tx.db.run("UPDATE statement_lines SET auto_note='' WHERE id=?", String(row.id));
      tx.audit(
        companyId,
        `Qayda ilə avtomatik uçota alındı`,
        'Çıxarış sətri',
        String(row.id),
        `${result.number} · qayda “${rule.name}” (v${rule.version}) · ${String(row.date)} · ${money(row.amount as bigint)}`,
      );
      out.posted++;
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      tx.db.run(
        'UPDATE statement_lines SET auto_note=? WHERE id=?',
        `“${rule.name}”: ${e.message}`,
        String(row.id),
      );
      out.failed.push({ row: Number(row.row_no), message: e.message });
    }
  }
  return out;
}

export function applyStatementRules(tx: Tx, cmd: CommandOf<'statement.apply'>): CommandResult {
  tx.company(cmd.companyId);
  if (
    !tx.db.get(
      'SELECT 1 AS x FROM statement_imports WHERE company_id=? AND id=?',
      cmd.companyId,
      cmd.importId,
    )
  )
    throw new DomainError('Çıxarış tapılmadı.', 'importId', 'not-found');
  const r = applyRules(tx, cmd.companyId, { importId: cmd.importId });
  return { id: cmd.importId, posted: r.posted, failed: r.failed };
}

// ---------------------------------------------------------------------------------------------
// Budget classification codes → 521 / 522 sub-account

export function saveBudgetCode(tx: Tx, cmd: CommandOf<'budgetCode.save'>): CommandResult {
  tx.company(cmd.companyId);
  const code = cmd.code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) throw new DomainError('Büdcə təsnifat kodu 6 rəqəmdir.', 'code');
  const chart = tx.chart(cmd.companyId);
  const account = chart.require(cmd.account.trim(), 'account');
  if (!inFamily(account.code, '521') && !inFamily(account.code, '522'))
    throw new DomainError('Kod 521 və ya 522 subhesabına yönəlməlidir.', 'account');
  const kindSlot = account.subkonto.indexOf('paymentKind');
  const paymentKindId = cmd.paymentKindId.trim();
  if (kindSlot >= 0) {
    const item = paymentKindId
      ? tx.db.get(
          "SELECT archived FROM items WHERE company_id=? AND id=? AND kind='paymentKind'",
          cmd.companyId,
          paymentKindId,
        )
      : undefined;
    if (!item || item.archived === 1n)
      throw new DomainError('Ödəniş növünü seçin.', 'paymentKindId');
  }
  const existing = cmd.id
    ? tx.db.get('SELECT * FROM budget_codes WHERE company_id=? AND id=?', cmd.companyId, cmd.id)
    : undefined;
  if (cmd.id && !existing) throw new DomainError('Kod tapılmadı.', 'id', 'not-found');
  if (existing) expectVersion(existing, cmd.version, 'Büdcə təsnifat kodu');
  const same = tx.db.get(
    'SELECT id FROM budget_codes WHERE company_id=? AND code=?',
    cmd.companyId,
    code,
  );
  if (same && same.id !== cmd.id) throw new DomainError('Bu kod artıq var.', 'code', 'conflict');
  const name = parseText(cmd.name, 'Ad', 160, false);
  const id = existing ? String(existing.id) : tx.id();
  const version = existing ? Number(existing.version) + 1 : 1;
  if (existing)
    tx.db.run(
      'UPDATE budget_codes SET code=?,name=?,account=?,payment_kind_id=?,archived=?,version=? WHERE id=?',
      code,
      name,
      account.code,
      kindSlot >= 0 ? paymentKindId : '',
      cmd.archived ? 1 : 0,
      version,
      id,
    );
  else
    tx.db.run(
      'INSERT INTO budget_codes(id,company_id,code,name,account,payment_kind_id,archived,version) VALUES(?,?,?,?,?,?,?,1)',
      id,
      cmd.companyId,
      code,
      name,
      account.code,
      kindSlot >= 0 ? paymentKindId : '',
      cmd.archived ? 1 : 0,
    );
  tx.audit(
    cmd.companyId,
    existing ? 'Dəyişdirildi' : 'Əlavə edildi',
    'Büdcə təsnifat kodu',
    id,
    `${code} → ${account.code}${name ? ` · ${name}` : ''}`,
  );
  return { id, version };
}

export function budgetCodes(db: Db, companyId: string): BudgetCodeView[] {
  return db
    .all('SELECT * FROM budget_codes WHERE company_id=? ORDER BY code', companyId)
    .map((r) => ({
      id: String(r.id),
      version: Number(r.version),
      code: String(r.code),
      name: String(r.name),
      account: String(r.account),
      paymentKindId: String(r.payment_kind_id),
      archived: r.archived === 1n,
    }));
}

export function rulesView(
  db: Db,
  companyId: string,
  names: (kind: string, id: string) => string,
): RuleView[] {
  const chart = loadChart(db, companyId);
  return db
    .all('SELECT * FROM bank_rules WHERE company_id=? ORDER BY archived, name', companyId)
    .map((r) => {
      const rule = toRule(r);
      return {
        id: rule.id,
        version: rule.version,
        name: rule.name,
        direction: rule.direction,
        bankAccountId: rule.bankAccountId,
        counterpartyTaxId: rule.counterpartyTaxId,
        terms: rule.terms,
        amountMin: rule.amountMin === null ? '' : money(rule.amountMin),
        amountMax: rule.amountMax === null ? '' : money(rule.amountMax),
        lines: rule.lines.map((l) => ({
          ...l,
          skNames: (chart.get(l.account)?.subkonto ?? []).map((k, i) =>
            l.sk[i] ? names(k, l.sk[i]!) : k === 'document' ? 'avtomatik' : '',
          ),
        })),
        mode: rule.mode,
        archived: r.archived === 1n,
        uses: Number(r.uses),
        lastUsedAt: String(r.last_used_at),
      };
    });
}
