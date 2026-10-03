/**
 * « Bulletins » (DECISIONS D-130, D-135): the report period a teacher composes comments for, what
 * kind of bank it takes, when the device's draft expires and when « Aujourd'hui » reminds her.
 */
import { addDays, isLocalDate, type LocalDate } from '../dates';
import {
  REPORT_PERIOD_KINDS,
  type ReportPeriodDates,
  type ReportPeriodKind,
} from '../year-plan/report-periods';

/** The report a period asks comments for: « Bulletin de progrès » or « Bulletin scolaire ». */
export type ComposerReport = 'progress' | 'term';
export const COMPOSER_REPORTS: readonly ComposerReport[] = ['progress', 'term'];

/** A board's report period, or « Dates choisies » (a board without report periods, or by choice). */
export type ComposerPeriod =
  { kind: ReportPeriodKind } | { from: LocalDate; to: LocalDate; report: ComposerReport };

/**
 * The period's part of the device draft's key: the kind of a board period (one per school year,
 * and a class has one year), else `custom-YYYY-MM-DD-YYYY-MM-DD-<report>`.
 */
export function periodKey(period: ComposerPeriod): string {
  if ('kind' in period) return period.kind;
  return `custom-${period.from}-${period.to}-${period.report}`;
}

const PERIOD_KEY =
  /^(?:progress|term1|term2|custom-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-(?:progress|term))$/;

export function isPeriodKey(value: string): boolean {
  return PERIOD_KEY.test(value);
}

/** The bank period a report period takes: the fall progress report, or a report card term. */
export function bankPeriodOf(kind: ReportPeriodKind): ComposerReport {
  return kind === 'progress' ? 'progress' : 'term';
}

/** Whether a bank written for `bankPeriod` (« Les deux »: `any`) serves `report`. */
export function bankServesReport(
  bankPeriod: 'progress' | 'term' | 'any',
  report: ComposerReport,
): boolean {
  return bankPeriod === 'any' || bankPeriod === report;
}

/** How long the device keeps comments after the report goes home (**Assumption**, D-130). */
export const DRAFT_DAYS_AFTER_REMISE = 60;

/**
 * The last day the device keeps a period's comments: 60 days after the « remise », or after the
 * « saisie » or the period's last day when the board has not set the « remise ».
 */
export function draftExpiresOn(
  period: Pick<ReportPeriodDates, 'endsOn' | 'dueOn' | 'issuedOn'>,
): LocalDate {
  return addDays(period.issuedOn ?? period.dueOn ?? period.endsOn, DRAFT_DAYS_AFTER_REMISE);
}

/** Whether a draft that expires on `expiresOn` has expired on `today`. */
export function draftExpired(expiresOn: string, today: LocalDate): boolean {
  return !isLocalDate(expiresOn) || expiresOn < today;
}

/** « Aujourd'hui » shows the reminder this many days before the « saisie » (**Assumption**, D-135). */
export const REMINDER_WINDOW_DAYS = 21;

export interface ReminderPeriod extends ReportPeriodDates {
  kind: ReportPeriodKind;
  schoolYearId: string;
}

export interface ReminderClass {
  id: string;
  name: string;
  schoolYearId: string;
}

export interface ReportReminder<C extends ReminderClass = ReminderClass> {
  kind: ReportPeriodKind;
  /** The « saisie » date, or the period's last day when the board set none. */
  date: LocalDate;
  /** True when `date` is the « saisie » (« saisie au plus tard le »), false for the last day. */
  due: boolean;
  /** The classes of that school year, in the order given. */
  classes: C[];
}

/**
 * The report periods to prepare comments for on `today`: from `windowDays` before the « saisie »
 * (or the period's last day, without one) until that day, each with the classes of its school
 * year. In date order, then Ontario's order.
 */
export function reportReminders<C extends ReminderClass>({
  periods,
  classes,
  today,
  windowDays = REMINDER_WINDOW_DAYS,
}: {
  periods: readonly ReminderPeriod[];
  classes: readonly C[];
  today: LocalDate;
  windowDays?: number;
}): ReportReminder<C>[] {
  const reminders: ReportReminder<C>[] = [];
  for (const p of periods) {
    const date = p.dueOn ?? p.endsOn;
    if (today < addDays(date, -windowDays) || today > date) continue;
    const forYear = classes.filter((c) => c.schoolYearId === p.schoolYearId);
    if (forYear.length === 0) continue;
    reminders.push({ kind: p.kind, date, due: p.dueOn !== null, classes: forYear });
  }
  return reminders.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      REPORT_PERIOD_KINDS.indexOf(a.kind) - REPORT_PERIOD_KINDS.indexOf(b.kind),
  );
}
