import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/ui/page';
import {
  directionSchools,
  landingFor,
  requireSession,
  substituteBoardSchools,
} from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('direction');
  return { title: t('title') };
}

/**
 * « Tableau de bord de la direction » (DECISIONS D-102): the landing page of a principal or
 * vice-principal who does not teach (D-118). Phase 6's slice S5 builds the dashboard; until then
 * this page leads to what the direction already has.
 */
export default async function DirectionPage() {
  const session = await requireSession();
  const schools = directionSchools(session);
  if (schools.length === 0) redirect(landingFor(session));
  const t = await getTranslations('direction');
  const tNav = await getTranslations('nav');

  return (
    <div>
      <PageHeader title={t('title')} subtitle={schools.map((s) => s.name).join(' · ')} />
      <EmptyState
        title={t('placeholder')}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {substituteBoardSchools(session).length > 0 ? (
              <Button asChild variant="secondary">
                <Link href="/absences">{tNav('substitutes')}</Link>
              </Button>
            ) : null}
            <Button asChild variant="secondary">
              <Link href="/school">{tNav('school')}</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
