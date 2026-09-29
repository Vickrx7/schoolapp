import { getFormatter, getTranslations } from 'next-intl/server';
import type { LibraryItemView } from '@/server/library/view-model';
import { loadPackProvenance } from '@/server/queries/library-packs';

export interface PackProvenanceSlotProps {
  item: LibraryItemView;
}

/**
 * Where an imported resource comes from (DECISIONS D-099, D-100, slice S7): « Éditeur déclaré :
 * IP Lynx · importé le 3 nov. 2026 · empreinte 3fa4c1d2e9b0 », under the provenance lines of
 * « Détails » (`item-details.tsx`), rendered on the server. The publisher is self-declared; the
 * fingerprint (the first 12 characters of the imported file's SHA-256) lets a reviewer check it
 * is the file the publisher sent. A pack loaded by a seed has no fingerprint; an item that did not
 * come from a pack shows nothing.
 */
export async function PackProvenanceSlot({ item }: PackProvenanceSlotProps) {
  if (!item.provenance.packTitle) return null;
  const view = await loadPackProvenance(item.id);
  if (!view) return null;
  const [t, format] = await Promise.all([getTranslations('libraryPacks'), getFormatter()]);
  const date = format.dateTime(new Date(view.importedAt), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return (
    <p className="mt-1 text-sm break-words text-slate-600">
      {view.fingerprint
        ? t('provenance', { publisher: view.publisher, date, hash: view.fingerprint })
        : t('provenanceWithoutFingerprint', { publisher: view.publisher, date })}
    </p>
  );
}
