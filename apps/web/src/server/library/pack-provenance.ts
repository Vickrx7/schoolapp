/**
 * Where an imported resource comes from (DECISIONS D-099, D-100): the content pack's declared
 * publisher, when it was imported and the first 12 characters of the file's SHA-256 (« empreinte
 * 3fa4c1d2e9b0 »), which a reviewer can compare with the one the publisher sent. The publisher is
 * self-declared: the fingerprint says which file this is, not who made it. Pure: the item page's
 * slot and the review queue's badge read their rows through row level security
 * (`server/queries/library-packs.ts`).
 */

/** How many characters of the file's SHA-256 the item page shows. */
export const FINGERPRINT_LENGTH = 12;

/** A content pack row as the item page reads it. */
export interface PackProvenanceRow {
  publisher: string | null;
  imported_at: string;
  file_sha256: string | null;
}

export interface PackProvenanceView {
  publisher: string;
  importedAt: string;
  /** Null for a pack loaded by a seed rather than imported from a file. */
  fingerprint: string | null;
}

/** The provenance line's values, or null when the pack names no publisher. */
export function packProvenanceView(row: PackProvenanceRow | null): PackProvenanceView | null {
  const publisher = row?.publisher?.trim();
  if (!row || !publisher) return null;
  const hash = row.file_sha256?.trim().toLowerCase() ?? '';
  return {
    publisher,
    importedAt: row.imported_at,
    fingerprint: /^[0-9a-f]{64}$/.test(hash) ? hash.slice(0, FINGERPRINT_LENGTH) : null,
  };
}

/** The review queue's « Ensemble : Ressources IP Lynx 2026.2 ». */
export interface PackLabel {
  title: string;
  version: string;
}

/** Each item's pack label, for the items that came from a pack. */
export function packLabelsById(
  rows: readonly { id: string; content_packs: PackLabel | null }[] | null,
): Map<string, PackLabel> {
  const labels = new Map<string, PackLabel>();
  for (const row of rows ?? []) {
    if (row.content_packs) {
      labels.set(row.id, { title: row.content_packs.title, version: row.content_packs.version });
    }
  }
  return labels;
}
