import 'server-only';
import { schoolWeeks, type LocalDate, type SchoolWeek, type YearCalendarEvent } from '@lynx/domain';
import { localized } from '@/i18n/config';
import { createSupabaseServerClient } from '../supabase';
import { toCalendarEvent } from './mappers';

/**
 * « Mon année » (DECISIONS D-123): what the planning screens read about a class's school year,
 * under row level security as the signed-in teacher.
 */

export interface ClassYear {
  id: string;
  name: string;
  startsOn: LocalDate;
  endsOn: LocalDate;
}

export interface ClassYearWeeks {
  year: ClassYear;
  /** Monday to Friday, with school days, days off and events (the board's, the school's, the class's). */
  weeks: SchoolWeek[];
}

/** A class's school year and its weeks. Null when the class cannot be read. */
export async function loadClassYearWeeks(cls: {
  id: string;
  schoolId: string;
  boardId: string;
}): Promise<ClassYearWeeks | null> {
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from('classes')
    .select('school_years(id, name, starts_on, ends_on)')
    .eq('id', cls.id)
    .maybeSingle();
  const y = row?.school_years;
  if (!y) return null;
  const { data: events } = await supabase
    .from('school_calendar_events')
    .select(
      'id, board_id, school_id, class_id, event_type, title, starts_on, ends_on, start_time, end_time, affects_schedule',
    )
    .eq('board_id', cls.boardId)
    .lte('starts_on', y.ends_on)
    .gte('ends_on', y.starts_on)
    .order('starts_on');
  const calendar: YearCalendarEvent[] = (events ?? []).map((e) => ({
    ...toCalendarEvent(e),
    schoolId: e.school_id,
  }));
  return {
    year: { id: y.id, name: y.name, startsOn: y.starts_on, endsOn: y.ends_on },
    weeks: schoolWeeks({
      startsOn: y.starts_on,
      endsOn: y.ends_on,
      events: calendar,
      schoolId: cls.schoolId,
      classId: cls.id,
    }),
  };
}

/** An attente the unit planning dialog offers (« Attentes visées »). */
export interface ExpectationChoice {
  id: string;
  code: string;
  text: string;
  kind: 'overall' | 'specific';
  parentId: string | null;
  verified: boolean;
  gradeCode: string;
  gradeLabel: string;
  /** « C. Compréhension… », the domaine; null when the attente has none. */
  strand: string | null;
  strandOrder: number;
  sortOrder: number;
}

/**
 * The attentes of a subject for a class's grades, by grade, domaine and the curriculum's order.
 * Everyone signed in reads the curriculum (it is reference data).
 */
export async function loadExpectationChoices(
  subjectId: string,
  gradeCodes: readonly string[],
  locale: string,
): Promise<ExpectationChoice[]> {
  if (gradeCodes.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('curriculum_expectations')
    .select(
      'id, code, text_fr, text_en, kind, parent_id, is_verified, grade_code, sort_order, grades(label_fr, label_en, ordinal), strands(code, label_fr, label_en, sort_order)',
    )
    .eq('subject_id', subjectId)
    .in('grade_code', [...gradeCodes])
    .order('sort_order')
    .limit(2000);
  const rows = (data ?? []).map((e) => ({
    ordinal: e.grades?.ordinal ?? 0,
    choice: {
      id: e.id,
      code: e.code,
      text: localized(locale, e.text_fr, e.text_en),
      kind: e.kind,
      parentId: e.parent_id,
      verified: e.is_verified,
      gradeCode: e.grade_code,
      gradeLabel: e.grades ? localized(locale, e.grades.label_fr, e.grades.label_en) : e.grade_code,
      strand: e.strands
        ? `${e.strands.code}. ${localized(locale, e.strands.label_fr, e.strands.label_en)}`
        : null,
      strandOrder: e.strands?.sort_order ?? 999,
      sortOrder: e.sort_order,
    } satisfies ExpectationChoice,
  }));
  rows.sort(
    (a, b) =>
      a.ordinal - b.ordinal ||
      a.choice.strandOrder - b.choice.strandOrder ||
      a.choice.sortOrder - b.choice.sortOrder ||
      a.choice.code.localeCompare(b.choice.code, 'fr-CA', { numeric: true }),
  );
  return rows.map((r) => r.choice);
}
