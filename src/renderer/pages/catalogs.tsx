import { useState, type ReactNode } from 'react';
import { Pencil, Plus } from '../icons';
import { currencies, subkontoLabel } from '../../domain/chart';
import type { CommandInput } from '../api';
import type {
  BankAccountView,
  CashboxView,
  EmployeeView,
  ItemKind,
  ItemView,
  ProductView,
} from '../../contracts/queries';
import { useCatalog } from '../catalog';
import { ModuleFrame } from '../frame';
import { SearchField, matches } from '../filters';
import { useMutation } from '../hooks';
import { pages } from '../pages';
import { accountOptions, Picker, subkontoOptions } from '../picker';
import { day, money } from '../format';
import { DateInput, Field, Modal, Notice } from '../ui';
import { useWindow } from '../workspace';

function EditDialog({
  title,
  onClose,
  build,
  children,
}: {
  title: string;
  onClose: () => void;
  build: () => CommandInput;
  children: ReactNode;
}) {
  const m = useMutation();
  const save = async () => {
    const r = await m.run(build());
    if (r) onClose();
  };
  return (
    <Modal title={title} onClose={onClose} size="small">
      <form className="dialog-form" noValidate onSubmit={(e) => (e.preventDefault(), void save())}>
        <div className="form-grid">{children}</div>
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

function ListFrame<T extends { id: string; archived: boolean }>({
  page,
  rows,
  search,
  setSearch,
  placeholder,
  head,
  row,
  onNew,
  onEdit,
  extraFilters,
  children,
}: {
  page: 'bankAccounts' | 'cashboxes' | 'products' | 'employees' | 'lists';
  rows: T[];
  search: string;
  setSearch: (s: string) => void;
  placeholder: string;
  head: string[];
  row: (r: T) => ReactNode[];
  onNew: () => void;
  onEdit: (r: T) => void;
  extraFilters?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <ModuleFrame
      title={pages[page].title}
      hint={pages[page].hint}
      count={rows.length}
      actions={
        <button type="button" className="button primary" onClick={onNew}>
          <Plus size={15} /> Yeni
        </button>
      }
      filters={
        <>
          {extraFilters}
          <SearchField value={search} onChange={setSearch} placeholder={placeholder} />
        </>
      }
    >
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">Əməliyyat</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={r.archived ? 'cancelled' : ''}
                onDoubleClick={() => onEdit(r)}
              >
                {row(r).map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
                <td className="row-tools">
                  <button
                    type="button"
                    className="icon-button"
                    title="Dəyiş"
                    aria-label="Dəyiş"
                    onClick={() => onEdit(r)}
                  >
                    <Pencil size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={head.length + 1} className="panel-empty">
                  Siyahı boşdur.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {children}
    </ModuleFrame>
  );
}

const archiveBox = (value: boolean, set: (v: boolean) => void, show: boolean) =>
  show ? (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} /> Arxivdə
    </label>
  ) : null;

export function BankAccountsPage() {
  const win = useWindow();
  const { catalog } = useCatalog(win.companyId);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<BankAccountView | 'new' | null>(null);
  const rows = (catalog?.bankAccounts ?? []).filter((b) =>
    matches(search, b.name, b.iban, b.bankName),
  );
  const bankAccountsAllowed = (catalog?.accounts ?? []).filter(
    (a) => a.postable && !a.archived && a.subkonto.includes('bankAccount'),
  );
  const [bankId, setBankId] = useState('');
  const [iban, setIban] = useState('');
  const [currency, setCurrency] = useState('AZN');
  const [account, setAccount] = useState('223.01');
  const [name, setName] = useState('');
  const [archived, setArchived] = useState(false);
  const open = (b: BankAccountView | 'new') => {
    setEdit(b);
    const x = b === 'new' ? null : b;
    setBankId(x?.bankId ?? '');
    setIban(x?.iban ?? '');
    setCurrency(x?.currency ?? 'AZN');
    setAccount(x?.account ?? '223.01');
    setName(x?.name ?? '');
    setArchived(x?.archived ?? false);
  };
  const current = edit && edit !== 'new' ? edit : null;
  return (
    <ListFrame
      page="bankAccounts"
      rows={rows}
      search={search}
      setSearch={setSearch}
      placeholder="Bank, IBAN, ad"
      head={['Ad', 'Bank', 'IBAN', 'Valyuta', 'Hesab']}
      row={(b) => [
        b.name,
        b.bankName,
        <span className="mono">{b.iban}</span>,
        b.currency,
        <span className="code">{b.account}</span>,
      ]}
      onNew={() => open('new')}
      onEdit={open}
    >
      {edit && catalog && (
        <EditDialog
          title={current ? current.name : 'Yeni bank hesabı'}
          onClose={() => setEdit(null)}
          build={() => ({
            type: 'bankAccount.save',
            companyId: win.companyId,
            ...(current ? { id: current.id, version: current.version } : {}),
            bankId,
            iban,
            currency,
            account,
            name,
            archived,
          })}
        >
          <Field
            label="Bank (kontragent)"
            wide
            hint="Bank əvvəlcə Kontragentlərdə qeydiyyata alınır"
          >
            <Picker
              ariaLabel="Bank"
              value={bankId}
              options={catalog.partners
                .filter((p) => !p.archived)
                .map((p) => ({
                  value: p.id,
                  label: p.name,
                  ...(p.taxId ? { hint: p.taxId } : {}),
                }))}
              onChange={setBankId}
            />
          </Field>
          <Field label="IBAN" wide>
            <input
              className="mono"
              maxLength={40}
              value={iban}
              placeholder="AZ00XXXX00000000000000000000"
              onChange={(e) => setIban(e.target.value)}
            />
          </Field>
          <Field label="Valyuta">
            <select
              value={currency}
              onChange={(e) => {
                const c = e.target.value;
                setCurrency(c);
                const fits = bankAccountsAllowed.find((a) => a.currency === (c !== 'AZN'));
                if (fits) setAccount(fits.code);
              }}
            >
              {['AZN', ...currencies].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Hesab">
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              {bankAccountsAllowed.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ad" wide hint="Boş qalsa: bank · valyuta">
            <input maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {archiveBox(archived, setArchived, !!current)}
        </EditDialog>
      )}
    </ListFrame>
  );
}

/** Kassalar: each bound to one 221 account and its currency (221.04: a currency cashbox). */
export function CashboxesPage() {
  const win = useWindow();
  const { catalog } = useCatalog(win.companyId);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<CashboxView | 'new' | null>(null);
  const rows = (catalog?.cashboxes ?? []).filter((b) => matches(search, b.name, b.account));
  const allowed = (catalog?.accounts ?? []).filter(
    (a) => a.postable && !a.archived && a.subkonto.includes('cashbox'),
  );
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('AZN');
  const [account, setAccount] = useState('221.01');
  const [archived, setArchived] = useState(false);
  const open = (b: CashboxView | 'new') => {
    setEdit(b);
    const x = b === 'new' ? null : b;
    setName(x?.name ?? '');
    setCurrency(x?.currency ?? 'AZN');
    setAccount(x?.account ?? '221.01');
    setArchived(x?.archived ?? false);
  };
  const current = edit && edit !== 'new' ? edit : null;
  return (
    <ListFrame
      page="cashboxes"
      rows={rows}
      search={search}
      setSearch={setSearch}
      placeholder="Ad, hesab"
      head={['Ad', 'Hesab', 'Valyuta']}
      row={(b) => [b.name, <span className="code">{b.account}</span>, b.currency]}
      onNew={() => open('new')}
      onEdit={open}
    >
      {edit && catalog && (
        <EditDialog
          title={current ? current.name : 'Yeni kassa'}
          onClose={() => setEdit(null)}
          build={() => ({
            type: 'cashbox.save',
            companyId: win.companyId,
            ...(current ? { id: current.id, version: current.version } : {}),
            name,
            currency,
            account,
            archived,
          })}
        >
          <Field label="Ad" wide>
            <input
              aria-label="Kassanın adı"
              autoFocus
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Valyuta">
            <select
              aria-label="Valyuta"
              value={currency}
              onChange={(e) => {
                const c = e.target.value;
                setCurrency(c);
                const fits = allowed.find((a) => a.currency === (c !== 'AZN'));
                if (fits && !!allowed.find((a) => a.code === account)?.currency !== (c !== 'AZN'))
                  setAccount(fits.code);
              }}
            >
              {['AZN', ...currencies].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Hesab">
            <select aria-label="Hesab" value={account} onChange={(e) => setAccount(e.target.value)}>
              {allowed.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </Field>
          {archiveBox(archived, setArchived, !!current)}
        </EditDialog>
      )}
    </ListFrame>
  );
}

const productKind = {
  goods: 'Mal',
  material: 'Material',
  asset: 'Əsas vəsait',
  service: 'Xidmət',
} as const;

export function ProductsPage() {
  const win = useWindow();
  const { catalog } = useCatalog(win.companyId);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<ProductView | 'new' | null>(null);
  const [f, setF] = useState({
    code: '',
    name: '',
    unit: 'ədəd',
    kind: 'goods' as ProductView['kind'],
    groupId: '',
    archived: false,
  });
  const rows = (catalog?.products ?? []).filter((p) => matches(search, p.name, p.code));
  const groups = (catalog?.items ?? []).filter((i) => i.kind === 'productGroup');
  const groupName = (id: string) =>
    id ? (groups.find((g) => g.id === id)?.name ?? '') : (groups[0]?.name ?? '');
  const open = (p: ProductView | 'new') => {
    setEdit(p);
    setF(
      p === 'new'
        ? { code: '', name: '', unit: 'ədəd', kind: 'goods', groupId: '', archived: false }
        : {
            code: p.code,
            name: p.name,
            unit: p.unit,
            kind: p.kind,
            groupId: p.groupId,
            archived: p.archived,
          },
    );
  };
  const current = edit && edit !== 'new' ? edit : null;
  return (
    <ListFrame
      page="products"
      rows={rows}
      search={search}
      setSearch={setSearch}
      placeholder="Ad və ya kod"
      head={['Kod', 'Ad', 'Vahid', 'Növ', 'Qrup']}
      row={(p) => [p.code, p.name, p.unit, productKind[p.kind], groupName(p.groupId)]}
      onNew={() => open('new')}
      onEdit={open}
    >
      {edit && (
        <EditDialog
          title={current ? current.name : 'Yeni nomenklatura'}
          onClose={() => setEdit(null)}
          build={() => ({
            type: 'product.save',
            companyId: win.companyId,
            ...(current ? { id: current.id, version: current.version } : {}),
            ...f,
          })}
        >
          <Field label="Ad" wide>
            <input
              autoFocus
              maxLength={240}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <Field label="Kod">
            <input
              maxLength={40}
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
            />
          </Field>
          <Field label="Ölçü vahidi">
            <input
              maxLength={20}
              value={f.unit}
              onChange={(e) => setF({ ...f, unit: e.target.value })}
            />
          </Field>
          <Field label="Növ">
            <select
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as ProductView['kind'] })}
            >
              {Object.entries(productKind).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nomenklatura qrupu" hint="Satışın maya dəyəri (701) bu qrup üzrə yazılır">
            <select value={f.groupId} onChange={(e) => setF({ ...f, groupId: e.target.value })}>
              <option value="">Standart qrup</option>
              {groups
                .filter((g) => !g.archived || g.id === f.groupId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </Field>
          {archiveBox(f.archived, (archived) => setF({ ...f, archived }), !!current)}
        </EditDialog>
      )}
    </ListFrame>
  );
}

/** Salary goes to an expense account with an expense item (stage 8a, QERARLAR 2026-10-27 §2). */
const payrollExpense = (code: string) =>
  ['202', '701', '711', '721'].some((f) => code === f || code.startsWith(`${f}.`));

export function EmployeesPage() {
  const win = useWindow();
  const { catalog } = useCatalog(win.companyId);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<EmployeeView | 'new' | null>(null);
  const empty = {
    name: '',
    position: '',
    fin: '',
    archived: false,
    tabNo: '',
    hired: '',
    left: '',
    salary: '',
    expenseAccount: '',
    expenseSk: [] as string[],
  };
  const [f, setF] = useState(empty);
  const rows = (catalog?.employees ?? []).filter((e) =>
    matches(search, e.name, e.position, e.fin, e.tabNo),
  );
  const open = (e: EmployeeView | 'new') => {
    setEdit(e);
    setF(
      e === 'new'
        ? empty
        : {
            name: e.name,
            position: e.position,
            fin: e.fin,
            archived: e.archived,
            tabNo: e.tabNo,
            hired: e.hired,
            left: e.left,
            salary: e.salary === '0.00' ? '' : e.salary,
            expenseAccount: e.expenseAccount,
            expenseSk: e.expenseSk,
          },
    );
  };
  const current = edit && edit !== 'new' ? edit : null;
  const account = catalog?.accounts.find((a) => a.code === f.expenseAccount);
  // Drivers to 701 with the default product group (QERARLAR 2026-10-27 §2).
  const setAccount = (code: string) => {
    const a = catalog?.accounts.find((x) => x.code === code);
    const group = catalog?.items.find((i) => i.role === 'defaultProductGroup' && !i.archived)?.id;
    setF({
      ...f,
      expenseAccount: code,
      expenseSk: (a?.subkonto ?? []).map((k) => (k === 'productGroup' ? (group ?? '') : '')),
    });
  };
  return (
    <ListFrame
      page="employees"
      rows={rows}
      search={search}
      setSearch={setSearch}
      placeholder="Ad, vəzifə, FİN, tabel nömrəsi"
      head={['Tabel №', 'Ad, soyad', 'Vəzifə', 'FİN', 'Əmək haqqı', 'Xərc hesabı', 'İşə qəbul']}
      row={(e) => [
        e.tabNo,
        e.name,
        e.position,
        e.fin,
        e.salary === '0.00' ? '' : money(e.salary),
        e.expenseAccount,
        e.hired ? day(e.hired) : '',
      ]}
      onNew={() => open('new')}
      onEdit={open}
    >
      {edit && (
        <EditDialog
          title={current ? current.name : 'Yeni işçi'}
          onClose={() => setEdit(null)}
          build={() => ({
            type: 'employee.save',
            companyId: win.companyId,
            ...(current ? { id: current.id, version: current.version } : {}),
            ...f,
          })}
        >
          <Field label="Ad, soyad" wide>
            <input
              autoFocus
              maxLength={160}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <Field label="Vəzifə">
            <input
              maxLength={120}
              value={f.position}
              onChange={(e) => setF({ ...f, position: e.target.value })}
            />
          </Field>
          <Field label="FİN">
            <input
              maxLength={7}
              value={f.fin}
              onChange={(e) => setF({ ...f, fin: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Tabel nömrəsi">
            <input
              maxLength={20}
              value={f.tabNo}
              onChange={(e) => setF({ ...f, tabNo: e.target.value })}
            />
          </Field>
          <Field label="Aylıq əmək haqqı" hint="Əmək müqaviləsi üzrə, vergilərdən əvvəl">
            <input
              inputMode="decimal"
              value={f.salary}
              onChange={(e) => setF({ ...f, salary: e.target.value })}
            />
          </Field>
          <Field label="İşə qəbul">
            <DateInput
              value={f.hired}
              onChange={(hired) => setF({ ...f, hired })}
              aria-label="İşə qəbul"
            />
          </Field>
          <Field label="İşdən çıxma" hint="Boş — işləyir">
            <DateInput
              value={f.left}
              onChange={(left) => setF({ ...f, left })}
              aria-label="İşdən çıxma"
            />
          </Field>
          <Field label="Əmək haqqının xərc hesabı" wide hint="Sürücülər — 701, ofis — 721">
            <Picker
              ariaLabel="Xərc hesabı"
              value={f.expenseAccount}
              options={catalog ? accountOptions(catalog, payrollExpense) : []}
              onChange={setAccount}
              placeholder="Hesab"
            />
          </Field>
          {catalog &&
            account?.subkonto.map((kind, i) =>
              kind === 'expenseItem' ? null : (
                <Field key={kind} label={subkontoLabel[kind]}>
                  <Picker
                    ariaLabel={subkontoLabel[kind]}
                    value={f.expenseSk[i] ?? ''}
                    options={subkontoOptions(catalog, kind, account.code, '')}
                    onChange={(v) =>
                      setF({
                        ...f,
                        expenseSk: account.subkonto.map((_, j) =>
                          j === i ? v : (f.expenseSk[j] ?? ''),
                        ),
                      })
                    }
                  />
                </Field>
              ),
            )}
          {archiveBox(f.archived, (archived) => setF({ ...f, archived }), !!current)}
        </EditDialog>
      )}
    </ListFrame>
  );
}

const itemKinds: { kind: ItemKind; label: string }[] = [
  { kind: 'expenseItem', label: 'Xərc maddələri' },
  { kind: 'incomeType', label: 'Gəlir növləri' },
  { kind: 'taxType', label: 'Vergi növləri' },
  { kind: 'paymentKind', label: 'Ödəniş növləri' },
  { kind: 'fund', label: 'Fondlar' },
  { kind: 'capitalChange', label: 'Kapital dəyişiklikləri' },
  { kind: 'productGroup', label: 'Nomenklatura qrupları' },
  { kind: 'cashFlowItem', label: 'Pul vəsaitlərinin hərəkəti maddələri' },
];

type Role =
  | ''
  | 'vatTax'
  | 'cogs'
  | 'defaultProductGroup'
  | 'goodsIncome'
  | 'serviceIncome'
  | 'fxIncome'
  | 'fxExpense'
  | 'depreciation'
  | 'assetDisposal'
  | 'assetSale';
/** Roles an element of each kind can take in the posting rules (invoices, revaluation). */
const kindRoles: Partial<Record<ItemKind, { role: Role; label: string }[]>> = {
  paymentKind: [{ role: 'vatTax', label: 'Satışın ƏDV-si (Kt 521.01)' }],
  expenseItem: [
    { role: 'cogs', label: 'Satılmış malların maya dəyəri (Dt 701)' },
    { role: 'fxExpense', label: 'Məzənnə fərqi xərci (Dt 731)' },
    { role: 'depreciation', label: 'Amortizasiya (Kt 112)' },
    { role: 'assetDisposal', label: 'Əsas vəsaitlərin silinməsi (Dt 731)' },
  ],
  productGroup: [{ role: 'defaultProductGroup', label: 'Standart nomenklatura qrupu' }],
  incomeType: [
    { role: 'goodsIncome', label: 'Mal satışında standart' },
    { role: 'serviceIncome', label: 'Xidmət satışında standart' },
    { role: 'fxIncome', label: 'Məzənnə fərqi gəliri (Kt 611)' },
    { role: 'assetSale', label: 'Əsas vəsaitin satışı (Kt 611)' },
  ],
};
const roleTitle = Object.fromEntries(
  Object.values(kindRoles)
    .flat()
    .map((r) => [r.role, r.label]),
) as Record<string, string>;

export function ListsPage() {
  const win = useWindow();
  const { catalog } = useCatalog(win.companyId);
  const [kind, setKind] = useState<ItemKind>('expenseItem');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<ItemView | 'new' | null>(null);
  const [name, setName] = useState('');
  const [archived, setArchived] = useState(false);
  const [role, setRole] = useState<Role>('');
  const rows = (catalog?.items ?? []).filter((i) => i.kind === kind && matches(search, i.name));
  const open = (i: ItemView | 'new') => {
    setEdit(i);
    setName(i === 'new' ? '' : i.name);
    setArchived(i === 'new' ? false : i.archived);
    setRole(i === 'new' ? '' : (i.role as Role));
  };
  const roles = kindRoles[kind];
  const current = edit && edit !== 'new' ? edit : null;
  return (
    <ListFrame
      page="lists"
      rows={rows}
      search={search}
      setSearch={setSearch}
      placeholder="Ad"
      head={roles ? ['Ad', 'Qaimələrdə'] : ['Ad']}
      row={(i) => (roles ? [i.name, i.role ? (roleTitle[i.role] ?? '') : ''] : [i.name])}
      onNew={() => open('new')}
      onEdit={open}
      extraFilters={
        <div className="segmented" role="group" aria-label="Siyahı">
          {itemKinds.map((k) => (
            <button
              key={k.kind}
              type="button"
              aria-pressed={kind === k.kind}
              onClick={() => setKind(k.kind)}
            >
              {k.label}
            </button>
          ))}
        </div>
      }
    >
      {edit && (
        <EditDialog
          title={
            current
              ? current.name
              : `Yeni: ${itemKinds.find((k) => k.kind === kind)!.label.toLowerCase()}`
          }
          onClose={() => setEdit(null)}
          build={() => ({
            type: 'item.save',
            companyId: win.companyId,
            ...(current ? { id: current.id, version: current.version } : {}),
            kind,
            name,
            archived,
            ...(roles ? { role } : {}),
          })}
        >
          <Field label="Ad" wide>
            <input
              autoFocus
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {roles && (
            <Field
              label="Yazılış qaydalarında"
              hint="Qaimə yazılışları bu elementi avtomatik götürür; başqa elementdən köçürülür"
            >
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="">Yox</option>
                {roles.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {archiveBox(archived, setArchived, !!current)}
        </EditDialog>
      )}
    </ListFrame>
  );
}
