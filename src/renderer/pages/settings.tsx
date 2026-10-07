import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { AuditView } from '../../contracts/queries';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { SearchField, matches } from '../filters';
import { day } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages } from '../pages';
import { DateInput, Field, Notice } from '../ui';
import { useWindow } from '../workspace';

export function SettingsPage() {
  const win = useWindow();
  const { company } = useCatalog(win.companyId);
  const [name, setName] = useState('');
  const [vatPayer, setVatPayer] = useState(true);
  const [purchaseVat, setPurchaseVat] = useState<'offset' | 'cost'>('offset');
  const [through, setThrough] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState('');
  const m = useMutation();
  useEffect(() => {
    if (!company) return;
    setName(company.name);
    setVatPayer(company.vatPayer);
    setPurchaseVat(company.purchaseVat);
    setThrough(company.closedThrough);
  }, [company?.version, company?.closedThrough]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void api
      .version()
      .then(setVersion)
      .catch(() => undefined);
  }, []);
  if (!company) return <ModuleFrame title={pages.settings.title}>Yüklənir…</ModuleFrame>;
  const reopening = !!company.closedThrough && !!through && through < company.closedThrough;
  return (
    <ModuleFrame
      title={pages.settings.title}
      hint={`${company.name} · VÖEN ${company.taxId}`}
      notices={
        <>
          {m.error && <Notice onClose={m.clear}>{m.error.message}</Notice>}
          {message && (
            <Notice kind="success" onClose={() => setMessage('')}>
              {message}
            </Notice>
          )}
        </>
      }
    >
      <div className="settings">
        <section className="panel">
          <h2 className="panel-title">Şirkət</h2>
          <form
            className="dialog-form"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await m.run({
                type: 'company.update',
                companyId: company.id,
                version: company.version,
                name,
                vatPayer,
                purchaseVat,
              });
              if (r) setMessage('Şirkət məlumatları saxlanıldı.');
            }}
          >
            <div className="form-grid">
              <Field label="Ad" wide>
                <input maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={vatPayer}
                  onChange={(e) => setVatPayer(e.target.checked)}
                />{' '}
                ƏDV ödəyicisidir
              </label>
              <Field
                label="Alış ƏDV-si (standart)"
                wide
                hint="Alış qaiməsində hər dəfə dəyişdirilə bilər (2-ci mərhələ)"
              >
                <select
                  value={purchaseVat}
                  onChange={(e) => setPurchaseVat(e.target.value as 'offset' | 'cost')}
                >
                  <option value="offset">Əvəzləşdirilir (241)</option>
                  <option value="cost">Maya dəyərinə daxil edilir</option>
                </select>
              </Field>
            </div>
            <div className="form-actions">
              <button type="submit" className="button primary" disabled={m.busy}>
                Saxla
              </button>
            </div>
          </form>
        </section>
        <section className="panel">
          <h2 className="panel-title">Dövrün bağlanması</h2>
          <p className="panel-text">
            Bağlanış tarixinə qədər (daxil olmaqla) heç bir sənəd yazıla, dəyişdirilə və ya ləğv
            edilə bilməz. Bu, bazanın özündə qorunur.
            {company.closedThrough
              ? ` Hazırda ${day(company.closedThrough)}-dək bağlıdır.`
              : ' Hazırda dövr bağlanmayıb.'}
          </p>
          <form
            className="dialog-form"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await m.run({
                type: 'period.close',
                companyId: company.id,
                through,
                reason,
              });
              if (r) {
                setReason('');
                setMessage(
                  reopening
                    ? `Dövr ${day(through)}-dək yenidən açıldı.`
                    : `Dövr ${day(through)}-dək bağlandı.`,
                );
              }
            }}
          >
            <div className="form-grid">
              <Field label="Bağlanış tarixi">
                <DateInput value={through} onChange={setThrough} aria-label="Bağlanış tarixi" />
              </Field>
              {reopening && (
                <Field label="Yenidən açmanın səbəbi" wide>
                  <input
                    maxLength={240}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              )}
            </div>
            <div className="form-actions">
              <button
                type="submit"
                className="button primary"
                disabled={m.busy || !through || through === company.closedThrough}
              >
                {reopening ? 'Yenidən aç' : 'Bağla'}
              </button>
            </div>
          </form>
        </section>
        <section className="panel">
          <h2 className="panel-title">Ehtiyat nüsxə</h2>
          <p className="panel-text">
            Proqram hər açılışda avtomatik nüsxə alır. Buradan istənilən an əlavə nüsxə saxlaya
            bilərsiniz.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              onClick={async () => {
                try {
                  const file = await api.backup();
                  if (file) setMessage(`Ehtiyat nüsxə saxlanıldı: ${file}`);
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              <ShieldCheck size={15} /> Ehtiyat nüsxə saxla
            </button>
          </div>
          <p className="panel-foot">Meyar {version}</p>
        </section>
      </div>
    </ModuleFrame>
  );
}

export function AuditPage() {
  const win = useWindow();
  const result = useQuery<AuditView[]>({ type: 'audit', companyId: win.companyId, limit: 2000 });
  const [search, setSearch] = useState('');
  const rows = (result.data ?? []).filter((a) =>
    matches(search, a.action, a.entity, a.detail, a.actor),
  );
  return (
    <ModuleFrame
      title={pages.audit.title}
      hint={pages.audit.hint}
      count={rows.length}
      onRefresh={result.reload}
      filters={
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Əməliyyat, obyekt, istifadəçi"
        />
      }
      notices={result.error && <Notice>{result.error}</Notice>}
    >
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th scope="col">Vaxt</th>
              <th scope="col">İstifadəçi</th>
              <th scope="col">Əməliyyat</th>
              <th scope="col">Obyekt</th>
              <th scope="col">Təfərrüat</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.seq}>
                <td>
                  {day(a.at.slice(0, 10))}{' '}
                  {new Date(a.at).toLocaleTimeString('az-AZ', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td>{a.actor}</td>
                <td>{a.action}</td>
                <td>{a.entity}</td>
                <td className="ellipsis" title={a.detail}>
                  {a.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ModuleFrame>
  );
}
