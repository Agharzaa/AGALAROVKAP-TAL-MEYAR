/**
 * Bank statement import (1C: "Bank çıxarışının yüklənməsi").
 *
 * 1. `readStatementTable` turns the rows of a bank's CSV/XLSX export into statement lines. It finds
 *    the header row by the words banks use (Tarix, Mədaxil/Məxaric, Debet/Kredit, Məbləğ, Təyinat,
 *    VÖEN…), so the column order of a particular bank does not matter.
 * 2. `classifyStatementLine` proposes how each line is booked — which operation kind, which
 *    partner, which account — the way an accountant reads a statement: first the counterparty's
 *    VÖEN, then the purpose text. Only proposals marked `high` are posted by "Avtomatik keçir";
 *    the rest wait for a person.
 */
import { formatMinor, parseMoney, type Minor } from './money.js';
import type { PaymentDirection, PaymentKind } from './posting.js';
import { roles } from './accounts.js';
import { searchKey } from './values.js';

export interface StatementLine {
  date: string;
  direction: PaymentDirection;
  amount: string;
  reference: string;
  counterparty: string;
  counterpartyTaxId: string;
  purpose: string;
}

export interface StatementReadResult {
  lines: StatementLine[];
  /** Rows that looked like data but could not be read, with the reason (1-based row numbers). */
  problems: { row: number; message: string }[];
  /** Which columns were recognised, for the preview. */
  columns: Partial<Record<Column, string>>;
}

type Column =
  | 'date'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'direction'
  | 'reference'
  | 'counterparty'
  | 'taxId'
  | 'purpose';

/** Header words per column, compared after `searchKey` folding (i/ı/İ alike, lower case). */
const headerWords: Record<Column, string[]> = {
  date: ['tarix', 'date', 'дата', 'əməliyyat tarixi', 'sənəd tarixi'],
  // From the account holder's side: money in / money out.
  credit: [
    'mədaxil',
    'medaxil',
    'daxilolma',
    'daxil olan',
    'kredit',
    'credit',
    'кредит',
    'приход',
    'mədaxil məbləği',
  ],
  debit: [
    'məxaric',
    'mexaric',
    'çıxış',
    'çıxan',
    'debet',
    'debit',
    'дебет',
    'расход',
    'məxaric məbləği',
  ],
  amount: ['məbləğ', 'mebleg', 'amount', 'сумма', 'cəm'],
  direction: ['növ', 'istiqamət', 'd/k', 'dt/kt', 'type'],
  reference: [
    'sənəd',
    '№',
    'nömrə',
    'nomre',
    'ödəniş tapşırığı',
    'reference',
    'номер',
    'sənəd nömrəsi',
    'ref',
  ],
  counterparty: [
    'kontragent',
    'qarşı tərəf',
    'benefisiar',
    'alan',
    'göndərən',
    'ödəyici',
    'ad',
    'adı',
    'name',
    'контрагент',
    'получатель',
    'плательщик',
    'müştəri',
  ],
  taxId: ['vöen', 'voen', 'inn', 'инн', 'tax id', 'vergi ödəyicisinin'],
  purpose: [
    'təyinat',
    'teyinat',
    'ödənişin təyinatı',
    'məqsəd',
    'purpose',
    'назначение',
    'açıqlama',
    'qeyd',
    'izah',
    'description',
  ],
};

function matchColumn(cell: string): Column | undefined {
  const text = searchKey(cell.trim());
  if (!text) return undefined;
  let best: { column: Column; score: number } | undefined;
  for (const [column, words] of Object.entries(headerWords) as [Column, string[]][])
    for (const w of words) {
      const word = searchKey(w);
      // Short words ("ad", "ref", "№") count only as the whole cell or its first word.
      const short = word.length <= 3;
      const score =
        text === word
          ? 3
          : text.startsWith(short ? `${word} ` : word)
            ? 2
            : !short && text.includes(word)
              ? 1
              : 0;
      if (score && (!best || score > best.score)) best = { column, score };
    }
  return best?.column;
}

/** Finds the header row within the first rows of the sheet (banks put a title block above it). */
function findHeader(
  rows: readonly string[][],
): { index: number; map: Map<Column, number> } | undefined {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const map = new Map<Column, number>();
    rows[i]!.forEach((cell, c) => {
      const column = matchColumn(cell);
      if (column && !map.has(column)) map.set(column, c);
    });
    const hasMoney = map.has('amount') || map.has('debit') || map.has('credit');
    if (map.has('date') && hasMoney && map.size >= 3) return { index: i, map };
  }
  return undefined;
}

/** Reads 31.01.2026, 31/01/2026, 2026-01-31, 31.01.26 and Excel serial day numbers. */
export function readStatementDate(value: string): string | undefined {
  const text = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return check(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\b/.exec(text);
  if (m) {
    const year = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    return check(year, +m[2]!, +m[1]!);
  }
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return check(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return undefined;
  function check(y: number, mo: number, d: number) {
    const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const date = new Date(`${iso}T00:00:00Z`);
    return y >= 2000 && y <= 2099 && date.toISOString().slice(0, 10) === iso ? iso : undefined;
  }
}

/**
 * Reads amounts the way banks print them: "1 234,56", "1.234,56", "1,234.56", "-50.00",
 * "(50,00)". Returns the absolute value in minor units and whether it was negative.
 */
export function readStatementAmount(
  value: string,
): { amount: Minor; negative: boolean } | undefined {
  let text = value.replace(/[\s ']/g, '').replace(/(AZN|₼|manat)$/i, '');
  if (!text) return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) text = text.slice(1);
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // The later separator is the decimal one.
    text = lastComma > lastDot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = text.length - lastComma - 1;
    // "12,345" is a thousands separator; "1,5", "0,005" and "1,5000" are decimals.
    const single = text.match(/,/g)!.length === 1;
    text =
      single && (decimals !== 3 || text.startsWith('0,'))
        ? text.replace(',', '.')
        : text.replace(/,/g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return undefined;
  // Banks sometimes print 4 decimals (1C style "17 000,0000"); round half up to qəpik.
  const [whole, frac = ''] = text.split('.');
  const padded = (frac + '000').slice(0, 3);
  let minor = BigInt(whole!) * 100n + BigInt(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) minor += 1n;
  try {
    parseMoney(formatMinor(minor));
  } catch {
    return undefined;
  }
  return { amount: minor, negative };
}

const cell = (row: readonly string[], index: number | undefined) =>
  index === undefined ? '' : String(row[index] ?? '').trim();

export function readStatementTable(rows: readonly string[][]): StatementReadResult {
  const header = findHeader(rows);
  if (!header)
    return {
      lines: [],
      problems: [
        {
          row: 0,
          message:
            'Başlıq sətri tapılmadı. Faylda “Tarix”, “Mədaxil/Məxaric” (və ya “Məbləğ”) və “Təyinat” sütunları olmalıdır.',
        },
      ],
      columns: {},
    };
  const { map } = header;
  const columns: StatementReadResult['columns'] = {};
  for (const [column, index] of map) columns[column] = rows[header.index]![index] ?? '';
  const lines: StatementLine[] = [];
  const problems: StatementReadResult['problems'] = [];
  for (let r = header.index + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (row.every((c) => !String(c ?? '').trim())) continue;
    const rawDate = cell(row, map.get('date'));
    const date = readStatementDate(rawDate);
    if (!date) {
      // Totals and page footers ("Cəmi", "Qalıq") have no date; they are not operations.
      if (rawDate || /c[əe]mi|qal[ıi]q|итого|остаток|total/i.test(row.join(' '))) continue;
      continue;
    }
    let direction: PaymentDirection | undefined;
    let amount: Minor | undefined;
    const credit = readStatementAmount(cell(row, map.get('credit')));
    const debit = readStatementAmount(cell(row, map.get('debit')));
    if (credit && credit.amount > 0n) {
      direction = 'in';
      amount = credit.amount;
    } else if (debit && debit.amount > 0n) {
      direction = 'out';
      amount = debit.amount;
    } else {
      const single = readStatementAmount(cell(row, map.get('amount')));
      if (single && single.amount > 0n) {
        amount = single.amount;
        const flag = searchKey(cell(row, map.get('direction')));
        if (/^(k|kt|kredit|credit|mədaxil|medaxil|daxil|in|\+)/.test(flag)) direction = 'in';
        else if (/^(d|dt|debet|debit|məxaric|mexaric|çıx|out|-)/.test(flag)) direction = 'out';
        else direction = single.negative ? 'out' : 'in';
      }
    }
    if (!direction || !amount) {
      problems.push({ row: r + 1, message: 'Məbləğ oxunmadı.' });
      continue;
    }
    const taxId = (/\b\d{10}\b/.exec(cell(row, map.get('taxId'))) ?? [''])[0];
    lines.push({
      date,
      direction,
      amount: formatMinor(amount),
      reference: cell(row, map.get('reference')).slice(0, 80),
      counterparty: cell(row, map.get('counterparty')).slice(0, 240),
      counterpartyTaxId:
        taxId ||
        (/\b(?:VÖEN|VOEN)[:\s]*(\d{10})\b/i.exec(cell(row, map.get('purpose')))?.[1] ?? ''),
      purpose: cell(row, map.get('purpose')).slice(0, 500),
    });
  }
  return { lines, problems, columns };
}

/** Splits CSV text (comma, semicolon or tab separated; quoted fields) into rows. */
export function readCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ','].sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length,
  )[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && !field) quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Classification

export type Confidence = 'high' | 'medium' | 'low';
export interface StatementSuggestion {
  kind: PaymentKind;
  partnerId?: string;
  /** Partner to create from the statement's name and VÖEN. */
  createPartner?: boolean;
  counterAccount?: string;
  expenseItemId?: string;
  confidence: Confidence;
  reason: string;
}

export interface ClassifyContext {
  companyTaxId: string;
  partnersByTaxId: ReadonlyMap<string, { id: string; name: string }>;
  /** Partners by folded name, used when the statement has no VÖEN. */
  partnersByName: ReadonlyMap<string, { id: string; name: string }>;
  /** Expense item for bank charges ("Bank xidmətləri"), when the company has one. */
  bankFeeItemId?: string;
}

const has = (text: string, ...words: string[]) => words.some((w) => text.includes(searchKey(w)));

export function classifyStatementLine(
  line: Pick<StatementLine, 'direction' | 'counterparty' | 'counterpartyTaxId' | 'purpose'>,
  ctx: ClassifyContext,
): StatementSuggestion {
  const purpose = searchKey(`${line.purpose} ${line.counterparty}`);
  const out = line.direction === 'out';
  const byTax = line.counterpartyTaxId
    ? ctx.partnersByTaxId.get(line.counterpartyTaxId)
    : undefined;
  const byName = !byTax ? ctx.partnersByName.get(searchKey(line.counterparty.trim())) : undefined;
  const partner = byTax ?? byName;
  const withPartner = partner ? { partnerId: partner.id } : {};

  if (line.counterpartyTaxId && line.counterpartyTaxId === ctx.companyTaxId)
    return {
      kind: 'transfer',
      counterAccount: roles.transit,
      confidence: 'high',
      reason: 'Qarşı tərəf şirkətin özüdür (öz hesabları arasında köçürmə, 222).',
    };
  if (has(purpose, 'ədv depozit', 'edv depozit', 'depozit hesab'))
    return {
      kind: 'transfer',
      counterAccount: roles.transit,
      confidence: 'high',
      reason: 'ƏDV depozit hesabı ilə köçürmə (222 vasitəsilə).',
    };
  if (
    out &&
    has(
      purpose,
      'komissiya',
      'xidmət haqqı',
      'xidmet haqqi',
      'bank xidm',
      'commission',
      'hesabın aparılması',
      'sms',
    )
  )
    return {
      kind: 'fee',
      counterAccount: roles.adminExpenses,
      ...(ctx.bankFeeItemId ? { expenseItemId: ctx.bankFeeItemId } : {}),
      confidence: ctx.bankFeeItemId ? 'high' : 'medium',
      reason: ctx.bankFeeItemId
        ? 'Təyinatda bank komissiyası (721, Bank xidmətləri).'
        : 'Bank komissiyası — xərc maddəsini seçin (721).',
    };
  if (
    out &&
    has(
      purpose,
      'dsmf',
      'sosial sığorta',
      'sosial sigorta',
      'işsizlik',
      'issizlik',
      'icbari tibbi',
      'itsh',
    )
  )
    return {
      kind: 'social',
      counterAccount: roles.social,
      confidence: 'high',
      reason: 'Sosial sığorta / işsizlik / tibbi sığorta haqqı (522).',
    };
  // "ƏDV daxil" or "vergi hesab-fakturası" in a supplier payment is not a tax payment, so purpose
  // words count only when the counterparty is not a known partner; the Treasury always counts.
  const budget = has(
    searchKey(line.counterparty),
    'xəzinə',
    'xezine',
    'dövlət vergi',
    'dovlet vergi',
    'dvx',
    'büdcə',
    'budce',
    'казначейство',
  );
  const taxWords = has(
    purpose,
    'vergi ödən',
    'vergi oden',
    'vergisi',
    'mənfəət vergi',
    'gəlir vergi',
    'əmlak vergi',
    'torpaq vergi',
    'sadələşdirilmiş vergi',
    'sadelesdirilmis vergi',
    'mənbədə',
    'ödəmə mənbəyində',
    'dövlət rüsumu',
    'dovlet rusumu',
    'ədv ödən',
    'ədv-nin ödən',
    'edv oden',
    'büdcəyə',
    'budceye',
    'büdcə təsnifat',
    'maliyyə sanksiya',
    'faiz (vergi)',
  );
  if (budget || (!byTax && taxWords))
    return {
      kind: 'tax',
      counterAccount: roles.taxPayable,
      confidence: 'high',
      reason: out ? 'Vergi ödənişi (521).' : 'Vergi qaytarılması (521).',
    };
  if (
    out &&
    has(purpose, 'əmək haqq', 'emek haqq', 'əməkhaqq', 'maaş', 'maas', 'zarplata', 'salary')
  )
    return {
      kind: 'salary',
      counterAccount: roles.payroll,
      confidence: 'high',
      reason: 'Əmək haqqının ödənilməsi (533).',
    };
  if (!out && has(purpose, 'nizamnamə', 'nizamname', 'nizamnamə kapital'))
    return {
      kind: 'capital',
      ...withPartner,
      ...(partner ? {} : line.counterpartyTaxId ? { createPartner: true } : {}),
      counterAccount: roles.capital,
      confidence: partner ? 'high' : 'medium',
      reason: 'Nizamnamə kapitalına qoyuluş (301).',
    };
  if (has(purpose, 'kredit', 'kredit xətti', 'loan') && !has(purpose, 'kredit kart'))
    return {
      kind: 'loan',
      ...withPartner,
      ...(partner ? {} : line.counterpartyTaxId ? { createPartner: true } : {}),
      counterAccount: roles.loans,
      confidence: 'medium',
      reason: out ? 'Kreditin qaytarılması (511) — faiz varsa ayırın.' : 'Kreditin alınması (511).',
    };
  if (
    has(
      purpose,
      'öz hesab',
      'oz hesab',
      'hesablar arası',
      'hesablar arasi',
      'kassaya',
      'kassadan',
      'nağdlaşdır',
      'nagdlasdir',
      'inkassasiya',
    )
  )
    return {
      kind: 'transfer',
      counterAccount: roles.transit,
      confidence: 'high',
      reason: 'Öz hesabları / kassa arasında köçürmə (222).',
    };
  const refund = has(purpose, 'qaytar', 'geri ödən', 'geri oden', 'возврат', 'refund');
  if (partner)
    return {
      kind: refund ? 'refund' : 'settlement',
      partnerId: partner.id,
      confidence: byTax && !refund ? 'high' : 'medium',
      reason: `${byTax ? 'VÖEN' : 'Ad'} üzrə tanındı: ${partner.name}${refund ? ' (qaytarma)' : ''}.`,
    };
  if (line.counterpartyTaxId)
    return {
      kind: refund ? 'refund' : 'settlement',
      createPartner: true,
      confidence: 'medium',
      reason: `Yeni kontragent: VÖEN ${line.counterpartyTaxId} — yaradılacaq.`,
    };
  return {
    kind: 'other',
    confidence: 'low',
    reason: 'Tanınmadı — əməliyyat növünü seçin.',
  };
}
