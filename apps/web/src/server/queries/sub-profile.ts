import 'server-only';
import { createSupabaseServerClient } from '../supabase';

export interface ClassSubProfile {
  arrivalNotes: string | null;
  routinesNotes: string | null;
  classroomManagementNotes: string | null;
  dismissalNotes: string | null;
  fallbackActivities: string | null;
  neighbourTeacherId: string | null;
  neighbourNote: string | null;
  updatedAt: string | null;
}

/**
 * A class's « Fiche de suppléance » (class team only, RLS) and the colleagues who can be named
 * as « Collègue à côté »: active teachers of the class's school, other than the reader.
 */
export async function loadClassSubProfile(
  classId: string,
  schoolId: string,
  userId: string,
): Promise<{ profile: ClassSubProfile; colleagues: { id: string; name: string }[] }> {
  const supabase = await createSupabaseServerClient();
  const [profile, teachers] = await Promise.all([
    supabase
      .from('class_sub_profiles')
      .select(
        'arrival_notes, routines_notes, classroom_management_notes, dismissal_notes, fallback_activities, neighbour_teacher_id, neighbour_note, updated_at',
      )
      .eq('class_id', classId)
      .maybeSingle(),
    supabase
      .from('user_roles')
      .select('user_id, users!user_roles_user_id_fkey(display_name, honorific, deactivated_at)')
      .eq('school_id', schoolId)
      .eq('role', 'teacher'),
  ]);
  const p = profile.data;
  const seen = new Set<string>();
  const colleagues = (teachers.data ?? [])
    .filter((r) => r.users && !r.users.deactivated_at && r.user_id !== userId)
    .filter((r) => !seen.has(r.user_id) && seen.add(r.user_id))
    .map((r) => ({
      id: r.user_id,
      name: [r.users!.honorific, r.users!.display_name].filter(Boolean).join(' '),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr-CA'));
  return {
    profile: {
      arrivalNotes: p?.arrival_notes ?? null,
      routinesNotes: p?.routines_notes ?? null,
      classroomManagementNotes: p?.classroom_management_notes ?? null,
      dismissalNotes: p?.dismissal_notes ?? null,
      fallbackActivities: p?.fallback_activities ?? null,
      neighbourTeacherId: p?.neighbour_teacher_id ?? null,
      neighbourNote: p?.neighbour_note ?? null,
      updatedAt: p?.updated_at ?? null,
    },
    colleagues,
  };
}
