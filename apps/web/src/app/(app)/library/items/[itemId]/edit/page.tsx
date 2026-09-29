import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ItemEditor } from '@/components/library/editor/item-editor';
import { PageHeader } from '@/components/ui/page';
import { editorFormFromItem } from '@/server/library/editor-form';
import { loadItemKeys, loadLibraryItem } from '@/server/queries/library';
import { loadEditorContext } from '@/server/queries/library-authoring';
import { requireSession, showLibrary } from '@/server/session';

type Props = { params: Promise<{ itemId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('libraryEdit');
  return { title: t('editTitle') };
}

/**
 * « Modifier la ressource » (DECISIONS D-063, D-065): for the people who may edit the item (its
 * author, or a content reviewer for the board's own items) while it is a draft, reviewed or sent
 * back; not found for everyone else and for approved items (read-only, D-063).
 */
export default async function EditLibraryItemPage({ params }: Props) {
  const session = await requireSession();
  if (!showLibrary(session)) notFound();
  const { itemId } = await params;
  if (!z.uuid().safeParse(itemId).success) notFound();
  const locale = await getLocale();
  const item = await loadLibraryItem(itemId, session, locale);
  if (!item || !item.canEdit) notFound();
  const [t, keys] = await Promise.all([
    getTranslations('libraryEdit'),
    loadItemKeys(
      item.id,
      item.versions.map((v) => v.id),
    ),
  ]);
  const initial = editorFormFromItem(item, keys);
  const context = await loadEditorContext(session, locale, {
    boardId: item.boardId,
    gradeCodes: initial.gradeCodes,
    subjectId: initial.subjectId,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        back={
          <Link
            href={`/library/items/${item.id}`}
            className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {t('backToItem')}
          </Link>
        }
        title={t('editTitle')}
        subtitle={item.title}
      />
      <ItemEditor
        mode="edit"
        itemId={item.id}
        contentRevision={item.contentRevision}
        initial={initial}
        context={context}
        status={item.status}
        shared={item.shareScope !== 'private'}
        faithFlagged={item.review?.faithFlagged ?? false}
      />
    </div>
  );
}
