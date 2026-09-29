/**
 * Database helpers of the library growth specs (Phase 5: adaptations and opinions, DECISIONS
 * D-092, D-093): seeded ids, opinion counts, and clean-up of what the specs add. As the database
 * owner (DATABASE_URL), like `db.ts`.
 */
import { query } from './db';

/** Seeded demo resources (UUIDv5 of `demo/<slug>`, content/library/demo). */
export const DEMO_ITEMS = {
  /** « Le huard, oiseau des lacs », board-approved, with 2 seeded opinions (Marc 5, Paul 4). */
  huard: { id: '3daed963-c2a5-568d-b23e-b38865b2b551', title: 'Le huard, oiseau des lacs' },
  /** « Ma première cabane à sucre », board-approved (3e année, Français). */
  cabane: { id: 'e7079a4b-eedf-5cee-8025-34e8174bc2bf', title: 'Ma première cabane à sucre' },
};

/** The title of the demo seed's content pack, which its resources credit (« ensemble »). */
export const DEMO_PACK_TITLE = 'Ressources de démonstration (à valider en classe)';

/** Marc Gagnon's seeded adaptation (supabase/seeds/40_library_growth_demo.sql): never deleted. */
const SEEDED_ADAPTATION = '40000000-0000-4000-8000-000000000001';

/** The number of opinions on a resource, leaving out one person's (by e-mail) when given. */
export async function opinionCount(itemId: string, exceptEmail: string | null = null) {
  const [row] = await query<{ n: number }>(
    `select count(*)::int as n from public.library_item_ratings r
     join public.users u on u.id = r.rater_id
     where r.item_id = $1 and ($2::text is null or u.email <> $2)`,
    [itemId, exceptEmail],
  );
  return row!.n;
}

/** Takes a person's opinion on a resource back (before and after a spec). */
export async function clearOpinion(itemId: string, email: string) {
  await query(
    `delete from public.library_item_ratings r using public.users u
     where r.rater_id = u.id and u.email = $2 and r.item_id = $1`,
    [itemId, email],
  );
}

/** Deletes a person's adaptations of a resource (not the seeded one). */
export async function deleteAdaptations(parentId: string, authorEmail: string) {
  await query(
    `delete from public.library_items i using public.users u
     where i.author_id = u.id and u.email = $2 and i.parent_item_id = $1 and i.id <> $3`,
    [parentId, authorEmail, SEEDED_ADAPTATION],
  );
}
