import 'server-only';
import { cache } from 'react';
import { localized } from '@/i18n/config';
import type { SessionContext } from '../session';
import { teachingSchools } from '../session';
import { createSupabaseServerClient } from '../supabase';

export interface ClassFormOptions {
  schools: { id: string; name: string; boardId: string }[];
  schoolYears: { id: string; boardId: string; name: string }[];
  rooms: { id: string; schoolId: string; name: string }[];
  grades: { code: string; label: string }[];
}

/** Choices for creating or editing a class. */
export async function loadClassFormOptions(
  session: SessionContext,
  locale: string,
): Promise<ClassFormOptions> {
  const schools = teachingSchools(session);
  const supabase = await createSupabaseServerClient();
  const boardIds = [...new Set(schools.map((s) => s.boardId))];
  const [years, rooms, grades] = await Promise.all([
    supabase
      .from('school_years')
      .select('id, board_id, name, ends_on')
      .in('board_id', boardIds)
      .order('starts_on', { ascending: false }),
    supabase
      .from('rooms')
      .select('id, school_id, name')
      .in(
        'school_id',
        schools.map((s) => s.id),
      )
      .order('name'),
    supabase.from('grades').select('code, label_fr, label_en, ordinal').order('ordinal'),
  ]);
  return {
    schools: schools.map((s) => ({ id: s.id, name: s.name, boardId: s.boardId })),
    schoolYears: (years.data ?? []).map((y) => ({ id: y.id, boardId: y.board_id, name: y.name })),
    rooms: (rooms.data ?? []).map((r) => ({ id: r.id, schoolId: r.school_id, name: r.name })),
    grades: (grades.data ?? []).map((g) => ({
      code: g.code,
      label: localized(locale, g.label_fr, g.label_en),
    })),
  };
}

export interface ClassSummary {
  id: string;
  name: string;
  schoolId: string;
  role: 'homeroom' | 'subject' | 'support';
  gradeLabels: string[];
  studentCount: number;
  /** A « classe exemple » (DECISIONS D-109): « Exemple » on the list. */
  sample: boolean;
}

export async function listMyClasses(
  session: SessionContext,
  locale: string,
): Promise<ClassSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('class_teachers')
    .select(
      'role, classes!inner(id, name, school_id, sample_owner_id, class_grades(grade_code, grades(label_fr, label_en, ordinal)), students(count))',
    )
    .eq('user_id', session.userId);
  return (data ?? [])
    .map((row) => ({
      id: row.classes.id,
      name: row.classes.name,
      schoolId: row.classes.school_id,
      role: row.role,
      gradeLabels: [...row.classes.class_grades]
        .sort((a, b) => (a.grades?.ordinal ?? 0) - (b.grades?.ordinal ?? 0))
        .map((g) =>
          g.grades ? localized(locale, g.grades.label_fr, g.grades.label_en) : g.grade_code,
        ),
      studentCount: (row.classes.students as unknown as { count: number }[])[0]?.count ?? 0,
      sample: row.classes.sample_owner_id !== null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr-CA'));
}

export interface ClassDetail {
  id: string;
  name: string;
  schoolId: string;
  boardId: string;
  roomId: string | null;
  gradeCodes: string[];
  gradeOrdinals: number[];
  myRole: 'homeroom' | 'subject' | 'support' | null;
  team: { userId: string; name: string; role: 'homeroom' | 'subject' | 'support' }[];
}

/** A class the user can see, with its team. Null if not visible (RLS) or not found. */
export const loadClass = cache(
  async (session: SessionContext, classId: string): Promise<ClassDetail | null> => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from('classes')
      .select(
        'id, name, school_id, room_id, schools(board_id), class_grades(grade_code, grades(ordinal)), class_teachers(user_id, role, users!class_teachers_user_id_fkey(display_name, honorific))',
      )
      .eq('id', classId)
      .maybeSingle();
    if (!data) return null;
    const team = data.class_teachers.map((m) => ({
      userId: m.user_id,
      name: [m.users?.honorific, m.users?.display_name].filter(Boolean).join(' '),
      role: m.role,
    }));
    return {
      id: data.id,
      name: data.name,
      schoolId: data.school_id,
      boardId: data.schools?.board_id ?? '',
      roomId: data.room_id,
      gradeCodes: data.class_grades.map((g) => g.grade_code),
      gradeOrdinals: data.class_grades.map((g) => g.grades?.ordinal ?? 0),
      myRole: team.find((m) => m.userId === session.userId)?.role ?? null,
      team,
    };
  },
);
