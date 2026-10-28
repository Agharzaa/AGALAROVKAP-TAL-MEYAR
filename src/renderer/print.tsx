/**
 * Printing a paper form (cash order, cash book): the sheet is rendered into the document body and
 * the system print dialog opens — on Windows "Microsoft Print to PDF" saves it as PDF. Everything
 * else on the page is hidden from print by the stylesheet (.print-sheet). `pdf` renders the same
 * sheet and has the desktop app save it as a PDF file straight away.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api';

interface Job {
  content: ReactNode;
  /** A PDF file name: save as PDF instead of the print dialog. */
  pdf?: string;
  done?: (outcome: { file: string | null } | { error: string }) => void;
}

export function usePrint() {
  const [job, setJob] = useState<Job | null>(null);
  useEffect(() => {
    if (!job) return;
    const done = () => setJob(null);
    if (job.pdf !== undefined) {
      let live = true;
      // Let the sheet render first; the main process prints the page as it stands.
      const t = setTimeout(() => {
        api
          .savePdf(job.pdf!)
          .then(
            (file) => job.done?.({ file }),
            (e: Error) => job.done?.({ error: e.message }),
          )
          .finally(() => live && done());
      }, 50);
      return () => {
        live = false;
        clearTimeout(t);
      };
    }
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
  }, [job]);
  return {
    print: (content: ReactNode) => setJob({ content }),
    pdf: (content: ReactNode, file: string, done: NonNullable<Job['done']>) =>
      setJob({ content, pdf: file, done }),
    sheet: job
      ? createPortal(<div className="print-sheet">{job.content}</div>, document.body)
      : null,
  };
}
