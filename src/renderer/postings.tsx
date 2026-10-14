/** The entry a document produced, read-only: where every figure of the document went. */
import type { PostingView } from '../contracts/queries';
import { money, qty } from './format';

export function Postings({ postings }: { postings: PostingView[] }) {
  const side = (s: PostingView['dt']) => (
    <>
      <b>{s.account}</b>
      {s.skNames.length > 0 && <small> · {s.skNames.join(' · ')}</small>}
      {s.curAmount && (
        <small>
          {' '}
          · {money(s.curAmount)} {s.currency}
        </small>
      )}
    </>
  );
  return (
    <table className="grid">
      <thead>
        <tr>
          <th scope="col">Debet</th>
          <th scope="col">Kredit</th>
          <th scope="col" className="num">
            Miqdar
          </th>
          <th scope="col" className="num">
            Məbləğ, AZN
          </th>
          <th scope="col">Məzmun</th>
        </tr>
      </thead>
      <tbody>
        {postings.map((p) => (
          <tr key={p.lineNo}>
            <td>{side(p.dt)}</td>
            <td>{side(p.kt)}</td>
            <td className="num">{qty(p.quantity)}</td>
            <td className="num strong">{money(p.amount)}</td>
            <td className="ellipsis" title={p.memo}>
              {p.memo}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
