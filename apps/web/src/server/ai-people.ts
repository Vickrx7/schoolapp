import 'server-only';
import type { KnownPerson } from '@lynx/ai/privacy';
import type { ServerSupabase } from './supabase';

/**
 * The people the signed-in user can see (their classes' students, their colleagues), for the
 * « Vérifier avant d'envoyer » previews of every AI feature. Read as the user, under RLS. The
 * worker checks again with a roster that is never narrower: everyone in every school where the
 * user works (apps/worker/src/ai.ts loadKnownPeople).
 */
export async function visiblePeople(supabase: ServerSupabase): Promise<KnownPerson[]> {
  const [students, users] = await Promise.all([
    supabase.from('students').select('first_name'),
    supabase.from('users').select('display_name'),
  ]);
  return [
    ...(students.data ?? []).map((s) => ({ name: s.first_name, kind: 'student' as const })),
    ...(users.data ?? []).map((u) => ({ name: u.display_name, kind: 'staff' as const })),
  ];
}
