import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { adminBoards, landingFor, requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('board');
  return { title: t('title') };
}

/**
 * « Administration du conseil » (DECISIONS D-107): the landing page of a board admin who neither
 * teaches nor directs (D-118). Phase 6's slice S4 builds it; until then this page leads to the
 * board's calendar.
 */
export default async function BoardPage() {
  const session = await requireSession();
  const boards = adminBoards(session);
  if (boards.length === 0) redirect(landingFor(session));
  const t = await getTranslations('board');
  const tNav = await getTranslations('nav');

  return (
    <div>
      <PageHeader title={t('title')} subtitle={boards.map((b) => b.name).join(' · ')} />
      <EmptyState
        title={t('placeholder')}
        action={
          <Button asChild variant="secondary">
            <Link href="/calendar">{tNav('calendar')}</Link>
          </Button>
        }
      />
    </div>
  );
}
