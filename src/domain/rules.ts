/**
 * Learned booking rules for bank statement rows (stage 3d; docs/MERHELE-3-BANK.md §6.3).
 *
 * A rule says: a row of this direction (and bank account, counterparty VÖEN, purpose words,
 * amount range — each only when given) is booked with these lines. The most specific matching
 * rule wins; two different rules equally specific are a conflict, and a conflict is never
 * resolved by the system. Rules come from the accountant's own decisions and post by themselves
 * only after the accountant switched them to "auto".
 */
import { searchKey } from './values.js';

export interface RuleLine {
  account: string;
  /** Subkonto values; an empty settlement document is resolved when posted (open invoices). */
  sk: string[];
  /** Fixed amount (canonical); empty for the one line that takes the rest of the row. */
  amount: string;
  cashFlowItem: string;
  memo: string;
}

export interface Rule {
  id: string;
  name: string;
  direction: 'in' | 'out';
  bankAccountId: string;
  counterpartyTaxId: string;
  /** Words in `searchKey` form; all must appear in the purpose or the counterparty name. */
  terms: string[];
  amountMin: bigint | null;
  amountMax: bigint | null;
  lines: RuleLine[];
  mode: 'suggest' | 'auto';
  version: number;
}

export interface RuleRow {
  direction: 'in' | 'out';
  bankAccountId: string;
  amount: bigint;
  counterparty: string;
  counterpartyTaxId: string;
  purpose: string;
}

/** Purpose text and terms are compared in one form: searchKey, punctuation as spaces. */
export const normalizeText = (text: string) =>
  ` ${searchKey(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;

export function normalizeTerms(terms: readonly string[]): string[] {
  return [...new Set(terms.map((t) => normalizeText(t).trim()).filter((t) => t.length >= 2))];
}

export function matches(rule: Rule, row: RuleRow): boolean {
  if (rule.direction !== row.direction) return false;
  if (rule.bankAccountId && rule.bankAccountId !== row.bankAccountId) return false;
  if (rule.counterpartyTaxId && rule.counterpartyTaxId !== row.counterpartyTaxId) return false;
  if (rule.amountMin !== null && row.amount < rule.amountMin) return false;
  if (rule.amountMax !== null && row.amount > rule.amountMax) return false;
  const text = normalizeText(`${row.purpose} ${row.counterparty}`);
  // A term matches a whole word or the start of one ("icarə" matches "icarəsi").
  return rule.terms.every((t) => text.includes(` ${t}`));
}

/** VÖEN weighs most, then each purpose word, then a bank account, then an amount range. */
export function specificity(rule: Rule): number {
  return (
    (rule.counterpartyTaxId ? 100 : 0) +
    rule.terms.length * 10 +
    (rule.bankAccountId ? 5 : 0) +
    (rule.amountMin !== null || rule.amountMax !== null ? 1 : 0)
  );
}

export type RuleChoice =
  { kind: 'none' } | { kind: 'rule'; rule: Rule } | { kind: 'conflict'; rules: Rule[] };

const sameBooking = (a: Rule, b: Rule) => JSON.stringify(a.lines) === JSON.stringify(b.lines);

export function chooseRule(rules: readonly Rule[], row: RuleRow): RuleChoice {
  const hits = rules.filter((r) => matches(r, row));
  if (!hits.length) return { kind: 'none' };
  const best = Math.max(...hits.map(specificity));
  const top = hits.filter((r) => specificity(r) === best);
  if (top.length > 1 && top.some((r) => !sameBooking(r, top[0]!)))
    return { kind: 'conflict', rules: top };
  // Equal rules booking alike: posting by itself needs every one of them switched to "auto".
  return { kind: 'rule', rule: top.find((r) => r.mode === 'suggest') ?? top[0]! };
}

/** The lines of one row: fixed amounts as given, the rest to the line without an amount. */
export function ruleAmounts(
  rule: Rule,
  amount: bigint,
  parse: (v: string) => bigint,
): bigint[] | null {
  const fixed = rule.lines.map((l) => (l.amount ? parse(l.amount) : null));
  const rest = amount - fixed.reduce<bigint>((s, v) => s + (v ?? 0n), 0n);
  if (rest <= 0n) return null;
  return fixed.map((v) => v ?? rest);
}

const stop = new Set(
  [
    'üzrə',
    'uzre',
    'ödəniş',
    'odenis',
    'ödənişi',
    'görə',
    'gore',
    'tarixli',
    'nömrəli',
    'saylı',
    'sayli',
    'və',
    've',
    'ilə',
    'ile',
    'üçün',
    'ucun',
    'mmc',
    'asc',
    'qsc',
    'ltd',
    'llc',
    'azn',
    'manat',
    'ədv',
    'edv',
    'daxil',
    'hesab',
    'faktura',
  ].map((w) => normalizeText(w).trim()),
);

/**
 * Words a learned rule could recognise the row by: letters only (numbers and dates change
 * from payment to payment), not common filler. With the payer's VÖEN known, none are needed.
 */
export function suggestTerms(purpose: string, hasTaxId: boolean): string[] {
  if (hasTaxId) return [];
  return normalizeText(purpose)
    .trim()
    .split(' ')
    .filter((w) => w.length >= 4 && !/\d/.test(w) && !stop.has(w))
    .slice(0, 2);
}

/**
 * Budget classification code printed in a tax payment's purpose ("BTK 121110", "Büdcə
 * təsnifatı kodu: 141110"); otherwise any six-digit number the company's code table knows.
 */
export function findBudgetCode(purpose: string, known: ReadonlySet<string>): string | undefined {
  const text = normalizeText(purpose);
  const labelled =
    /(?:büdcə təsnifat\p{L}* kodu|budce tesnifat\p{L}* kodu|b t k|btk)\s*(\d{6})/u.exec(text)?.[1];
  if (labelled) return labelled;
  return text.match(/\b\d{6}\b/g)?.find((c) => known.has(c));
}
