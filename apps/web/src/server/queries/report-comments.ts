import 'server-only';
import { contentSchema, type ReportBankScope } from '@lynx/content';
import {
  composerSubjects,
  localDateIn,
  reportReminders,
  taughtExpectationIds,
  type BankEntry,
  type ComposerSubjectChoice,
  type CoverageProgress,
  type CoverageUnit,
  type LocalDate,
  type ReminderClass,
  type ReportPeriod,
  type ReportPeriodKind,
  type ReportReminder,
} from '@lynx/domain';
import { z } from 'zod';
import { localized } from '@/i18n/config';
import { reportError } from '../errors';
import {
  aiBankHref,
  bankOptions,
  composerBank,
  composerPeriod,
  composerSubject,
  newBankHref,
  scopeOf,
  type BankCandidate,
  type BankOption,
  type ComposerPeriodSelection,
} from '../report-comments/view-model';
import { aiOn, findSchool, hasModule, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { fetchAllRows } from './fetch-all';
import type { ClassDetail } from './classes';
import { loadSubjectsForGrades, type SubjectOption } from './subjects';
import { loadExpectationChoices, type ClassYear, type ExpectationChoice } from './year-plan';

/**
 * « Bulletins » (DECISIONS D-130, D-135): what the composer needs from the server, read under
 * row level security as the signed-in teacher. Nothing here is about a comment: the students'
 * first names (as « Élèves » shows them), the class's report periods, timetable and teaching
 * record, the usable comment banks and the curriculum. The comments themselves are composed and
 * kept in the browser only (`useReportDraft`); the page has no server action, route handler or
 * form that carries them.
 */

export interface ComposerStudent {
  id: string;
  firstName: string;
}

export interface ComposerGrade {
  code: string;
  label: string;
}

/** The chosen bank, with its entries (no student data: `{prénom}` only). */
export interface ComposerBank extends BankOption {
  revision: number;
  entries: BankEntry[];
}

export interface ReportComposerData {
  year: ClassYear;
  today: LocalDate;
  grades: ComposerGrade[];
  students: ComposerStudent[];
  /** The board's report periods for the class's year, in Ontario's order. */
  periods: ReportPeriod[];
  period: ComposerPeriodSelection;
  subjects: ComposerSubjectChoice<SubjectOption>[];
  subject: ComposerSubjectChoice<SubjectOption>;
  scope: ReportBankScope;
  banks: BankOption[];
  bank: ComposerBank | null;
  /** The chosen bank could not be read (its content does not fit the schema). */
  bankUnreadable: boolean;
  /** The subject's attentes for the class's grades (none for the learning skills). */
  expectations: ExpectationChoice[];
  /** Taught during the period; null when the subject has no attentes loaded. */
  taughtIds: string[] | null;
  /** « Créer une banque avec l'IA » (the school's AI is on), prefilled with ids only. */
  aiBankHref: string | null;
  newBankHref: string;
}

/** A row of `search_library`'s answer (only what the bank list needs). */
const searchSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      status: z.enum(['draft', 'teacher_reviewed', 'board_approved', 'rejected', 'archived']),
      source: z.string(),
      mine: z.boolean(),
      gradeCodes: z.array(z.string()),
    }),
  ),
});

/** At most this many banks per grade and subject (`search_library` answers 50 at a time). */
const BANK_LIMIT = 50;

/** PostgREST answers at most this many rows at a time. */
const PAGE = 1000;

/**
 * Everything « Bulletins » shows for a class, from the page's address (`period`, `from`, `to`,
 * `kind`, `subject`, `bank`). Null when the class's school year or teaching record cannot be read
 * (reported; the page says so).
 */
export async function loadReportComposer(
  session: SessionContext,
  cls: ClassDetail,
  params: Record<string, unknown>,
  locale: string,
): Promise<ReportComposerData | null> {
  const school = findSchool(session, cls.schoolId);
  if (!school) return null;
  const board = session.boards.find((b) => b.id === school.boardId);
  const supabase = await createSupabaseServerClient();
  const today = localDateIn(school.timezone);

  const [yearRes, gradesRes, studentsRes, blocksRes, unitsRes, progressRes, subjects] =
    await Promise.all([
      supabase
        .from('classes')
        .select(
          'school_years(id, name, starts_on, ends_on, report_periods(kind, starts_on, ends_on, due_on, issued_on))',
        )
        .eq('id', cls.id)
        .maybeSingle(),
      supabase
        .from('grades')
        .select('code, label_fr, label_en, ordinal')
        .in('code', cls.gradeCodes)
        .order('ordinal'),
      supabase.from('students').select('id, first_name').eq('class_id', cls.id).limit(PAGE),
      supabase
        .from('timetable_blocks')
        .select('subject_id, teacher_id')
        .eq('class_id', cls.id)
        .eq('kind', 'subject'),
      supabase
        .from('units')
        .select(
          'id, title, status, planned_start_on, planned_end_on, unit_expectations(expectation_id), unit_lessons(id, unit_lesson_expectations(expectation_id))',
        )
        .eq('class_id', cls.id)
        .neq('status', 'archived'),
      // A class's progress passes PostgREST's 1,000 rows in the spring: page by page.
      fetchAllRows((from, to) =>
        supabase
          .from('lesson_progress')
          .select('lesson_id, status, taught_on')
          .eq('class_id', cls.id)
          .order('lesson_id')
          .range(from, to),
      ),
      loadSubjectsForGrades(cls.gradeOrdinals, board?.settings, locale),
    ]);
  const failed =
    yearRes.error ??
    gradesRes.error ??
    studentsRes.error ??
    blocksRes.error ??
    unitsRes.error ??
    progressRes.error;
  if (failed) {
    reportError('loadReportComposer', failed);
    return null;
  }
  const y = yearRes.data?.school_years;
  if (!y) return null;
  const year: ClassYear = { id: y.id, name: y.name, startsOn: y.starts_on, endsOn: y.ends_on };
  const periods: ReportPeriod[] = (y.report_periods ?? []).map((p) => ({
    kind: p.kind as ReportPeriodKind,
    startsOn: p.starts_on,
    endsOn: p.ends_on,
    dueOn: p.due_on,
    issuedOn: p.issued_on,
  }));
  const period = composerPeriod(params, periods, year, today);
  const grades = (gradesRes.data ?? []).map((g) => ({
    code: g.code,
    label: localized(locale, g.label_fr, g.label_en),
  }));
  const students = (studentsRes.data ?? [])
    .map((s) => ({ id: s.id, firstName: s.first_name }))
    .sort((a, b) => a.firstName.localeCompare(b.firstName, 'fr-CA'));
  const choices = composerSubjects({
    blocks: (blocksRes.data ?? []).map((b) => ({
      subjectId: b.subject_id,
      teacherId: b.teacher_id,
    })),
    userId: session.userId,
    myRole: cls.myRole,
    subjects,
  });
  const subject = composerSubject(params.subject, choices);
  const scope = scopeOf(subject);
  const subjectId = subject.subject?.id ?? null;

  // The banks (for each grade of the class) and the subject's attentes.
  const [searches, expectations] = await Promise.all([
    Promise.all(
      grades.map((g) =>
        supabase.rpc('search_library', {
          p_filters: {
            types: ['report_comments'],
            gradeCode: g.code,
            ...(subjectId ? { subjectId } : {}),
          },
          p_limit: BANK_LIMIT,
          p_offset: 0,
        }),
      ),
    ),
    subjectId ? loadExpectationChoices(subjectId, cls.gradeCodes, locale) : Promise.resolve([]),
  ]);
  const found: z.infer<typeof searchSchema>['items'] = [];
  for (const { data, error } of searches) {
    if (error) {
      reportError('loadReportComposer', error);
      continue;
    }
    const parsed = searchSchema.safeParse(data);
    if (parsed.success) found.push(...parsed.data.items);
  }
  // The scope and report of each bank, from its base version (a bank has no levels).
  const ids = [...new Set(found.map((f) => f.id))];
  const shapes = new Map<string, { scope: string | null; period: string | null }>();
  if (ids.length) {
    const { data, error } = await supabase
      .from('library_item_versions')
      .select('item_id, scope:content->>scope, period:content->>period')
      .in('item_id', ids)
      .is('language_level_id', null);
    if (error) reportError('loadReportComposer', error);
    for (const v of data ?? []) shapes.set(v.item_id, { scope: v.scope, period: v.period });
  }
  const candidates: BankCandidate[] = found.map((f) => ({
    ...f,
    scope: shapes.get(f.id)?.scope ?? null,
    period: shapes.get(f.id)?.period ?? null,
  }));
  const banks = bankOptions(candidates, scope, period.report);
  const chosen = composerBank(params.bank, banks);

  let bank: ComposerBank | null = null;
  let bankUnreadable = false;
  if (chosen) {
    const [item, version] = await Promise.all([
      supabase.from('library_items').select('content_revision').eq('id', chosen.id).maybeSingle(),
      supabase
        .from('library_item_versions')
        .select('content')
        .eq('item_id', chosen.id)
        .is('language_level_id', null)
        .maybeSingle(),
    ]);
    const content = contentSchema('report_comments', 'draft').safeParse(version.data?.content);
    if (item.error || version.error) reportError('loadReportComposer', item.error ?? version.error);
    if (item.data && content.success) {
      bank = { ...chosen, revision: item.data.content_revision, entries: content.data.entries };
    } else {
      bankUnreadable = true;
    }
  }

  // The attentes taught during the period, from the class's own units, lessons and progress.
  const units: CoverageUnit[] = (unitsRes.data ?? []).map((u) => ({
    id: u.id,
    title: u.title,
    status: u.status,
    startsOn: u.planned_start_on,
    endsOn: u.planned_end_on,
    expectationIds: u.unit_expectations.map((e) => e.expectation_id),
    lessons: u.unit_lessons.map((l) => ({
      id: l.id,
      expectationIds: l.unit_lesson_expectations.map((e) => e.expectation_id),
    })),
  }));
  const progress = new Map(
    (progressRes.data ?? []).map((p) => [
      p.lesson_id,
      { status: p.status, taughtOn: p.taught_on } satisfies CoverageProgress,
    ]),
  );
  const taughtIds =
    expectations.length === 0
      ? null
      : taughtExpectationIds(
          {
            expectations: expectations.map((e) => ({
              id: e.id,
              kind: e.kind,
              parentId: e.parentId,
            })),
            units,
            progress,
          },
          period.window,
        );

  const gradeCode = grades[0]?.code ?? cls.gradeCodes[0] ?? '';
  const taughtInGrade = (taughtIds ?? []).filter((id) => {
    const e = expectations.find((x) => x.id === id);
    return e && e.gradeCode === gradeCode;
  });
  return {
    year,
    today,
    grades,
    students,
    periods,
    period,
    subjects: choices,
    subject,
    scope,
    banks,
    bank,
    bankUnreadable,
    expectations,
    taughtIds,
    aiBankHref: aiOn(session, school)
      ? aiBankHref({
          scope,
          gradeCode,
          subjectId,
          report: period.report,
          expectationIds: taughtInGrade,
        })
      : null,
    newBankHref: newBankHref({ gradeCode, subjectId }),
  };
}

// ---------------------------------------------------------------------------------------
// « Aujourd'hui »: « Préparer mes commentaires » (D-135)
// ---------------------------------------------------------------------------------------

export interface ReminderClassRow extends ReminderClass {
  schoolId: string;
}

/**
 * The report periods to prepare comments for today: for each of the teacher's classes as
 * homeroom or subject teacher (never « Soutien », never a sample class) at a school with the
 * Library module, from 21 days before the « saisie » until that day.
 */
export async function loadReportReminders(
  session: SessionContext,
): Promise<ReportReminder<ReminderClassRow>[]> {
  const schools = session.schools.filter(
    (s) => hasModule(s, 'library') && hasModule(s, 'teaching'),
  );
  if (schools.length === 0) return [];
  const ids = new Set(schools.map((s) => s.id));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('class_teachers')
    .select(
      'role, classes!inner(id, name, school_id, school_year_id, sample_owner_id, school_years(report_periods(kind, starts_on, ends_on, due_on, issued_on)))',
    )
    .eq('user_id', session.userId)
    .in('role', ['homeroom', 'subject']);
  if (error) {
    reportError('loadReportReminders', error);
    return [];
  }
  const classes: ReminderClassRow[] = [];
  const periods = new Map<string, Parameters<typeof reportReminders>[0]['periods'][number]>();
  for (const row of data ?? []) {
    const c = row.classes;
    if (!ids.has(c.school_id) || c.sample_owner_id !== null) continue;
    classes.push({ id: c.id, name: c.name, schoolId: c.school_id, schoolYearId: c.school_year_id });
    for (const p of c.school_years?.report_periods ?? []) {
      periods.set(`${c.school_year_id}:${p.kind}`, {
        kind: p.kind as ReportPeriodKind,
        schoolYearId: c.school_year_id,
        startsOn: p.starts_on,
        endsOn: p.ends_on,
        dueOn: p.due_on,
        issuedOn: p.issued_on,
      });
    }
  }
  classes.sort((a, b) => a.name.localeCompare(b.name, 'fr-CA'));
  const timezone = schools[0]!.timezone;
  return reportReminders({ periods: [...periods.values()], classes, today: localDateIn(timezone) });
}
