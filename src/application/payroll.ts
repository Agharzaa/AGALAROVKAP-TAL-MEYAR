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
  monthBounds,
  noExemption,
  parseRates,
  payrollFor,
  ratesInput,
  salaryFor,
  type ContributionKey,
  type Exemption,
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
  PayrollSettlementRow,
  PayrollTaxesView,
  PayslipView,
} from '../contracts/queries.js';
import type { Db, Row } from '../infrastructure/sqlite/db.js';
import { absencePay, awayIn } from './absences.js';
import { loadCalendar } from './calendar.js';
import { timesheetPayOf } from './timesheets.js';
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

interface Deduction {
  amount: Minor;
  account: string;
  sk: string[];
  memo: string;
}

interface Line {
  employeeId: string;
  name: string;
  salary: Minor;
  bonus: Minor;
  vacation: Minor;
  sick: Minor;
  /** The timesheet's extra pay (8d). */
  extra: { overtime: Minor; holidayWork: Minor; night: Minor };
  deductions: Deduction[];
  deducted: Minor;
  amounts: ReturnType<typeof payrollFor>;
  expenseAccount: string;
  expenseSk: string[];
}

/** The employee's own exemption in force in the month (8c): only at the main workplace. */
export function exemptionOf(e: Row, month: string): Exemption {
  const { first, last } = monthBounds(month);
  const from = str(e.exemption_from);
  const to = str(e.exemption_to);
  if (e.main_job !== 1n || (from && from > last) || (to && to < first)) return noExemption;
  return { amount: e.exemption as bigint, extra: e.exemption_extra as bigint };
}

function readLines(
  tx: Tx,
  companyId: string,
  chart: Chart,
  rates: PayrollRates,
  month: string,
  input: CommandOf<'payroll.save'>['lines'],
): { lines: Line[]; postings: Posting[] } {
  const seen = new Set<string>();
  const lines: Line[] = [];
  const kind = roleItem(tx, companyId, 'vatTax', 'Vergi (haqq)');
  const salaryItem = roleItem(tx, companyId, 'salary', 'Əmək haqqı');
  const socialItem = roleItem(tx, companyId, 'socialInsurance', 'Sosial sığorta ayırmaları');
  let sickItem = '';
  const cal = loadCalendar(tx.db, companyId);
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
    // Vacation and sick pay come from their documents (8c), never from the form.
    const pay = absencePay(tx.db, companyId, l.employeeId, month, cal);
    // The timesheet's overtime, work on days off and night hours, at the contract salary (8d).
    const ts = timesheetPayOf(
      tx.db,
      companyId,
      month,
      l.employeeId,
      e.salary as bigint,
      rates.pay,
      cal,
    );
    const extra = ts
      ? { overtime: ts.overtime, holidayWork: ts.holidayWork, night: ts.night }
      : { overtime: 0n, holidayWork: 0n, night: 0n };
    const extras = extra.overtime + extra.holidayWork + extra.night;
    if (salary + bonus + pay.vacation + pay.sick + extras <= 0n)
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
    const amounts = payrollFor(
      salary + bonus + pay.vacation + extras,
      rates,
      exemptionOf(e, month),
      pay.sick,
    );
    const side533 = { account: '533', sk: [l.employeeId] };
    gross.push({
      dt: { account: account.code, sk: expenseSk },
      kt: side533,
      amount: amounts.gross,
      memo: `Əmək haqqı${pay.vacation ? ', məzuniyyət' : ''}${extras ? ', artıq iş / bayram / gecə' : ''}: ${name}`,
    });
    if (pay.sick) {
      sickItem ||= roleItem(tx, companyId, 'sickPay', 'Xəstəlik vərəqəsi üzrə müavinət');
      gross.push({
        dt: { account: account.code, sk: sk(sickItem) },
        kt: side533,
        amount: pay.sick,
        memo: `Xəstəlik vərəqəsi (işəgötürənin günləri): ${name}`,
      });
    }
    for (const key of withheld)
      if (amounts[key])
        kept.push({
          dt: side533,
          kt: { account: liability[key], sk: [kind] },
          amount: amounts[key],
          memo: `${labelOf[key]}: ${name}`,
        });
    // Other deductions (8b): Dt 533 / Kt the account; they do not change the taxes.
    const deductions = l.deductions.map((d, j): Deduction => {
      const df = `${f}.deductions.${j}`;
      const amount = parseMoney(d.amount, `${where}: tutulma`);
      if (amount <= 0n)
        throw new DomainError(`${where}: tutulma müsbət olmalıdır.`, `${df}.amount`);
      const a = chart.require(d.account.trim(), `${df}.account`);
      if (a.code === '533' || a.code.startsWith('52'))
        throw new DomainError(
          `${where}: tutulmanın hesabı 533 və vergi / fond hesabı ola bilməz.`,
          `${df}.account`,
        );
      const dsk = a.subkonto.map((_, n) => (d.sk[n] ?? '').trim());
      checkSideValues(tx.db, companyId, a, dsk, `${df}.sk`, '');
      return {
        amount,
        account: a.code,
        sk: dsk,
        memo: parseText(d.memo, `${where}: tutulmanın məzmunu`, 200, false),
      };
    });
    const deducted = deductions.reduce((s, d) => s + d.amount, 0n);
    if (deducted > amounts.net)
      throw new DomainError(
        `${where}: ${name} — tutulmalar (${formatMinor(deducted)}) ödəniləcəkdən (${formatMinor(amounts.net)}) çoxdur.`,
        `${f}.deductions`,
      );
    for (const d of deductions)
      kept.push({
        dt: side533,
        kt: { account: d.account, sk: d.sk },
        amount: d.amount,
        memo: `${d.memo || 'Tutulma'}: ${name}`,
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
      vacation: pay.vacation,
      sick: pay.sick,
      extra,
      deductions,
      deducted,
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
  const { lines, postings } = readLines(tx, cmd.companyId, chart, rates.rates, month, cmd.lines);
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
         medical_employer,expense_account,expense_sk,vacation,sick,exemption,deducted,deductions,
         overtime,holiday_work,night)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      l.amounts.net - l.deducted,
      l.amounts.dsmfEmployer,
      l.amounts.unemploymentEmployer,
      l.amounts.medicalEmployer,
      l.expenseAccount,
      JSON.stringify(l.expenseSk),
      l.vacation,
      l.sick,
      l.amounts.exemption,
      l.deducted,
      JSON.stringify(l.deductions.map((d) => ({ ...d, amount: formatMinor(d.amount) }))),
      l.extra.overtime,
      l.extra.holidayWork,
      l.extra.night,
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
    vacation: money(l.vacation),
    sick: money(l.sick),
    exemption: money(l.exemption),
    deducted: money(l.deducted),
    overtime: money(l.overtime),
    holidayWork: money(l.holiday_work),
    night: money(l.night),
    deductions: JSON.parse(str(l.deductions)) as PayrollLineView['deductions'],
  };
}

function documentView(db: Db, r: Row): PayrollDocumentView {
  const names = new Map(
    db
      .all('SELECT * FROM employees WHERE company_id=?', str(r.company_id))
      .map((e) => [str(e.id), e]),
  );
  const rows = db.all(
    'SELECT * FROM payroll_lines WHERE document_id=? ORDER BY line_no',
    str(r.id),
  );
  const lines = rows.map((l) => lineView(l, names));
  // A vacation, sick leave or the timesheet changed after the payroll was posted (8c, 8d;
  // QERARLAR 2026-10-27 §12).
  const companyId = str(r.company_id);
  const cal = r.status === 'posted' ? loadCalendar(db, companyId) : null;
  const pay = cal ? ratesAt(db, companyId, str(r.date))?.rates.pay : undefined;
  const stale =
    cal && pay
      ? rows
          .filter((l) => {
            const id = str(l.employee_id);
            const a = absencePay(db, companyId, id, str(r.month), cal);
            const e = names.get(id);
            const t = timesheetPayOf(
              db,
              companyId,
              str(r.month),
              id,
              e?.salary as bigint,
              pay,
              cal,
            );
            return (
              a.vacation !== l.vacation ||
              a.sick !== l.sick ||
              (t?.overtime ?? 0n) !== l.overtime ||
              (t?.holidayWork ?? 0n) !== l.holiday_work ||
              (t?.night ?? 0n) !== l.night
            );
          })
          .map((l) => str(names.get(str(l.employee_id))?.name))
      : [];
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
    stale,
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
 * The lines a new payroll of the month starts with: every employee working in it with a salary or
 * with a vacation / sick leave starting in it, paid by the working days worked (hired or leaving
 * within the month, away on vacation or sick leave — Ə4, Ə11).
 */
export function payrollFill(db: Db, companyId: string, monthInput: string): PayrollFillLine[] {
  const month = checkMonth(monthInput);
  const first = `${month}-01`;
  const last = monthEnd(month);
  const cal = loadCalendar(db, companyId);
  const rates = ratesAt(db, companyId, last);
  return db
    .all(
      `SELECT * FROM employees WHERE company_id=? AND archived=0
         AND (hired='' OR hired<=?) AND (left_on='' OR left_on>=?) ORDER BY tab_no, name`,
      companyId,
      last,
      first,
    )
    .flatMap((e) => {
      const id = str(e.id);
      const pay = absencePay(db, companyId, id, month, cal);
      // By the month's timesheet when there is one (8d), else by the calendar and the absences.
      const ts = rates
        ? timesheetPayOf(db, companyId, month, id, e.salary as bigint, rates.rates.pay, cal)
        : null;
      const salary =
        ts?.salary ??
        salaryFor(
          e.salary as bigint,
          month,
          str(e.hired),
          str(e.left_on),
          awayIn(db, companyId, id, month),
          cal,
        );
      const extras = ts ? ts.overtime + ts.holidayWork + ts.night : 0n;
      if (!salary && !pay.vacation && !pay.sick && !extras) return [];
      return [
        {
          employeeId: id,
          name: str(e.name),
          salary: formatMinor(salary),
          vacation: formatMinor(pay.vacation),
          sick: formatMinor(pay.sick),
          overtime: formatMinor(ts?.overtime ?? 0n),
          holidayWork: formatMinor(ts?.holidayWork ?? 0n),
          night: formatMinor(ts?.night ?? 0n),
          byTimesheet: !!ts,
        },
      ];
    });
}

// ---------------------------------------------------------------------------------------------
// Reports (8b)

/** Credit less debit of an account (one subkonto value when given) over postings in [from, to]. */
function owed(db: Db, companyId: string, account: string, s1: string, from: string, to: string) {
  const r = db.get(
    `SELECT COALESCE(SUM(a),0) AS b FROM (
       SELECT amount AS a FROM postings WHERE company_id=?1 AND kt_account=?2 AND (?3='' OR kt_s1=?3) AND date BETWEEN ?4 AND ?5
       UNION ALL SELECT -amount FROM postings WHERE company_id=?1 AND dt_account=?2 AND (?3='' OR dt_s1=?3) AND date BETWEEN ?4 AND ?5)`,
    companyId,
    account,
    s1,
    from,
    to,
  )!;
  return r.b as bigint;
}

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** The employee's month: owed at the start, accrued, withheld, paid, owed at the end (533). */
export function payslip(
  db: Db,
  companyId: string,
  employeeId: string,
  monthInput: string,
): PayslipView {
  const month = checkMonth(monthInput);
  const { first, last } = monthBounds(month);
  const e = db.get('SELECT * FROM employees WHERE company_id=? AND id=?', companyId, employeeId);
  if (!e) throw new DomainError('İşçi tapılmadı.', 'employeeId', 'not-found');
  const opening = owed(db, companyId, '533', employeeId, '0000-01-01', dayBefore(first));
  const closing = owed(db, companyId, '533', employeeId, '0000-01-01', last);
  const l = db.get(
    `SELECT l.* FROM payroll_lines l JOIN payroll_documents d ON d.id=l.document_id
     WHERE l.company_id=? AND l.employee_id=? AND d.month=? AND d.status='posted'`,
    companyId,
    employeeId,
    month,
  );
  const item = (label: string, v: unknown) =>
    (v as bigint) ? [{ label, amount: formatMinor(v as bigint) }] : [];
  const accrued = l
    ? [
        ...item('Əmək haqqı', l.salary),
        ...item('Mükafat', l.bonus),
        ...item('Məzuniyyət / kompensasiya', l.vacation),
        ...item('Artıq iş vaxtı', l.overtime),
        ...item('Bayram / istirahət günü iş', l.holiday_work),
        ...item('Gecə saatları', l.night),
        ...item('Xəstəlik vərəqəsi (işəgötürənin günləri)', l.sick),
      ]
    : [];
  const withheld = l
    ? [
        ...item('Gəlir vergisi', l.income_tax),
        ...item('DSMF', l.dsmf_employee),
        ...item('İşsizlik sığortası', l.unemployment_employee),
        ...item('İcbari tibbi sığorta', l.medical_employee),
        ...(
          JSON.parse(str(l.deductions)) as { amount: string; memo: string; account: string }[]
        ).map((d) => ({ label: d.memo || `Tutulma (${d.account})`, amount: d.amount })),
      ]
    : [];
  // Everything else on 533 in the month: the payments (bank, cash, operations).
  const paid = db
    .all(
      `SELECT e.date, e.source_number AS number,
         SUM(CASE WHEN p.dt_account='533' AND p.dt_s1=?2 THEN p.amount ELSE 0 END)
           - SUM(CASE WHEN p.kt_account='533' AND p.kt_s1=?2 THEN p.amount ELSE 0 END) AS a
       FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE p.company_id=?1 AND e.source_type<>?5 AND p.date BETWEEN ?3 AND ?4
         AND ((p.dt_account='533' AND p.dt_s1=?2) OR (p.kt_account='533' AND p.kt_s1=?2))
       GROUP BY e.id HAVING a<>0 ORDER BY e.date, e.rowid`,
      companyId,
      employeeId,
      first,
      last,
      PAYROLL,
    )
    .map((r) => ({ date: str(r.date), number: str(r.number), amount: formatMinor(r.a as bigint) }));
  return {
    employeeId,
    name: str(e.name),
    tabNo: str(e.tab_no),
    position: str(e.position),
    month,
    opening: formatMinor(opening),
    accrued,
    withheld,
    paid,
    closing: formatMinor(closing),
  };
}

/** Settlements with employees on 533 over a period: accrued and withheld by payrolls, paid. */
export function payrollSettlements(
  db: Db,
  companyId: string,
  fromInput: string,
  toInput: string,
): PayrollSettlementRow[] {
  const from = parseDate(fromInput, 'Başlanğıc');
  const to = parseDate(toInput, 'Son');
  const before = dayBefore(from);
  const rows = new Map<string, { opening: Minor; accrued: Minor; withheld: Minor; paid: Minor }>();
  const at = (id: string) => {
    const r = rows.get(id) ?? { opening: 0n, accrued: 0n, withheld: 0n, paid: 0n };
    rows.set(id, r);
    return r;
  };
  for (const r of db.all(
    `SELECT p.dt_account AS da, p.dt_s1 AS d1, p.kt_account AS ka, p.kt_s1 AS k1, p.amount AS a, p.date,
       e.source_type AS t
     FROM postings p JOIN entries e ON e.id=p.entry_id
     WHERE p.company_id=? AND p.date<=? AND (p.dt_account='533' OR p.kt_account='533')`,
    companyId,
    to,
  )) {
    const a = r.a as bigint;
    const payroll = str(r.t) === PAYROLL;
    const old = str(r.date) <= before;
    if (str(r.ka) === '533') {
      const x = at(str(r.k1));
      if (old) x.opening += a;
      else if (payroll) x.accrued += a;
      else x.paid -= a;
    }
    if (str(r.da) === '533') {
      const x = at(str(r.d1));
      if (old) x.opening -= a;
      else if (payroll) x.withheld += a;
      else x.paid += a;
    }
  }
  const names = new Map(
    db
      .all('SELECT id,name FROM employees WHERE company_id=?', companyId)
      .map((e) => [str(e.id), str(e.name)]),
  );
  return [...rows.entries()]
    .map(([id, x]) => ({
      employeeId: id,
      name: names.get(id) ?? id,
      opening: formatMinor(x.opening),
      accrued: formatMinor(x.accrued),
      withheld: formatMinor(x.withheld),
      paid: formatMinor(x.paid),
      closing: formatMinor(x.opening + x.accrued - x.withheld - x.paid),
    }))
    .filter((r) => [r.opening, r.accrued, r.withheld, r.paid].some((v) => v !== '0.00'))
    .sort((a, b) => a.name.localeCompare(b.name, 'az'));
}

/** Taxes and funds of a month: accrued by the payroll, paid (transferred), owed — for the returns. */
export function payrollTaxes(db: Db, companyId: string, monthInput: string): PayrollTaxesView {
  const month = checkMonth(monthInput);
  const { first, last } = monthBounds(month);
  const accounts: [string, string][] = [
    ['521.03', 'Gəlir vergisi'],
    ['522.01', 'DSMF (işçi + işəgötürən)'],
    ['522.03.1', 'İşsizlik sığortası — işçi'],
    ['522.03.2', 'İşsizlik sığortası — işəgötürən'],
    ['522.04.1', 'Tibbi sığorta — işçi'],
    ['522.04.2', 'Tibbi sığorta — işəgötürən'],
  ];
  const rows = accounts.map(([account, label]) => {
    const opening = owed(db, companyId, account, '', '0000-01-01', dayBefore(first));
    const closing = owed(db, companyId, account, '', '0000-01-01', last);
    const accrued = db.get(
      `SELECT COALESCE(SUM(p.amount),0) AS a FROM postings p JOIN entries e ON e.id=p.entry_id
       WHERE p.company_id=? AND p.kt_account=? AND e.source_type=? AND p.date BETWEEN ? AND ?`,
      companyId,
      account,
      PAYROLL,
      first,
      last,
    )!.a as bigint;
    return {
      account,
      label,
      opening: formatMinor(opening),
      accrued: formatMinor(accrued),
      paid: formatMinor(opening + accrued - closing),
      closing: formatMinor(closing),
    };
  });
  const lines = db.get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(l.gross),0) AS g FROM payroll_lines l
       JOIN payroll_documents d ON d.id=l.document_id
     WHERE l.company_id=? AND d.month=? AND d.status='posted'`,
    companyId,
    month,
  )!;
  return { month, employees: Number(lines.n), base: formatMinor(lines.g as bigint), rows };
}

/**
 * The month closing's checks (8b, 8c): employees at work and no payroll posted — a warning; a
 * payroll whose vacations or sick leaves changed after it was posted — it blocks.
 */
export function payrollSignals(
  db: Db,
  companyId: string,
  month: string,
): { warnings: string[]; blocking: string[] } {
  const { first, last } = monthBounds(month);
  const warnings: string[] = [];
  const blocking: string[] = [];
  const doc = db.get(
    "SELECT * FROM payroll_documents WHERE company_id=? AND month=? AND status='posted'",
    companyId,
    month,
  );
  if (!doc) {
    const working = Number(
      db.get(
        `SELECT COUNT(*) AS n FROM employees WHERE company_id=? AND archived=0 AND salary>0
           AND (hired='' OR hired<=?) AND (left_on='' OR left_on>=?)`,
        companyId,
        last,
        first,
      )!.n,
    );
    if (working)
      warnings.push(
        `${month} ayının əmək haqqı hesablanmayıb (${working} işçi işləyir): Əmək haqqı → Əmək haqqının hesablanması.`,
      );
  } else {
    const stale = documentView(db, doc).stale;
    if (stale.length)
      blocking.push(
        `${str(doc.number)} əmək haqqı sənədi köhnəlib — sonradan dəyişən məzuniyyət / xəstəlik vərəqəsi: ${stale.join(', ')}. Sənədi açıb "İşçilərə görə doldur" və düzəlişi uçota alın.`,
      );
  }
  return { warnings, blocking };
}
