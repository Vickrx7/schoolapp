import { notFound } from 'next/navigation';
import { SubProfileForm } from '@/components/classes/sub-profile-form';
import { loadClass } from '@/server/queries/classes';
import { loadClassSubProfile } from '@/server/queries/sub-profile';
import { requireSession } from '@/server/session';

/**
 * Class tab « Suppléance »: the class's « Fiche de suppléance » (D-057). The layout already
 * limits class pages to the class team; the page checks again (they render concurrently).
 */
export default async function ClassSubstitutePage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const session = await requireSession();
  const cls = await loadClass(session, classId);
  if (!cls || !cls.myRole) notFound();
  const { profile, colleagues } = await loadClassSubProfile(classId, cls.schoolId, session.userId);
  return (
    <SubProfileForm
      userId={session.userId}
      classId={classId}
      profile={profile}
      colleagues={colleagues}
    />
  );
}
