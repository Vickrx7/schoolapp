'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import { librarySchools, requireSession, showLibrary } from '../session';
import { createSupabaseServerClient } from '../supabase';

/**
 * « Adapter cette ressource » and « Votre avis » (DECISIONS D-092, D-093). The database decides
 * everything (`remix_library_item`, `rate_library_item` check who may, the licence, the status and
 * the author); these actions check the arguments and the Library module (D-078). Refusals come
 * back as LXM01 (archived), LXM02 (licence), LXR01 (one's own resource) and LXR02 (not
 * board-approved); LXM03 (sharing wider than the original) comes from any sharing path.
 */

const uuid = z.uuid();
const ratingSchema = z.number().int().min(1).max(5).nullable();

/**
 * « Adapter cette ressource »: a private copy of the resource, credited to it. `newId` is the
 * copy's id, chosen by the browser once per dialog, so a request sent again (a lost answer, a
 * double tap) returns the same copy. The browser then opens the copy in the editor.
 */
export async function remixItem(
  itemId: string,
  newId: string,
): Promise<ActionResult<{ itemId: string }>> {
  const session = await requireSession();
  // New resources are written by teachers and direction of a library school (D-078).
  if (!librarySchools(session).length) return fail('forbidden');
  if (!uuid.safeParse(itemId).success || !uuid.safeParse(newId).success || itemId === newId) {
    return fail('invalid');
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('remix_library_item', {
    p_item_id: itemId,
    p_new_id: newId,
  });
  if (error) return fail(reportError('remixItem', error));
  if (!data) return fail('unexpected');
  revalidatePath('/library/mine');
  revalidatePath('/library');
  return ok({ itemId: data });
}

/** « Votre avis »: 1 to 5 stars, or null to take one's opinion back (« Retirer mon avis »). */
export async function rateItem(itemId: string, rating: number | null): Promise<ActionResult> {
  const session = await requireSession();
  if (!showLibrary(session)) return fail('forbidden');
  if (!uuid.safeParse(itemId).success || !ratingSchema.safeParse(rating).success) {
    return fail('invalid');
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('rate_library_item', {
    p_item_id: itemId,
    // A null rating takes the opinion back (the generated types cannot say it is nullable).
    p_rating: rating as number,
  });
  if (error) return fail(reportError('rateItem', error));
  revalidatePath(`/library/items/${itemId}`);
  revalidatePath('/library');
  return okVoid();
}
