import type { LibraryItemView } from '@/server/library/view-model';

export interface PackProvenanceSlotProps {
  item: LibraryItemView;
}

/**
 * Where an imported resource comes from (DECISIONS D-099, D-100, slice S7): « Éditeur déclaré :
 * IP Lynx · importé le … · empreinte 3fa4c1d2e9b0 ». Rendered on the server in « Détails »
 * (`item-details.tsx`), under the provenance lines. Renders nothing until S7 fills it.
 */
export function PackProvenanceSlot(_props: PackProvenanceSlotProps) {
  return null;
}
