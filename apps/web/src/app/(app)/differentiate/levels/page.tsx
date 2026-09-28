import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LevelsManager } from '@/components/differentiate/levels-manager';
import { PageHeader } from '@/components/ui/page';
import { loadLanguageLevels } from '@/server/queries/differentiate';
import { aiSchools, requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('levels');
  return { title: t('title') };
}

export default async function LevelsPage() {
  const session = await requireSession();
  const schools = aiSchools(session);
  if (schools.length === 0) redirect('/today');
  const t = await getTranslations();
  const levels = await loadLanguageLevels(await getLocale());
  const boardIds = new Set(schools.map((s) => s.boardId));

  return (
    <div>
      <PageHeader
        back={
          <Link
            href="/differentiate"
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {t('differentiate.title')}
          </Link>
        }
        title={t('levels.title')}
        subtitle={t('levels.intro')}
      />
      <LevelsManager
        boardLevels={levels.filter((l) => !l.personal && l.active)}
        personalLevels={levels.filter((l) => l.personal)}
        boards={session.boards
          .filter((b) => boardIds.has(b.id))
          .map((b) => ({ id: b.id, name: b.name }))}
      />
    </div>
  );
}
