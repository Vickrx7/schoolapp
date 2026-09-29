import type { AttachTarget, LibraryCardView } from '@/server/library/view-model';
import { AttachToLessonButton } from '../attach-to-lesson-button';

/**
 * The actions of a result card (slice S6, D-076): « Joindre à cette leçon » when a resource is
 * being chosen for a lesson (`attachTo`, from Planification's « Joindre une ressource »).
 * Rendered by S4's `item-card.tsx`.
 */
export function CardActionsSlot({
  card,
  attachTo,
}: {
  card: LibraryCardView;
  attachTo: AttachTarget | null;
}) {
  if (!attachTo) return null;
  return <AttachToLessonButton itemId={card.id} itemTitle={card.title} target={attachTo} />;
}
