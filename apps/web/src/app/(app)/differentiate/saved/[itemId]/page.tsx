import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ResultEditor } from '@/components/differentiate/result-editor';
import { Badge } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { loadSavedText } from '@/server/queries/differentiate';
import { requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('differentiate');
  return { title: t('saved') };
}

export default async function SavedDifferentiationPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const session = await requireSession();
  const { itemId } = await params;
  if (!z.uuid().safeParse(itemId).success) notFound();
  const locale = await getLocale();
  const item = await loadSavedText(itemId, locale);
  if (!item) notFound();
  const t = await getTranslations('differentiate');

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <PageHeader
          back={
            <Link
              href="/differentiate"
              className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
            >
              <ChevronLeft className="size-4" aria-hidden />
              {t('title')}
            </Link>
          }
          title={item.title}
          actions={<Badge>{t('draftLabel')}</Badge>}
        />
      </div>
      <ResultEditor
        mode="saved"
        id={item.id}
        userId={session.userId}
        version={item.version}
        initial={{
          title: item.title,
          objective: item.objective,
          versions: item.versions.map((v) => ({
            languageLevelId: v.languageLevelId,
            levelLabel: v.levelLabel,
            title: v.content.title,
            text: v.content.text,
            glossary: v.content.glossary ?? [],
            visualSupports: v.content.visualSupports ?? [],
            questions: v.content.questions ?? [],
            teacherNote: v.content.teacherNote ?? '',
          })),
        }}
      />
    </div>
  );
}
