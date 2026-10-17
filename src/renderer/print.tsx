/**
 * Printing a paper form (cash order, cash book): the sheet is rendered into the document body and
 * the system print dialog opens — on Windows "Microsoft Print to PDF" saves it as PDF. Everything
 * else on the page is hidden from print by the stylesheet (.print-sheet).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function usePrint() {
  const [sheet, setSheet] = useState<ReactNode>(null);
  useEffect(() => {
    if (!sheet) return;
    const done = () => setSheet(null);
    window.addEventListener('afterprint', done);
    // Let the sheet render first; print() returns once the dialog is closed.
    const t = setTimeout(() => {
      try {
        window.print();
      } catch {
        done();
      }
    }, 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [sheet]);
  return {
    print: (content: ReactNode) => setSheet(content),
    sheet: sheet ? createPortal(<div className="print-sheet">{sheet}</div>, document.body) : null,
  };
}
