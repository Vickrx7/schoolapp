import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { TeacherChecklist } from '@/components/onboarding/teacher-checklist';
import { PageHeader } from '@/components/ui/page';
import { loadTeacherOnboarding } from '@/server/queries/onboarding';
import { landingFor, requireSession, teachingSchools } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('onboarding');
  return { title: t('title') };
}

/**
 * « Pour bien commencer » (DECISIONS D-109): the checklist « Aujourd'hui » shows until it is
 * hidden or done, always here. For teachers; anyone else goes to their own landing page.
 */
export default async function GettingStartedPage() {
  const session = await requireSession();
  if (teachingSchools(session).length === 0) redirect(landingFor(session));
  const t = await getTranslations('onboarding');
  const data = await loadTeacherOnboarding(session);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t('title')} />
      <TeacherChecklist data={data} variant="page" />
    </div>
  );
}
