/**
 * The credit line of an adaptation (« Adapter », Phase 5 plan, decision P-11): « Adaptée de
 * « … » » plus who made the original, read live from `public.library_item_lineage` (direct
 * parent only; names are never stored in the copy):
 *
 * - « par Mme Tremblay (É.É.C. Saint-Exemple) » for a teacher's resource the viewer can use (the
 *   school only when the original is school-scoped);
 * - « (Conseil scolaire) » for the board's own resources;
 * - the pack's title for a resource from a content pack;
 * - « (ressource d’origine non disponible) » when the viewer cannot use the original (it was
 *   archived, unshared or deleted): only the title copied at adaptation time is shown, with no
 *   link and no name.
 *
 * Pure so it is unit-tested. The screens translate the keys below in the `libraryGrowth`
 * namespace, which slice S0/S4 owns in `messages/*.json`. Proposed strings for the integrator
 * (each credit reads after `basedOn`, separated by a space):
 *
 *   key               fr-CA                                     en-CA
 *   basedOn           Adaptée de « {title} »                    Adapted from “{title}”
 *   basedOnUntitled   Adaptée d’une autre ressource             Adapted from another resource
 *   by                par {name}                                by {name}
 *   byAtSchool        par {name} ({school})                     by {name} ({school})
 *   board             (Conseil scolaire)                        (school board)
 *   pack              (ensemble « {title} »)                    (pack “{title}”)
 *   unavailable       (ressource d’origine non disponible)      (original resource not available)
 *
 * Differences from the plan's G4 list, for the integrator to confirm: `basedOnUntitled` (an item
 * adapted before Phase 5 may have no copied title) and `byAtSchool` (P-11 shows the school, `by`
 * has no placeholder for it) are new; `board` and `pack` carry parentheses like `unavailable`
 * and the example « Adaptée de « … » (Conseil scolaire) » (A1.7); `pack` says « ensemble », the
 * word the item page's provenance already uses for content packs (the plan says « Paquet »).
 */

/** The messages namespace of the keys below. */
export const LINEAGE_MESSAGES_NAMESPACE = 'libraryGrowth';

export const LINEAGE_MESSAGE_KEYS = [
  'basedOn',
  'basedOnUntitled',
  'by',
  'byAtSchool',
  'board',
  'pack',
  'unavailable',
] as const;
export type LineageMessageKey = (typeof LINEAGE_MESSAGE_KEYS)[number];

/** The row of `public.library_item_lineage`, as the query maps it. */
export interface LineageRow {
  /** Null when the original is not available to the viewer. */
  parentId: string | null;
  /** The original's title, or the title copied at adaptation time when it is not available. */
  title: string | null;
  /** The viewer can use the original (`app.library_item_usable_by`). */
  available: boolean;
  /** 'author', 'board' or 'pack' (text in the database: anything else names no one). */
  creditKind: string | null;
  /** « Mme Tremblay » (`app.formal_staff_name`), for `author`. */
  creditName: string | null;
  /** The school's short name, for an author's school-scoped original. */
  schoolName: string | null;
  packTitle: string | null;
}

export type LineageMessage =
  | { key: 'basedOn'; values: { title: string } }
  | { key: 'basedOnUntitled'; values?: undefined }
  | { key: 'by'; values: { name: string } }
  | { key: 'byAtSchool'; values: { name: string; school: string } }
  | { key: 'board'; values?: undefined }
  | { key: 'pack'; values: { title: string } }
  | { key: 'unavailable'; values?: undefined };

export interface LineageView {
  /** « Adaptée de « … » ». */
  basedOn: LineageMessage;
  /** The original's page, only when the viewer can use it. */
  href: string | null;
  /** Who made the original; null when there is no one to name. */
  credit: LineageMessage | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clean = (value: string | null | undefined) => value?.trim() || null;

function credit(row: LineageRow): LineageMessage | null {
  if (!row.available) return { key: 'unavailable' };
  switch (row.creditKind) {
    case 'author': {
      const name = clean(row.creditName);
      if (!name) return null;
      const school = clean(row.schoolName);
      return school
        ? { key: 'byAtSchool', values: { name, school } }
        : { key: 'by', values: { name } };
    }
    case 'board':
      return { key: 'board' };
    case 'pack': {
      const title = clean(row.packTitle);
      return title ? { key: 'pack', values: { title } } : null;
    }
    default:
      return null;
  }
}

/** The credit line of an item, or null when it is not an adaptation (no lineage row). */
export function lineageView(row: LineageRow | null | undefined): LineageView | null {
  if (!row) return null;
  const title = clean(row.title);
  const parentId = row.available && row.parentId && UUID.test(row.parentId) ? row.parentId : null;
  return {
    basedOn: title ? { key: 'basedOn', values: { title } } : { key: 'basedOnUntitled' },
    href: parentId ? `/library/items/${parentId}` : null,
    credit: credit(row),
  };
}
