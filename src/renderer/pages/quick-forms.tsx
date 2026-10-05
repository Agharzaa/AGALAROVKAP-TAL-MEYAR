import { useState, type FormEvent } from 'react';
import type { Catalog, PartnerView, ProductView } from '../../contracts/queries';
import { inFamily } from '../../domain/accounts';
import { useMutation } from '../hooks';
import { Field, Notice } from '../ui';

export function PartnerForm({
  companyId,
  existing,
  onDone,
  onCancel,
}: {
  companyId: string;
  existing?: PartnerView;
  onDone: (id: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [taxId, setTaxId] = useState(existing?.taxId ?? '');
  const m = useMutation();
  return (
    <form
      noValidate
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        const r = await m.run({
          type: 'partner.save',
          companyId,
          name,
          taxId,
          ...(existing ? { id: existing.id, version: existing.version } : {}),
        });
        if (r) await onDone(r.id);
      }}
    >
      <fieldset className="modal-body form-grid" disabled={m.busy}>
        {m.error && <Notice onClose={m.clear}>{m.error.message}</Notice>}
        <Field label="Adı" wide>
          <input
            autoFocus
            required
            maxLength={240}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="VÖEN" wide hint="10 rəqəm; əvvəldəki sıfırlar saxlanılır.">
          <input
            required
            inputMode="numeric"
            pattern="[0-9]{10}"
            maxLength={10}
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
          />
        </Field>
      </fieldset>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Geri
        </button>
        <button className="button primary" disabled={m.busy}>
          {m.busy ? 'Saxlanılır…' : 'Saxla'}
        </button>
      </div>
    </form>
  );
}

export function ProductForm({
  companyId,
  catalog,
  existing,
  onDone,
  onCancel,
}: {
  companyId: string;
  catalog: Catalog;
  existing?: ProductView;
  onDone: (id: string, account: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [v, setV] = useState({
    code: existing?.code ?? '',
    name: existing?.name ?? '',
    group: existing?.group ?? '',
    barcode: existing?.barcode ?? '',
    baseUnit: existing?.baseUnit ?? 'pcs',
    purchaseUnit: existing?.purchaseUnit ?? 'pcs',
    factor: existing?.factor ?? '1',
    account:
      existing?.account ??
      catalog.accounts.find((a) => a.postable && inFamily(a.code, '205'))?.code ??
      '205',
  });
  const m = useMutation();
  const accounts = catalog.accounts.filter(
    (a) => a.postable && ['205', '201', '113'].some((f) => inFamily(a.code, f)),
  );
  const unitName = (code: string) => catalog.units.find((u) => u.code === code)?.name ?? code;
  return (
    <form
      noValidate
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        const r = await m.run({
          type: 'product.save',
          companyId,
          ...v,
          factor: v.baseUnit === v.purchaseUnit ? '1' : v.factor,
          ...(existing ? { id: existing.id, version: existing.version } : {}),
        });
        if (r) await onDone(r.id, v.account);
      }}
    >
      <fieldset className="modal-body form-grid" disabled={m.busy}>
        {m.error && <Notice onClose={m.clear}>{m.error.message}</Notice>}
        <Field label="Kod">
          <input
            autoFocus
            required
            maxLength={40}
            value={v.code}
            onChange={(e) => setV({ ...v, code: e.target.value })}
          />
        </Field>
        <Field label="Barkod">
          <input
            maxLength={64}
            value={v.barcode}
            onChange={(e) => setV({ ...v, barcode: e.target.value })}
          />
        </Field>
        <Field label="Adı" wide>
          <input
            required
            maxLength={240}
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </Field>
        <Field label="Qrup">
          <input
            maxLength={120}
            value={v.group}
            onChange={(e) => setV({ ...v, group: e.target.value })}
          />
        </Field>
        <Field label="İlkin uçot hesabı" hint="Sənəd sətrində başqa hesab seçmək olar.">
          <select value={v.account} onChange={(e) => setV({ ...v, account: e.target.value })}>
            {accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Əsas vahid" hint="Qalıq bu vahidlə aparılır.">
          <select value={v.baseUnit} onChange={(e) => setV({ ...v, baseUnit: e.target.value })}>
            {catalog.units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Alış vahidi">
          <select
            value={v.purchaseUnit}
            onChange={(e) => setV({ ...v, purchaseUnit: e.target.value })}
          >
            {catalog.units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        {v.baseUnit !== v.purchaseUnit && (
          <Field
            label={`1 ${unitName(v.purchaseUnit)} = ? ${unitName(v.baseUnit)}`}
            hint="Məsələn, qutuda 12 ədəd."
          >
            <input
              required
              inputMode="decimal"
              value={v.factor}
              onChange={(e) => setV({ ...v, factor: e.target.value })}
            />
          </Field>
        )}
      </fieldset>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Geri
        </button>
        <button className="button primary" disabled={m.busy}>
          {m.busy ? 'Saxlanılır…' : 'Saxla'}
        </button>
      </div>
    </form>
  );
}
