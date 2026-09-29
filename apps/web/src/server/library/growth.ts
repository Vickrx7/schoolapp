/**
 * The small rules of adaptations and opinions on the library's screens (DECISIONS D-092, D-093):
 * who is offered « Adapter cette ressource » and « Votre avis », what the opinion line says, and
 * which sharing an adaptation still allows. The database decides in the end (every write is a
 * function that checks again); these only hide what would be refused. Pure, so they are
 * unit-tested and client components can use them.
 */
import type { LibraryItemStatus, ShareScope } from '@lynx/db';
import { z } from 'zod';

/** An average shows from this many opinions (below, only their number, D-093). */
export const MIN_OPINIONS_FOR_AVERAGE = 5;

/** At most this many items per `library_item_stats` call (a page of results). */
export const MAX_STATS_ITEMS = 50;

/** Opinions and usage of an item (`public.library_item_stats`). */
export interface ItemStats {
  /** Rounded to the half star (4.5); null below 5 opinions and for items not board-approved. */
  ratingAverage: number | null;
  /** Null for an item that is not board-approved: it takes no opinion. */
  ratingCount: number | null;
  /** The user's own stars (1 to 5), if she gave her opinion. */
  myRating: number | null;
  /** The number of units whose lessons link the item (« Utilisée dans 3 unités », D-076). */
  usageCount: number;
}

const count = z.number().int().nonnegative();

/** One row of `public.library_item_stats`, as PostgREST returns it. */
export const statsRowSchema = z.object({
  item_id: z.uuid(),
  rating_average: z.coerce.number().min(1).max(5).nullable(),
  rating_count: count.nullable(),
  my_rating: z.number().int().min(1).max(5).nullable(),
  usage_count: count,
});

/** The rows of `library_item_stats` by item id; rows that do not parse are left out. */
export function statsById(rows: readonly unknown[] | null | undefined): Map<string, ItemStats> {
  const out = new Map<string, ItemStats>();
  for (const raw of rows ?? []) {
    const row = statsRowSchema.safeParse(raw);
    if (!row.success) continue;
    out.set(row.data.item_id, {
      ratingAverage: row.data.rating_average,
      ratingCount: row.data.rating_count,
      myRating: row.data.my_rating,
      usageCount: row.data.usage_count,
    });
  }
  return out;
}

/** What the opinion line says: « 4,5 sur 5 (7 avis) », « 3 avis : pas encore assez… », or none. */
export type OpinionSummary =
  | { kind: 'average'; average: number; count: number }
  | { kind: 'notEnough'; count: number }
  | { kind: 'none' };

/** Null for an item that takes no opinion (not board-approved). */
export function opinionSummary(
  stats: Pick<ItemStats, 'ratingAverage' | 'ratingCount'> | null | undefined,
): OpinionSummary | null {
  if (!stats || stats.ratingCount === null) return null;
  if (stats.ratingCount === 0) return { kind: 'none' };
  if (stats.ratingCount >= MIN_OPINIONS_FOR_AVERAGE && stats.ratingAverage !== null) {
    return { kind: 'average', average: stats.ratingAverage, count: stats.ratingCount };
  }
  return { kind: 'notEnough', count: stats.ratingCount };
}

/** The stars of an average, for the icons: 4.5 → 4 full and 1 half. */
export function starFill(average: number): ('full' | 'half' | 'empty')[] {
  const halves = Math.round(Math.min(Math.max(average, 0), 5) * 2);
  return [1, 2, 3, 4, 5].map((n) =>
    halves >= n * 2 ? 'full' : halves === n * 2 - 1 ? 'half' : 'empty',
  );
}

export interface GrowthItem {
  status: LibraryItemStatus;
  shareScope: ShareScope;
  /** The user wrote it. */
  mine: boolean;
  /** The user may edit it (a draft, reviewed or sent back of hers). */
  canEdit: boolean;
  noDerivatives: boolean;
}

/**
 * Whether the item can be used by the user (the rule of `app.library_item_usable_by` on what the
 * page shows): her own, or reviewed or approved and shared with her.
 */
export function usableItem(item: Pick<GrowthItem, 'status' | 'shareScope' | 'mine'>): boolean {
  return (
    item.mine ||
    ((item.status === 'teacher_reviewed' || item.status === 'board_approved') &&
      item.shareScope !== 'private')
  );
}

/**
 * « Adapter cette ressource » (D-092): offered on items the user can use that are not archived;
 * on her own items only once approved (the others she edits directly). `licence` when the
 * licence forbids it: the page says so instead of offering it.
 */
export function adaptOffer(item: GrowthItem): 'offer' | 'licence' | null {
  if (item.status === 'archived' || !usableItem(item)) return null;
  if (item.mine && item.canEdit) return null;
  return item.noDerivatives ? 'licence' : 'offer';
}

/**
 * « Votre avis » (D-093): board-approved items the user can use and did not write. The board's
 * own items have no author: everyone may give an opinion.
 */
export function canGiveOpinion(item: Pick<GrowthItem, 'status' | 'mine'>): boolean {
  return item.status === 'board_approved' && !item.mine;
}

/**
 * The sharing an item still allows (the share dialog's choices): an adaptation capped to one
 * school may be private or shared with that school only; anything else, as before.
 */
export function allowedScopes(capSchoolId: string | null): {
  scopes: ShareScope[];
  schoolIds: string[] | null;
} {
  return capSchoolId
    ? { scopes: ['private', 'school'], schoolIds: [capSchoolId] }
    : { scopes: ['private', 'school', 'board'], schoolIds: null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A random (version 4) UUID for a new resource, chosen by the browser so a request sent again
 * makes nothing twice; also on plain-http origins, where `crypto.randomUUID` is missing.
 */
export function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The item ids of a page of results for one stats call: well-formed, once each, 50 at most. */
export function statsIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => UUID.test(id)))].slice(0, MAX_STATS_ITEMS);
}
