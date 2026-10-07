import { CheckCircle2, CircleAlert, Clock3 } from 'lucide-react';
import type { HomeView, IntegrityView } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { day, longDate, money, today } from '../format';
import { useQuery } from '../hooks';
import { Notice } from '../ui';
import { useWorkspace, type View } from '../workspace';

interface Task {
  state: 'wait' | 'ok' | 'bad';
  title: string;
  detail: string;
  action: string;
  view?: View;
}

export function HomePage({
  integrity,
  integrityLoading,
  onRecheck,
}: {
  integrity: IntegrityView | undefined;
  integrityLoading: boolean;
  onRecheck: () => void;
}) {
  const ws = useWorkspace();
  const { catalog } = useCatalog(ws.companyId);
  const home = useQuery<HomeView>({ type: 'home', companyId: ws.companyId });
  const h = home.data;
  const tasks: Task[] = [];
  if (catalog && h) {
    if (!catalog.bankAccounts.length)
      tasks.push({
        state: 'wait',
        title: 'Bank hesablarını daxil edin',
        detail: 'Hər hesab: bank (kontragent), IBAN, valyuta, 223.01 / 223.02 / 224.04',
        action: 'Aç',
        view: { type: 'page', page: 'bankAccounts' },
      });
    if (h.postings === 0)
      tasks.push({
        state: 'wait',
        title: 'Başlanğıc qalıqları daxil edin',
        detail: 'Əl ilə əməliyyatla: hesab və subkontolar üzrə qalıqlar',
        action: 'Yeni əməliyyat',
        view: { type: 'operation' },
      });
    for (const w of h.warnings)
      tasks.push({
        state: 'bad',
        title:
          w.kind === 'advance'
            ? 'Avans əvəzləşdirilməyib'
            : w.kind === 'stock'
              ? 'Mənfi anbar qalığı'
              : 'Mənfi pul qalığı',
        detail: w.text,
        action: 'Hesab kartı',
        view: { type: 'accountCard', account: w.account, sk: w.sk },
      });
    if (!h.warnings.length && h.postings > 0)
      tasks.push({
        state: 'ok',
        title: 'Hesablaşmalar qaydasındadır',
        detail: 'Avanslar, anbar və pul qalıqları üzrə xəbərdarlıq yoxdur',
        action: 'Dövriyyə balansı',
        view: { type: 'page', page: 'trial' },
      });
  }
  const balance = (dt: string, kt: string) => {
    const d = dt !== '0.00';
    const k = kt !== '0.00';
    if (!d && !k) return <span className="muted">0,00</span>;
    return (
      <>
        {d && (
          <b>
            {money(dt)} <small>Dt</small>
          </b>
        )}
        {d && k && <br />}
        {k && (
          <b>
            {money(kt)} <small>Kt</small>
          </b>
        )}
      </>
    );
  };
  return (
    <div className="home">
      <div className="home-main">
        <section className="panel" aria-label="Gözləyən işlər">
          <h1 className="panel-title">
            Gözləyən işlər <span>· {longDate(today())}</span>
          </h1>
          {home.error && <Notice>{home.error}</Notice>}
          {!h && !home.error && <p className="panel-empty">Yüklənir…</p>}
          {tasks.map((t, i) => (
            <div key={i} className="task-row">
              {t.state === 'ok' ? (
                <CheckCircle2 size={17} className="ok" aria-label="Qaydasındadır" />
              ) : t.state === 'bad' ? (
                <CircleAlert size={17} className="bad" aria-label="Diqqət" />
              ) : (
                <Clock3 size={17} className="wait" aria-label="Gözləyir" />
              )}
              <span className="task-text">
                <b>{t.title}</b>
                <span>{t.detail}</span>
              </span>
              {t.view && (
                <button
                  type="button"
                  className={`button ${t.state === 'ok' ? 'secondary' : 'primary'} small`}
                  onClick={() => ws.open(t.view!)}
                >
                  {t.action}
                </button>
              )}
            </div>
          ))}
        </section>
        <section className="panel" aria-label="Son sənədlər">
          <h2 className="panel-title">Son sənədlər</h2>
          {h && !h.recent.length && <p className="panel-empty">Hələ sənəd yoxdur.</p>}
          {h && h.recent.length > 0 && (
            <table className="grid">
              <thead>
                <tr>
                  <th scope="col">Tarix</th>
                  <th scope="col">Sənəd</th>
                  <th scope="col">Məzmun</th>
                  <th scope="col" className="num">
                    Sətir
                  </th>
                  <th scope="col" className="num">
                    Məbləğ
                  </th>
                </tr>
              </thead>
              <tbody>
                {h.recent.map((o) => (
                  <tr
                    key={o.id}
                    className={o.status === 'cancelled' ? 'cancelled' : ''}
                    onDoubleClick={() => ws.open({ type: 'operation', id: o.id })}
                  >
                    <td>{day(o.date)}</td>
                    <td>
                      <button
                        type="button"
                        className="link"
                        onClick={() => ws.open({ type: 'operation', id: o.id })}
                      >
                        {o.number}
                      </button>
                    </td>
                    <td className="ellipsis">{o.memo || '—'}</td>
                    <td className="num">{o.lines}</td>
                    <td className="num">{o.status === 'cancelled' ? 'ləğv' : money(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <div className="home-side">
        <section className="panel" aria-label="Qalıqlar">
          <h2 className="panel-title">
            Qalıqlar <span>· {day(today())}</span>
          </h2>
          {h?.balances.map((b) => (
            <button
              key={b.account}
              type="button"
              className="balance-row"
              onClick={() => ws.open({ type: 'accountCard', account: b.account })}
            >
              <span className="code">{b.account}</span>
              <span className="name">{b.name}</span>
              <span className="sum">{balance(b.dt, b.kt)}</span>
            </button>
          ))}
        </section>
        <section className="panel" aria-label="Nəzarət">
          <h2 className="panel-title">Nəzarət</h2>
          {integrityLoading && !integrity && <p className="panel-empty">Baza yoxlanılır…</p>}
          {integrity && (
            <>
              <div className="check-row">
                {integrity.ok ? (
                  <CheckCircle2 size={16} className="ok" aria-hidden="true" />
                ) : (
                  <CircleAlert size={16} className="bad" aria-hidden="true" />
                )}
                <span>
                  {integrity.ok
                    ? 'Jurnal tarazdır, qalıq registrləri jurnala uyğundur'
                    : integrity.problems.join(' ')}
                </span>
              </div>
              <div className="check-row">
                <CheckCircle2 size={16} className="ok" aria-hidden="true" />
                <span>Jurnal və audit dəyişdirilə və silinə bilməz (yalnız storno)</span>
              </div>
              <div className="check-row">
                {h?.warnings.some((w) => w.kind === 'advance') ? (
                  <CircleAlert size={16} className="bad" aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={16} className="ok" aria-hidden="true" />
                )}
                <span>
                  {h?.warnings.some((w) => w.kind === 'advance')
                    ? 'Əvəzləşdirilməmiş avans var'
                    : 'Əvəzləşdirilməmiş avans yoxdur'}
                </span>
              </div>
              <p className="panel-foot">
                {integrity.postings.toLocaleString('az-AZ')} yazılış ·{' '}
                {integrity.registers.toLocaleString('az-AZ')} registr · {integrity.ms} ms{' '}
                <button type="button" className="link" onClick={onRecheck}>
                  Yenidən yoxla
                </button>
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
