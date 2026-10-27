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
  /** Salary, bonus and vacation pay: the base of income tax and of every contribution. */
  gross: Minor;
  /** Sick pay of the employer's days (8c): income tax only, no contributions. */
  sick: Minor;
  /** What was taken off the taxable income: the larger relief, plus the additional 50. */
  exemption: Minor;
  /** Paid to the employee: gross and sick pay less what is withheld. */
  net: Minor;
}

/** An employee's own income tax exemptions (VM 102), per month. */
export interface Exemption {
  /** 400 / 200 / 100 (VM 102.2–102.4): only the largest one counts (102.7). */
  amount: Minor;
  /** The additional 50 (VM 102.5). */
  extra: Minor;
}
export const noExemption: Exemption = { amount: 0n, extra: 0n };

/**
 * One employee's month by the rates in force. The 2026 relief (200 of an income up to 2 500) and
 * the employee's own exemption are not added together: the larger one counts (QERARLAR 2026-10-27
 * §8), the additional 50 on top.
 */
export function payrollFor(
  gross: Minor,
  rates: PayrollRates,
  exemption: Exemption = noExemption,
  sick: Minor = 0n,
): PayrollAmounts {
  const income = gross + sick;
  const general = income <= rates.relief.ifUpTo ? rates.relief.amount : 0n;
  const relief = (general > exemption.amount ? general : exemption.amount) + exemption.extra;
  const taxable = income > relief ? income - relief : 0n;
  const out = { gross, sick, exemption: income < relief ? income : relief } as PayrollAmounts;
  out.incomeTax = byBrackets(taxable, rates.incomeTax);
  for (const key of contributionKeys)
    if (key !== 'incomeTax') out[key] = byBrackets(gross, rates[key]);
  out.net =
    income - out.incomeTax - out.dsmfEmployee - out.unemploymentEmployee - out.medicalEmployee;
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

/** Calendar days from `from` to `to`, both included (0 when `to` is earlier). */
export function calendarDays(from: string, to: string): number {
  const n = Math.round((day(to).getTime() - day(from).getTime()) / 86_400_000) + 1;
  return n > 0 ? n : 0;
}

/** First and last day of a month ("YYYY-MM"). */
export function monthBounds(month: string): { first: string; last: string } {
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  return { first: `${month}-01`, last: iso(end) };
}

/** A period the employee is away (vacation, sick leave): no salary for its working days. */
export interface Away {
  from: string;
  to: string;
}

/**
 * The salary of a month ("YYYY-MM") for an employee hired / leaving on the given days ('' — not in
 * this month) and away on some: in proportion to the working days worked (holidays are not
 * counted).
 */
export function salaryFor(
  salary: Minor,
  month: string,
  hired: string,
  left: string,
  away: readonly Away[] = [],
): Minor {
  const { first, last } = monthBounds(month);
  const from = hired && hired > first ? hired : first;
  const to = left && left < last ? left : last;
  if (from > to) return 0n;
  let worked = workdays(from, to);
  for (const a of away) {
    const f = a.from > from ? a.from : from;
    const t = a.to < to ? a.to : to;
    if (f <= t) worked -= workdays(f, t);
  }
  const all = workdays(first, last);
  if (worked <= 0 || !all) return 0n;
  if (worked === all) return salary;
  return roundHalfAwayFromZero(salary * BigInt(worked), BigInt(all));
}

// ---------------------------------------------------------------------------------------------
// Stage 8c — vacation and sick pay (plan §12, QERARLAR 2026-10-27 §9, §10)

/** The calendar days of a sick leave the employer pays for; the rest goes to DSMF. */
export const EMPLOYER_SICK_DAYS = 14;

/**
 * Vacation pay: the average monthly earnings of the 12 full months before (or of the months worked,
 * when fewer) — or the accountant's figure — over 30,4, times the calendar days.
 */
export function vacationPay(
  months: readonly Minor[],
  days: number,
  manualAverage: Minor | null = null,
): { average: Minor; daily: Minor; amount: Minor } {
  const used = months.slice(-12);
  const average =
    manualAverage ??
    (used.length
      ? roundHalfAwayFromZero(
          used.reduce((s, m) => s + m, 0n),
          BigInt(used.length),
        )
      : 0n);
  // The daily rate is rounded to the qəpik first, as the accountant computes it by hand.
  const daily = roundHalfAwayFromZero(average * 10n, 304n);
  return { average, daily, amount: daily * BigInt(days) };
}

/**
 * The four full quarters before the quarter a sick leave starts in: their first and last day (the
 * base of the average daily earnings from 01.05.2026).
 */
export function fourQuartersBefore(start: string): { from: string; to: string } {
  const y = Number(start.slice(0, 4));
  const q = Math.floor((Number(start.slice(5, 7)) - 1) / 3);
  const end = new Date(Date.UTC(y, q * 3, 0));
  const begin = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth() + 1, 1));
  return { from: iso(begin), to: iso(end) };
}

/**
 * Sick pay of the employer's days: the average daily earnings (the base over its calendar days, or
 * the accountant's figure) times the service percentage, for the first 14 calendar days — or all of
 * them when the employer is at fault for an accident at work.
 */
export function sickPay(input: {
  base: Minor;
  baseDays: number;
  manualDaily: Minor | null;
  days: number;
  percent: number;
  employerAll: boolean;
}): { daily: Minor; employerDays: number; fundDays: number; amount: Minor } {
  const employerDays = input.employerAll ? input.days : Math.min(input.days, EMPLOYER_SICK_DAYS);
  // The average daily earnings are rounded to the qəpik first, then the percentage and the days.
  const daily =
    input.manualDaily ??
    (input.baseDays > 0 ? roundHalfAwayFromZero(input.base, BigInt(input.baseDays)) : 0n);
  const amount = roundHalfAwayFromZero(daily * BigInt(input.percent) * BigInt(employerDays), 100n);
  return { daily, employerDays, fundDays: input.days - employerDays, amount };
}
