/**
 * Stage 8d — the timesheet (plan §13): a month's document, one row per employee and a cell per
 * day — hours worked (İ), a business trip (E), vacation (M), unpaid leave (Ö), sick leave (X),
 * absence without a reason (Q), a day off (B). It is filled from the calendar, the employment and
 * the vacation / sick leave documents; the payroll of the month pays by it: the salary for the
 * norm hours worked, overtime, work on a day off and night hours at their rates.
 */
import { eachDay, normHours, type WorkCalendar } from '../domain/calendar.js';
import { DomainError } from '../domain/errors.js';
import { type Minor } from '../domain/money.js';
import { monthBounds, timesheetPay, type ExtraPay } from '../domain/payroll.js';
import { numberKey, parseText } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type {
  TimesheetDay,
  TimesheetDetail,
  TimesheetFill,
  TimesheetRowView,
  TimesheetView,
} from '../contracts/queries.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import { loadCalendar } from './calendar.js';
import { checkMonth } from './revaluation.js';
import { expectVersion, type Tx } from './tx.js';

const LABEL = 'Tabel';
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

type Code = 'İ' | 'E' | 'M' | 'Ö' | 'X' | 'Q' | 'B' | '';
interface Cell {
  c: Code;
  /** Hours in hundredths (İ, E). */
  h: number;
}

const hoursText = (h: number) => {
  const v = h / 100;
  return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
};
/** "8", "7,5", "E", "E8", "M", "Ö", "X", "Q", "B" or "" → a cell. */
export function parseCell(text: string, norm: number, where: string): Cell {
  const t = text.trim().toUpperCase().replace('İ', 'I').replace('O', 'Ö');
  if (!t) return { c: '', h: 0 };
  const hours = (s: string) => {
    const v = Math.round(Number(s.replace(',', '.')) * 100);
    if (!Number.isFinite(v) || v < 0 || v > 2400)
      throw new DomainError(`${where}: saat 0–24 olmalıdır.`);
    return v;
  };
  let m = /^I?(\d{1,2}(?:[.,]\d{1,2})?)$/.exec(t);
  if (m) return { c: 'İ', h: hours(m[1]!) };
  m = /^E(\d{1,2}(?:[.,]\d{1,2})?)?$/.exec(t);
  if (m) return { c: 'E', h: m[1] ? hours(m[1]) : norm * 100 || 800 };
  if (['M', 'Ö', 'X', 'Q', 'B'].includes(t)) return { c: t as Code, h: 0 };
  throw new DomainError(`${where}: "${text}" tanınmadı — saat (8), E, M, Ö, X, Q və ya B yazın.`);
}
export const cellText = (c: Cell) =>
  c.c === 'İ' ? hoursText(c.h) : c.c === 'E' ? `E${hoursText(c.h)}` : c.c;

function daysOf(cal: WorkCalendar, month: string): TimesheetDay[] {
  const { first, last } = monthBounds(month);
  return eachDay(first, last).map((date) => ({
    date,
    workday: cal.isWorkday(date),
    holiday: cal.isHoliday(date),
    norm: cal.hours(date),
    name: cal.name(date),
  }));
}

/** The absence code of every day of the month for an employee (posted vacations, sick leaves). */
function absenceCodes(db: Db, companyId: string, employeeId: string, month: string) {
  const { first, last } = monthBounds(month);
  const codes = new Map<string, Code>();
  for (const a of db.all(
    `SELECT kind, date_from, date_to FROM payroll_absences WHERE company_id=? AND employee_id=?
       AND status='posted' AND kind<>'compensation' AND date_from<=? AND date_to>=?`,
    companyId,
    employeeId,
    last,
    first,
  ))
    for (const d of eachDay(str(a.date_from), str(a.date_to)))
      if (d >= first && d <= last)
        codes.set(d, a.kind === 'vacation' ? 'M' : a.kind === 'unpaid' ? 'Ö' : 'X');
  return codes;
}

/** A new timesheet of the month: everyone at work, by the calendar and the absences. */
export function timesheetFill(db: Db, companyId: string, monthInput: string): TimesheetFill {
  const month = checkMonth(monthInput);
  const { first, last } = monthBounds(month);
  const cal = loadCalendar(db, companyId);
  const days = daysOf(cal, month);
  const rows = db
    .all(
      `SELECT * FROM employees WHERE company_id=? AND archived=0
         AND (hired='' OR hired<=?) AND (left_on='' OR left_on>=?) ORDER BY tab_no, name`,
      companyId,
      last,
      first,
    )
    .map((e) => {
      const away = absenceCodes(db, companyId, str(e.id), month);
      return {
        employeeId: str(e.id),
        name: str(e.name),
        cells: days.map((d) => {
          if (
            (str(e.hired) && d.date < str(e.hired)) ||
            (str(e.left_on) && d.date > str(e.left_on))
          )
            return '';
          const a = away.get(d.date);
          if (a) return a;
          return d.workday ? String(d.norm) : 'B';
        }),
      };
    });
  return { month, days, rows };
}

/** Totals of a row: worked days and hours, hours over the day's norm, hours on days off. */
function totals(cells: Cell[], days: TimesheetDay[]) {
  let worked = 0;
  let over = 0;
  let off = 0;
  let count = 0;
  const absent = { vacation: 0, unpaid: 0, sick: 0, truancy: 0 };
  cells.forEach((c, i) => {
    const d = days[i]!;
    if (c.c === 'İ' || c.c === 'E') {
      if (c.h > 0) count++;
      if (d.workday) {
        const norm = d.norm * 100;
        worked += Math.min(c.h, norm);
        over += Math.max(0, c.h - norm);
      } else off += c.h;
    } else if (c.c === 'M') absent.vacation++;
    else if (c.c === 'Ö') absent.unpaid++;
    else if (c.c === 'X') absent.sick++;
    else if (c.c === 'Q') absent.truancy++;
  });
  return { worked, over, off, count, absent };
}

const parseHours = (v: string, where: string) => {
  const t = v.trim();
  if (!t) return 0;
  return parseCell(t, 0, where).h;
};

function nextNumber(tx: Tx, companyId: string, month: string): string {
  const base = `TB-${month}`;
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (
      !tx.db.get(
        'SELECT 1 AS x FROM timesheets WHERE company_id=? AND number_key=?',
        companyId,
        numberKey(candidate),
      )
    )
      return candidate;
  }
}

export function saveTimesheet(tx: Tx, cmd: CommandOf<'timesheet.save'>): CommandResult {
  tx.company(cmd.companyId);
  const month = checkMonth(cmd.month);
  const { last } = monthBounds(month);
  const memo = parseText(cmd.memo, 'Məzmun', 500, false);
  const existing = cmd.id
    ? tx.db.get('SELECT * FROM timesheets WHERE company_id=? AND id=?', cmd.companyId, cmd.id)
    : undefined;
  if (cmd.id && !existing) throw new DomainError('Tabel tapılmadı.', 'id', 'not-found');
  if (existing) {
    expectVersion(existing, cmd.version, LABEL);
    if (existing.status !== 'posted')
      throw new DomainError('Ləğv edilmiş tabel dəyişdirilmir.', undefined, 'conflict');
    tx.open(cmd.companyId, str(existing.date), 'month');
  }
  tx.open(cmd.companyId, last, 'month');
  const other = tx.db.get(
    "SELECT number FROM timesheets WHERE company_id=? AND month=? AND status='posted' AND id<>?",
    cmd.companyId,
    month,
    cmd.id ?? '',
  );
  if (other)
    throw new DomainError(
      `${month} ayının tabeli artıq var (${str(other.number)}): onu düzəldin.`,
      'month',
      'conflict',
    );
  const cal = loadCalendar(tx.db, cmd.companyId);
  const days = daysOf(cal, month);
  const seen = new Set<string>();
  const rows = cmd.rows.map((r, i) => {
    const where = `Sətir ${i + 1}`;
    const e = tx.db.get(
      'SELECT name FROM employees WHERE company_id=? AND id=?',
      cmd.companyId,
      r.employeeId,
    );
    if (!e) throw new DomainError(`${where}: işçi tapılmadı.`, `rows.${i}.employeeId`, 'not-found');
    if (seen.has(r.employeeId))
      throw new DomainError(
        `${where}: ${str(e.name)} tabeldə ikinci dəfədir.`,
        `rows.${i}.employeeId`,
      );
    seen.add(r.employeeId);
    if (r.cells.length > days.length)
      throw new DomainError(`${where}: ayda ${days.length} gün var.`, `rows.${i}.cells`);
    const cells = days.map((d, j) =>
      parseCell(r.cells[j] ?? '', d.norm, `${where}, ${Number(d.date.slice(8))}-i`),
    );
    return {
      employeeId: r.employeeId,
      cells,
      overtime: parseHours(r.overtime, `${where}: artıq iş saatı`),
      night: parseHours(r.night, `${where}: gecə saatı`),
    };
  });
  const number =
    parseText(cmd.number, 'Nömrə', 40, false) ||
    (existing ? str(existing.number) : nextNumber(tx, cmd.companyId, month));
  const key = numberKey(number);
  const same = tx.db.get(
    'SELECT id FROM timesheets WHERE company_id=? AND number_key=?',
    cmd.companyId,
    key,
  );
  if (same && same.id !== cmd.id)
    throw new DomainError('Bu nömrə ilə tabel artıq var.', 'number', 'conflict');
  const id = existing ? str(existing.id) : tx.id();
  const version = existing ? Number(existing.version) + 1 : 1;
  const now = tx.clock.now();
  if (existing) {
    tx.db.run(
      'UPDATE timesheets SET number=?,number_key=?,memo=?,version=?,updated_at=? WHERE id=?',
      number,
      key,
      memo,
      version,
      now,
      id,
    );
    tx.db.run('DELETE FROM timesheet_rows WHERE document_id=?', id);
  } else
    tx.db.run(
      "INSERT INTO timesheets VALUES(?,?,?,?,?,?,?,'posted',?,?,?)",
      id,
      cmd.companyId,
      month,
      number,
      key,
      last,
      memo,
      version,
      now,
      now,
    );
  rows.forEach((r, i) =>
    tx.db.run(
      'INSERT INTO timesheet_rows VALUES(?,?,?,?,?,?,?)',
      cmd.companyId,
      id,
      i + 1,
      r.employeeId,
      JSON.stringify(r.cells),
      r.overtime,
      r.night,
    ),
  );
  tx.history(cmd.companyId, 'timesheet', id, version, 'posted', {
    month,
    number,
    rows: rows.map((r) => ({ employeeId: r.employeeId, cells: r.cells.map(cellText) })),
  });
  tx.audit(
    cmd.companyId,
    existing ? 'Dəyişdirildi' : 'Yaradıldı',
    LABEL,
    id,
    `${number} · ${month} · ${rows.length} işçi`,
  );
  return { id, version, number };
}

export function cancelTimesheet(tx: Tx, cmd: CommandOf<'timesheet.cancel'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = parseText(cmd.reason, 'Ləğv səbəbi');
  const row = tx.db.get(
    'SELECT * FROM timesheets WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('Tabel tapılmadı.', 'id', 'not-found');
  expectVersion(row, cmd.version, LABEL);
  if (row.status !== 'posted')
    throw new DomainError('Tabel artıq ləğv edilib.', undefined, 'conflict');
  tx.open(cmd.companyId, str(row.date), 'month');
  const version = Number(row.version) + 1;
  tx.db.run(
    "UPDATE timesheets SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  tx.history(cmd.companyId, 'timesheet', cmd.id, version, 'cancelled', { reason });
  tx.audit(cmd.companyId, 'Ləğv edildi', LABEL, cmd.id, `${str(row.number)} · ${reason}`);
  return { id: cmd.id, version };
}

// ---------------------------------------------------------------------------------------------
// Queries and the payroll's use of it

function rowView(
  db: Db,
  companyId: string,
  month: string,
  r: Row,
  e: Row | undefined,
  days: TimesheetDay[],
  norm: number,
): TimesheetRowView & { stale: boolean } {
  const cells = JSON.parse(str(r.cells)) as Cell[];
  const t = totals(cells, days);
  const expected = absenceCodes(db, companyId, str(r.employee_id), month);
  const stale = days.some((d, i) => {
    const want = expected.get(d.date) ?? '';
    const have = cells[i]!.c;
    const isAbsence = (c: string) => c === 'M' || c === 'Ö' || c === 'X';
    return (isAbsence(want) || isAbsence(have)) && want !== have;
  });
  return {
    employeeId: str(r.employee_id),
    name: str(e?.name),
    tabNo: str(e?.tab_no),
    cells: cells.map(cellText),
    overtime: hoursText(Number(r.overtime)),
    overtimeTotal: hoursText(Number(r.overtime) + t.over),
    night: hoursText(Number(r.night)),
    days: t.count,
    hours: hoursText(t.worked),
    holidayHours: hoursText(t.off),
    norm: hoursText(norm * 100),
    absent: t.absent,
    stale,
  };
}

function view(db: Db, r: Row): TimesheetDetail {
  const companyId = str(r.company_id);
  const month = str(r.month);
  const cal = loadCalendar(db, companyId);
  const days = daysOf(cal, month);
  const { first, last } = monthBounds(month);
  const norm = normHours(cal, first, last);
  const names = new Map(
    db.all('SELECT * FROM employees WHERE company_id=?', companyId).map((e) => [str(e.id), e]),
  );
  const rows = db
    .all('SELECT * FROM timesheet_rows WHERE document_id=? ORDER BY line_no', str(r.id))
    .map((x) => rowView(db, companyId, month, x, names.get(str(x.employee_id)), days, norm));
  return {
    id: str(r.id),
    version: Number(r.version),
    month,
    number: str(r.number),
    date: str(r.date),
    memo: str(r.memo),
    status: r.status as TimesheetView['status'],
    rows: rows.map(({ stale: _, ...x }) => x),
    stale: r.status === 'posted' ? rows.filter((x) => x.stale).map((x) => x.name) : [],
    days,
  };
}

export function timesheets(db: Db, companyId: string): TimesheetView[] {
  return db
    .all('SELECT * FROM timesheets WHERE company_id=? ORDER BY month DESC, rowid DESC', companyId)
    .map((r) => {
      const { days: _, ...v } = view(db, r);
      return v;
    });
}

export function timesheet(db: Db, companyId: string, id: string): TimesheetDetail {
  const r = db.get('SELECT * FROM timesheets WHERE company_id=? AND id=?', companyId, id);
  if (!r) throw new DomainError('Tabel tapılmadı.', 'id', 'not-found');
  return view(db, r);
}

/** The month's posted timesheet, if any. */
export function postedTimesheet(db: Db, companyId: string, month: string): Row | undefined {
  return db.get(
    "SELECT * FROM timesheets WHERE company_id=? AND month=? AND status='posted'",
    companyId,
    month,
  );
}

/**
 * The pay of an employee's row of the month's posted timesheet (8d): the salary for the norm hours
 * worked and the extra pay; null without a timesheet or a row of the employee.
 */
export function timesheetPayOf(
  db: Db,
  companyId: string,
  month: string,
  employeeId: string,
  salary: Minor,
  pay: ExtraPay,
  cal: WorkCalendar,
): { salary: Minor; overtime: Minor; holidayWork: Minor; night: Minor } | null {
  const doc = postedTimesheet(db, companyId, month);
  if (!doc) return null;
  const r = db.get(
    'SELECT * FROM timesheet_rows WHERE document_id=? AND employee_id=?',
    str(doc.id),
    employeeId,
  );
  if (!r) return null;
  const days = daysOf(cal, month);
  const { first, last } = monthBounds(month);
  const t = totals(JSON.parse(str(r.cells)) as Cell[], days);
  return timesheetPay({
    salary,
    norm: normHours(cal, first, last) * 100,
    worked: t.worked,
    overtime: Number(r.overtime) + t.over,
    holidayWork: t.off,
    night: Number(r.night),
    pay,
  });
}

/** The month closing's check (8d): a timesheet that no longer matches the absences blocks it. */
export function timesheetSignals(db: Db, companyId: string, month: string): string[] {
  const doc = postedTimesheet(db, companyId, month);
  if (!doc) return [];
  const stale = view(db, doc).stale;
  return stale.length
    ? [
        `${str(doc.number)} tabeli məzuniyyət / xəstəlik sənədlərinə uyğun deyil: ${stale.join(', ')}. Tabeli açıb "Doldur" və saxlayın.`,
      ]
    : [];
}
