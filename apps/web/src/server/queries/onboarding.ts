import 'server-only';
import {
  classPurgeDate,
  localDateIn,
  samplePurgeDate,
  showsPurgeNotice,
  type LocalDate,
} from '@lynx/domain';
import type { SessionContext } from '../session';
import { teachingSchools } from '../session';
import { createSupabaseServerClient } from '../supabase';

/**
 * « Pour bien commencer » (DECISIONS D-109): what a teacher has set up, counted under row level
 * security over her real classes (never a sample class), the sample classes she made with the
 * day each is deleted, and the classes whose students' first names are erased soon (D-105).
 */

export type OnboardingStepKey = 'class' | 'students' | 'timetable' | 'unit';

export interface OnboardingStep {
  key: OnboardingStepKey;
  done: boolean;
  /** Where to do it: the first real class's tab, or « Classes » when there is none yet. */
  href: string;
}

export interface SampleClassInfo {
  id: string;
  name: string;
  schoolId: string;
  /** The school-local day the nightly job deletes it (`samplePurgeDate`). */
  purgeOn: LocalDate;
}

export interface PurgeNotice {
  classId: string;
  className: string;
  /** The first day its students' first names are gone (`classPurgeDate`). */
  purgeOn: LocalDate;
}

export interface TeacherOnboarding {
  steps: OnboardingStep[];
  done: number;
  total: number;
  /** « Remplir la fiche de suppléance », optional: null until she has a real class. */
  subProfile: { done: boolean; href: string } | null;
  /** « Masquer » on « Aujourd'hui » (`users.onboarding_dismissed_at`). */
  dismissed: boolean;
  samples: SampleClassInfo[];
  /** Every sample class she is on (her own, or a colleague's she was added to): « Exemple ». */
  sampleClassIds: string[];
  /** Teaching schools where she has no sample class yet (one per school). */
  sampleSchools: { id: string; name: string; dayCount: number }[];
  /** Real classes whose students' first names are erased within the notice window. */
  purgeNotices: PurgeNotice[];
}

interface ClassRow {
  id: string;
  name: string;
  school_id: string;
  sample_owner_id: string | null;
  created_at: string;
  students_purged_at: string | null;
  students_purge_notice_on: string | null;
  school_years: { ends_on: string } | null;
}

/** The teacher's classes at her teaching schools, real and sample, as she can read them. */
async function myClasses(session: SessionContext) {
  const schools = teachingSchools(session);
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('class_teachers')
    .select(
      'class_id, classes!inner(id, name, school_id, sample_owner_id, created_at, students_purged_at, students_purge_notice_on, school_years(ends_on))',
    )
    .eq('user_id', session.userId);
  const rows = (data ?? [])
    .map((r) => r.classes as ClassRow)
    .filter((c) => schools.some((s) => s.id === c.school_id))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr-CA'));
  return { supabase, schools, rows };
}

const countOf = (res: { count: number | null }) => res.count ?? 0;

export async function loadTeacherOnboarding(session: SessionContext): Promise<TeacherOnboarding> {
  const { supabase, schools, rows } = await myClasses(session);
  const real = rows.filter((c) => c.sample_owner_id === null);
  const sampleRows = rows.filter((c) => c.sample_owner_id === session.userId);
  const ids = real.map((c) => c.id);
  const first = real[0] ?? null;

  const [students, blocks, units, profiles] = ids.length
    ? await Promise.all([
        supabase.from('students').select('id', { count: 'exact', head: true }).in('class_id', ids),
        supabase
          .from('timetable_blocks')
          .select('id', { count: 'exact', head: true })
          .in('class_id', ids),
        supabase
          .from('units')
          .select('id, unit_lessons!inner(id)', { count: 'exact', head: true })
          .in('class_id', ids)
          .eq('status', 'active'),
        supabase
          .from('class_sub_profiles')
          .select('class_id', { count: 'exact', head: true })
          .in('class_id', ids),
      ])
    : [{ count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }];

  const tab = (name: string) => (first ? `/classes/${first.id}/${name}` : '/classes');
  const steps: OnboardingStep[] = [
    { key: 'class', done: real.length > 0, href: '/classes' },
    { key: 'students', done: countOf(students) > 0, href: tab('students') },
    { key: 'timetable', done: countOf(blocks) > 0, href: tab('timetable') },
    { key: 'unit', done: countOf(units) > 0, href: tab('planning') },
  ];

  const timezoneOf = (schoolId: string) =>
    schools.find((s) => s.id === schoolId)?.timezone ?? 'America/Toronto';
  const samples = sampleRows.map((c) => ({
    id: c.id,
    name: c.name,
    schoolId: c.school_id,
    purgeOn: samplePurgeDate(localDateIn(timezoneOf(c.school_id), new Date(c.created_at))),
  }));

  return {
    steps,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    subProfile: first
      ? { done: countOf(profiles) > 0, href: `/classes/${first.id}/substitute` }
      : null,
    dismissed: session.onboardingDismissedAt !== null,
    samples,
    sampleClassIds: rows.filter((c) => c.sample_owner_id !== null).map((c) => c.id),
    sampleSchools: schools
      .filter((s) => !samples.some((c) => c.schoolId === s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        dayCount: s.scheduleType === 'cycle' ? (s.cycleLength ?? 5) : 5,
      })),
    purgeNotices: purgeNoticesOf(session, real),
  };
}

/** The year-end notices (D-105) of real classes, 60 days before their students are erased. */
function purgeNoticesOf(session: SessionContext, classes: ClassRow[]): PurgeNotice[] {
  return classes.flatMap((c) => {
    const purgeOn = purgeDateOf(session, c);
    return purgeOn ? [{ classId: c.id, className: c.name, purgeOn }] : [];
  });
}

function purgeDateOf(session: SessionContext, c: ClassRow): LocalDate | null {
  if (c.sample_owner_id !== null || c.students_purged_at !== null || !c.school_years) return null;
  const school = session.schools.find((s) => s.id === c.school_id);
  const board = session.boards.find((b) => b.id === school?.boardId);
  if (!school || !board) return null;
  const today = localDateIn(school.timezone);
  const purgeOn = classPurgeDate(
    c.school_years.ends_on,
    board.settings,
    c.students_purge_notice_on,
    today,
  );
  return showsPurgeNotice(today, purgeOn) ? purgeOn : null;
}

/** What the class page says about a class (D-105, D-109): a sample, or students erased soon. */
export interface ClassNotices {
  sample: { purgeOn: LocalDate } | null;
  purge: { purgeOn: LocalDate } | null;
}

export async function loadClassNotices(
  session: SessionContext,
  classId: string,
): Promise<ClassNotices> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('classes')
    .select(
      'id, name, school_id, sample_owner_id, created_at, students_purged_at, students_purge_notice_on, school_years(ends_on)',
    )
    .eq('id', classId)
    .maybeSingle();
  if (!data) return { sample: null, purge: null };
  const row = data as ClassRow;
  const school = session.schools.find((s) => s.id === row.school_id);
  const sample =
    row.sample_owner_id !== null
      ? {
          purgeOn: samplePurgeDate(
            localDateIn(school?.timezone ?? 'America/Toronto', new Date(row.created_at)),
          ),
        }
      : null;
  const purgeOn = purgeDateOf(session, row);
  return { sample, purge: purgeOn ? { purgeOn } : null };
}

/** Whether the teacher has a sample class at a teaching school (the absence form's notice). */
export async function hasSampleClass(session: SessionContext): Promise<boolean> {
  const schools = teachingSchools(session);
  if (schools.length === 0) return false;
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from('classes')
    .select('id', { count: 'exact', head: true })
    .eq('sample_owner_id', session.userId)
    .in(
      'school_id',
      schools.map((s) => s.id),
    );
  return (count ?? 0) > 0;
}
