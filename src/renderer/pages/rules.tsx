/**
 * Learned rules (stage 3d) and budget classification codes. A rule is made from a booking the
 * accountant already did ("Qayda kimi saxla" on a bank document), edited here, and switched to
 * automatic posting only by the accountant. Codes name the 521 / 522 sub-account of a tax payment.
 */
import { useMemo, useState } from 'react';
import { Pencil, Plus } from '../icons';
import type { RuleLineInput } from '../../contracts/commands';
import type { BudgetCodeView, Catalog, RuleDraft, RuleView } from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { day, money, toField } from '../format';
import { useMutation, useQuery } from '../hooks';
import { pages } from '../pages';
import { accountOptions, Picker, subkontoOptions } from '../picker';
import { DataTable, Empty, Field, Modal, Notice, type Column } from '../ui';
import { useWindow } from '../workspace';

interface RuleForm {
  id?: string;
  version?: number;
  name: string;
  direction: 'in' | 'out';
  bankAccountId: string;
  counterpartyTaxId: string;
  terms: string;
  amountMin: string;
  amountMax: string;
  lines: RuleLineInput[];
  mode: 'suggest' | 'auto';
}

export const formFromDraft = (d: RuleDraft): RuleForm => ({
  name: d.name,
  direction: d.direction,
  bankAccountId: d.bankAccountId,
  counterpartyTaxId: d.counterpartyTaxId,
  terms: d.terms.join(', '),
  amountMin: '',
  amountMax: '',
  lines: d.lines.map((l) => ({ ...l, amount: toField(l.amount) })),
  mode: 'suggest',
});
const formFromRule = (r: RuleView): RuleForm => ({
  id: r.id,
  version: r.version,
  name: r.name,
  direction: r.direction,
  bankAccountId: r.bankAccountId,
  counterpartyTaxId: r.counterpartyTaxId,
  terms: r.terms.join(', '),
  amountMin: toField(r.amountMin),
  amountMax: toField(r.amountMax),
  lines: r.lines.map(({ skNames: _n, ...l }) => ({ ...l, amount: toField(l.amount) })),
  mode: r.mode,
});

/** Create or edit a rule; the lines' accounts and subkonto come from the booking it learned. */
export function RuleDialog({
  companyId,
  catalog,
  initial,
  existing,
  onClose,
  onSaved,
}: {
  companyId: string;
  catalog: Catalog;
  initial: RuleForm;
  existing?: { id: string; name: string } | undefined;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [form, setForm] = useState(initial);
  const m = useMutation();
  const set = (patch: Partial<RuleForm>) => setForm({ ...form, ...patch });
  const account = (code: string) => catalog.accounts.find((a) => a.code === code);
  async function save(archived = false) {
    const r = await m.run({
      type: 'rule.save',
      companyId,
      ...(form.id ? { id: form.id, version: form.version } : {}),
      name: form.name,
      direction: form.direction,
      bankAccountId: form.bankAccountId,
      counterpartyTaxId: form.counterpartyTaxId,
      terms: form.terms
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      amountMin: form.amountMin.trim(),
      amountMax: form.amountMax.trim(),
      lines: form.lines.map((l) => ({ ...l, amount: l.amount.trim() })),
      mode: form.mode,
      archived,
    });
    if (r) {
      onSaved?.();
      onClose();
    }
  }
  return (
    <Modal
      title={form.id ? `Qayda · ${initial.name}` : 'Yeni qayda'}
      subtitle={form.direction === 'in' ? 'Daxilolma sətirləri üçün' : 'Məxaric sətirləri üçün'}
      onClose={onClose}
      size="medium"
    >
      <form className="dialog-form" noValidate onSubmit={(e) => (e.preventDefault(), void save())}>
        {existing && !form.id && (
          <Notice kind="info">
            Bu cür sətirləri artıq “{existing.name}” qaydası tanıyır. Yeni qayda yalnız daha dəqiq
            (əlavə söz, məbləğ aralığı) olanda lazımdır.
          </Notice>
        )}
        <div className="form-grid">
          <Field label="Qaydanın adı">
            <input
              autoFocus
              maxLength={160}
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label="Ödəyicinin / alanın VÖEN-i" hint="Boş — istənilən">
            <input
              aria-label="VÖEN"
              inputMode="numeric"
              maxLength={20}
              value={form.counterpartyTaxId}
              onChange={(e) => set({ counterpartyTaxId: e.target.value })}
            />
          </Field>
          <Field
            label="Təyinatda olmalı sözlər"
            hint="Vergüllə; hamısı olmalıdır. Rəqəm və tarix yazmayın — hər ay dəyişir."
          >
            <input
              aria-label="Sözlər"
              value={form.terms}
              onChange={(e) => set({ terms: e.target.value })}
            />
          </Field>
          <Field label="Bank hesabı" hint="Boş — bütün hesablar">
            <select
              aria-label="Bank hesabı"
              value={form.bankAccountId}
              onChange={(e) => set({ bankAccountId: e.target.value })}
            >
              <option value="">Bütün hesablar</option>
              {catalog.bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.account} · {b.name || b.iban}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Məbləğ, ən az">
            <input
              aria-label="Ən az məbləğ"
              inputMode="decimal"
              value={form.amountMin}
              onChange={(e) => set({ amountMin: e.target.value })}
            />
          </Field>
          <Field label="Məbləğ, ən çox">
            <input
              aria-label="Ən çox məbləğ"
              inputMode="decimal"
              value={form.amountMax}
              onChange={(e) => set({ amountMax: e.target.value })}
            />
          </Field>
          <Field label="Rejim">
            <select
              aria-label="Rejim"
              value={form.mode}
              onChange={(e) => set({ mode: e.target.value as RuleForm['mode'] })}
            >
              <option value="suggest">Təklif — mühasib təsdiqləyir</option>
              <option value="auto">Avtomatik — sistem özü uçota alır</option>
            </select>
          </Field>
        </div>
        <table className="grid">
          <thead>
            <tr>
              <th scope="col">{form.direction === 'in' ? 'Kredit' : 'Debet'} hesabı</th>
              <th scope="col">Subkonto</th>
              <th scope="col" className="num">
                Məbləğ
              </th>
            </tr>
          </thead>
          <tbody>
            {form.lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <b>{l.account}</b> {account(l.account)?.name}
                </td>
                <td>
                  {(account(l.account)?.subkonto ?? [])
                    .map((k, j) =>
                      k === 'document' && !l.sk[j]
                        ? 'hesablaşma sənədi avtomatik'
                        : (subkontoOptions(catalog, k, l.account, l.sk[0] ?? '').find(
                            (o) => o.value === l.sk[j],
                          )?.label ??
                          l.sk[j] ??
                          '—'),
                    )
                    .join(' · ') || '—'}
                </td>
                <td className="num narrow">
                  <input
                    aria-label={`Qayda sətri ${i + 1} məbləğ`}
                    inputMode="decimal"
                    placeholder="qalan"
                    value={l.amount}
                    onChange={(e) =>
                      set({
                        lines: form.lines.map((x, k) =>
                          k === i ? { ...x, amount: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="doc-hint">
          Bir sətrin məbləği boş qalır — çıxarış sətrinin qalan məbləği ona yazılır. Avtomatik
          rejimdə hər uçot audit jurnalında qaydanın adı və versiyası ilə görünür və sənədi ləğv
          etməklə geri qaytarılır.
        </p>
        {m.error && <Notice>{m.error.message}</Notice>}
        <div className="form-actions">
          {form.id && (
            <button
              type="button"
              className="button secondary push-right"
              disabled={m.busy}
              onClick={() => void save(true)}
            >
              Arxivləşdir
            </button>
          )}
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

export function RulesPage() {
  const win = useWindow();
  const { catalog } = useCatalog(win.companyId);
  const rules = useQuery<RuleView[]>({ type: 'rules', companyId: win.companyId });
  const [edit, setEdit] = useState<RuleView | null>(null);
  const m = useMutation();
  const page = pages.rules;
  async function toggle(r: RuleView) {
    await m.run({
      type: 'rule.save',
      companyId: win.companyId,
      ...formFromRule(r),
      id: r.id,
      version: r.version,
      terms: r.terms,
      amountMin: r.amountMin,
      amountMax: r.amountMax,
      lines: r.lines.map(({ skNames: _n, ...l }) => l),
      mode: r.mode === 'auto' ? 'suggest' : 'auto',
      archived: false,
    });
  }
  const columns: Column<RuleView>[] = [
    {
      key: 'name',
      label: 'Qayda',
      className: 'clip',
      render: (r) => (
        <button type="button" className="link" onClick={() => setEdit(r)}>
          {r.name}
        </button>
      ),
    },
    { key: 'dir', label: 'Növ', render: (r) => (r.direction === 'in' ? 'Daxilolma' : 'Məxaric') },
    { key: 'tax', label: 'VÖEN', className: 'nowrap', render: (r) => r.counterpartyTaxId || '—' },
    { key: 'terms', label: 'Sözlər', className: 'clip', render: (r) => r.terms.join(', ') || '—' },
    {
      key: 'lines',
      label: 'Yazılış',
      className: 'clip',
      render: (r) =>
        r.lines
          .map(
            (l) =>
              `${l.account}${l.amount ? ` ${money(l.amount)}` : ''}${l.skNames.filter(Boolean).length ? ` (${l.skNames.filter(Boolean).join(' · ')})` : ''}`,
          )
          .join(' + '),
    },
    {
      key: 'mode',
      label: 'Rejim',
      render: (r) =>
        r.archived ? (
          'arxivdə'
        ) : (
          <>
            <b className={`chip ${r.mode === 'auto' ? 'chip-ok' : 'chip-wait'}`}>
              {r.mode === 'auto' ? 'Avtomatik' : 'Təklif'}
            </b>{' '}
            <button
              type="button"
              className="button secondary small"
              disabled={m.busy}
              aria-label={`${r.name}: ${r.mode === 'auto' ? 'təklifə qaytar' : 'avtomatik et'}`}
              onClick={() => void toggle(r)}
            >
              {r.mode === 'auto' ? 'Təklifə qaytar' : 'Avtomatik et'}
            </button>
          </>
        ),
    },
    {
      key: 'uses',
      label: 'İstifadə',
      align: 'end',
      render: (r) =>
        r.uses ? `${r.uses}${r.lastUsedAt ? ` · ${day(r.lastUsedAt.slice(0, 10))}` : ''}` : '—',
    },
  ];
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      count={rules.data?.length ?? 0}
      onRefresh={rules.reload}
      notices={
        <>
          {rules.error && <Notice>{rules.error}</Notice>}
          {m.error && <Notice onClose={m.clear}>{m.error.message}</Notice>}
        </>
      }
    >
      <p className="doc-hint">
        Qayda bank sənədində “Qayda kimi saxla” ilə mühasibin öz qərarından yaranır və “Təklif”
        rejimində başlayır. Sistem qaydanı heç vaxt özü avtomatik etmir.
      </p>
      <DataTable
        label={page.title}
        rows={rules.data ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        onOpen={setEdit}
        rowClass={(r) => (r.archived ? 'cancelled' : '')}
        empty={<Empty title="Hələ qayda yoxdur" />}
      />
      {edit && catalog && (
        <RuleDialog
          companyId={win.companyId}
          catalog={catalog as Catalog}
          initial={formFromRule(edit)}
          onClose={() => setEdit(null)}
        />
      )}
    </ModuleFrame>
  );
}

export function BudgetCodesPage() {
  const win = useWindow();
  const { catalog } = useCatalog(win.companyId);
  const codes = useQuery<BudgetCodeView[]>({ type: 'budgetCodes', companyId: win.companyId });
  const [edit, setEdit] = useState<Partial<BudgetCodeView> | null>(null);
  const m = useMutation();
  const page = pages.budgetCodes;
  const accounts = useMemo(
    () =>
      catalog
        ? accountOptions(catalog as Catalog, (c) => c.startsWith('521.') || c.startsWith('522.'))
        : [],
    [catalog],
  );
  const kinds = (catalog?.items ?? []).filter((i) => i.kind === 'paymentKind' && !i.archived);
  async function save() {
    if (!edit) return;
    const r = await m.run({
      type: 'budgetCode.save',
      companyId: win.companyId,
      ...(edit.id ? { id: edit.id, version: edit.version } : {}),
      code: edit.code ?? '',
      name: edit.name ?? '',
      account: edit.account ?? '',
      paymentKindId: edit.paymentKindId ?? '',
      archived: edit.archived ?? false,
    });
    if (r) setEdit(null);
  }
  const columns: Column<BudgetCodeView>[] = [
    {
      key: 'code',
      label: 'Kod',
      render: (c) => (
        <button type="button" className="link" onClick={() => setEdit(c)}>
          {c.code}
        </button>
      ),
    },
    { key: 'name', label: 'Ad', className: 'clip', render: (c) => c.name },
    { key: 'account', label: 'Subhesab', render: (c) => c.account },
    {
      key: 'kind',
      label: 'Ödəniş növü',
      render: (c) => catalog?.items.find((i) => i.id === c.paymentKindId)?.name ?? '—',
    },
  ];
  return (
    <ModuleFrame
      title={page.title}
      hint={page.hint}
      count={codes.data?.length ?? 0}
      onRefresh={codes.reload}
      actions={
        <button
          type="button"
          className="button primary"
          onClick={() => setEdit({ paymentKindId: kinds[0]?.id ?? '' })}
        >
          <Plus size={15} /> Yeni kod
        </button>
      }
      notices={codes.error && <Notice>{codes.error}</Notice>}
    >
      <DataTable
        label={page.title}
        rows={codes.data ?? []}
        columns={columns}
        rowKey={(c) => c.id}
        onOpen={setEdit}
        rowClass={(c) => (c.archived ? 'cancelled' : '')}
        empty={
          <Empty title="Kod yoxdur — vergi ödənişlərinin subhesabını təyinatdakı koda görə təklif etmək üçün əlavə edin" />
        }
      />
      {edit && (
        <Modal
          title={edit.id ? `Kod ${edit.code}` : 'Yeni büdcə təsnifat kodu'}
          onClose={() => setEdit(null)}
          size="small"
        >
          <form
            className="dialog-form"
            noValidate
            onSubmit={(e) => (e.preventDefault(), void save())}
          >
            <div className="form-grid">
              <Field label="Kod" hint="6 rəqəm">
                <input
                  autoFocus
                  inputMode="numeric"
                  maxLength={10}
                  value={edit.code ?? ''}
                  onChange={(e) => setEdit({ ...edit, code: e.target.value })}
                />
              </Field>
              <Field label="Ad">
                <input
                  maxLength={160}
                  value={edit.name ?? ''}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </Field>
              <Field label="Subhesab (521 / 522)">
                <Picker
                  ariaLabel="Subhesab"
                  value={edit.account ?? ''}
                  options={accounts}
                  onChange={(account) => setEdit({ ...edit, account })}
                />
              </Field>
              <Field label="Ödəniş növü">
                <select
                  aria-label="Ödəniş növü"
                  value={edit.paymentKindId ?? ''}
                  onChange={(e) => setEdit({ ...edit, paymentKindId: e.target.value })}
                >
                  {kinds.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </Field>
              {edit.id && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={edit.archived ?? false}
                    onChange={(e) => setEdit({ ...edit, archived: e.target.checked })}
                  />
                  Arxivdə
                </label>
              )}
            </div>
            {m.error && <Notice>{m.error.message}</Notice>}
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={() => setEdit(null)}>
                Ləğv et
              </button>
              <button type="submit" className="button primary" disabled={m.busy}>
                <Pencil size={15} /> Saxla
              </button>
            </div>
          </form>
        </Modal>
      )}
    </ModuleFrame>
  );
}
