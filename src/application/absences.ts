/**
 * Stage 8c / 8d — vacations, sick leaves and the compensation of unused vacation (plan §12, §13;
 * QERARLAR 2026-10-27 §9, §10, §12, §13). They post nothing: the pay is worked out when the
 * document is saved, kept on it with how it was worked out, and goes to the payrolls of the months
 * its paid days fall in (a vacation is split by them; the public holidays in it are not vacation
 * days, it grows by them); its working days are not paid as salary. A change after such a month's
 * payroll was posted makes the payroll stale (it says so, and the month closing waits for it to be
 * saved again). The vacation entitlement and its balance follow from the employee's card.
 */
import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney, type Minor } from '../domain/money.js';
import { eachDay, vacationDays, vacationEnd, type WorkCalendar } from '../domain/calendar.js';
import {
  calendarDays,
  fourQuartersBefore,
  monthBounds,
  sickPay,
  splitByMonth,
  vacationEarned,
  vacationPay,
  type Away,
} from '../domain/payroll.js';
import { numberKey, parseDate, parseText } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type { AbsenceView, VacationBalanceRow } from '../contracts/queries.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import { loadCalendar } from './calendar.js';
import { expectVersion, type Tx } from './tx.js';

type Kind = 'vacation' | 'unpaid' | 'sick' | 'compensation';
const prefix: Record<Kind, string> = {
  vacation: 'MZ',
  unpaid: 'ÖM',
  sick: 'XV',
  compensation: 'MK',
};
export const absenceLabel: Record<Kind, string> = {
  vacation: 'Məzuniyyət',
  unpaid: 'Ödənişsiz məzuniyyət',
  sick: 'Xəstəlik vərəqəsi',
  compensation: 'Məzuniyyət kompensasiyası',
};
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dmy = (iso: string) => iso.split('-').reverse().join('.');
const show = (v: Minor) =>
  formatMinor(v)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const monthOf = (iso: string) => iso.slice(0, 7);
const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const previousMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** Every posted absence of the employee that touches the month: its working days are not paid. */
export function awayIn(db: Db, companyId: string, employeeId: string, month: string): Away[] {
  const { first, last } = monthBounds(month);
  return db
    .all(
      `SELECT date_from, date_to FROM payroll_absences WHERE company_id=? AND employee_id=? AND status='posted'
         AND kind<>'compensation' AND date_from<=? AND date_to>=?`,
      companyId,
      employeeId,
      last,
      first,
    )
    .map((r) => ({ from: str(r.date_from), to: str(r.date_to) }));
}

/**
 * An absence's pay by month (8d): a vacation by its days without the holidays (the daily rate a
 * day), a sick leave by the employer's days, a compensation in its month.
 */
export function monthShare(a: Row, cal: WorkCalendar): Map<string, Minor> {
  const amount = a.amount as bigint;
  const from = str(a.date_from);
  if (a.kind === 'compensation') return new Map([[monthOf(from), amount]]);
  const all = eachDay(from, str(a.date_to));
  if (a.kind === 'vacation')
    return splitByMonth(
      amount,
      all.filter((d) => !cal.isHoliday(d)),
      a.daily as bigint,
    );
  if (a.kind === 'sick') return splitByMonth(amount, all.slice(0, Number(a.employer_days)));
  return new Map();
}

/**
 * The vacation (with the compensation) and sick pay that go to the month's payroll: the part of
 * every posted absence that falls in the month.
 */
export function absencePay(
  db: Db,
  companyId: string,
  employeeId: string,
  month: string,
  cal: WorkCalendar = loadCalendar(db, companyId),
): { vacation: Minor; sick: Minor } {
  const { first, last } = monthBounds(month);
  let vacation = 0n;
  let sick = 0n;
  for (const a of db.all(
    `SELECT * FROM payroll_absences WHERE company_id=? AND employee_id=? AND status='posted'
       AND kind<>'unpaid' AND date_from<=? AND date_to>=?`,
    companyId,
    employeeId,
    last,
    first,
  )) {
    const part = monthShare(a, cal).get(month) ?? 0n;
    if (a.kind === 'sick') sick += part;
    else vacation += part;
  }
  return { vacation, sick };
}

/**
 * The employee's vacation balance on a day (8d): the days earned by the working years from the
 * hire date (the current one by the months gone) less the vacation and compensation days of the
 * posted documents up to that day (but the one being saved).
 */
export function vacationBalanceOf(db: Db, e: Row, date: string, exceptId = ''): VacationBalanceRow {
  const earned = vacationEarned({
    hired: str(e.hired),
    tenureFrom: str(e.tenure_from),
    base: Number(e.vacation_days),
    extra: Number(e.vacation_extra),
    date,
  });
  const used = Number(
    db.get(
      `SELECT COALESCE(SUM(days),0) AS n FROM payroll_absences WHERE company_id=? AND employee_id=?
         AND status='posted' AND kind IN('vacation','compensation') AND date_from<=? AND id<>?`,
      str(e.company_id),
      str(e.id),
      date,
      exceptId,
    )!.n,
  );
  return {
    employeeId: str(e.id),
    name: str(e.name),
    hired: str(e.hired),
    years: earned.years,
    annual: earned.annual,
    earned: earned.earned,
    used,
    balance: earned.earned - used,
  };
}

/** Vacation balances of the employees at work on a day. */
export function vacationBalances(
  db: Db,
  companyId: string,
  dateInput: string,
): VacationBalanceRow[] {
  const date = parseDate(dateInput);
  return db
    .all(
      `SELECT * FROM employees WHERE company_id=? AND archived=0 AND hired<>'' AND hired<=?
         AND (left_on='' OR left_on>=?) ORDER BY tab_no, name`,
      companyId,
      date,
      date,
    )
    .map((e) => vacationBalanceOf(db, e, date));
}

/**
 * The earnings of every month the payroll was posted for, by month: the work — salary, bonus and the
 * timesheet's overtime, day-off and night pay — and the insured income (the gross, the base of the
 * contributions: the work and the vacation pay), without sick pay.
 */
function earnings(db: Db, companyId: string, employeeId: string, from: string, to: string) {
  return db.all(
    `SELECT d.month, SUM(l.gross - l.vacation) AS work, SUM(l.gross) AS insured
     FROM payroll_lines l JOIN payroll_documents d ON d.id=l.document_id
     WHERE l.company_id=? AND l.employee_id=? AND d.status='posted' AND d.month BETWEEN ? AND ?
     GROUP BY d.month ORDER BY d.month`,
    companyId,
    employeeId,
    from,
    to,
  );
}

interface Worked {
  average: Minor;
  daily: Minor;
  employerDays: number;
  fundDays: number;
  amount: Minor;
  basis: string;
  warning: string;
}

function workOut(
  tx: Tx,
  companyId: string,
  kind: Kind,
  employee: Row,
  from: string,
  to: string,
  days: number,
  manual: Minor | null,
  percent: number,
  employerAll: boolean,
  id: string,
): Worked {
  const employeeId = str(employee.id);
  const hired = str(employee.hired);
  if (kind === 'unpaid')
    return {
      average: 0n,
      daily: 0n,
      employerDays: 0,
      fundDays: 0,
      amount: 0n,
      basis: 'Ödənişsiz: yalnız iş günlərinin əmək haqqı hesablanmır.',
      warning: '',
    };
  if (kind === 'vacation' || kind === 'compensation') {
    // The 12 full calendar months before the vacation month; a month the employee was hired in
    // after its first day is not a full month, nor one with a day of vacation, unpaid leave or sick
    // leave (QERARLAR 2026-10-28 §2) — unless no month is left without one.
    const last = previousMonth(monthOf(from));
    let first = last;
    for (let i = 1; i < 12; i++) first = previousMonth(first);
    const away = new Set<string>();
    for (const r of tx.db.all(
      `SELECT date_from, date_to FROM payroll_absences WHERE company_id=? AND employee_id=? AND status='posted'
         AND kind<>'compensation' AND id<>? AND date_from<=? AND date_to>=?`,
      companyId,
      employeeId,
      id,
      monthBounds(last).last,
      `${first}-01`,
    ))
      for (const d of eachDay(str(r.date_from), str(r.date_to))) away.add(monthOf(d));
    const full = earnings(tx.db, companyId, employeeId, first, last).filter(
      (r) => !(hired > `${str(r.month)}-01`),
    );
    const worked = full.filter((r) => !away.has(str(r.month)));
    const used = worked.length ? worked : full;
    const skipped = full.filter((r) => !used.includes(r)).map((r) => str(r.month));
    const months = used.map((r) => r.work as bigint);
    if (manual === null && !months.length)
      throw new DomainError(
        'Əvvəlki aylar üçün Meyar-da əmək haqqı yoxdur: orta aylıq qazancı əl ilə yazın.',
        'manual',
      );
    const v = vacationPay(months, days, manual);
    return {
      average: v.average,
      daily: v.daily,
      employerDays: days,
      fundDays: 0,
      amount: v.amount,
      basis:
        (kind === 'compensation' ? `İstifadə olunmamış ${days} gün. ` : '') +
        (manual !== null
          ? `Orta aylıq (mühasib): ${show(v.average)} ₼; günlük ${show(v.average)} / 30,4 = ${show(v.daily)} ₼ × ${days} gün.`
          : `${months.length} ay (${first} – ${last}${skipped.length ? `; məzuniyyət / xəstəlik olan aylar çıxılıb: ${skipped.join(', ')}` : ''}): ${show(months.reduce((s, m) => s + m, 0n))} ₼ / ${months.length} = ${show(v.average)} ₼; ${show(v.average)} / 30,4 = ${show(v.daily)} ₼ × ${days} gün.`),
      warning: '',
    };
  }
  // A sheet that starts the day after another one ends continues the same illness: the 14 employer
  // days and the four quarters are the illness's, not the sheet's.
  const chain: Row[] = [];
  for (let start = from; ;) {
    const prev = tx.db.get(
      `SELECT number, date_from, employer_days, employer_all FROM payroll_absences WHERE company_id=?
         AND employee_id=? AND kind='sick' AND status='posted' AND id<>? AND date_to=?`,
      companyId,
      employeeId,
      id,
      dayBefore(start),
    );
    if (!prev) break;
    chain.unshift(prev);
    start = str(prev.date_from);
  }
  const employerDaysUsed = chain.reduce(
    (n, r) => n + (r.employer_all === 1n ? 0 : Number(r.employer_days)),
    0,
  );
  const illness = chain.length ? str(chain[0]!.date_from) : from;
  // Sick leave: the four full quarters before, over their calendar days less earlier sick days.
  const q = fourQuartersBefore(illness);
  const rows = earnings(tx.db, companyId, employeeId, monthOf(q.from), monthOf(q.to));
  const base = rows.reduce((s, r) => s + (r.insured as bigint), 0n);
  const sickBefore = tx.db
    .all(
      `SELECT date_from, date_to FROM payroll_absences WHERE company_id=? AND employee_id=? AND kind='sick'
         AND status='posted' AND id<>? AND date_from<=? AND date_to>=?`,
      companyId,
      employeeId,
      id,
      q.to,
      q.from,
    )
    .reduce((n, r) => {
      const f = str(r.date_from) > q.from ? str(r.date_from) : q.from;
      const t = str(r.date_to) < q.to ? str(r.date_to) : q.to;
      return n + calendarDays(f, t);
    }, 0);
  const baseDays = calendarDays(q.from, q.to) - sickBefore;
  if (manual === null && !base)
    throw new DomainError(
      'Əvvəlki 4 rüb üçün Meyar-da əmək haqqı yoxdur: orta günlük qazancı əl ilə yazın.',
      'manual',
    );
  const s = sickPay({
    base,
    baseDays,
    manualDaily: manual,
    days,
    percent,
    employerAll,
    employerDaysUsed,
  });
  const continued = chain.length
    ? `Davamı: ${chain.map((r) => str(r.number)).join(', ')} (xəstəlik ${dmy(illness)}-dən; işəgötürənin ${employerDaysUsed} günü istifadə olunub). `
    : '';
  const tenure =
    hired && calendarDays(hired, illness) < 183
      ? `Sığorta stajı 6 aydan az ola bilər (işə qəbul ${dmy(hired)}): müavinət hüququnu yoxlayın.`
      : '';
  return {
    average: s.daily,
    daily: s.daily,
    employerDays: s.employerDays,
    fundDays: s.fundDays,
    amount: s.amount,
    basis: `${continued}${
      manual !== null
        ? `Orta günlük (mühasib): ${show(s.daily)} ₼`
        : `${dmy(q.from)} – ${dmy(q.to)}: ${show(base)} ₼ / ${baseDays} gün = ${show(s.daily)} ₼`
    }; × ${percent}% × ${s.employerDays} gün (işəgötürən) = ${show(s.amount)} ₼${
      s.fundDays ? `; ${s.fundDays} gün — DSMF ödəyir (Meyar-da yazılış yoxdur)` : ''
    }.`,
    warning: tenure,
  };
}

function nextNumber(tx: Tx, companyId: string, kind: Kind): string {
  const n =
    Number(
      tx.db.get(
        'SELECT COUNT(*) AS n FROM payroll_absences WHERE company_id=? AND kind=?',
        companyId,
        kind,
      )!.n,
    ) + 1;
  for (let i = n; ; i++) {
    const candidate = `${prefix[kind]}-${String(i).padStart(6, '0')}`;
    if (
      !tx.db.get(
        'SELECT 1 AS x FROM payroll_absences WHERE company_id=? AND kind=? AND number_key=?',
        companyId,
        kind,
        numberKey(candidate),
      )
    )
      return candidate;
  }
}

/** A posted payroll of the month the absence touches: it has to be saved again. */
function staleWarning(tx: Tx, companyId: string, from: string, to: string): string {
  const docs = tx.db
    .all(
      `SELECT number FROM payroll_documents WHERE company_id=? AND status='posted' AND month BETWEEN ? AND ?`,
      companyId,
      monthOf(from),
      monthOf(to),
    )
    .map((r) => str(r.number));
  return docs.length
    ? `${docs.join(', ')} əmək haqqı sənədi uçotdadır: onu açıb yenidən doldurun və düzəlişi uçota alın.`
    : '';
}

export function saveAbsence(tx: Tx, cmd: CommandOf<'absence.save'>): CommandResult {
  tx.company(cmd.companyId);
  const kind = cmd.kind;
  const cal = loadCalendar(tx.db, cmd.companyId);
  const from = parseDate(cmd.from, kind === 'compensation' ? 'Tarix' : 'Başlama tarixi');
  // A vacation of N days ends by itself, its holidays not counted; a compensation is a day.
  const to =
    kind === 'compensation'
      ? from
      : kind === 'vacation' && cmd.days
        ? vacationEnd(cal, from, cmd.days)
        : parseDate(cmd.to, 'Bitmə tarixi');
  if (to < from) throw new DomainError('Bitmə tarixi başlamadan əvvəl ola bilməz.', 'to');
  if (calendarDays(from, to) > 366) throw new DomainError('Müddət bir ildən çox ola bilməz.', 'to');
  const memo = parseText(cmd.memo, 'Məzmun', 500, false);
  const existing = cmd.id
    ? tx.db.get('SELECT * FROM payroll_absences WHERE company_id=? AND id=?', cmd.companyId, cmd.id)
    : undefined;
  if (cmd.id && !existing) throw new DomainError('Sənəd tapılmadı.', 'id', 'not-found');
  if (existing) {
    expectVersion(existing, cmd.version, absenceLabel[kind]);
    if (existing.kind !== kind)
      throw new DomainError('Sənədin növü dəyişdirilmir.', undefined, 'conflict');
    if (existing.status !== 'posted')
      throw new DomainError('Ləğv edilmiş sənəd dəyişdirilmir.', undefined, 'conflict');
    tx.open(cmd.companyId, str(existing.date_from), 'from');
  }
  tx.open(cmd.companyId, from, 'from');
  const employee = tx.db.get(
    'SELECT * FROM employees WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.employeeId,
  );
  if (!employee) throw new DomainError('İşçi tapılmadı.', 'employeeId', 'not-found');
  const name = str(employee.name);
  if (employee.archived === 1n) throw new DomainError(`${name} arxivdədir.`, 'employeeId');
  const balance = vacationBalanceOf(tx.db, employee, from, cmd.id ?? '');
  const days =
    kind === 'vacation'
      ? vacationDays(cal, from, to)
      : kind === 'compensation'
        ? (cmd.days ?? balance.balance)
        : calendarDays(from, to);
  if (days <= 0)
    throw new DomainError(
      kind === 'compensation'
        ? `${name}: ${dmy(from)} tarixinə istifadə olunmamış məzuniyyət yoxdur (qalıq ${balance.balance} gün).`
        : 'Müddətdə məzuniyyət günü yoxdur (yalnız bayramlar).',
      kind === 'compensation' ? 'days' : 'to',
    );
  if (
    (str(employee.hired) && from < str(employee.hired)) ||
    (str(employee.left_on) && to > str(employee.left_on))
  )
    throw new DomainError(`${name} bu tarixlərdə işləmir (işə qəbul / çıxma tarixi).`, 'from');
  const overlap =
    kind !== 'compensation' &&
    tx.db.get(
      `SELECT number, kind FROM payroll_absences WHERE company_id=? AND employee_id=? AND status='posted' AND id<>?
       AND kind<>'compensation' AND date_from<=? AND date_to>=?`,
      cmd.companyId,
      cmd.employeeId,
      cmd.id ?? '',
      to,
      from,
    );
  if (overlap)
    throw new DomainError(
      `${name} bu günlərdə ${absenceLabel[overlap.kind as Kind].toLowerCase()}dədir (${str(overlap.number)}).`,
      'from',
      'conflict',
    );
  const manualText = cmd.manual.trim();
  const manual = manualText ? parseMoney(manualText, 'Orta qazanc') : null;
  if (manual !== null && manual <= 0n)
    throw new DomainError('Orta qazanc müsbət olmalıdır.', 'manual');
  const sheetNo = parseText(cmd.sheetNo, 'Vərəqənin nömrəsi', 40, false);
  if (kind === 'sick' && !sheetNo)
    throw new DomainError('Xəstəlik vərəqəsinin nömrəsini yazın.', 'sheetNo');
  const id = existing ? str(existing.id) : tx.id();
  const w = workOut(
    tx,
    cmd.companyId,
    kind,
    employee,
    from,
    to,
    days,
    manual,
    kind === 'sick' ? cmd.percent : 100,
    kind === 'sick' && cmd.employerAll,
    id,
  );
  const number =
    parseText(cmd.number, 'Nömrə', 40, false) ||
    (existing ? str(existing.number) : nextNumber(tx, cmd.companyId, kind));
  const key = numberKey(number);
  const same = tx.db.get(
    'SELECT id FROM payroll_absences WHERE company_id=? AND kind=? AND number_key=?',
    cmd.companyId,
    kind,
    key,
  );
  if (same && same.id !== cmd.id)
    throw new DomainError('Bu nömrə ilə sənəd artıq var.', 'number', 'conflict');
  const version = existing ? Number(existing.version) + 1 : 1;
  const now = tx.clock.now();
  const values = [
    number,
    key,
    cmd.employeeId,
    from,
    to,
    days,
    sheetNo,
    kind === 'sick' ? cmd.percent : 100,
    kind === 'sick' && cmd.employerAll ? 1 : 0,
    manualText ? formatMinor(manual!) : '',
    w.average,
    w.daily,
    w.employerDays,
    w.fundDays,
    w.amount,
    w.basis,
    memo,
    version,
    now,
  ] as const;
  if (existing)
    tx.db.run(
      `UPDATE payroll_absences SET number=?,number_key=?,employee_id=?,date_from=?,date_to=?,days=?,sheet_no=?,
         percent=?,employer_all=?,manual=?,average=?,daily=?,employer_days=?,fund_days=?,amount=?,basis=?,memo=?,
         version=?,updated_at=? WHERE id=?`,
      ...values,
      id,
    );
  else
    tx.db.run(
      `INSERT INTO payroll_absences(number,number_key,employee_id,date_from,date_to,days,sheet_no,percent,
         employer_all,manual,average,daily,employer_days,fund_days,amount,basis,memo,version,updated_at,
         id,company_id,kind,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'posted',?)`,
      ...values,
      id,
      cmd.companyId,
      kind,
      now,
    );
  tx.history(cmd.companyId, 'absence', id, version, 'posted', {
    kind,
    number,
    employee: name,
    from,
    to,
    amount: formatMinor(w.amount),
    basis: w.basis,
  });
  tx.audit(
    cmd.companyId,
    existing ? 'Dəyişdirildi' : 'Yaradıldı',
    absenceLabel[kind],
    id,
    `${number} · ${name} · ${dmy(from)} – ${dmy(to)} · ${formatMinor(w.amount)} AZN`,
  );
  const stale = staleWarning(
    tx,
    cmd.companyId,
    existing && str(existing.date_from) < from ? str(existing.date_from) : from,
    existing && str(existing.date_to) > to ? str(existing.date_to) : to,
  );
  // Beyond the balance: a vacation in advance, or a mistake — the accountant decides.
  const beyond =
    (kind === 'vacation' || kind === 'compensation') && days > balance.balance
      ? `${name}: ${dmy(from)} tarixinə məzuniyyət qalığı ${balance.balance} gündür, sənəd ${days} gün.`
      : '';
  const leftOn =
    kind === 'compensation' && !str(employee.left_on)
      ? `${name}: işçinin kartında işdən çıxma tarixi yazılmayıb.`
      : '';
  const following =
    kind === 'sick'
      ? [
          ...new Set([
            ...(existing
              ? [recomputeFollowing(tx, cmd.companyId, employee, str(existing.date_to))]
              : []),
            recomputeFollowing(tx, cmd.companyId, employee, to),
          ]),
        ]
          .filter(Boolean)
          .join(' ')
      : '';
  const warning = [w.warning, beyond, leftOn, stale, following].filter(Boolean).join(' ');
  return { id, version, number, ...(warning ? { warning } : {}) };
}

const dayAfter = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * The sick leaves continuing the one that ends on `end` (QERARLAR 2026-10-28 §3): worked out again,
 * since the employer days left and the four quarters are the illness's. A sheet in a closed period
 * stays as it is (the warning says so).
 */
function recomputeFollowing(tx: Tx, companyId: string, employee: Row, end: string): string {
  const closed = str(tx.company(companyId).closed_through);
  const changed: string[] = [];
  const kept: string[] = [];
  const touched: [string, string][] = [];
  for (let date = end; ;) {
    const a = tx.db.get(
      `SELECT * FROM payroll_absences WHERE company_id=? AND employee_id=? AND kind='sick' AND status='posted'
         AND date_from=?`,
      companyId,
      str(employee.id),
      dayAfter(date),
    );
    if (!a) break;
    date = str(a.date_to);
    if (str(a.date_from) <= closed) {
      kept.push(str(a.number));
      continue;
    }
    const manual = str(a.manual) ? parseMoney(str(a.manual)) : null;
    const w = workOut(
      tx,
      companyId,
      'sick',
      employee,
      str(a.date_from),
      str(a.date_to),
      Number(a.days),
      manual,
      Number(a.percent),
      a.employer_all === 1n,
      str(a.id),
    );
    if (
      w.amount === a.amount &&
      w.daily === a.daily &&
      w.employerDays === Number(a.employer_days) &&
      w.basis === str(a.basis)
    )
      continue;
    const version = Number(a.version) + 1;
    tx.db.run(
      `UPDATE payroll_absences SET average=?,daily=?,employer_days=?,fund_days=?,amount=?,basis=?,version=?,
         updated_at=? WHERE id=?`,
      w.average,
      w.daily,
      w.employerDays,
      w.fundDays,
      w.amount,
      w.basis,
      version,
      tx.clock.now(),
      str(a.id),
    );
    tx.history(companyId, 'absence', str(a.id), version, 'posted', {
      kind: 'sick',
      number: str(a.number),
      employee: str(employee.name),
      from: str(a.date_from),
      to: str(a.date_to),
      amount: formatMinor(w.amount),
      basis: w.basis,
    });
    tx.audit(
      companyId,
      'Yenidən hesablandı',
      absenceLabel.sick,
      str(a.id),
      `${str(a.number)} · əvvəlki vərəqə dəyişdi · ${formatMinor(w.amount)} AZN`,
    );
    changed.push(str(a.number));
    touched.push([str(a.date_from), str(a.date_to)]);
  }
  const stale = touched.length
    ? staleWarning(tx, companyId, touched[0]![0], touched.at(-1)![1])
    : '';
  return [
    changed.length ? `Davam vərəqəsi yenidən hesablandı: ${changed.join(', ')}.` : '',
    kept.length ? `Bağlı dövrdəki davam vərəqəsi dəyişmədi: ${kept.join(', ')}.` : '',
    stale,
  ]
    .filter(Boolean)
    .join(' ');
}

export function cancelAbsence(tx: Tx, cmd: CommandOf<'absence.cancel'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = parseText(cmd.reason, 'Ləğv səbəbi');
  const row = tx.db.get(
    'SELECT * FROM payroll_absences WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('Sənəd tapılmadı.', 'id', 'not-found');
  const kind = row.kind as Kind;
  expectVersion(row, cmd.version, absenceLabel[kind]);
  if (row.status !== 'posted')
    throw new DomainError('Sənəd artıq ləğv edilib.', undefined, 'conflict');
  tx.open(cmd.companyId, str(row.date_from), 'from');
  const version = Number(row.version) + 1;
  tx.db.run(
    "UPDATE payroll_absences SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  tx.history(cmd.companyId, 'absence', cmd.id, version, 'cancelled', { reason });
  tx.audit(
    cmd.companyId,
    'Ləğv edildi',
    absenceLabel[kind],
    cmd.id,
    `${str(row.number)} · ${reason}`,
  );
  const employee = tx.db.get(
    'SELECT * FROM employees WHERE company_id=? AND id=?',
    cmd.companyId,
    str(row.employee_id),
  )!;
  const warning = [
    staleWarning(tx, cmd.companyId, str(row.date_from), str(row.date_to)),
    kind === 'sick' ? recomputeFollowing(tx, cmd.companyId, employee, str(row.date_to)) : '',
  ]
    .filter(Boolean)
    .join(' ');
  return { id: cmd.id, version, ...(warning ? { warning } : {}) };
}

function view(r: Row, names: Map<string, string>): AbsenceView {
  return {
    id: str(r.id),
    version: Number(r.version),
    kind: r.kind as Kind,
    number: str(r.number),
    employeeId: str(r.employee_id),
    employeeName: names.get(str(r.employee_id)) ?? '',
    from: str(r.date_from),
    to: str(r.date_to),
    days: Number(r.days),
    sheetNo: str(r.sheet_no),
    percent: Number(r.percent),
    employerAll: r.employer_all === 1n,
    manual: str(r.manual),
    average: formatMinor(r.average as bigint),
    daily: formatMinor(r.daily as bigint),
    employerDays: Number(r.employer_days),
    fundDays: Number(r.fund_days),
    amount: formatMinor(r.amount as bigint),
    basis: str(r.basis),
    memo: str(r.memo),
    status: r.status as AbsenceView['status'],
  };
}

const employeeNames = (db: Db, companyId: string) =>
  new Map(
    db
      .all('SELECT id,name FROM employees WHERE company_id=?', companyId)
      .map((e) => [str(e.id), str(e.name)]),
  );

export function absences(db: Db, companyId: string, kind?: Kind): AbsenceView[] {
  const names = employeeNames(db, companyId);
  return db
    .all(
      `SELECT * FROM payroll_absences WHERE company_id=?${kind ? ' AND kind=?' : ''} ORDER BY date_from DESC, rowid DESC`,
      companyId,
      ...(kind ? [kind] : []),
    )
    .map((r) => view(r, names));
}

export function absence(db: Db, companyId: string, id: string): AbsenceView {
  const r = db.get('SELECT * FROM payroll_absences WHERE company_id=? AND id=?', companyId, id);
  if (!r) throw new DomainError('Sənəd tapılmadı.', 'id', 'not-found');
  return view(r, employeeNames(db, companyId));
}
