/**
 * Payroll (stage 8a; docs/MERHELE-8-EMEK-HAQQI.md, QERARLAR 2026-10-27): the dated rates and a
 * month's payroll document, posted on the month's last day:
 *   Dt 701 / 721 ("Əmək haqqı") / Kt 533 (employee) — gross;
 *   Dt 533 / Kt 521.03, 522.01, 522.03.1, 522.04.1 — withheld from the employee;
 *   Dt 701 / 721 ("Sosial sığorta ayırmaları") / Kt 522.01, 522.03.2, 522.04.2 — the employer's share.
 * One posted document a month: the brackets apply to the employee's whole month.
 */
import type { Chart } from '../domain/chart.js';
import { DomainError } from '../domain/errors.js';
import { formatMinor, parseMoney, type Minor } from '../domain/money.js';
import {
  parseRates,
  payrollFor,
  ratesInput,
  salaryFor,
  type ContributionKey,
  type PayrollRates,
  type RatesInput,
} from '../domain/payroll.js';
import { checkPostings, storno, type Posting } from '../domain/posting.js';
import { monthEnd } from '../domain/rates.js';
import { numberKey, parseDate, parseText } from '../domain/values.js';
import type { CommandOf, CommandResult } from '../contracts/commands.js';
import type {
  PayrollDocumentDetail,
  PayrollDocumentView,
  PayrollFillLine,
  PayrollLineView,
  PayrollRatesView,
} from '../contracts/queries.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import { documentEntry } from './reports.js';
import { checkMonth } from './revaluation.js';
import { checkSideValues } from './subkonto.js';
import { expectVersion, type Tx } from './tx.js';

export const PAYROLL = 'payroll';
const LABEL = 'Əmək haqqının hesablanması';
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dmy = (iso: string) => iso.split('-').reverse().join('.');

/** Salary goes to an expense account with an expense item (QERARLAR 2026-10-27 §2). */
const expenseFamilies = ['202', '701', '711', '721'];
export const isPayrollExpense = (code: string) =>
  expenseFamilies.some((f) => code === f || code.startsWith(`${f}.`));

/** Where each amount withheld or added goes (the 1C sub-accounts of 521 / 522). */
const liability: Record<ContributionKey, string> = {
  incomeTax: '521.03',
  dsmfEmployee: '522.01',
  unemploymentEmployee: '522.03.1',
  medicalEmployee: '522.04.1',
  dsmfEmployer: '522.01',
  unemploymentEmployer: '522.03.2',
  medicalEmployer: '522.04.2',
};
const withheld = ['incomeTax', 'dsmfEmployee', 'unemploymentEmployee', 'medicalEmployee'] as const;
const employer = ['dsmfEmployer', 'unemploymentEmployer', 'medicalEmployer'] as const;
const column: Record<ContributionKey, string> = {
  incomeTax: 'income_tax',
  dsmfEmployee: 'dsmf_employee',
  unemploymentEmployee: 'unemployment_employee',
  medicalEmployee: 'medical_employee',
  dsmfEmployer: 'dsmf_employer',
  unemploymentEmployer: 'unemployment_employer',
  medicalEmployer: 'medical_employer',
};

function roleItem(tx: Tx, companyId: string, role: string, what: string): string {
  const r = tx.db.get(
    'SELECT id FROM items WHERE company_id=? AND role=? AND archived=0',
    companyId,
    role,
  );
  if (!r)
    throw new DomainError(
      `Standart "${what}" elementi təyin edilməyib. Siyahılar bölməsində elementi açıb "Yazılış qaydalarında" sahəsini seçin.`,
      undefined,
      'not-found',
    );
  return str(r.id);
}

// ---------------------------------------------------------------------------------------------
// Rates

/** The rates in force on a day (the latest set from that day or before). */
export function ratesAt(
  db: Db,
  companyId: string,
  day: string,
): { from: string; rates: PayrollRates } | null {
  const r = db.get(
    'SELECT valid_from, rates FROM payroll_rates WHERE company_id=? AND valid_from<=? ORDER BY valid_from DESC LIMIT 1',
    companyId,
    day,
  );
  return r
    ? { from: str(r.valid_from), rates: parseRates(JSON.parse(str(r.rates)) as RatesInput) }
    : null;
}

export function savePayrollRates(tx: Tx, cmd: CommandOf<'payrollRates.save'>): CommandResult {
  tx.company(cmd.companyId);
  const from = parseDate(cmd.validFrom, 'Qüvvəyə minmə tarixi');
  const rates = parseRates(cmd.rates);
  // A set some posted month was computed with stays as it was: a change is a new set from a day.
  const next = tx.db.get(
    'SELECT MIN(valid_from) AS d FROM payroll_rates WHERE company_id=? AND valid_from>?',
    cmd.companyId,
    from,
  )!.d;
  const exists = tx.db.get(
    'SELECT 1 AS x FROM payroll_rates WHERE company_id=? AND valid_from=?',
    cmd.companyId,
    from,
  );
  // Posted months from that day to the next set: computed with this set, or with the one before.
  const used = tx.db.get(
    `SELECT number FROM payroll_documents WHERE company_id=? AND status='posted' AND date>=?${next ? ' AND date<?' : ''} LIMIT 1`,
    cmd.companyId,
    from,
    ...(next ? [str(next)] : []),
  );
  if (used)
    throw new DomainError(
      `${str(used.number)} bu dərəcələrlə hesablanıb: ${exists ? 'dəst dəyişdirilmir' : 'həmin aydan əvvələ yeni dəst qoyulmur'}. Yeni dərəcələri həmin sənəddən sonrakı tarixdən yazın.`,
      'validFrom',
      'conflict',
    );
  const json = JSON.stringify(ratesInput(rates));
  if (exists)
    tx.db.run(
      'UPDATE payroll_rates SET rates=?,updated_at=? WHERE company_id=? AND valid_from=?',
      json,
      tx.clock.now(),
      cmd.companyId,
      from,
    );
  else
    tx.db.run(
      'INSERT INTO payroll_rates VALUES(?,?,?,?)',
      cmd.companyId,
      from,
      json,
      tx.clock.now(),
    );
  tx.audit(
    cmd.companyId,
    exists ? 'Dəyişdirildi' : 'Yaradıldı',
    'Əmək haqqı dərəcələri',
    from,
    `${dmy(from)} tarixindən`,
  );
  return { id: from };
}

export function payrollRates(db: Db, companyId: string): PayrollRatesView[] {
  const rows = db.all(
    'SELECT * FROM payroll_rates WHERE company_id=? ORDER BY valid_from DESC',
    companyId,
  );
  return rows.map((r, i) => {
    const next = i > 0 ? str(rows[i - 1]!.valid_from) : '';
    const used = db.get(
      `SELECT 1 AS x FROM payroll_documents WHERE company_id=? AND status='posted' AND date>=?${next ? ' AND date<?' : ''} LIMIT 1`,
      companyId,
      str(r.valid_from),
      ...(next ? [next] : []),
    );
    return {
      validFrom: str(r.valid_from),
      rates: JSON.parse(str(r.rates)) as RatesInput,
      used: !!used,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Documents

function nextNumber(tx: Tx, companyId: string): string {
  const n =
    Number(
      tx.db.get('SELECT COUNT(*) AS n FROM payroll_documents WHERE company_id=?', companyId)!.n,
    ) + 1;
  for (let i = n; ; i++) {
    const candidate = `ƏH-${String(i).padStart(6, '0')}`;
    if (
      !tx.db.get(
        'SELECT 1 AS x FROM payroll_documents WHERE company_id=? AND number_key=?',
        companyId,
        numberKey(candidate),
      )
    )
      return candidate;
  }
}

interface Line {
  employeeId: string;
  name: string;
  salary: Minor;
  bonus: Minor;
  amounts: ReturnType<typeof payrollFor>;
  expenseAccount: string;
  expenseSk: string[];
}

function readLines(
  tx: Tx,
  companyId: string,
  chart: Chart,
  rates: PayrollRates,
  input: CommandOf<'payroll.save'>['lines'],
): { lines: Line[]; postings: Posting[] } {
  const seen = new Set<string>();
  const lines: Line[] = [];
  const kind = roleItem(tx, companyId, 'vatTax', 'Vergi (haqq)');
  const salaryItem = roleItem(tx, companyId, 'salary', 'Əmək haqqı');
  const socialItem = roleItem(tx, companyId, 'socialInsurance', 'Sosial sığorta ayırmaları');
  const gross: Posting[] = [];
  const kept: Posting[] = [];
  // The employer's share, summed by expense account and its subkonto.
  const share = new Map<string, { account: string; sk: string[]; amounts: Map<string, Minor> }>();
  input.forEach((l, i) => {
    const f = `lines.${i}`;
    const where = `Sətir ${i + 1}`;
    const e = tx.db.get(
      'SELECT * FROM employees WHERE company_id=? AND id=?',
      companyId,
      l.employeeId,
    );
    if (!e) throw new DomainError(`${where}: işçi tapılmadı.`, `${f}.employeeId`, 'not-found');
    const name = str(e.name);
    if (e.archived === 1n)
      throw new DomainError(`${where}: ${name} arxivdədir.`, `${f}.employeeId`);
    if (seen.has(l.employeeId))
      throw new DomainError(`${where}: ${name} sənəddə ikinci dəfədir.`, `${f}.employeeId`);
    seen.add(l.employeeId);
    const salary = parseMoney(l.salary || '0', `${where}: əmək haqqı`);
    const bonus = parseMoney(l.bonus || '0', `${where}: mükafat`);
    if (salary < 0n || bonus < 0n)
      throw new DomainError(`${where}: məbləğ mənfi ola bilməz.`, `${f}.salary`);
    if (salary + bonus <= 0n)
      throw new DomainError(`${where}: ${name} üçün məbləğ yoxdur.`, `${f}.salary`);
    const code = str(e.expense_account);
    if (!code)
      throw new DomainError(
        `${where}: ${name} — işçinin kartında xərc hesabını (701 / 721) seçin.`,
        `${f}.employeeId`,
      );
    const account = chart.require(code, `${f}.employeeId`);
    if (!isPayrollExpense(account.code) || !account.subkonto.includes('expenseItem'))
      throw new DomainError(
        `${where}: ${name} — xərc hesabı 701, 711, 721 və ya 202 olmalıdır (xərc maddəsi ilə).`,
        `${f}.employeeId`,
      );
    const stored = JSON.parse(str(e.expense_sk)) as string[];
    const sk = (item: string) =>
      account.subkonto.map((k, j) => (k === 'expenseItem' ? item : (stored[j] ?? '').trim()));
    const expenseSk = sk(salaryItem);
    checkSideValues(tx.db, companyId, account, expenseSk, `${f}.employeeId`, '');
    const amounts = payrollFor(salary + bonus, rates);
    const side533 = { account: '533', sk: [l.employeeId] };
    gross.push({
      dt: { account: account.code, sk: expenseSk },
      kt: side533,
      amount: amounts.gross,
      memo: `Əmək haqqı: ${name}`,
    });
    for (const key of withheld)
      if (amounts[key])
        kept.push({
          dt: side533,
          kt: { account: liability[key], sk: [kind] },
          amount: amounts[key],
          memo: `${labelOf[key]}: ${name}`,
        });
    const social = sk(socialItem);
    const k = `${account.code}|${social.join('|')}`;
    const s = share.get(k) ?? { account: account.code, sk: social, amounts: new Map() };
    for (const key of employer) s.amounts.set(key, (s.amounts.get(key) ?? 0n) + amounts[key]);
    share.set(k, s);
    lines.push({
      employeeId: l.employeeId,
      name,
      salary,
      bonus,
      amounts,
      expenseAccount: account.code,
      expenseSk,
    });
  });
  const added: Posting[] = [];
  for (const s of share.values())
    for (const key of employer) {
      const amount = s.amounts.get(key) ?? 0n;
      if (amount)
        added.push({
          dt: { account: s.account, sk: s.sk },
          kt: { account: liability[key], sk: [kind] },
          amount,
          memo: labelOf[key],
        });
    }
  const postings = [...gross, ...kept, ...added];
  checkPostings(chart, postings, 'lines');
  return { lines, postings };
}

const labelOf: Record<ContributionKey, string> = {
  incomeTax: 'Gəlir vergisi',
  dsmfEmployee: 'DSMF (işçi)',
  unemploymentEmployee: 'İşsizlik sığortası (işçi)',
  medicalEmployee: 'Tibbi sığorta (işçi)',
  dsmfEmployer: 'DSMF (işəgötürən)',
  unemploymentEmployer: 'İşsizlik sığortası (işəgötürən)',
  medicalEmployer: 'Tibbi sığorta (işəgötürən)',
};

export function savePayroll(tx: Tx, cmd: CommandOf<'payroll.save'>): CommandResult {
  tx.company(cmd.companyId);
  const month = checkMonth(cmd.month);
  const date = monthEnd(month);
  const memo = parseText(cmd.memo, 'Məzmun', 500, false);
  const existing = cmd.id
    ? tx.db.get(
        'SELECT * FROM payroll_documents WHERE company_id=? AND id=?',
        cmd.companyId,
        cmd.id,
      )
    : undefined;
  if (cmd.id && !existing) throw new DomainError('Sənəd tapılmadı.', 'id', 'not-found');
  if (existing) {
    expectVersion(existing, cmd.version, LABEL);
    if (existing.status !== 'posted')
      throw new DomainError('Ləğv edilmiş sənəd dəyişdirilmir.', undefined, 'conflict');
  }
  const other = tx.db.get(
    "SELECT number FROM payroll_documents WHERE company_id=? AND month=? AND status='posted' AND id<>?",
    cmd.companyId,
    month,
    cmd.id ?? '',
  );
  if (other)
    throw new DomainError(
      `${month} ayının əmək haqqı artıq ${str(other.number)} sənədindədir: ayda bir sənəd olur (pilləli vergi işçinin bütün aylıq gəlirindən). Həmin sənədi düzəldin.`,
      'month',
      'conflict',
    );
  const number =
    parseText(cmd.number, 'Nömrə', 40, false) ||
    (existing ? str(existing.number) : nextNumber(tx, cmd.companyId));
  const key = numberKey(number);
  const same = tx.db.get(
    'SELECT id FROM payroll_documents WHERE company_id=? AND number_key=?',
    cmd.companyId,
    key,
  );
  if (same && same.id !== cmd.id)
    throw new DomainError('Bu nömrə ilə sənəd artıq var.', 'number', 'conflict');
  const rates = ratesAt(tx.db, cmd.companyId, date);
  if (!rates)
    throw new DomainError(
      `${dmy(date)} tarixində qüvvədə olan əmək haqqı dərəcələri yoxdur ("Dərəcələr").`,
      'month',
      'not-found',
    );
  const id = existing ? str(existing.id) : tx.id();
  const chart = tx.chart(cmd.companyId);
  tx.open(cmd.companyId, date, 'month');
  const now = tx.clock.now();
  if (existing) {
    const before = tx.entryPostings(cmd.companyId, PAYROLL, id, Number(existing.version));
    tx.open(cmd.companyId, before.date, 'month');
    tx.post(
      cmd.companyId,
      chart,
      { type: PAYROLL, id, number: str(existing.number), version: Number(existing.version) },
      before.date,
      true,
      storno(before.postings),
    );
    tx.db.run('DELETE FROM payroll_lines WHERE document_id=?', id);
  }
  const { lines, postings } = readLines(tx, cmd.companyId, chart, rates.rates, cmd.lines);
  const version = existing ? Number(existing.version) + 1 : 1;
  if (existing)
    tx.db.run(
      'UPDATE payroll_documents SET month=?,number=?,number_key=?,date=?,memo=?,version=?,updated_at=? WHERE id=?',
      month,
      number,
      key,
      date,
      memo,
      version,
      now,
      id,
    );
  else
    tx.db.run(
      "INSERT INTO payroll_documents VALUES(?,?,?,?,?,?,?,'posted',?,?,?)",
      id,
      cmd.companyId,
      month,
      number,
      key,
      date,
      memo,
      version,
      now,
      now,
    );
  lines.forEach((l, i) =>
    tx.db.run(
      `INSERT INTO payroll_lines(company_id,document_id,line_no,employee_id,salary,bonus,gross,income_tax,
         dsmf_employee,unemployment_employee,medical_employee,net,dsmf_employer,unemployment_employer,
         medical_employer,expense_account,expense_sk) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      cmd.companyId,
      id,
      i + 1,
      l.employeeId,
      l.salary,
      l.bonus,
      l.amounts.gross,
      l.amounts.incomeTax,
      l.amounts.dsmfEmployee,
      l.amounts.unemploymentEmployee,
      l.amounts.medicalEmployee,
      l.amounts.net,
      l.amounts.dsmfEmployer,
      l.amounts.unemploymentEmployer,
      l.amounts.medicalEmployer,
      l.expenseAccount,
      JSON.stringify(l.expenseSk),
    ),
  );
  tx.post(cmd.companyId, chart, { type: PAYROLL, id, number, version }, date, false, postings);
  tx.history(cmd.companyId, PAYROLL, id, version, 'posted', {
    month,
    number,
    memo,
    rates: rates.from,
    lines: lines.map((l) => ({
      employee: l.name,
      salary: formatMinor(l.salary),
      bonus: formatMinor(l.bonus),
      gross: formatMinor(l.amounts.gross),
      net: formatMinor(l.amounts.net),
    })),
  });
  const total = lines.reduce((s, l) => s + l.amounts.gross, 0n);
  tx.audit(
    cmd.companyId,
    existing ? 'Düzəliş edildi (storno + yeni yazılış)' : 'Uçota alındı',
    LABEL,
    id,
    `${number} · ${month} · ${lines.length} işçi · ${formatMinor(total)} AZN`,
  );
  return { id, version, number };
}

export function cancelPayroll(tx: Tx, cmd: CommandOf<'payroll.cancel'>): CommandResult {
  tx.company(cmd.companyId);
  const reason = parseText(cmd.reason, 'Ləğv səbəbi');
  const row = tx.db.get(
    'SELECT * FROM payroll_documents WHERE company_id=? AND id=?',
    cmd.companyId,
    cmd.id,
  );
  if (!row) throw new DomainError('Sənəd tapılmadı.', 'id', 'not-found');
  expectVersion(row, cmd.version, LABEL);
  if (row.status !== 'posted')
    throw new DomainError('Sənəd artıq ləğv edilib.', undefined, 'conflict');
  const before = tx.entryPostings(cmd.companyId, PAYROLL, cmd.id, Number(row.version));
  tx.open(cmd.companyId, before.date, 'month');
  tx.post(
    cmd.companyId,
    tx.chart(cmd.companyId),
    { type: PAYROLL, id: cmd.id, number: str(row.number), version: Number(row.version) },
    before.date,
    true,
    storno(before.postings),
  );
  const version = Number(row.version) + 1;
  tx.db.run(
    "UPDATE payroll_documents SET status='cancelled',version=?,updated_at=? WHERE id=?",
    version,
    tx.clock.now(),
    cmd.id,
  );
  tx.history(cmd.companyId, PAYROLL, cmd.id, version, 'cancelled', { reason });
  tx.audit(cmd.companyId, 'Ləğv edildi (storno)', LABEL, cmd.id, `${str(row.number)} · ${reason}`);
  return { id: cmd.id, version };
}

// ---------------------------------------------------------------------------------------------
// Queries

const money = (v: unknown) => formatMinor(v as bigint);

function lineView(l: Row, names: Map<string, Row>): PayrollLineView {
  const e = names.get(str(l.employee_id));
  return {
    employeeId: str(l.employee_id),
    name: str(e?.name),
    tabNo: str(e?.tab_no),
    position: str(e?.position),
    salary: money(l.salary),
    bonus: money(l.bonus),
    gross: money(l.gross),
    incomeTax: money(l.income_tax),
    dsmfEmployee: money(l.dsmf_employee),
    unemploymentEmployee: money(l.unemployment_employee),
    medicalEmployee: money(l.medical_employee),
    net: money(l.net),
    dsmfEmployer: money(l.dsmf_employer),
    unemploymentEmployer: money(l.unemployment_employer),
    medicalEmployer: money(l.medical_employer),
    expenseAccount: str(l.expense_account),
  };
}

function documentView(db: Db, r: Row): PayrollDocumentView {
  const names = new Map(
    db
      .all('SELECT * FROM employees WHERE company_id=?', str(r.company_id))
      .map((e) => [str(e.id), e]),
  );
  const lines = db
    .all('SELECT * FROM payroll_lines WHERE document_id=? ORDER BY line_no', str(r.id))
    .map((l) => lineView(l, names));
  const sum = (k: keyof PayrollLineView) =>
    formatMinor(lines.reduce((s, l) => s + parseMoney(l[k]), 0n));
  return {
    id: str(r.id),
    version: Number(r.version),
    month: str(r.month),
    number: str(r.number),
    date: str(r.date),
    memo: str(r.memo),
    status: r.status as PayrollDocumentView['status'],
    employees: lines.length,
    gross: sum('gross'),
    net: sum('net'),
    lines,
  };
}

export function payrollDocuments(db: Db, companyId: string): PayrollDocumentView[] {
  return db
    .all(
      'SELECT * FROM payroll_documents WHERE company_id=? ORDER BY month DESC, rowid DESC',
      companyId,
    )
    .map((r) => documentView(db, r));
}

export function payrollDocument(db: Db, companyId: string, id: string): PayrollDocumentDetail {
  const r = db.get('SELECT * FROM payroll_documents WHERE company_id=? AND id=?', companyId, id);
  if (!r) throw new DomainError('Sənəd tapılmadı.', 'id', 'not-found');
  return { ...documentView(db, r), postings: documentEntry(db, companyId, PAYROLL, id).postings };
}

/**
 * The lines a new payroll of the month starts with: every employee working in it with a salary,
 * paid by the working days when hired or leaving within the month (Ə4).
 */
export function payrollFill(db: Db, companyId: string, monthInput: string): PayrollFillLine[] {
  const month = checkMonth(monthInput);
  const first = `${month}-01`;
  const last = monthEnd(month);
  return db
    .all(
      `SELECT * FROM employees WHERE company_id=? AND archived=0 AND salary>0
         AND (hired='' OR hired<=?) AND (left_on='' OR left_on>=?) ORDER BY tab_no, name`,
      companyId,
      last,
      first,
    )
    .map((e) => ({
      employeeId: str(e.id),
      name: str(e.name),
      salary: formatMinor(salaryFor(e.salary as bigint, month, str(e.hired), str(e.left_on))),
    }));
}
