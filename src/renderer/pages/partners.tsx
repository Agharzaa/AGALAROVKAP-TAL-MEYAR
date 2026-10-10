import { useEffect, useState } from 'react';
import { FileSpreadsheet, Pencil, Plus } from '../icons';
import { currencies } from '../../domain/chart';
import type { ContractView, PartnerView } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { SearchField, matches } from '../filters';
import { day } from '../format';
import { useMutation } from '../hooks';
import { pages } from '../pages';
import { DateInput, Field, Modal, Notice } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

const kindLabel = {
  legal: 'Hüquqi şəxs',
  individual: 'Fiziki şəxs',
  foreign: 'Xarici',
  state: 'Dövlət orqanı',
} as const;
const contractKind = { sale: 'Satış', purchase: 'Alış', loan: 'Kredit', other: 'Digər' } as const;

function PartnerForm({
  partner,
  onSaved,
  onCancel,
}: {
  partner: PartnerView | null;
  onSaved: (id: string) => void;
  onCancel?: () => void;
}) {
  const win = useWindow();
  const [name, setName] = useState(partner?.name ?? '');
  const [taxId, setTaxId] = useState(partner?.taxId ?? '');
  const [kind, setKind] = useState<PartnerView['kind']>(partner?.kind ?? 'legal');
  const [note, setNote] = useState(partner?.note ?? '');
  const [archived, setArchived] = useState(partner?.archived ?? false);
  const [saved, setSaved] = useState(false);
  const m = useMutation();
  useEffect(() => {
    setName(partner?.name ?? '');
    setTaxId(partner?.taxId ?? '');
    setKind(partner?.kind ?? 'legal');
    setNote(partner?.note ?? '');
    setArchived(partner?.archived ?? false);
    setSaved(false);
    m.clear();
  }, [partner?.id, partner?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setSaved(false);
    const r = await m.run({
      type: 'partner.save',
      companyId: win.companyId,
      ...(partner ? { id: partner.id, version: partner.version } : {}),
      name,
      taxId,
      kind,
      note,
      archived,
    });
    if (r) {
      setSaved(true);
      onSaved(r.id);
    }
  };
  return (
    <form className="dialog-form" noValidate onSubmit={(e) => (e.preventDefault(), void save())}>
      <div className="form-grid">
        <Field label="Ad" wide>
          <input
            autoFocus={!partner}
            maxLength={240}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Növ">
          <select value={kind} onChange={(e) => setKind(e.target.value as PartnerView['kind'])}>
            {Object.entries(kindLabel).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="VÖEN" hint={kind === 'legal' ? '10 rəqəm' : 'Məcburi deyil'}>
          <input
            inputMode="numeric"
            maxLength={10}
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
          />
        </Field>
        <Field label="Qeyd" wide>
          <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {partner && (
          <label className="check">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />{' '}
            Arxivdə
          </label>
        )}
      </div>
      {m.error && <Notice>{m.error.message}</Notice>}
      {saved && !m.error && <Notice kind="success">Saxlanıldı.</Notice>}
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="button secondary" onClick={onCancel}>
            Ləğv et
          </button>
        )}
        <button type="submit" className="button primary" disabled={m.busy}>
          Saxla
        </button>
      </div>
    </form>
  );
}

function ContractDialog({
  partnerId,
  contract,
  onClose,
}: {
  partnerId: string;
  contract: ContractView | null;
  onClose: () => void;
}) {
  const win = useWindow();
  const [number, setNumber] = useState(contract?.number ?? '');
  const [date, setDate] = useState(contract?.date ?? new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState<ContractView['kind']>(contract?.kind ?? 'sale');
  const [currency, setCurrency] = useState(contract?.currency ?? 'AZN');
  const [note, setNote] = useState(contract?.note ?? '');
  const [archived, setArchived] = useState(contract?.archived ?? false);
  const m = useMutation();
  const save = async () => {
    const r = await m.run({
      type: 'contract.save',
      companyId: win.companyId,
      ...(contract ? { id: contract.id, version: contract.version } : {}),
      partnerId,
      number,
      date,
      kind,
      currency,
      note,
      archived,
    });
    if (r) onClose();
  };
  return (
    <Modal
      title={contract ? `Müqavilə №${contract.number}` : 'Yeni müqavilə'}
      onClose={onClose}
      size="small"
    >
      <form className="dialog-form" noValidate onSubmit={(e) => (e.preventDefault(), void save())}>
        <div className="form-grid">
          <Field label="Nömrə">
            <input
              autoFocus
              maxLength={80}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </Field>
          <Field label="Tarix">
            <DateInput value={date} onChange={setDate} aria-label="Müqavilənin tarixi" />
          </Field>
          <Field label="Növ">
            <select value={kind} onChange={(e) => setKind(e.target.value as ContractView['kind'])}>
              {Object.entries(contractKind).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valyuta">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {['AZN', ...currencies].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Qeyd" wide>
            <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {contract && (
            <label className="check">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />{' '}
              Arxivdə
            </label>
          )}
        </div>
        {m.error && <Notice>{m.error.message}</Notice>}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Ləğv et
          </button>
          <button type="submit" className="button primary" disabled={m.busy}>
            Saxla
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PartnersPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [contract, setContract] = useState<ContractView | null | 'new'>(null);
  const [showArchived, setShowArchived] = useState(false);
  const list = (catalog?.partners ?? []).filter(
    (p) => (showArchived || !p.archived) && matches(search, p.name, p.taxId),
  );
  const partner = catalog?.partners.find((p) => p.id === selected) ?? null;
  const contracts = (catalog?.contracts ?? []).filter((c) => c.partnerId === selected);
  return (
    <ModuleFrame
      title={pages.partners.title}
      hint={pages.partners.hint}
      count={list.length}
      actions={
        <button
          type="button"
          className="button primary"
          onClick={() => (setCreating(true), setSelected(''))}
        >
          <Plus size={15} /> Yeni kontragent
        </button>
      }
      filters={
        <>
          <SearchField value={search} onChange={setSearch} placeholder="Ad və ya VÖEN" />
          <label className="check">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />{' '}
            Arxivdəkilər də
          </label>
        </>
      }
    >
      <div className="master-detail">
        <div className="master table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Ad</th>
                <th scope="col">VÖEN</th>
                <th scope="col" className="num">
                  Müq.
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr
                  key={p.id}
                  className={`${p.id === selected ? 'selected' : ''}${p.archived ? ' cancelled' : ''}`}
                  onClick={() => (setSelected(p.id), setCreating(false))}
                >
                  <td className="ellipsis" title={p.name}>
                    {p.name}
                  </td>
                  <td>{p.taxId || '—'}</td>
                  <td className="num">
                    {catalog?.contracts.filter((c) => c.partnerId === p.id).length || ''}
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr>
                  <td colSpan={3} className="panel-empty">
                    Kontragent yoxdur.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="detail">
          {creating && (
            <section className="panel">
              <h2 className="panel-title">Yeni kontragent</h2>
              <PartnerForm
                partner={null}
                onSaved={(id) => (setCreating(false), setSelected(id))}
                onCancel={() => setCreating(false)}
              />
            </section>
          )}
          {!creating && !partner && (
            <p className="panel-empty">Soldan kontragent seçin və ya yenisini yaradın.</p>
          )}
          {!creating && partner && (
            <>
              <section className="panel">
                <h2 className="panel-title">
                  {partner.name} <span>· {kindLabel[partner.kind]}</span>
                </h2>
                <PartnerForm partner={partner} onSaved={() => undefined} />
              </section>
              <section className="panel">
                <h2 className="panel-title">
                  Müqavilələr
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => setContract('new')}
                  >
                    <Plus size={13} /> Müqavilə
                  </button>
                </h2>
                {!contracts.length && (
                  <p className="panel-empty">
                    Müqavilə yoxdur. Hesablaşmalar (211, 531, 543, 501…) müqavilə üzrə aparılır.
                  </p>
                )}
                {contracts.length > 0 && (
                  <table className="grid">
                    <thead>
                      <tr>
                        <th scope="col">Nömrə</th>
                        <th scope="col">Tarix</th>
                        <th scope="col">Növ</th>
                        <th scope="col">Valyuta</th>
                        <th scope="col">
                          <span className="sr-only">Əməliyyat</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {contracts.map((c) => (
                        <tr key={c.id} className={c.archived ? 'cancelled' : ''}>
                          <td>№{c.number}</td>
                          <td>{day(c.date)}</td>
                          <td>{contractKind[c.kind]}</td>
                          <td>{c.currency}</td>
                          <td className="row-tools">
                            <button
                              type="button"
                              className="icon-button"
                              title="Dəyiş"
                              aria-label={`Dəyiş: müqavilə ${c.number}`}
                              onClick={() => setContract(c)}
                            >
                              <Pencil size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="panel-foot">
                  <button
                    type="button"
                    className="link"
                    onClick={() => ws.open({ type: 'page', page: 'trial' })}
                  >
                    <FileSpreadsheet size={13} /> Qalıqlar: Dövriyyə balansında kontragent filtri
                    ilə
                  </button>
                </p>
              </section>
            </>
          )}
        </div>
      </div>
      {contract && partner && (
        <ContractDialog
          partnerId={partner.id}
          contract={contract === 'new' ? null : contract}
          onClose={() => setContract(null)}
        />
      )}
    </ModuleFrame>
  );
}
