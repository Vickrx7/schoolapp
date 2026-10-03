import 'server-only';
import {
  expectationCoverage,
  localDateIn,
  type CoverageProgress,
  type CoverageUnit,
  type LocalDate,
  type ReportPeriod,
} from '@lynx/domain';
import { localized } from '@/i18n/config';
import type { CurriculumStrand } from '../curriculum-groups';
import { reportError } from '../errors';
import {
  classCoverageShow,
  coverageOverview,
  coveragePeriod,
  groupClassCoverage,
  orderedPeriods,
  type ClassCoverageRow,
  type ClassCoverageShow,
  type ClassCoverageView,
  type CoverageCountRow,
  type CoverageOverview,
  type CoveragePeriodSelection,
} from '../planning/coverage-view';
import { findSchool, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { fetchAllRows } from './fetch-all';
import type { ClassDetail } from './classes';
import type { ClassYear } from './year-plan';
import { loadSubjectsForGrades, type SubjectOption } from './subjects';

/**
 * « Couverture des attentes » of a class (DECISIONS D-125): the class's units, lessons and
 * progress against the curriculum loaded for its grades, all read under row level security as
 * the signed-in teacher (the class team; never the direction, office staff or the board, D-013).
 * Nothing is stored: the statuses are computed on each request by the domain's
 * `expectationCoverage`.
 */

export interface ClassGrade {
  code: string;
  label: string;
}

/** What the coverage of a class is computed from. */
export interface CoverageInputs {
  year: ClassYear;
  today: LocalDate;
  /** The board's report periods for the class's year, in Ontario's order. */
  periods: ReportPeriod[];
  /** The subjects a unit of the class may take, in the board's order. */
  subjects: SubjectOption[];
  /** The class's grades, youngest first. */
  grades: ClassGrade[];
  /** Every attente of the class's grades, all subjects (what counting needs). */
  rows: CoverageCountRow[];
  /** The class's units, archived ones aside, with their attentes and lessons' attentes. */
  units: CoverageUnit[];
  /** The class's progress, by lesson. */
  progress: Map<string, CoverageProgress>;
}

/**
 * The coverage inputs of a class. Null when the class's school year cannot be read, or when a
 * query fails (reported; the page says it could not be loaded).
 */
export async function loadCoverageInputs(
  session: SessionContext,
  cls: ClassDetail,
  locale: string,
): Promise<CoverageInputs | null> {
  const school = findSchool(session, cls.schoolId);
  if (!school) return null;
  const board = session.boards.find((b) => b.id === school.boardId);
  const supabase = await createSupabaseServerClient();

  const loadRows = async (): Promise<CoverageCountRow[] | null> => {
    const { data, error } = await fetchAllRows((from, to) =>
      supabase
        .from('curriculum_expectations')
        .select('id, subject_id, grade_code, kind, parent_id, is_verified')
        .in('grade_code', cls.gradeCodes)
        .order('id')
        .range(from, to),
    );
    if (error) {
      reportError('loadClassCoverage', error);
      return null;
    }
    return data.map((e) => ({
      expectationId: e.id,
      subjectId: e.subject_id,
      gradeCode: e.grade_code,
      kind: e.kind,
      parentId: e.parent_id,
      verified: e.is_verified,
    }));
  };

  const [yearRes, gradesRes, unitsRes, progressRes, subjects, rows] = await Promise.all([
    supabase
      .from('classes')
      .select('school_years(id, name, starts_on, ends_on)')
      .eq('id', cls.id)
      .maybeSingle(),
    supabase
      .from('grades')
      .select('code, label_fr, label_en, ordinal')
      .in('code', cls.gradeCodes)
      .order('ordinal'),
    supabase
      .from('units')
      .select(
        'id, title, status, planned_start_on, planned_end_on, unit_expectations(expectation_id), unit_lessons(id, unit_lesson_expectations(expectation_id))',
      )
      .eq('class_id', cls.id)
      .neq('status', 'archived'),
    fetchAllRows((from, to) =>
      supabase
        .from('lesson_progress')
        .select('lesson_id, status, taught_on')
        .eq('class_id', cls.id)
        .order('lesson_id')
        .range(from, to),
    ),
    loadSubjectsForGrades(cls.gradeOrdinals, board?.settings, locale),
    loadRows(),
  ]);
  const failed = yearRes.error ?? gradesRes.error ?? unitsRes.error ?? progressRes.error;
  if (failed) {
    reportError('loadClassCoverage', failed);
    return null;
  }
  const y = yearRes.data?.school_years;
  if (!y || !rows) return null;
  const { data: periodRows, error: periodError } = await supabase
    .from('report_periods')
    .select('kind, starts_on, ends_on, due_on, issued_on')
    .eq('school_year_id', y.id);
  if (periodError) {
    reportError('loadClassCoverage', periodError);
    return null;
  }

  return {
    year: { id: y.id, name: y.name, startsOn: y.starts_on, endsOn: y.ends_on },
    today: localDateIn(school.timezone),
    periods: orderedPeriods(
      (periodRows ?? []).map((p) => ({
        kind: p.kind as ReportPeriod['kind'],
        startsOn: p.starts_on,
        endsOn: p.ends_on,
        dueOn: p.due_on,
        issuedOn: p.issued_on,
      })),
    ),
    subjects,
    grades: (gradesRes.data ?? []).map((g) => ({
      code: g.code,
      label: localized(locale, g.label_fr, g.label_en),
    })),
    rows,
    units: (unitsRes.data ?? []).map((u) => ({
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
    })),
    progress: new Map(
      (progressRes.data ?? []).map((p) => [
        p.lesson_id,
        { status: p.status, taughtOn: p.taught_on } satisfies CoverageProgress,
      ]),
    ),
  };
}

/** The whole year's coverage per subject (and grade) of the class: the overview and the PDF. */
export function overviewOf(inputs: CoverageInputs): CoverageOverview<SubjectOption> {
  const coverage = expectationCoverage({
    expectations: inputs.rows.map((r) => ({
      id: r.expectationId,
      kind: r.kind,
      parentId: r.parentId,
    })),
    units: inputs.units,
    progress: inputs.progress,
    period: null,
  });
  return coverageOverview(
    inputs.rows,
    coverage,
    inputs.subjects,
    inputs.grades.map((g) => g.code),
  );
}

export interface ClassCoveragePage {
  /** Null when the coverage could not be read (the page says so). */
  inputs: CoverageInputs | null;
  /** « Vue d'ensemble », without a subject; null once one is chosen. */
  overview: CoverageOverview<SubjectOption> | null;
  subject: SubjectOption | null;
  /** The chosen grade (always one of the class's grades once a subject is chosen). */
  grade: ClassGrade | null;
  period: CoveragePeriodSelection;
  show: ClassCoverageShow;
  /** The chosen subject and grade's attentes; null without a subject, or on failure. */
  view: ClassCoverageView | null;
  failed: boolean;
}

/**
 * The page: the overview of the class's subjects, and, for a chosen subject (and grade, for a
 * class of several grades), the attentes by domaine with their status and evidence for the
 * chosen period.
 */
export async function loadClassCoverage(
  session: SessionContext,
  cls: ClassDetail,
  params: {
    subject?: unknown;
    grade?: unknown;
    period?: unknown;
    from?: unknown;
    to?: unknown;
    show?: unknown;
  },
  locale: string,
): Promise<ClassCoveragePage> {
  const show = classCoverageShow(params.show);
  const inputs = await loadCoverageInputs(session, cls, locale);
  const empty = {
    inputs,
    overview: null,
    subject: null,
    grade: null,
    period: coveragePeriod({}, []),
    show,
    view: null,
  };
  if (!inputs) return { ...empty, failed: true };

  const period = coveragePeriod(params, inputs.periods);
  const pick = (value: unknown) => (Array.isArray(value) ? value[0] : value);
  const subject = inputs.subjects.find((s) => s.id === pick(params.subject)) ?? null;
  const grade = subject
    ? (inputs.grades.find((g) => g.code === pick(params.grade)) ?? inputs.grades[0] ?? null)
    : null;
  // The overview is shown only without a subject.
  const base = { ...empty, period, overview: subject ? null : overviewOf(inputs), subject, grade };
  if (!subject || !grade) return { ...base, failed: false };

  const supabase = await createSupabaseServerClient();
  const [expectations, strands] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from('curriculum_expectations')
        .select('id, kind, parent_id, strand_id, code, text_fr, text_en, is_verified, sort_order')
        .eq('subject_id', subject.id)
        .eq('grade_code', grade.code)
        .order('sort_order')
        .order('id')
        .range(from, to),
    ),
    supabase
      .from('strands')
      .select('id, code, label_fr, label_en, sort_order')
      .eq('subject_id', subject.id),
  ]);
  if (expectations.error || strands.error) {
    reportError('loadClassCoverage', expectations.error ?? strands.error);
    return { ...base, failed: true };
  }
  const rows: ClassCoverageRow[] = (expectations.data ?? []).map((e) => ({
    expectationId: e.id,
    parentId: e.parent_id,
    strandId: e.strand_id,
    kind: e.kind,
    code: e.code,
    text: localized(locale, e.text_fr, e.text_en),
    verified: e.is_verified,
    sortOrder: e.sort_order,
  }));
  const strandRows: CurriculumStrand[] = (strands.data ?? []).map((s) => ({
    id: s.id,
    code: s.code,
    label: localized(locale, s.label_fr, s.label_en),
    sortOrder: s.sort_order,
  }));
  const coverage = expectationCoverage({
    expectations: rows.map((r) => ({ id: r.expectationId, kind: r.kind, parentId: r.parentId })),
    units: inputs.units,
    progress: inputs.progress,
    period: period.window,
  });
  return {
    ...base,
    view: groupClassCoverage(rows, strandRows, coverage, show),
    failed: false,
  };
}
