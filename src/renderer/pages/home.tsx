import { CheckCircle2, ChevronRight, CircleAlert, Clock3, RefreshCw } from 'lucide-react';
import type { HomeView, IntegrityView, RecentDocument } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { day, longDate, money, today } from '../format';
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

/** One step of a section's work: a document or report, and what it posts. */
interface Step {
  title: string;
  posts?: string;
  view?: View;
  /** Stage that brings it, for steps not built yet. */
  soon?: string;
}
const page = (p: Extract<View, { type: 'page' }>['page']): View => ({ type: 'page', page: p });
const card = (account: string): View => ({ type: 'accountCard', account });

/**
 * The work map (1C "Funksiyalar paneli"): each row is how one area of the accounting flows,
 * left to right, from the lists it needs to the report that closes it.
 */
const flows: { name: string; steps: Step[] }[] = [
  {
    name: 'Satış',
    steps: [
      { title: 'Kontragentlər', posts: 'VÖEN, müqavilə', view: page('partners') },
      {
        title: 'Satış qaiməsi',
        posts: 'Dt 211 · Kt 601, 521',
        view: { type: 'invoice', direction: 'sale' },
      },
      { title: 'Alıcıdan ödəniş', posts: 'Dt 223 · Kt 211', soon: '3-cü mərhələ' },
      { title: 'Alıcılar', posts: 'Hesab kartı 211', view: card('211') },
    ],
  },
  {
    name: 'Alış',
    steps: [
      { title: 'Kontragentlər', posts: 'VÖEN, müqavilə', view: page('partners') },
      {
        title: 'Alış qaiməsi',
        posts: 'Dt 205, 241 · Kt 531',
        view: { type: 'invoice', direction: 'purchase' },
      },
      { title: 'Malsatana ödəniş', posts: 'Dt 531 · Kt 223', soon: '3-cü mərhələ' },
      { title: 'Malsatanlar', posts: 'Hesab kartı 531', view: card('531') },
    ],
  },
  {
    name: 'Bank',
    steps: [
      { title: 'Bank hesabları', posts: 'IBAN, 223.01 / 223.02', view: page('bankAccounts') },
      { title: 'Bank çıxarışı', posts: 'Excel-dən yükləmə', soon: '3-cü mərhələ' },
      { title: 'Bank sənədləri', posts: 'Dt/Kt 223', soon: '3-cü mərhələ' },
      { title: 'Bank qalığı', posts: 'Hesab kartı 223', view: card('223') },
    ],
  },
  {
    name: 'Mühasibat',
    steps: [
      {
        title: 'Əl ilə əməliyyat',
        posts: 'Başlanğıc qalıqlar, düzəlişlər',
        view: { type: 'operation' },
      },
      { title: 'Dövriyyə balansı', posts: 'Hesab və subkonto üzrə', view: page('trial') },
      { title: 'Dövrün bağlanması', posts: 'Bağlı dövrə yazılmır', view: page('settings') },
    ],
  },
];

const kindLabel: Record<RecentDocument['kind'], string> = {
  operation: 'Əməliyyat',
  sale: 'Satış qaiməsi',
  purchase: 'Alış qaiməsi',
};
const viewOf = (d: RecentDocument): View =>
  d.kind === 'operation'
    ? { type: 'operation', id: d.id }
    : { type: 'invoice', direction: d.kind, id: d.id };

/** The work area's background: "İş masası". */
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
  }
  const amount = (v: string) => (v === '0.00' ? '' : money(v));
  return (
    <div className="home">
      <header className="desk-head">
        <h1>İş masası</h1>
        <p>
          {company ? `${company.name}, VÖEN ${company.taxId}` : ''}
          <span>{longDate(today())}</span>
        </p>
      </header>
      {home.error && <Notice>{home.error}</Notice>}
      <div className="desk">
        <div className="desk-main">
          <section className="panel" aria-label="İş xəritəsi">
            <header className="panel-head">
              <h2>İş xəritəsi</h2>
              <small>Sənəddən hesabata qədər, soldan sağa</small>
            </header>
            <div className="flows">
              {flows.map((f) => (
                <div key={f.name} className="flow">
                  <span className="flow-name">{f.name}</span>
                  <ol className="flow-steps">
                    {f.steps.map((s, i) => (
                      <li key={s.title}>
                        {i > 0 && (
                          <ChevronRight size={15} className="flow-arrow" aria-hidden="true" />
                        )}
                        {s.view ? (
                          <button
                            type="button"
                            className="step"
                            aria-label={s.title}
                            title={s.posts ? `${s.title} — ${s.posts}` : s.title}
                            onClick={() => ws.open(s.view!)}
                          >
                            <b>{s.title}</b>
                            {s.posts && <small>{s.posts}</small>}
                          </button>
                        ) : (
                          <span className="step soon" title={`${s.soon}də əlavə olunacaq`}>
                            <b>{s.title}</b>
                            <small>{s.soon}</small>
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>
          <section className="panel" aria-label="Son sənədlər">
            <header className="panel-head">
              <h2>Son sənədlər</h2>
              <small>Bütün növlər, yenidən köhnəyə</small>
            </header>
            {h && !h.documents.length && (
              <p className="panel-empty">
                Hələ sənəd yoxdur. İlk sənədi iş xəritəsindən və ya yuxarıdakı “Yarat” düyməsindən
                açın.
              </p>
            )}
            {h && h.documents.length > 0 && (
              <div className="table-scroll flat">
                <table className="grid">
                  <thead>
                    <tr>
                      <th scope="col">Tarix</th>
                      <th scope="col">Sənəd</th>
                      <th scope="col">Nömrə</th>
                      <th scope="col">Kontragent və ya məzmun</th>
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
                        <td className="nowrap">{kindLabel[d.kind]}</td>
                        <td className="nowrap">
                          <button type="button" className="link" onClick={() => ws.open(viewOf(d))}>
                            {d.number}
                          </button>
                        </td>
                        <td className="ellipsis">{d.title || '—'}</td>
                        <td className="num">
                          {money(d.total)}
                          {d.currency !== 'AZN' && (
                            <small className="currency"> {d.currency}</small>
                          )}
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
        <div className="desk-side">
          <section className="panel" aria-label="Diqqət">
            <header className="panel-head">
              <h2>Diqqət</h2>
              <small>
                {tasks.length ? `${tasks.length} iş gözləyir` : 'Hər şey qaydasındadır'}
              </small>
            </header>
            {!h && !home.error && <p className="panel-empty">Yüklənir…</p>}
            {h && !tasks.length && (
              <div className="task-row ok">
                <CheckCircle2 size={17} className="ok" aria-label="Qaydasındadır" />
                <span className="task-text">
                  <b>Hesablaşmalar qaydasındadır</b>
                  <span>Avans, anbar və pul qalıqları üzrə xəbərdarlıq yoxdur</span>
                </span>
              </div>
            )}
            {tasks.map((t, i) => (
              <div key={i} className={`task-row ${t.state}`}>
                {t.state === 'bad' ? (
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
                    className="button secondary small"
                    onClick={() => ws.open(t.view!)}
                  >
                    {t.action}
                  </button>
                )}
              </div>
            ))}
          </section>
          <section className="panel" aria-label="Qalıqlar">
            <header className="panel-head">
              <h2>Qalıqlar</h2>
              <small>{day(today())} vəziyyətinə</small>
            </header>
            <table className="grid balances">
              <thead>
                <tr>
                  <th scope="col">Hesab</th>
                  <th scope="col" className="num">
                    Debet
                  </th>
                  <th scope="col" className="num">
                    Kredit
                  </th>
                </tr>
              </thead>
              <tbody>
                {h?.balances.map((b) => (
                  <tr
                    key={b.account}
                    className="clickable"
                    title="Hesab kartını aç"
                    onClick={() => ws.open({ type: 'accountCard', account: b.account })}
                  >
                    <td className="balance-name">
                      <span className="code">{b.account}</span> {b.name}
                    </td>
                    <td className="num">{amount(b.dt)}</td>
                    <td className="num">{amount(b.kt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel" aria-label="Nəzarət">
            <header className="panel-head">
              <h2>Nəzarət</h2>
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
              <ul className="checks">
                <li className={integrity.ok ? 'ok' : 'bad'}>
                  {integrity.ok ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
                  {integrity.ok
                    ? `Jurnal tarazdır, registrlər jurnala uyğundur (${integrity.postings.toLocaleString('az-AZ')} yazılış)`
                    : integrity.problems.join(' ')}
                </li>
                <li className="ok">
                  <CheckCircle2 size={15} />
                  Jurnal və audit silinmir, düzəliş yalnız storno ilə
                </li>
                <li className={company?.closedThrough ? 'ok' : 'wait'}>
                  {company?.closedThrough ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
                  {company?.closedThrough
                    ? `Dövr ${day(company.closedThrough)}-dək bağlıdır`
                    : 'Dövr hələ bağlanmayıb'}
                </li>
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
