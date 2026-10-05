import { useState } from 'react';
import type { AccountView, PostingView } from '../../contracts/queries';
import { addAmounts, day, isZero, qty } from '../format';
import { Amount } from '../ui';

export interface PreviewLine {
  account: string;
  debit: string;
  credit: string;
  memo: string;
}

/**
 * Shows what a document did to the ledger. Saved documents show the stored journal lines —
 * never re-derived pairs; unsaved edits show a preview computed with the same posting rules,
 * clearly marked as not yet posted.
 */
export function PostingsPanel({
  preview,
  postings,
  currentVersion,
  accounts,
  note,
}: {
  preview?: PreviewLine[] | string;
  postings?: PostingView[];
  currentVersion?: number;
  accounts: AccountView[];
  note?: string;
}) {
  const [view, setView] = useState<'entries' | 't'>('entries');
  const [all, setAll] = useState(false);
  const name = (code: string) => accounts.find((a) => a.code === code)?.name ?? '';
  const current = (postings ?? []).filter((p) => p.version === currentVersion && !p.reversal);
  const shown = all ? (postings ?? []) : current;
  const isPreview = preview !== undefined;
  return (
    <section className="postings" aria-label="Müxabirləşmələr">
      <header className="postings-heading">
        <h2>{isPreview ? 'Müxabirləşmə — ilkin baxış' : 'Müxabirləşmə'}</h2>
        {isPreview ? (
          <span className="badge warn">Hələ uçota alınmayıb</span>
        ) : (
          <span className="badge">Bazada saxlanmış yazılışlar</span>
        )}
        <div className="segmented" role="group" aria-label="Görünüş">
          <button
            type="button"
            aria-pressed={view === 'entries'}
            onClick={() => setView('entries')}
          >
            Dt/Kt
          </button>
          <button type="button" aria-pressed={view === 't'} onClick={() => setView('t')}>
            T-hesablar
          </button>
        </div>
        {!isPreview &&
          postings &&
          postings.some((p) => p.reversal || p.version !== currentVersion) && (
            <label className="check">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{' '}
              Bütün versiyalar və əks yazılışlar
            </label>
          )}
      </header>
      {typeof preview === 'string' ? (
        <p className="postings-empty">
          Sənədi doldurduqca yazılışlar burada görünəcək. ({preview})
        </p>
      ) : isPreview ? (
        view === 'entries' ? (
          <EntryTable
            rows={preview!.map((p, i) => ({ key: String(i), ...p, extra: '' }))}
            name={name}
          />
        ) : (
          <TAccounts rows={preview!} name={name} />
        )
      ) : !postings ? null : shown.length === 0 ? (
        <p className="postings-empty">Bu sənədin maliyyə yazılışı yoxdur.</p>
      ) : view === 'entries' ? (
        <EntryTable
          rows={shown.map((p) => ({
            key: `${p.entryId}-${p.lineNo}`,
            account: p.account,
            debit: p.debit,
            credit: p.credit,
            memo: p.analytics || p.memo,
            extra: `${day(p.date)} · v${p.version}${p.reversal ? ' · əks yazılış' : ''}${p.quantity ? ` · ${qty(p.quantity)} əd.` : ''}`,
            reversal: p.reversal,
          }))}
          name={name}
        />
      ) : (
        <TAccounts rows={shown} name={name} />
      )}
      {note && <p className="postings-note">{note}</p>}
    </section>
  );
}

function EntryTable({
  rows,
  name,
}: {
  rows: {
    key: string;
    account: string;
    debit: string;
    credit: string;
    memo: string;
    extra: string;
    reversal?: boolean;
  }[];
  name: (code: string) => string;
}) {
  return (
    <table className="entry-table">
      <thead>
        <tr>
          <th scope="col">Hesab</th>
          <th scope="col">Analitika</th>
          <th scope="col" className="num">
            Debet
          </th>
          <th scope="col" className="num">
            Kredit
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={r.reversal ? 'reversal' : ''}>
            <td>
              <span className="account-code">{r.account}</span> {name(r.account)}
            </td>
            <td>
              {r.memo}
              {r.extra && <small>{r.extra}</small>}
            </td>
            <td className="num">{isZero(r.debit) ? '' : <Amount value={r.debit} />}</td>
            <td className="num">{isZero(r.credit) ? '' : <Amount value={r.credit} />}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2}>Cəmi</td>
          <td className="num">
            <Amount value={addAmounts(rows.map((r) => r.debit))} strong />
          </td>
          <td className="num">
            <Amount value={addAmounts(rows.map((r) => r.credit))} strong />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/** Each account as a T: debit left, credit right, and this document's net effect below. */
function TAccounts({
  rows,
  name,
}: {
  rows: { account: string; debit: string; credit: string }[];
  name: (code: string) => string;
}) {
  const codes = [...new Set(rows.map((r) => r.account))];
  return (
    <div className="t-grid">
      {codes.map((code) => {
        const own = rows.filter((r) => r.account === code);
        const debits = own.filter((r) => !isZero(r.debit)).map((r) => r.debit);
        const credits = own.filter((r) => !isZero(r.credit)).map((r) => r.credit);
        const d = addAmounts(debits);
        const c = addAmounts(credits);
        const net = addAmounts([d, `-${c}`.replace('--', '')]);
        return (
          <article className="t-account" key={code} aria-label={`T-hesab ${code}`}>
            <h3>
              <span className="account-code">{code}</span> {name(code)}
            </h3>
            <div className="t-sides">
              <div>
                <span className="t-side">Debet</span>
                {debits.map((v, i) => (
                  <Amount key={i} value={v} />
                ))}
                <b className="t-sum">
                  <Amount value={d} />
                </b>
              </div>
              <div>
                <span className="t-side">Kredit</span>
                {credits.map((v, i) => (
                  <Amount key={i} value={v} />
                ))}
                <b className="t-sum">
                  <Amount value={c} />
                </b>
              </div>
            </div>
            <p className="t-net">
              Bu sənəd üzrə saldo: <Amount value={net.replace('-', '')} />{' '}
              {isZero(net) ? '' : net.startsWith('-') ? 'Kt' : 'Dt'}
            </p>
          </article>
        );
      })}
    </div>
  );
}
