/**
 * Stage 8c — vacations and sick leaves (plan §12, QERARLAR 2026-10-27 §9, §10, §12). They post
 * nothing: the pay is worked out when the document is saved, kept on it with how it was worked out,
 * and goes to the payroll of the month the absence starts in; its working days are not paid as
 * salary. A change after that month's payroll was posted makes the payroll stale (it says so, and
 * the month closing waits for it to be saved again).
 */
import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney, type Minor } from '../domain/money.js';
import {
  calendarDays,
  fourQuartersBefore,
  monthBounds,
  sickPay,
  vacationPay,
  type Away,
} from '../domain/payroll.js';
import { numberKey, parseDate, parseText } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type { AbsenceView } from '../contracts/queries.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import { expectVersion, type Tx } from './tx.js';

type Kind = 'vacation' | 'unpaid' | 'sick';
const prefix: Record<Kind, string> = { vacation: 'MZ', unpaid: 'ÖM', sick: 'XV' };
export const absenceLabel: Record<Kind, string> = {
  vacation: 'Məzuniyyət',
  unpaid: 'Ödənişsiz məzuniyyət',
  sick: 'Xəstəlik vərəqəsi',
};
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dmy = (iso: string) => iso.split('-').reverse().join('.');
const show = (v: Minor) =>
  formatMinor(v)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const monthOf = (iso: string) => iso.slice(0, 7);
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
         AND date_from<=? AND date_to>=?`,
      companyId,
      employeeId,
      last,
      first,
    )
    .map((r) => ({ from: str(r.date_from), to: str(r.date_to) }));
}

/** The vacation and sick pay that go to the month's payroll: absences starting in that month. */
export function absencePay(
  db: Db,
  companyId: string,
  employeeId: string,
  month: string,
): { vacation: Minor; sick: Minor } {
  const { first, last } = monthBounds(month);
  const r = db.get(
    `SELECT COALESCE(SUM(CASE WHEN kind='vacation' THEN amount END),0) AS v,
       COALESCE(SUM(CASE WHEN kind='sick' THEN amount END),0) AS s
     FROM payroll_absences WHERE company_id=? AND employee_id=? AND status='posted' AND date_from BETWEEN ? AND ?`,
    companyId,
    employeeId,
    first,
    last,
  )!;
  return { vacation: r.v as bigint, sick: r.s as bigint };
}

/**
 * The earnings of every month the payroll was posted for, by month: salary, bonus and vacation pay
 * (the base of the contributions), without sick pay.
 */
function earnings(db: Db, companyId: string, employeeId: string, from: string, to: string) {
  return db.all(
    `SELECT d.month, SUM(l.salary + l.bonus) AS work, SUM(l.salary + l.bonus + l.vacation) AS insured
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
  if (kind === 'vacation') {
    // The 12 full calendar months before the vacation month; a month the employee was hired in
    // after its first day is not a full month.
    const last = previousMonth(monthOf(from));
    let first = last;
    for (let i = 1; i < 12; i++) first = previousMonth(first);
    const months = earnings(tx.db, companyId, employeeId, first, last)
      .filter((r) => !(hired > `${str(r.month)}-01`))
      .map((r) => r.work as bigint);
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
        manual !== null
          ? `Orta aylıq (mühasib): ${show(v.average)} ₼; günlük ${show(v.average)} / 30,4 = ${show(v.daily)} ₼ × ${days} gün.`
          : `${months.length} ay (${first} – ${last}): ${show(months.reduce((s, m) => s + m, 0n))} ₼ / ${months.length} = ${show(v.average)} ₼; ${show(v.average)} / 30,4 = ${show(v.daily)} ₼ × ${days} gün.`,
      warning: '',
    };
  }
  // Sick leave: the four full quarters before, over their calendar days less earlier sick days.
  const q = fourQuartersBefore(from);
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
  const s = sickPay({ base, baseDays, manualDaily: manual, days, percent, employerAll });
  const tenure =
    hired && calendarDays(hired, from) < 183
      ? `Sığorta stajı 6 aydan az ola bilər (işə qəbul ${dmy(hired)}): müavinət hüququnu yoxlayın.`
      : '';
  return {
    average: s.daily,
    daily: s.daily,
    employerDays: s.employerDays,
    fundDays: s.fundDays,
    amount: s.amount,
    basis: `${
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
  const from = parseDate(cmd.from, 'Başlama tarixi');
  const to = parseDate(cmd.to, 'Bitmə tarixi');
  if (to < from) throw new DomainError('Bitmə tarixi başlamadan əvvəl ola bilməz.', 'to');
  const days = calendarDays(from, to);
  if (days > 366) throw new DomainError('Müddət bir ildən çox ola bilməz.', 'to');
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
  if (
    (str(employee.hired) && from < str(employee.hired)) ||
    (str(employee.left_on) && to > str(employee.left_on))
  )
    throw new DomainError(`${name} bu tarixlərdə işləmir (işə qəbul / çıxma tarixi).`, 'from');
  const overlap = tx.db.get(
    `SELECT number, kind FROM payroll_absences WHERE company_id=? AND employee_id=? AND status='posted' AND id<>?
       AND date_from<=? AND date_to>=?`,
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
  const warning = [w.warning, stale].filter(Boolean).join(' ');
  return { id, version, number, ...(warning ? { warning } : {}) };
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
  const warning = staleWarning(tx, cmd.companyId, str(row.date_from), str(row.date_to));
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
