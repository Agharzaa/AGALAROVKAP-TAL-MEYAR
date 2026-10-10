import { useState } from 'react';
import { Pencil, Plus } from '../icons';
import {
  subkontoKinds,
  subkontoLabel,
  type AccountNature,
  type SubkontoKind,
} from '../../domain/chart';
import type { AccountView } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { SearchField, matches } from '../filters';
import { useMutation } from '../hooks';
import { pages } from '../pages';
import { Field, Modal, Notice } from '../ui';
import { useWindow, useWorkspace } from '../workspace';

const natureLabel: Record<AccountNature, string> = {
  active: 'Aktiv',
  passive: 'Passiv',
  'active-passive': 'Aktiv-passiv',
};

interface Draft {
  mode: 'create' | 'edit';
  code: string;
  name: string;
  nature: AccountNature;
  subkonto: SubkontoKind[];
  quantitative: boolean;
  currency: boolean;
  archived: boolean;
  locked: boolean;
}

function AccountDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const win = useWindow();
  const [d, setD] = useState(draft);
  const m = useMutation();
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const slot = (i: number, v: string) => {
    const next = [...d.subkonto];
    if (v) next[i] = v as SubkontoKind;
    else next.splice(i, 1);
    set({ subkonto: next.filter(Boolean).slice(0, 3) });
  };
  const save = async () => {
    const r =
      d.mode === 'create'
        ? await m.run({
            type: 'account.create',
            companyId: win.companyId,
            code: d.code,
            name: d.name,
            nature: d.nature,
            subkonto: d.subkonto,
            quantitative: d.quantitative,
            currency: d.currency,
          })
        : await m.run({
            type: 'account.update',
            companyId: win.companyId,
            code: d.code,
            name: d.name,
            nature: d.nature,
            subkonto: d.subkonto,
            quantitative: d.quantitative,
            currency: d.currency,
            archived: d.archived,
          });
    if (r) onClose();
  };
  return (
    <Modal
      title={d.mode === 'create' ? 'Yeni hesab' : `Hesab ${d.code}`}
      subtitle={
        d.locked ? 'Yazılışı olan hesabın subkontosu və uçot qaydası dəyişdirilmir.' : undefined
      }
      onClose={onClose}
    >
      <form className="dialog-form" noValidate onSubmit={(e) => (e.preventDefault(), void save())}>
        <div className="form-grid">
          <Field label="Kod" hint="Məsələn 721.01">
            <input
              autoFocus={d.mode === 'create'}
              disabled={d.mode === 'edit'}
              value={d.code}
              onChange={(e) => set({ code: e.target.value })}
            />
          </Field>
          <Field label="Ad" wide>
            <input
              autoFocus={d.mode === 'edit'}
              maxLength={200}
              value={d.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label="Növü">
            <select
              disabled={d.locked}
              value={d.nature}
              onChange={(e) => set({ nature: e.target.value as AccountNature })}
            >
              {Object.entries(natureLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          {[0, 1, 2].map((i) => (
            <Field key={i} label={`Subkonto ${i + 1}`}>
              <select
                disabled={d.locked || i > d.subkonto.length}
                value={d.subkonto[i] ?? ''}
                onChange={(e) => slot(i, e.target.value)}
              >
                <option value="">—</option>
                {subkontoKinds.map((k) => (
                  <option
                    key={k}
                    value={k}
                    disabled={d.subkonto.includes(k) && d.subkonto[i] !== k}
                  >
                    {subkontoLabel[k]}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <label className="check">
            <input
              type="checkbox"
              disabled={d.locked}
              checked={d.quantitative}
              onChange={(e) => set({ quantitative: e.target.checked })}
            />{' '}
            Miqdar uçotu
          </label>
          <label className="check">
            <input
              type="checkbox"
              disabled={d.locked}
              checked={d.currency}
              onChange={(e) => set({ currency: e.target.checked })}
            />{' '}
            Valyuta uçotu
          </label>
          {d.mode === 'edit' && (
            <label className="check">
              <input
                type="checkbox"
                checked={d.archived}
                onChange={(e) => set({ archived: e.target.checked })}
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

export function AccountsPage() {
  const win = useWindow();
  const ws = useWorkspace();
  const { catalog } = useCatalog(win.companyId);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState('');
  const rows = (catalog?.accounts ?? []).filter((a) => matches(search, a.code, a.name));
  const edit = (a: AccountView) =>
    setDraft({
      mode: 'edit',
      code: a.code,
      name: a.name,
      nature: a.nature,
      subkonto: a.subkonto,
      quantitative: a.quantitative,
      currency: a.currency,
      archived: a.archived,
      locked: a.used,
    });
  const sel = catalog?.accounts.find((a) => a.code === selected);
  return (
    <ModuleFrame
      title={pages.accounts.title}
      hint={pages.accounts.hint}
      count={rows.length}
      actions={
        <>
          <button
            type="button"
            className="button secondary"
            disabled={!sel}
            onClick={() =>
              sel &&
              setDraft({
                mode: 'create',
                code: `${sel.code}.`,
                name: '',
                nature: sel.nature,
                subkonto: sel.subkonto,
                quantitative: sel.quantitative,
                currency: sel.currency,
                archived: false,
                locked: false,
              })
            }
          >
            <Plus size={15} /> Subhesab
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() =>
              setDraft({
                mode: 'create',
                code: '',
                name: '',
                nature: 'active',
                subkonto: [],
                quantitative: false,
                currency: false,
                archived: false,
                locked: false,
              })
            }
          >
            <Plus size={15} /> Yeni hesab
          </button>
        </>
      }
      filters={<SearchField value={search} onChange={setSearch} placeholder="Kod və ya ad" />}
    >
      <div className="table-scroll">
        <table className="grid accounts">
          <thead>
            <tr>
              <th scope="col">Kod</th>
              <th scope="col">Ad</th>
              <th scope="col">Növü</th>
              <th scope="col">Subkonto 1</th>
              <th scope="col">Subkonto 2</th>
              <th scope="col">Subkonto 3</th>
              <th scope="col">Uçot</th>
              <th scope="col">
                <span className="sr-only">Əməliyyat</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr
                key={a.code}
                className={`${a.archived ? 'cancelled' : ''}${a.code === selected ? ' selected' : ''}${!a.postable ? ' group' : ''}`}
                onClick={() => setSelected(a.code)}
                onDoubleClick={() =>
                  ws.open({ type: 'accountCard', account: a.code }, win.companyId)
                }
              >
                <td
                  className="code"
                  style={{ paddingLeft: `${8 + (a.code.split('.').length - 1) * 16}px` }}
                >
                  {a.code}
                </td>
                <td>
                  {a.name}
                  {!a.postable && <small className="tag">qrup</small>}
                </td>
                <td>{natureLabel[a.nature]}</td>
                {[0, 1, 2].map((i) => (
                  <td key={i}>{a.subkonto[i] ? subkontoLabel[a.subkonto[i]!] : ''}</td>
                ))}
                <td>
                  {[a.quantitative && 'miqdar', a.currency && 'valyuta'].filter(Boolean).join(', ')}
                </td>
                <td className="row-tools">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Dəyiş: ${a.code}`}
                    title="Dəyiş"
                    onClick={() => edit(a)}
                  >
                    <Pencil size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draft && <AccountDialog draft={draft} onClose={() => setDraft(null)} />}
    </ModuleFrame>
  );
}
