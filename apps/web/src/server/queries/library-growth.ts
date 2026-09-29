import 'server-only';
import { cache } from 'react';
import { reportError } from '../errors';
import { statsById, statsIds, type ItemStats } from '../library/growth';
import { lineageView, type LineageRow, type LineageView } from '../library/lineage-view';
import { createSupabaseServerClient } from '../supabase';

/**
 * Adaptations' credit lines, and opinions and usage (DECISIONS D-092, D-093). Everything is read
 * as the user: the database functions answer only about items the user can read (the credit
 * line) or use (the stats), name an original's author only when the user can use the original,
 * and never say who gave which opinion.
 */

/**
 * « Adaptée de « … » » of an item, or null when it is not an adaptation or cannot be read.
 * Cached per request (the item page and its editor's header ask for it).
 */
export const loadLineage = cache(async (itemId: string): Promise<LineageView | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('library_item_lineage', { p_item_id: itemId });
  if (error) {
    reportError('loadLineage', error);
    return null;
  }
  const row = data?.[0];
  if (!row) return null;
  // The function's columns are null whenever the original is not available (the generated
  // types say otherwise: they cannot know).
  const nullable = row as { [K in keyof typeof row]: (typeof row)[K] | null };
  const lineage: LineageRow = {
    parentId: nullable.parent_id,
    title: nullable.title,
    available: nullable.available === true,
    creditKind: nullable.credit_kind,
    creditName: nullable.credit_name,
    schoolName: nullable.school_name,
    packTitle: nullable.pack_title,
  };
  return lineageView(lineage);
});

/** Opinions and usage of a page of results, by item (items the user cannot use are absent). */
export async function loadCardStats(ids: readonly string[]): Promise<Map<string, ItemStats>> {
  const wanted = statsIds(ids);
  if (!wanted.length) return new Map();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('library_item_stats', { p_item_ids: wanted });
  if (error) {
    reportError('loadCardStats', error);
    return new Map();
  }
  return statsById(data);
}

/** Opinions and usage of one item (« Votre avis » on its page), or null. */
export async function loadItemStats(itemId: string): Promise<ItemStats | null> {
  return (await loadCardStats([itemId])).get(itemId) ?? null;
}
