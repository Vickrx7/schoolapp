import { Presentation } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { isPresentable, presenterHref } from '@/server/class-mode/presenter';
import type { LibraryItemView } from '@/server/library/view-model';
import { getSession, librarySchools } from '@/server/session';

export interface ClassModeSlotProps {
  item: LibraryItemView;
  /** The version on screen: « Présenter » projects it (`?v=`), and the quiz dialog starts on it. */
  versionId: string;
}

/**
 * « Mode classe » on the item page (DECISIONS D-082): « Présenter à la classe » for the version
 * on screen (slice S2), then « Lancer un quiz sur les appareils » (slice S3). Rendered on the
 * server once per version, in the item page's action row next to the PDF slot, for library
 * users only.
 *
 * « Présenter à la classe » opens the projector page on that version (`/projector/items/<id>?v=`)
 * for teachers and direction at a school with the Library module, when the item can be used in
 * class and has a player (quizzes, exit tickets, games, brain breaks, experiments) or is marked
 * projectable (`isPresentable`, which the page checks again).
 *
 * A plain link, not `next/link`: the projector opens as a new document. After a client-side
 * navigation the tab would keep the item page's server payload (its inline scripts and the
 * router cache), which holds the « Guide et corrigé », the teacher's note and the safety notes;
 * a new document holds only the slides.
 */
export async function ClassModeSlot({ item, versionId }: ClassModeSlotProps) {
  const session = await getSession();
  if (!session || !librarySchools(session).length) return null;
  const presentable = isPresentable({
    type: item.type,
    projectable: item.formats.projectable,
    status: item.status,
    shareScope: item.shareScope,
    mine: item.mine,
  });
  if (!presentable) return null;
  const t = await getTranslations('classPresenter');
  return (
    <Button asChild variant="secondary">
      <a href={presenterHref(item.id, versionId)}>
        <Presentation aria-hidden />
        {t('present')}
      </a>
    </Button>
  );
}
