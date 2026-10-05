import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, DatabaseBackup, Lock, Plus, ShieldCheck } from 'lucide-react';
import type { DashboardView } from '../../contracts/queries';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { day, isZero, longDate, today } from '../format';
import { useMutation, useQuery } from '../hooks';
import { Amount, Confirm, DateInput, Field, Notice } from '../ui';
import { useWorkspace } from '../workspace';

export function Home() {
  const ws = useWorkspace();
  const { company } = useCatalog(ws.companyId);
  const r = useQuery<DashboardView>({ type: 'dashboard', companyId: ws.companyId, asOf: today() });
  const d = r.data;
  const open = (view: Parameters<typeof ws.open>[0]) => ws.open(view, ws.companyId);
  return (
    <ModuleFrame
      title={company?.name ?? 'İş masası'}
      hint={longDate(today())}
      onRefresh={r.reload}
      notices={r.error && <Notice>{r.error}</Notice>}
    >
      <div className="home">
        <section className="figures" aria-label="Əsas göstəricilər">
          <button
            type="button"
            className="figure"
            onClick={() => open({ type: 'page', page: 'receivables' })}
          >
            <span>Alıcıların borcu · 211</span>
            <strong>{d ? <Amount value={d.receivable} /> : '—'}</strong>
            {d && !isZero(d.customerAdvances) && (
              <small>
                Alınmış avans: <Amount value={d.customerAdvances} />
              </small>
            )}
          </button>
          <button
            type="button"
            className="figure"
            onClick={() => open({ type: 'page', page: 'payables' })}
          >
            <span>Təchizatçılara borc · 531</span>
            <strong>{d ? <Amount value={d.payable} /> : '—'}</strong>
            {d && !isZero(d.supplierAdvances) && (
              <small>
                Verilmiş avans: <Amount value={d.supplierAdvances} />
              </small>
            )}
          </button>
          <button
            type="button"
            className="figure"
            onClick={() => open({ type: 'accountCard', account: '223' })}
          >
            <span>Bank qalığı · 223, 224.04</span>
            <strong>{d ? <Amount value={d.bank} /> : '—'}</strong>
          </button>
          <div className="figure plain">
            <span>Uçotdakı qaimələr</span>
            <strong>
              {d ? d.purchases : '—'} <small>alış</small> · {d ? d.sales : '—'} <small>satış</small>
            </strong>
          </div>
        </section>

        <div className="home-grid">
          <section className="panel" aria-label="Son bank əməliyyatları">
            <header className="panel-heading">
              <h2>Son bank əməliyyatları</h2>
              <div className="panel-actions">
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => open({ type: 'payment', direction: 'in' })}
                >
                  <Plus size={13} /> Daxilolma
                </button>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => open({ type: 'payment', direction: 'out' })}
                >
                  <Plus size={13} /> Ödəniş
                </button>
              </div>
            </header>
            {d && d.recentPayments.length ? (
              <ul className="ledger-list">
                {d.recentPayments.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => open({ type: 'payment', direction: p.direction, id: p.id })}
                    >
                      <span
                        className={`direction ${p.direction}`}
                        aria-label={p.direction === 'in' ? 'Daxilolma' : 'Ödəniş'}
                      >
                        {p.direction === 'in' ? (
                          <ArrowDownLeft size={15} />
                        ) : (
                          <ArrowUpRight size={15} />
                        )}
                      </span>
                      <span className="two-line">
                        <strong>{p.partnerName}</strong>
                        <small>
                          {p.reference} · {day(p.date)}
                          {!isZero(p.unallocated) && ' · qaiməyə tam bağlanmayıb'}
                        </small>
                      </span>
                      <Amount value={p.direction === 'in' ? p.amount : `-${p.amount}`} strong />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panel-empty">Hələ bank əməliyyatı yoxdur.</p>
            )}
          </section>

          <section className="panel" aria-label="Bildirişlər">
            <header className="panel-heading">
              <h2>Diqqət tələb edənlər</h2>
            </header>
            <ul className="notes">
              {d && d.unallocatedPayments > 0 && (
                <li className="warn">
                  <strong>{d.unallocatedPayments} bank sənədi qaiməyə tam bağlanmayıb.</strong>
                  <span>Qalıq kontragentin hesabında avans kimi durur.</span>
                  <button
                    type="button"
                    className="link"
                    onClick={() => open({ type: 'page', page: 'bankIn' })}
                  >
                    Daxilolmalara bax
                  </button>
                </li>
              )}
              <li>
                <strong>
                  {d?.closedThrough
                    ? `Dövr ${day(d.closedThrough)} tarixinədək bağlıdır.`
                    : 'Uçot dövrü açıqdır.'}
                </strong>
                <span>Bağlı tarixlərdə sənəd əlavə, düzəliş və ləğv edilmir.</span>
                <button
                  type="button"
                  className="link"
                  onClick={() => open({ type: 'page', page: 'settings' })}
                >
                  Parametrlər
                </button>
              </li>
              <li>
                <strong>Ehtiyat nüsxə</strong>
                <span>
                  Proqram hər açılışda bazanın nüsxəsini götürür. Ayrıca nüsxəni xarici diskə
                  saxlayın.
                </span>
                <button
                  type="button"
                  className="link"
                  onClick={() => open({ type: 'page', page: 'settings' })}
                >
                  Nüsxə yarat
                </button>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </ModuleFrame>
  );
}

export function SettingsPage() {
  const ws = useWorkspace();
  const { company } = useCatalog(ws.companyId);
  const [version, setVersion] = useState('');
  const [through, setThrough] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const [backupError, setBackupError] = useState('');
  const m = useMutation();
  useEffect(() => {
    api
      .version()
      .then(setVersion)
      .catch(() => setVersion(''));
  }, []);
  return (
    <ModuleFrame
      title="Parametrlər"
      hint={company?.name}
      notices={
        <>
          {message && (
            <Notice kind="success" onClose={() => setMessage('')}>
              {message}
            </Notice>
          )}
          {(m.error || backupError) && (
            <Notice
              onClose={() => {
                m.clear();
                setBackupError('');
              }}
            >
              {m.error?.message ?? backupError}
            </Notice>
          )}
        </>
      }
    >
      <div className="settings">
        <section className="panel">
          <header className="panel-heading">
            <h2>
              <ShieldCheck size={16} /> Şirkət
            </h2>
          </header>
          <dl className="facts">
            <div>
              <dt>Adı</dt>
              <dd>{company?.name}</dd>
            </div>
            <div>
              <dt>VÖEN</dt>
              <dd>{company?.taxId}</dd>
            </div>
            <div>
              <dt>Uçot valyutası</dt>
              <dd>AZN</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <header className="panel-heading">
            <h2>
              <Lock size={16} /> Uçot dövrü
            </h2>
          </header>
          <form
            noValidate
            className="panel-body"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setConfirm(true);
            }}
          >
            <p>
              {company?.closedThrough
                ? `${day(company.closedThrough)} tarixinədək bağlıdır.`
                : 'Dövr açıqdır.'}
            </p>
            <Field label="Bu tarix daxil olmaqla bağla">
              <DateInput required value={through} onChange={setThrough} />
            </Field>
            <button className="button secondary" disabled={!through || m.busy}>
              Dövrü bağla
            </button>
          </form>
        </section>
        <section className="panel">
          <header className="panel-heading">
            <h2>
              <DatabaseBackup size={16} /> Ehtiyat nüsxə
            </h2>
          </header>
          <div className="panel-body">
            <p>
              Bazanın ardıcıl nüsxəsi SQLite backup mexanizmi ilə götürülür; açıq faylın kor-koranə
              kopyası deyil.
            </p>
            <button
              type="button"
              className="button primary"
              onClick={async () => {
                setBackupError('');
                try {
                  const path = await api.backup();
                  if (path) setMessage(`Nüsxə saxlanıldı: ${path}`);
                } catch (e) {
                  setBackupError((e as Error).message);
                }
              }}
            >
              <DatabaseBackup size={15} /> Nüsxə yarat
            </button>
          </div>
        </section>
        <section className="panel">
          <header className="panel-heading">
            <h2>Meyar {version && `· v${version}`}</h2>
          </header>
          <div className="panel-body">
            <p>
              Bu versiyada: qaimələr, ƏDV, bank və ödəniş bölgüsü, anbar (orta maya dəyəri), jurnal,
              dövriyyə balansı, hesab kartı.
            </p>
            <p className="muted">
              Hələ yoxdur: istifadəçi rolları, valyuta, amortizasiya, əməkhaqqı, vergi
              bəyannamələri, DVX və bank API-ləri, avtomatik yeniləmə. Quraşdırıcı imzalanmamış
              sınaq versiyasıdır.
            </p>
          </div>
        </section>
      </div>
      {confirm && (
        <Confirm
          title="Dövrü bağla"
          confirmLabel="Bağla"
          destructive
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            const r = await m.run({ type: 'period.close', companyId: ws.companyId, through });
            setConfirm(false);
            if (r) setMessage(`Dövr ${day(through)} tarixinədək bağlandı.`);
          }}
        >
          <p>
            {day(through)} daxil olmaqla bütün sənədlər dəyişməz olacaq. Bu versiyada bağlı dövr
            yenidən açılmır. Əvvəl dövriyyə balansını yoxlayın və nüsxə yaradın.
          </p>
        </Confirm>
      )}
    </ModuleFrame>
  );
}

export function Onboarding({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const m = useMutation();
  return (
    <div className="onboarding">
      <form
        noValidate
        className="onboarding-form"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          const r = await m.run({ type: 'company.create', name, taxId });
          if (r) onCreated(r.id);
        }}
      >
        <div className="brand large">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span className="brand-name">Meyar</span>
        </div>
        <h1>Şirkətinizi əlavə edin</h1>
        <p>
          Ad və VÖEN kifayətdir. Hesab planı, ölçü vahidləri və əsas anbar avtomatik hazırlanır.
        </p>
        {m.error && <Notice onClose={m.clear}>{m.error.message}</Notice>}
        <fieldset disabled={m.busy}>
          <Field label="Şirkətin adı">
            <input
              autoFocus
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="VÖEN" hint="10 rəqəm">
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{10}"
              maxLength={10}
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
            />
          </Field>
          <button className="button primary block">
            {m.busy ? 'Yaradılır…' : 'Şirkəti yarat'}
          </button>
        </fieldset>
        <p className="onboarding-foot">
          <ShieldCheck size={14} aria-hidden="true" /> Məlumatlar bu kompüterdəki yerli bazada
          saxlanılır.
        </p>
      </form>
      <aside className="onboarding-sample" aria-hidden="true">
        <h2>Hər sənəd öz yazılışını özü yaradır.</h2>
        <p>
          Satış qaiməsini saxlayan kimi debet və krediti bərabər müxabirləşmə qurulur. Siz yalnız
          sənədi yoxlayırsınız.
        </p>
        <table className="sample-entry">
          <caption>Satış qaiməsi S-0001 · 118,00 AZN</caption>
          <thead>
            <tr>
              <th>Hesab</th>
              <th className="num">Debet</th>
              <th className="num">Kredit</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>211 · Alıcılar</td>
              <td className="num">118,00</td>
              <td />
            </tr>
            <tr>
              <td>601 · Satış gəliri</td>
              <td />
              <td className="num">100,00</td>
            </tr>
            <tr>
              <td>545 · Satış üzrə ƏDV</td>
              <td />
              <td className="num">18,00</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>Cəmi</td>
              <td className="num">118,00</td>
              <td className="num">118,00</td>
            </tr>
          </tfoot>
        </table>
      </aside>
    </div>
  );
}
