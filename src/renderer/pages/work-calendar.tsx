/**
 * Stage 8d — the production calendar (plan §13): a year's special days (holidays, moved rest days,
 * weekend days made working, shortened days) and the month norms they give. Payrolls, timesheets
 * and vacations are worked out by it.
 */
import { useEffect, useState } from 'react';
import { Check, Plus, Trash2 } from '../icons';
import { dayKindLabel, type DayKind } from '../../domain/calendar';
import type { CalendarView } from '../../contracts/queries';
import { ModuleFrame } from '../frame';
import { monthTitle, today } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages } from '../pages';
import { DateInput, Notice } from '../ui';
import { useWindow } from '../workspace';

interface Day {
  date: string;
  kind: DayKind;
  name: string;
}

export function WorkCalendarPage() {
  const win = useWindow();
  const page = pages.workCalendar;
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const result = useQuery<CalendarView>({ type: 'calendar', companyId: win.companyId, year });
  const v = result.data;
  const [days, setDays] = useState<Day[] | null>(null);
  const m = useMutation();
  const [message, setMessage] = useState('');
  useEffect(() => setDays(v && v.year === year ? v.days : null), [v, year]);
  const dirty = !!v && !!days && JSON.stringify(days) !== JSON.stringify(v.days);
  const set = (i: number, patch: Partial<Day>) =>
    setDays(days!.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  async function save() {
    if (!days) return;
    setMessage('');
    const r = await m.run({
      type: 'calendar.save',
      companyId: win.companyId,
      year,
      days: days.filter((d) => d.date),
    });
    if (r) {
      setMessage(`${year}-ci ilin təqvimi saxlanıldı.`);
      result.reload();
    }
  }
  return (
    <ModuleFrame
      title={page.title}
      hint={v ? `${year}: ${v.workdays} iş günü, ${v.hours} saat (40 saatlıq həftə)` : page.hint}
      onRefresh={result.reload}
      actions={
        <button
          type="button"
          className="button primary"
          disabled={!dirty || m.busy}
          onClick={() => void save()}
        >
          <Check size={15} /> Saxla
        </button>
      }
      filters={
        <label className="filter-text">
          <span>İl</span>
          <input
            aria-label="İl"
            inputMode="numeric"
            maxLength={4}
            value={year}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, ''));
              if (n >= 2000 && n <= 2100) setYear(n);
            }}
          />
        </label>
      }
      notices={
        <>
          {result.error && <Notice>{result.error}</Notice>}
          {m.error && <Notice onClose={m.clear}>{m.error.message}</Notice>}
          {message && (
            <Notice kind="success" onClose={() => setMessage('')}>
              {message}
            </Notice>
          )}
          {v && !v.known && (
            <Notice kind="warning">
              {year}-ci il üçün təqvim yazılmayıb: bayramlar sayılmır, yalnız şənbə və bazar
              istirahətdir. Nazirlər Kabinetinin qərarı ilə bayramları və köçürülmüş günləri əlavə
              edin.
            </Notice>
          )}
          {v?.known && year === 2026 && (
            <Notice kind="info">
              2026 — Nazirlər Kabinetinin 02.12.2025 tarixli 362 saylı qərarı və ƏƏSMN-in istehsalat
              təqvimi ilə (241 iş günü, 1 922 saat). Mühasib yoxlayır.
            </Notice>
          )}
        </>
      }
    >
      <div className="calendar-page">
        <table className="grid report" aria-label="Aylar üzrə norma">
          <thead>
            <tr>
              <th scope="col">Ay</th>
              <th scope="col" className="num">
                İş günü
              </th>
              <th scope="col" className="num">
                Saat
              </th>
            </tr>
          </thead>
          <tbody>
            {v?.months.map((x) => (
              <tr key={x.month}>
                <th scope="row">{monthTitle(x.month)}</th>
                <td className="num">{x.workdays}</td>
                <td className="num">{x.hours}</td>
              </tr>
            ))}
            {v && (
              <tr className="total">
                <th scope="row">İl</th>
                <td className="num">{v.workdays}</td>
                <td className="num">{v.hours}</td>
              </tr>
            )}
          </tbody>
        </table>
        <section className="panel calendar-days" aria-label="Xüsusi günlər">
          <h2>Xüsusi günlər</h2>
          {days?.map((d, i) => (
            <div key={i} className="calendar-day">
              <DateInput
                value={d.date}
                onChange={(date) => set(i, { date })}
                aria-label={`Gün ${i + 1}: tarix`}
              />
              <select
                aria-label={`Gün ${i + 1}: növ`}
                value={d.kind}
                onChange={(e) => set(i, { kind: e.target.value as DayKind })}
              >
                {(Object.keys(dayKindLabel) as DayKind[]).map((k) => (
                  <option key={k} value={k}>
                    {dayKindLabel[k]}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Gün ${i + 1}: ad`}
                maxLength={120}
                value={d.name}
                placeholder="Ad (məs. Novruz bayramı)"
                onChange={(e) => set(i, { name: e.target.value })}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`Gün ${i + 1}: sil`}
                onClick={() => setDays(days.filter((_, j) => j !== i))}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              setDays([...(days ?? []), { date: `${year}-01-01`, kind: 'holiday', name: '' }])
            }
          >
            <Plus size={15} /> Gün əlavə et
          </button>
        </section>
      </div>
    </ModuleFrame>
  );
}
