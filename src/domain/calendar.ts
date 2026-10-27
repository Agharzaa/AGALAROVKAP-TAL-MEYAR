/**
 * The production calendar (stage 8d; plan §13, QERARLAR 2026-10-27 §13): public holidays (Labour
 * Code art. 105), rest days moved by the Cabinet, weekend days made working, and the shortened
 * pre-holiday days (one hour less). Working days and norm hours of a period follow from it; a day
 * not in it is a working day from Monday to Friday.
 */
export type DayKind = 'holiday' | 'rest' | 'work' | 'short';
export interface CalendarDay {
  date: string;
  kind: DayKind;
  name: string;
}

export const dayKindLabel: Record<DayKind, string> = {
  holiday: 'Bayram (iş günü deyil)',
  rest: 'Köçürülmüş istirahət günü',
  work: 'İş gününə çevrilmiş istirahət günü',
  short: 'Bayramqabağı qısaldılmış gün (−1 saat)',
};

/**
 * 2026 (Cabinet decision No. 362 of 02.12.2025, the ministry's production calendar): 241 working
 * days, 1 922 hours in a 40-hour week. The accountant confirms it and may change it.
 */
export const calendar2026: CalendarDay[] = [
  { date: '2026-01-01', kind: 'holiday', name: 'Yeni il' },
  { date: '2026-01-02', kind: 'holiday', name: 'Yeni il' },
  { date: '2026-01-19', kind: 'short', name: 'Bayramqabağı' },
  { date: '2026-01-20', kind: 'holiday', name: 'Ümumxalq Hüzn Günü' },
  { date: '2026-03-08', kind: 'holiday', name: 'Qadınlar günü' },
  { date: '2026-03-09', kind: 'rest', name: 'Köçürülmüş (8 mart)' },
  { date: '2026-03-19', kind: 'short', name: 'Bayramqabağı' },
  { date: '2026-03-20', kind: 'holiday', name: 'Novruz, Ramazan bayramı' },
  { date: '2026-03-21', kind: 'holiday', name: 'Novruz, Ramazan bayramı' },
  { date: '2026-03-22', kind: 'holiday', name: 'Novruz bayramı' },
  { date: '2026-03-23', kind: 'holiday', name: 'Novruz bayramı' },
  { date: '2026-03-24', kind: 'holiday', name: 'Novruz bayramı' },
  { date: '2026-03-25', kind: 'rest', name: 'Köçürülmüş istirahət günü' },
  { date: '2026-03-26', kind: 'rest', name: 'Köçürülmüş istirahət günü' },
  { date: '2026-03-27', kind: 'rest', name: 'Köçürülmüş istirahət günü' },
  { date: '2026-03-30', kind: 'rest', name: 'Köçürülmüş istirahət günü' },
  { date: '2026-05-08', kind: 'short', name: 'Bayramqabağı' },
  { date: '2026-05-09', kind: 'holiday', name: 'Faşizm üzərində Qələbə günü' },
  { date: '2026-05-11', kind: 'rest', name: 'Köçürülmüş (9 may)' },
  { date: '2026-05-26', kind: 'short', name: 'Bayramqabağı' },
  { date: '2026-05-27', kind: 'holiday', name: 'Qurban bayramı' },
  { date: '2026-05-28', kind: 'holiday', name: 'Qurban bayramı, Müstəqillik günü' },
  { date: '2026-05-29', kind: 'rest', name: 'Köçürülmüş (28 may)' },
  { date: '2026-06-15', kind: 'holiday', name: 'Milli Qurtuluş günü' },
  { date: '2026-06-25', kind: 'short', name: 'Bayramqabağı' },
  { date: '2026-06-26', kind: 'holiday', name: 'Silahlı Qüvvələr günü' },
  { date: '2026-11-08', kind: 'holiday', name: 'Zəfər günü' },
  { date: '2026-11-09', kind: 'holiday', name: 'Dövlət Bayrağı günü' },
  { date: '2026-11-10', kind: 'rest', name: 'Köçürülmüş (8 noyabr)' },
  { date: '2026-12-30', kind: 'short', name: 'Bayramqabağı' },
  { date: '2026-12-31', kind: 'holiday', name: 'Dünya azərbaycanlılarının həmrəyliyi günü' },
];

/** A day's place in the calendar: whether it is worked, its norm hours, a public holiday. */
export class WorkCalendar {
  private readonly days: Map<string, CalendarDay>;
  constructor(days: readonly CalendarDay[] = []) {
    this.days = new Map(days.map((d) => [d.date, d]));
  }
  kind(date: string): DayKind | undefined {
    return this.days.get(date)?.kind;
  }
  name(date: string): string {
    return this.days.get(date)?.name ?? '';
  }
  isWorkday(date: string): boolean {
    const k = this.kind(date);
    if (k === 'work' || k === 'short') return true;
    if (k === 'holiday' || k === 'rest') return false;
    const w = new Date(`${date}T00:00:00Z`).getUTCDay();
    return w !== 0 && w !== 6;
  }
  /** A public holiday: not counted in a vacation, which grows by it (Labour Code). */
  isHoliday(date: string): boolean {
    return this.kind(date) === 'holiday';
  }
  /** Norm hours of a day in a 40-hour five-day week: 8, a shortened day 7, a day off 0. */
  hours(date: string): number {
    return this.isWorkday(date) ? (this.kind(date) === 'short' ? 7 : 8) : 0;
  }
}

const next = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Every day from `from` to `to`, both included. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = next(d)) out.push(d);
  return out;
}

export function workdaysIn(cal: WorkCalendar, from: string, to: string): number {
  return eachDay(from, to).filter((d) => cal.isWorkday(d)).length;
}

export function normHours(cal: WorkCalendar, from: string, to: string): number {
  return eachDay(from, to).reduce((s, d) => s + cal.hours(d), 0);
}

/** Vacation days of a period: its calendar days less the public holidays in it. */
export function vacationDays(cal: WorkCalendar, from: string, to: string): number {
  return eachDay(from, to).filter((d) => !cal.isHoliday(d)).length;
}

/** The last day of a vacation of `days` days from `from`, the holidays in it not counted. */
export function vacationEnd(cal: WorkCalendar, from: string, days: number): string {
  let d = from;
  let left = days;
  for (;;) {
    if (!cal.isHoliday(d)) left--;
    if (left <= 0) return d;
    d = next(d);
  }
}
