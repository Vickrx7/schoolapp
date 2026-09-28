import { getLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ClassSettings } from '@/components/classes/class-settings';
import { loadClass, loadClassFormOptions } from '@/server/queries/classes';
import { requireSession } from '@/server/session';
import { createSupabaseServerClient } from '@/server/supabase';

export default async function ClassSettingsPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const session = await requireSession();
  // The layout shows "not found" for a missing class, but pages render at the same time
  // (e.g. right after the class was deleted), so check here too.
  const cls = await loadClass(session, classId);
  if (!cls) notFound();
  const options = await loadClassFormOptions(session, await getLocale());
  const supabase = await createSupabaseServerClient();

  // Teachers at this school who could join the class team.
  const { data: colleagues } = await supabase
    .from('user_roles')
    .select('user_id, users!user_roles_user_id_fkey(display_name, honorific)')
    .eq('school_id', cls.schoolId)
    .eq('role', 'teacher');

  return (
    <ClassSettings
      classId={classId}
      className={cls.name}
      isHomeroom={cls.myRole === 'homeroom'}
      currentUserId={session.userId}
      options={options}
      initial={{
        name: cls.name,
        schoolId: cls.schoolId,
        roomId: cls.roomId,
        gradeCodes: cls.gradeCodes,
      }}
      team={cls.team}
      candidates={(colleagues ?? [])
        .filter((c) => !cls.team.some((m) => m.userId === c.user_id))
        .map((c) => ({
          id: c.user_id,
          name: [c.users?.honorific, c.users?.display_name].filter(Boolean).join(' '),
        }))}
    />
  );
}
