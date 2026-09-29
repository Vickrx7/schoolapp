import { getTranslations } from 'next-intl/server';
import { adaptOffer } from '@/server/library/growth';
import type { LibraryItemView } from '@/server/library/view-model';
import { getSession, librarySchools } from '@/server/session';
import { RemixButton } from '../growth/remix-button';

export interface RemixSlotProps {
  item: LibraryItemView;
}

/**
 * « Adapter cette ressource » on the item page (DECISIONS D-092): a private copy with lineage and
 * credit, for items the user can use that are not archived and whose licence allows it (her own
 * only once approved: she edits the others). Rendered on the server in the item page's action
 * row, next to « Ajouter à ma planification », for teachers and direction of a library school of
 * the item's board. A resource whose licence forbids it says so instead: « Cette ressource ne
 * peut pas être adaptée (licence). » The database checks everything again.
 */
export async function RemixSlot({ item }: RemixSlotProps) {
  const session = await getSession();
  if (!session || !librarySchools(session).some((s) => s.boardId === item.boardId)) return null;
  // A colleague's resource shared with one school is usable by that school's staff only (a
  // reviewer may read it from elsewhere).
  if (
    !item.mine &&
    item.shareScope === 'school' &&
    !session.schools.some((s) => s.id === item.schoolId)
  ) {
    return null;
  }
  const offer = adaptOffer({
    status: item.status,
    shareScope: item.shareScope,
    mine: item.mine,
    canEdit: item.canEdit,
    noDerivatives: item.adaptation.noDerivatives,
  });
  if (!offer) return null;
  if (offer === 'licence') {
    const t = await getTranslations('libraryGrowth');
    return (
      <p className="flex min-h-11 items-center text-sm text-slate-600">{t('noDerivatives')}</p>
    );
  }
  // An adaptation of a colleague's resource shared with one school stays within that school.
  const capped =
    item.adaptation.shareCapSchoolId !== null ||
    (!item.mine && item.status === 'teacher_reviewed' && item.shareScope === 'school');
  return <RemixButton itemId={item.id} capped={capped} />;
}
