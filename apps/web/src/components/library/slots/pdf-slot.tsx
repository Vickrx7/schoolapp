import type { LibraryItemView } from '@/server/library/view-model';

/**
 * « Télécharger le PDF » (slice S7, D-075): a plain `<a>` to `/library/items/<id>/pdf?doc&v`
 * (never prefetched). Rendered on the server once per version on the item page (in the action
 * row, for the version on screen: `versionIds` is that one version) and once on the print page
 * (the versions chosen there, in version order). Messages: `libraryItem.pdf.*`. Returns nothing
 * until S7 fills it.
 */
export function PdfSlot(_props: { item: LibraryItemView; versionIds: string[] }) {
  return null;
}
