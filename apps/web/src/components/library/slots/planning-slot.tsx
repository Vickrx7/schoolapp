import type { LibraryItemView } from '@/server/library/view-model';

/**
 * « Ajouter à ma planification » on the item page (slice S6, D-076): attach a material to a
 * lesson, or add a lesson plan or project as a new lesson. Rendered on the server in the item
 * page's action row, next to « Imprimer » and the PDF slot; only items the user can use may be
 * linked. Returns nothing until S6 fills it.
 */
export function PlanningSlot(_props: { item: LibraryItemView }) {
  return null;
}
