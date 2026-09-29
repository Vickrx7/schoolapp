import type { AttachTarget, LibraryCardView } from '@/server/library/view-model';

/**
 * The actions of a result card (slice S6): « Joindre à cette leçon » when a resource is being
 * chosen for a lesson (`attachTo`, from Planification's « Joindre une ressource »). Rendered by
 * S4's `item-card.tsx`. Returns nothing until S6 fills it.
 */
export function CardActionsSlot(_props: { card: LibraryCardView; attachTo: AttachTarget | null }) {
  return null;
}
