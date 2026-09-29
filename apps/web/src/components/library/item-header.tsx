import { ChevronLeft, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page';
import type { LibraryItemView } from '@/server/library/view-model';
import { ItemBadges } from './item-badges';

/**
 * The item page's header: title, type and category, who it comes from (« Mme Tremblay ·
 * É.É.C. Saint-Exemple », or « Ressource du conseil scolaire »), its badges with the workflow
 * status, and « Modifier » for the people who may edit it (the workflow buttons are the
 * workflow slot's).
 */
export function ItemHeader({
  item,
  back,
  editable = item.canEdit,
}: {
  item: LibraryItemView;
  /** Where « Retour » goes: the library (default), the results it was opened from… */
  back?: { href: string; label: string };
  /** « Modifier » (the library editor): not for a saved text outside the library. */
  editable?: boolean;
}) {
  const t = useTranslations('libraryItem');
  const tc = useTranslations('libraryCommon');
  const origin = item.boardOwn
    ? t('provenance.board')
    : [item.authorName, item.schoolName].filter(Boolean).join(' · ');

  return (
    <div className="space-y-3">
      <PageHeader
        back={
          <Link
            href={back?.href ?? '/library'}
            className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {back?.label ?? t('back')}
          </Link>
        }
        title={item.title}
        subtitle={
          <span className="flex flex-col gap-0.5">
            <span>
              {tc(`types.${item.type}`)} · {tc(`buckets.${item.bucket}`)}
            </span>
            {origin ? <span className="text-sm">{origin}</span> : null}
          </span>
        }
        actions={
          editable ? (
            <Button asChild variant="secondary">
              <Link href={`/library/items/${item.id}/edit`}>
                <Pencil aria-hidden />
                {t('actions.edit')}
              </Link>
            </Button>
          ) : null
        }
      />
      <ItemBadges
        withStatus
        input={{
          type: item.type,
          status: item.status,
          requested: item.requested,
          source: item.source,
          subFriendly: item.subFriendly,
          requiresFaithReview: item.faith.requiresReview,
          levelCount: item.versions.filter((v) => v.languageLevelId !== null).length,
        }}
      />
    </div>
  );
}
