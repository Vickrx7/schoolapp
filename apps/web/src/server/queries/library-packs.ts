import 'server-only';
import { cache } from 'react';
import { reportError } from '../errors';
import {
  packLabelsById,
  packProvenanceView,
  type PackLabel,
  type PackProvenanceView,
} from '../library/pack-provenance';
import { createSupabaseServerClient } from '../supabase';

/**
 * Content packs on the library's screens (DECISIONS D-099, D-100). Read as the user: row level
 * security decides which items are readable, and a pack row is readable by its board's staff.
 * Packs themselves are imported and exported by the operator's CLI only.
 */

/**
 * « Éditeur déclaré : IP Lynx · importé le … · empreinte 3fa4c1d2e9b0 » for an item that came
 * from a content pack, or null. Cached per request.
 */
export const loadPackProvenance = cache(
  async (itemId: string): Promise<PackProvenanceView | null> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('library_items')
      .select('content_packs(publisher, imported_at, file_sha256)')
      .eq('id', itemId)
      .maybeSingle();
    if (error) {
      reportError('loadPackProvenance', error);
      return null;
    }
    return packProvenanceView(data?.content_packs ?? null);
  },
);

/** The pack (title and version) of each item that came from one, e.g. for the review queue. */
export async function loadPackLabels(itemIds: readonly string[]): Promise<Map<string, PackLabel>> {
  if (!itemIds.length) return new Map();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('library_items')
    .select('id, content_packs(title, version)')
    .in('id', [...itemIds])
    .not('content_pack_id', 'is', null);
  if (error) {
    reportError('loadPackLabels', error);
    return new Map();
  }
  return packLabelsById(data);
}
