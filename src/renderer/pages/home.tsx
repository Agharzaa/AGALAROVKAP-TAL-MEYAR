import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FilePlus2,
  RefreshCw,
} from 'lucide-react';
import type { HomeView, IntegrityView, RecentDocument } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { addAmounts, day, longDate, money, today } from '../format';
import { useQuery } from '../hooks';
import { Notice, Status } from '../ui';
import { useWorkspace, type View } from '../workspace';

interface Task {
  state: 'wait' | 'ok' | 'bad';
  title: string;
  detail: string;
  action: string;
  view?: View;
}

const kindLabel: Record<RecentDocument['kind'], string> = {
  operation: 'Əməliyyat',
  sale: 'Satış',
  purchase: 'Alış',
};
const viewOf = (d: RecentDocument): View =>
  d.kind === 'operation'
    ? { type: 'operation', id: d.id }
    : { type: 'invoice', direction: d.kind, id: d.id };

/** The start page: the work area's background, "İdarəetmə paneli" of the green Meyar layout. */
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
  const { catalog, company } = useCatalog(ws.companyId);
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
  const bal = (code: string) => h?.balances.find((b) => b.account === code);
  /** Debit minus credit of some accounts, canonical. */
  const net = (codes: string[], side: 'dt' | 'kt') =>
    addAmounts(
      codes.flatMap((c) => {
        const b = bal(c);
        if (!b) return [];
        return side === 'dt' ? [b.dt, `-${b.kt}`] : [b.kt, `-${b.dt}`];
      }),
    );
  const kpis = [
    {
      label: 'Pul vəsaitləri',
      accounts: '221 · 223 · 224',
      value: net(['221', '223', '224'], 'dt'),
    },
    { label: 'Debitorlar', accounts: '211 Dt', value: bal('211')?.dt ?? '0.00' },
    { label: 'Kreditorlar', accounts: '531 Kt', value: bal('531')?.kt ?? '0.00' },
    { label: 'Alınmış avanslar', accounts: '543 Kt', value: bal('543')?.kt ?? '0.00' },
    { label: 'Vergi öhdəlikləri', accounts: '521 Kt', value: bal('521')?.kt ?? '0.00' },
  ];
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
  const advanceWarning = h?.warnings.some((w) => w.kind === 'advance');
  return (
    <div className="home">
      <header className="pagehead">
        <div>
          <span className="eyebrow">İdarəetmə paneli</span>
          <h1>Ümumi vəziyyət</h1>
          <p>
            {company ? `${company.name} · ` : ''}
            {longDate(today())}
          </p>
        </div>
        <div className="pagehead-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => ws.open({ type: 'operation' })}
          >
            <FilePlus2 size={15} aria-hidden="true" /> Əl ilə əməliyyat
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => ws.open({ type: 'invoice', direction: 'purchase' })}
          >
            <ArrowDownLeft size={15} aria-hidden="true" /> Alış qaiməsi
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => ws.open({ type: 'invoice', direction: 'sale' })}
          >
            <ArrowUpRight size={15} aria-hidden="true" /> Satış qaiməsi
          </button>
        </div>
      </header>
      {home.error && <Notice>{home.error}</Notice>}
      <section className="kpis" aria-label="Əsas göstəricilər">
        {kpis.map((k) => (
          <div key={k.label} className="kpi">
            <span>{k.label}</span>
            <strong className={k.value.startsWith('-') ? 'negative' : ''}>
              {h ? money(k.value) : '…'} <small>₼</small>
            </strong>
            <small>{k.accounts}</small>
          </div>
        ))}
      </section>
      <div className="home-grid">
        <div className="home-main">
          <section className="panel" aria-label="Gözləyən işlər">
            <header className="panel-head">
              <div>
                <h2>Gözləyən işlər</h2>
                <small>Bu gün diqqət tələb edənlər</small>
              </div>
            </header>
            {!h && !home.error && <p className="panel-empty">Yüklənir…</p>}
            {h && !tasks.length && <p className="panel-empty">Gözləyən iş yoxdur.</p>}
            {tasks.map((t, i) => (
              <div key={i} className={`task-row ${t.state}`}>
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
          <section className="panel grow" aria-label="Son sənədlər">
            <header className="panel-head">
              <div>
                <h2>Son sənədlər</h2>
                <small>Əməliyyatlar və qaimələr, yenidən köhnəyə</small>
              </div>
            </header>
            {h && !h.documents.length && <p className="panel-empty">Hələ sənəd yoxdur.</p>}
            {h && h.documents.length > 0 && (
              <div className="table-scroll flat">
                <table className="grid">
                  <thead>
                    <tr>
                      <th scope="col">Tarix</th>
                      <th scope="col">Növ</th>
                      <th scope="col">Nömrə</th>
                      <th scope="col">Kontragent / məzmun</th>
                      <th scope="col" className="num">
                        Məbləğ
                      </th>
                      <th scope="col">Vəziyyət</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.documents.map((d) => (
                      <tr
                        key={`${d.kind}${d.id}`}
                        className={d.status === 'cancelled' ? 'cancelled' : ''}
                        onDoubleClick={() => ws.open(viewOf(d))}
                      >
                        <td className="nowrap">{day(d.date)}</td>
                        <td>
                          <span className={`badge ${d.kind}`}>{kindLabel[d.kind]}</span>
                        </td>
                        <td className="nowrap">
                          <button type="button" className="link" onClick={() => ws.open(viewOf(d))}>
                            {d.number}
                          </button>
                        </td>
                        <td className="ellipsis">{d.title || '—'}</td>
                        <td className="num mono">
                          {money(d.total)}
                          {d.currency !== 'AZN' && <small> {d.currency}</small>}
                        </td>
                        <td>
                          <Status status={d.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        <div className="home-side">
          <section className="panel" aria-label="Nəzarət">
            <header className="panel-head">
              <div>
                <h2>Nəzarət</h2>
                <small>Uçotun bütövlüyü</small>
              </div>
              <button
                type="button"
                className="icon-button"
                title="Yenidən yoxla"
                aria-label="Yenidən yoxla"
                onClick={onRecheck}
              >
                <RefreshCw size={14} />
              </button>
            </header>
            {integrityLoading && !integrity && <p className="panel-empty">Baza yoxlanılır…</p>}
            {integrity && (
              <>
                <div className="check-row">
                  <span>
                    <b>Jurnal və registrlər</b>
                    <small>
                      {integrity.ok
                        ? `${integrity.postings.toLocaleString('az-AZ')} yazılış · ${integrity.ms} ms`
                        : integrity.problems.join(' ')}
                    </small>
                  </span>
                  <span className={`badge ${integrity.ok ? 'green' : 'red'}`}>
                    {integrity.ok ? 'Tarazdır' : 'Uyğunsuz'}
                  </span>
                </div>
                <div className="check-row">
                  <span>
                    <b>Dəyişməzlik</b>
                    <small>Jurnal və audit silinmir, düzəliş storno ilə</small>
                  </span>
                  <span className="badge green">Qorunur</span>
                </div>
                <div className="check-row">
                  <span>
                    <b>Avanslar</b>
                    <small>
                      {advanceWarning
                        ? 'Əvəzləşdirilməmiş avans var'
                        : 'Əvəzləşdirilməmiş avans yoxdur'}
                    </small>
                  </span>
                  <span className={`badge ${advanceWarning ? 'orange' : 'green'}`}>
                    {advanceWarning ? 'Yoxlayın' : 'Qaydasında'}
                  </span>
                </div>
                <div className="check-row">
                  <span>
                    <b>Dövr</b>
                    <small>
                      {company?.closedThrough
                        ? `${day(company.closedThrough)}-dək bağlıdır`
                        : 'Hələ bağlanmayıb'}
                    </small>
                  </span>
                  <span className={`badge ${company?.closedThrough ? 'green' : 'blue'}`}>
                    {company?.closedThrough ? 'Bağlı' : 'Açıq'}
                  </span>
                </div>
              </>
            )}
          </section>
          <section className="panel" aria-label="Qalıqlar">
            <header className="panel-head">
              <div>
                <h2>Qalıqlar</h2>
                <small>{day(today())} vəziyyətinə · hesab kartını açın</small>
              </div>
            </header>
            {h?.balances.map((b) => (
              <button
                key={b.account}
                type="button"
                className="balance-row"
                onClick={() => ws.open({ type: 'accountCard', account: b.account })}
              >
                <span className="code">{b.account}</span>
                <span className="name">{b.name}</span>
                <span className="sum mono">{balance(b.dt, b.kt)}</span>
              </button>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
