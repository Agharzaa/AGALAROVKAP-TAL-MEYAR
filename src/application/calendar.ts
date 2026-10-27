/**
 * Stage 8d — the company's production calendar (plan §13): the special days of a year, seeded for
 * 2026 and changed by the accountant; the working days and norm hours that payrolls, timesheets
 * and vacations are worked out by.
 */
import {
  calendar2026,
  normHours,
  WorkCalendar,
  workdaysIn,
  type CalendarDay,
  type DayKind,
} from '../domain/calendar.js';
import { DomainError } from '../domain/errors.js';
import { parseDate, parseText } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type { CalendarView } from '../contracts/queries.js';
import type { Db } from '../infrastructure/sqlite/db.js';
import type { Tx } from './tx.js';

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** The company's calendar (all its years: a few hundred rows at most). */
export function loadCalendar(db: Db, companyId: string): WorkCalendar {
  return new WorkCalendar(
    db
      .all('SELECT date, kind, name FROM work_calendar WHERE company_id=?', companyId)
      .map((r) => ({ date: str(r.date), kind: r.kind as DayKind, name: str(r.name) })),
  );
}

/** A new company starts with the 2026 calendar (plan §13). */
export function seedCalendar(tx: Tx, companyId: string) {
  for (const d of calendar2026)
    tx.db.run('INSERT INTO work_calendar VALUES(?,?,?,?)', companyId, d.date, d.kind, d.name);
}

export function saveCalendar(tx: Tx, cmd: CommandOf<'calendar.save'>): CommandResult {
  tx.company(cmd.companyId);
  const year = String(cmd.year);
  const seen = new Set<string>();
  const days: CalendarDay[] = cmd.days.map((d, i) => {
    const date = parseDate(d.date, `Gün ${i + 1}`);
    if (date.slice(0, 4) !== year)
      throw new DomainError(`Gün ${i + 1}: ${date} ${year}-ci ilə aid deyil.`, `days.${i}.date`);
    if (seen.has(date))
      throw new DomainError(`Gün ${i + 1}: ${date} ikinci dəfədir.`, `days.${i}.date`);
    seen.add(date);
    const w = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (d.kind === 'work' && w !== 0 && w !== 6)
      throw new DomainError(
        `Gün ${i + 1}: ${date} onsuz da iş günüdür — "iş gününə çevrilmiş" yalnız şənbə / bazar ola bilər.`,
        `days.${i}.kind`,
      );
    return { date, kind: d.kind, name: parseText(d.name, `Gün ${i + 1}: ad`, 120, false) };
  });
  // Months already closed keep their calendar: the payrolls of them were worked out by it.
  const closed = str(tx.company(cmd.companyId).closed_through);
  const before = new Map(
    tx.db
      .all(
        'SELECT date, kind FROM work_calendar WHERE company_id=? AND substr(date,1,4)=?',
        cmd.companyId,
        year,
      )
      .map((r) => [str(r.date), str(r.kind)]),
  );
  const changed = [
    ...days.filter((d) => before.get(d.date) !== d.kind).map((d) => d.date),
    ...[...before.keys()].filter((d) => !seen.has(d)),
  ];
  const locked = changed.filter((d) => d <= closed).sort();
  if (locked.length)
    throw new DomainError(
      `${locked[0]} bağlı dövrdədir: bağlanmış ayların təqvimi dəyişdirilmir.`,
      'days',
      'closed-period',
    );
  tx.db.run(
    'DELETE FROM work_calendar WHERE company_id=? AND substr(date,1,4)=?',
    cmd.companyId,
    year,
  );
  for (const d of days)
    tx.db.run('INSERT INTO work_calendar VALUES(?,?,?,?)', cmd.companyId, d.date, d.kind, d.name);
  const cal = new WorkCalendar(days);
  tx.audit(
    cmd.companyId,
    'Dəyişdirildi',
    'İstehsalat təqvimi',
    year,
    `${year}: ${days.length} xüsusi gün · ${workdaysIn(cal, `${year}-01-01`, `${year}-12-31`)} iş günü`,
  );
  return { id: year };
}

export function calendarView(db: Db, companyId: string, year: number): CalendarView {
  const y = String(year);
  const rows = db
    .all(
      'SELECT date, kind, name FROM work_calendar WHERE company_id=? AND substr(date,1,4)=? ORDER BY date',
      companyId,
      y,
    )
    .map((r) => ({ date: str(r.date), kind: r.kind as DayKind, name: str(r.name) }));
  const cal = new WorkCalendar(rows);
  const months = Array.from({ length: 12 }, (_, i) => {
    const month = `${y}-${String(i + 1).padStart(2, '0')}`;
    const last = new Date(Date.UTC(year, i + 1, 0)).toISOString().slice(0, 10);
    return {
      month,
      workdays: workdaysIn(cal, `${month}-01`, last),
      hours: normHours(cal, `${month}-01`, last),
    };
  });
  return {
    year,
    known: rows.length > 0,
    days: rows,
    months,
    workdays: months.reduce((s, m) => s + m.workdays, 0),
    hours: months.reduce((s, m) => s + m.hours, 0),
  };
}
