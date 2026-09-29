import type { LibraryItemView } from '@/server/library/view-model';
import { getSession, teachingSchools } from '@/server/session';
import { PlanningDialog } from '../planning-dialog';

/**
 * « Ajouter à ma planification » on the item page (slice S6, D-076): attach a material to a
 * lesson, or add a lesson plan or project as a new lesson. Rendered on the server in the item
 * page's action row, next to « Imprimer » and the PDF slot. Offered to teachers (a class at a
 * school with the Teaching module) for items they can use: their own (not archived), and
 * reviewed or approved items shared with them. A reviewer reading an item that waits for review
 * cannot put it into a lesson (D-065); the database refuses it anyway.
 */
export async function PlanningSlot({ item }: { item: LibraryItemView }) {
  const session = await getSession();
  if (!session || !teachingSchools(session).length) return null;
  const usable =
    item.status !== 'archived' &&
    (item.mine ||
      ((item.status === 'teacher_reviewed' || item.status === 'board_approved') &&
        item.shareScope !== 'private'));
  if (!usable) return null;
  return <PlanningDialog itemId={item.id} itemType={item.type} />;
}
