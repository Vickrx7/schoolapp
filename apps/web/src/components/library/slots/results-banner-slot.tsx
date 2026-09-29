import type { AttachTarget } from '@/server/library/view-model';

/**
 * The banner above the results while a resource is being chosen for a lesson (slice S6):
 * « Vous choisissez une ressource pour la leçon 4 « Trouver l’idée principale » ». Rendered by
 * S4's results page. Returns nothing until S6 fills it.
 */
export function ResultsBannerSlot(_props: { attachTo: AttachTarget | null }) {
  return null;
}
