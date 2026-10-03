/**
 * « Bulletins » (DECISIONS D-130, D-135): the page's address and choices, apart from the database
 * and React so they are unit-tested. The address holds filters only (the period, the subject and
 * the bank), never a comment: comments live on the teacher's device (`useReportDraft`).
 *
 * Pure and imported relatively (no `@/` alias), like `planning/coverage-view.ts`.
 */
import {
  LEARNING_SKILLS_KEY,
  REPORT_PERIOD_KINDS,
  bankPeriodOf,
  bankServesReport,
  draftExpiresOn,
  isLocalDate,
  periodKey,
  type ComposerPeriod,
  type ComposerReport,
  type ComposerSubjectChoice,
  type DateWindow,
  type LocalDate,
  type ReportPeriod,
  type ReportPeriodKind,
} from '@lynx/domain';
import type { ReportBankPeriod, ReportBankScope } from '@lynx/content';

const first = (value: unknown): string | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------------------
// « Période »
// ---------------------------------------------------------------------------------------

export interface ComposerPeriodSelection {
  /** A board period's kind, or « Dates choisies ». */
  choice: ReportPeriodKind | 'custom';
  period: ComposerPeriod;
  /** The device draft's period key (`periodKey`). */
  key: string;
  /** The dates the taught attentes are read for. */
  window: DateWindow;
  /** The report the comments are for (the banks offered follow it). */
  report: ComposerReport;
  /** The last day the device keeps the comments (`draftExpiresOn`). */
  expiresOn: LocalDate;
  /** « Dates choisies » typed without two dates in order: the default dates are used. */
  invalid: boolean;
  /** The board's period, when one is chosen. */
  reportPeriod: ReportPeriod | null;
}

/** The board's periods, in Ontario's order. */
const ordered = (periods: readonly ReportPeriod[]) =>
  REPORT_PERIOD_KINDS.flatMap((kind) => periods.filter((p) => p.kind === kind));

/**
 * The period of `period`, `from`, `to` and `kind` (the report, for « Dates choisies »): one of
 * the board's periods; « Dates choisies » with two dates in order; by default the first period
 * whose « saisie » (or last day) has not passed, else the last one; and « Dates choisies » from
 * the year's first day to today when the board has set no period.
 */
export function composerPeriod(
  params: { period?: unknown; from?: unknown; to?: unknown; kind?: unknown },
  periods: readonly ReportPeriod[],
  year: DateWindow,
  today: LocalDate,
): ComposerPeriodSelection {
  const board = ordered(periods);
  const of = (p: ReportPeriod): ComposerPeriodSelection => ({
    choice: p.kind,
    period: { kind: p.kind },
    key: periodKey({ kind: p.kind }),
    window: { startsOn: p.startsOn, endsOn: p.endsOn },
    report: bankPeriodOf(p.kind),
    expiresOn: draftExpiresOn(p),
    invalid: false,
    reportPeriod: p,
  });
  const custom = (from: LocalDate, to: LocalDate, report: ComposerReport, invalid: boolean) => {
    const period: ComposerPeriod = { from, to, report };
    return {
      choice: 'custom' as const,
      period,
      key: periodKey(period),
      window: { startsOn: from, endsOn: to },
      report,
      expiresOn: draftExpiresOn({ endsOn: to, dueOn: null, issuedOn: null }),
      invalid,
      reportPeriod: null,
    };
  };
  const choice = first(params.period);
  if (choice === 'custom' || board.length === 0) {
    const from = first(params.from);
    const to = first(params.to);
    const report: ComposerReport = first(params.kind) === 'progress' ? 'progress' : 'term';
    if (from && to && isLocalDate(from) && isLocalDate(to) && from <= to) {
      return custom(from, to, report, false);
    }
    const end = today < year.startsOn ? year.startsOn : today > year.endsOn ? year.endsOn : today;
    return custom(
      year.startsOn,
      end,
      report,
      choice === 'custom' && (from !== null || to !== null),
    );
  }
  const chosen = board.find((p) => p.kind === choice);
  if (chosen) return of(chosen);
  const next = board.find((p) => (p.dueOn ?? p.endsOn) >= today) ?? board[board.length - 1]!;
  return of(next);
}

// ---------------------------------------------------------------------------------------
// « Matière »
// ---------------------------------------------------------------------------------------

/** The subject of `subject`, by default the first choice (`composerSubjects`' order). */
export function composerSubject<S>(
  value: unknown,
  choices: readonly ComposerSubjectChoice<S>[],
): ComposerSubjectChoice<S> {
  const key = first(value);
  return choices.find((c) => c.key === key) ?? choices[0]!;
}

/** What a bank must be about for a subject: Enseignement religieux is « L'enseignement religieux ». */
export function scopeOf(choice: {
  key: string;
  subject: { code: string } | null;
}): ReportBankScope {
  if (choice.key === LEARNING_SKILLS_KEY) return 'learning_skills';
  return choice.subject?.code === 'ere' ? 'religion' : 'subject';
}

// ---------------------------------------------------------------------------------------
// « Banque »
// ---------------------------------------------------------------------------------------

export interface BankCandidate {
  id: string;
  title: string;
  status: 'draft' | 'teacher_reviewed' | 'board_approved' | 'rejected' | 'archived';
  source: string;
  mine: boolean;
  scope: string | null;
  period: string | null;
  gradeCodes: string[];
}

export interface BankOption extends BankCandidate {
  scope: ReportBankScope;
  period: ReportBankPeriod;
}

const BANK_PERIODS: readonly string[] = ['progress', 'term', 'any'];

/**
 * The banks usable for the subject's scope and the period's report (« Les deux » serves both),
 * in the search's order (board-approved first), each once.
 */
export function bankOptions(
  candidates: readonly BankCandidate[],
  scope: ReportBankScope,
  report: ComposerReport,
): BankOption[] {
  const seen = new Set<string>();
  const options: BankOption[] = [];
  for (const c of candidates) {
    if (seen.has(c.id) || c.scope !== scope || !c.period || !BANK_PERIODS.includes(c.period)) {
      continue;
    }
    if (!bankServesReport(c.period as ReportBankPeriod, report)) continue;
    seen.add(c.id);
    options.push(c as BankOption);
  }
  return options;
}

/** The bank of `bank`, by default the first option. */
export function composerBank(value: unknown, options: readonly BankOption[]): BankOption | null {
  const id = first(value);
  return options.find((o) => o.id === id) ?? options[0] ?? null;
}

// ---------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------

export interface ComposerAddress {
  period: ReportPeriodKind | 'custom';
  from?: LocalDate | null;
  to?: LocalDate | null;
  kind?: ComposerReport | null;
  subject?: string | null;
  bank?: string | null;
}

/** `/classes/<id>/bulletins?period=term1&subject=<id>&bank=<id>`: filters only. */
export function composerHref(classId: string, address: ComposerAddress): string {
  const params = new URLSearchParams();
  params.set('period', address.period);
  if (address.period === 'custom') {
    if (address.from) params.set('from', address.from);
    if (address.to) params.set('to', address.to);
    params.set('kind', address.kind ?? 'term');
  }
  if (address.subject) params.set('subject', address.subject);
  if (address.bank && UUID.test(address.bank)) params.set('bank', address.bank);
  return `/classes/${classId}/bulletins?${params.toString()}`;
}

/** « Créer une banque avec l'IA » takes at most this many attentes (D-132). */
export const BANK_LINK_MAX_EXPECTATIONS = 12;

/**
 * « Créer une banque avec l'IA », prefilled with ids only (D-132): the scope, the grade, the
 * subject (not for the learning skills), the report and up to 12 attentes taught.
 */
export function aiBankHref({
  scope,
  gradeCode,
  subjectId,
  report,
  expectationIds,
}: {
  scope: ReportBankScope;
  gradeCode: string;
  subjectId: string | null;
  report: ComposerReport;
  expectationIds: readonly string[];
}): string {
  const params = new URLSearchParams();
  params.set('scope', scope);
  params.set('grade', gradeCode);
  if (scope !== 'learning_skills' && subjectId) params.set('subject', subjectId);
  params.set('period', report);
  const ids = scope === 'learning_skills' ? [] : expectationIds.filter((id) => UUID.test(id));
  if (ids.length) params.set('exp', ids.slice(0, BANK_LINK_MAX_EXPECTATIONS).join(','));
  return `/library/generate/comments?${params.toString()}`.replaceAll('%2C', ',');
}

/** « Créer une banque »: a new bank in the library's editor, for the grade and the subject. */
export function newBankHref({
  gradeCode,
  subjectId,
}: {
  gradeCode: string;
  subjectId: string | null;
}): string {
  const params = new URLSearchParams({ type: 'report_comments', grade: gradeCode });
  if (subjectId) params.set('subject', subjectId);
  return `/library/new?${params.toString()}`;
}
