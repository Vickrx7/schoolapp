import type { LibraryItemView } from '@/server/library/view-model';

export interface ClassModeSlotProps {
  item: LibraryItemView;
  /** The version on screen: « Présenter » projects it (`?v=`), and the quiz dialog starts on it. */
  versionId: string;
}

/**
 * « Mode classe » on the item page (DECISIONS D-082): « Présenter à la classe » for the version
 * on screen (slice S2), then « Lancer un quiz sur les appareils » (slice S3). Rendered on the
 * server once per version, in the item page's action row next to the PDF slot, for library
 * users only. Renders nothing until those slices fill it.
 */
export function ClassModeSlot(_props: ClassModeSlotProps) {
  return null;
}
