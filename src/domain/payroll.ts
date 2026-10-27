/**
 * Payroll (stage 8; docs/MERHELE-8-EMEK-HAQQI.md, QERARLAR 2026-10-27): the rates of income tax and
 * the social contributions as marginal brackets, and one employee's month — gross, what is
 * withheld, net, and what the employer pays on top. Every amount is rounded to the qəpik once,
 * after its brackets are summed.
 */
import { DomainError } from './errors.js';
import { formatMinor, parseMoney, roundHalfAwayFromZero, type Minor } from './money.js';

/** A bracket applies its rate to the part of the amount above the previous bracket, up to `upTo`. */
export interface Bracket {
  /** Upper bound of the bracket; null — no bound (the last one). */
  upTo: Minor | null;
  /** Hundredths of a percent: 3% → 300, 0,5% → 50. */
  rate: number;
}

export const contributionKeys = [
  'incomeTax',
  'dsmfEmployee',
  'unemploymentEmployee',
  'medicalEmployee',
  'dsmfEmployer',
  'unemploymentEmployer',
  'medicalEmployer',
] as const;
export type ContributionKey = (typeof contributionKeys)[number];

export const contributionLabel: Record<ContributionKey, string> = {
  incomeTax: 'Gəlir vergisi',
  dsmfEmployee: 'DSMF — işçi',
  unemploymentEmployee: 'İşsizlik sığortası — işçi',
  medicalEmployee: 'Tibbi sığorta — işçi',
  dsmfEmployer: 'DSMF — işəgötürən',
  unemploymentEmployer: 'İşsizlik sığortası — işəgötürən',
  medicalEmployer: 'Tibbi sığorta — işəgötürən',
};

export interface PayrollRates extends Record<ContributionKey, Bracket[]> {
  /** Income tax is not withheld from `amount` when the month's income is at most `ifUpTo`. */
  relief: { amount: Minor; ifUpTo: Minor };
}

/** The rates as they are stored and edited: decimal strings, '' for "no bound". */
export interface RatesInput extends Record<ContributionKey, { upTo: string; rate: string }[]> {
  relief: { amount: string; ifUpTo: string };
}

/**
 * 2026, non-oil and non-state sector (plan §5): the starting set the accountant confirms. Above
 * 8 000 the DSMF keeps its rates until the accountant says otherwise (QERARLAR 2026-10-27 §1).
 */
export const rates2026: RatesInput = {
  incomeTax: [
    { upTo: '2500.00', rate: '3' },
    { upTo: '8000.00', rate: '10' },
    { upTo: '', rate: '14' },
  ],
  relief: { amount: '200.00', ifUpTo: '2500.00' },
  dsmfEmployee: [
    { upTo: '200.00', rate: '3' },
    { upTo: '', rate: '10' },
  ],
  unemploymentEmployee: [{ upTo: '', rate: '0.5' }],
  medicalEmployee: [
    { upTo: '2500.00', rate: '2' },
    { upTo: '', rate: '0.5' },
  ],
  dsmfEmployer: [
    { upTo: '200.00', rate: '22' },
    { upTo: '', rate: '15' },
  ],
  unemploymentEmployer: [{ upTo: '', rate: '0.5' }],
  medicalEmployer: [
    { upTo: '2500.00', rate: '2' },
    { upTo: '', rate: '0.5' },
  ],
};

/** "3" / "0.5" / "0,5" (percent) → hundredths of a percent. */
export function parseRate(value: string, field: string): number {
  const text = value.trim().replace(',', '.');
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text);
  const rate = m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : NaN;
  if (!m || rate > 10_000)
    throw new DomainError(`${field}: dərəcə 0–100 faiz olmalıdır (məs. 3 və ya 0,5).`);
  return rate;
}

export const formatRate = (rate: number) =>
  `${Math.floor(rate / 100)}${
    rate % 100
      ? `.${String(rate % 100)
          .padStart(2, '0')
          .replace(/0$/, '')}`
      : ''
  }`;

/** Checks the rates: brackets rising, the last one without a bound. */
export function parseRates(input: RatesInput): PayrollRates {
  const out = {} as PayrollRates;
  for (const key of contributionKeys) {
    const rows = input[key];
    if (!rows?.length) throw new DomainError(`${contributionLabel[key]}: dərəcə yazın.`);
    let previous = 0n;
    out[key] = rows.map((r, i) => {
      const last = i === rows.length - 1;
      const where = `${contributionLabel[key]}, pillə ${i + 1}`;
      const rate = parseRate(r.rate, where);
      if (last) {
        if (r.upTo.trim())
          throw new DomainError(`${contributionLabel[key]}: son pillənin yuxarı həddi olmur.`);
        return { upTo: null, rate };
      }
      const upTo = parseMoney(r.upTo, `${where}: hədd`);
      if (upTo <= previous) throw new DomainError(`${where}: hədd əvvəlkindən böyük olmalıdır.`);
      previous = upTo;
      return { upTo, rate };
    });
  }
  out.relief = {
    amount: parseMoney(input.relief?.amount || '0', 'Güzəşt'),
    ifUpTo: parseMoney(input.relief?.ifUpTo || '0', 'Güzəştin həddi'),
  };
  if (out.relief.amount < 0n || out.relief.ifUpTo < 0n)
    throw new DomainError('Güzəşt mənfi ola bilməz.');
  return out;
}

/** The canonical stored form (what `parseRates` read). */
export function ratesInput(r: PayrollRates): RatesInput {
  const out = {} as RatesInput;
  for (const key of contributionKeys)
    out[key] = r[key].map((b) => ({
      upTo: b.upTo === null ? '' : formatMinor(b.upTo),
      rate: formatRate(b.rate),
    }));
  out.relief = { amount: formatMinor(r.relief.amount), ifUpTo: formatMinor(r.relief.ifUpTo) };
  return out;
}

/** The brackets' sum on an amount, rounded to the qəpik once. */
export function byBrackets(amount: Minor, brackets: readonly Bracket[]): Minor {
  if (amount <= 0n) return 0n;
  let from = 0n;
  let sum = 0n;
  for (const b of brackets) {
    const to = b.upTo === null || b.upTo > amount ? amount : b.upTo;
    if (to > from) sum += (to - from) * BigInt(b.rate);
    if (b.upTo === null || b.upTo >= amount) break;
    from = b.upTo;
  }
  return roundHalfAwayFromZero(sum, 10_000n);
}

export interface PayrollAmounts extends Record<ContributionKey, Minor> {
  gross: Minor;
  /** Paid to the employee: gross less what is withheld. */
  net: Minor;
}

/** One employee's month by the rates in force. */
export function payrollFor(gross: Minor, rates: PayrollRates): PayrollAmounts {
  const relief = gross <= rates.relief.ifUpTo ? rates.relief.amount : 0n;
  const taxable = gross > relief ? gross - relief : 0n;
  const out = { gross } as PayrollAmounts;
  out.incomeTax = byBrackets(taxable, rates.incomeTax);
  for (const key of contributionKeys)
    if (key !== 'incomeTax') out[key] = byBrackets(gross, rates[key]);
  out.net =
    gross - out.incomeTax - out.dsmfEmployee - out.unemploymentEmployee - out.medicalEmployee;
  return out;
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Working days (Monday–Friday) from `from` to `to`, both included. */
export function workdays(from: string, to: string): number {
  let n = 0;
  for (let d = day(from); iso(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

/**
 * The salary of a month ("YYYY-MM") for an employee hired / leaving on the given days ('' — not in
 * this month): in proportion to the working days in it (holidays are not counted).
 */
export function salaryFor(salary: Minor, month: string, hired: string, left: string): Minor {
  const first = `${month}-01`;
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  const last = iso(end);
  const from = hired && hired > first ? hired : first;
  const to = left && left < last ? left : last;
  if (from > to) return 0n;
  if (from === first && to === last) return salary;
  const all = workdays(first, last);
  return all ? roundHalfAwayFromZero(salary * BigInt(workdays(from, to)), BigInt(all)) : 0n;
}
