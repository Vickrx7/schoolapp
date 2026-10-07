/**
 * « Parcourir le curriculum » (DECISIONS D-069): the attentes of a grade and subject grouped by
 * domaine, each overall attente followed by its specific attentes, with the number of resources
 * the user can use for each (`public.library_expectation_counts`). Pure: no server-only import,
 * so the grouping is unit-tested. Loaded by `server/queries/library-search.ts`.
 */

export interface CurriculumExpectationView {
  id: string;
  code: string;
  kind: 'overall' | 'specific';
  /** In the interface language when the curriculum has it (staff-typed text shown as is). */
  text: string;
  /** « À vérifier » while false (D-030). */
  verified: boolean;
  /** Resources the user can use for it, and how many are board-approved. */
  itemCount: number;
  approvedCount: number;
  /** An overall attente's specific attentes (« contenus d’apprentissage »), in order. */
  children: CurriculumExpectationView[];
}

export interface CurriculumStrandView {
  /** Null for attentes that belong to no domaine (shown last). */
  id: string | null;
  code: string | null;
  label: string | null;
  /** Overall attentes with their specific ones, then specific attentes whose parent is elsewhere. */
  expectations: CurriculumExpectationView[];
}

export interface StrandRow {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
}

export interface ExpectationRow {
  id: string;
  strandId: string | null;
  parentId: string | null;
  kind: 'overall' | 'specific';
  code: string;
  text: string;
  verified: boolean;
  sortOrder: number;
}

export type ExpectationCounts = ReadonlyMap<string, { itemCount: number; approvedCount: number }>;

const byOrder = (a: { sortOrder: number; code: string }, b: { sortOrder: number; code: string }) =>
  a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'fr-CA', { numeric: true });

/**
 * Groups attentes by domaine: domaines in their order (only those with attentes for this grade),
 * attentes without a domaine last; in each, overall attentes in order, each followed by its
 * specific attentes, and specific attentes whose overall attente is not in the list at the end.
 */
export function buildCurriculumTree(
  strands: readonly StrandRow[],
  expectations: readonly ExpectationRow[],
  counts: ExpectationCounts,
): CurriculumStrandView[] {
  const known = new Set(expectations.map((e) => e.id));
  const view = (e: ExpectationRow): CurriculumExpectationView => ({
    id: e.id,
    code: e.code,
    kind: e.kind,
    text: e.text,
    verified: e.verified,
    itemCount: counts.get(e.id)?.itemCount ?? 0,
    approvedCount: counts.get(e.id)?.approvedCount ?? 0,
    children: expectations
      .filter((c) => c.parentId === e.id)
      .sort(byOrder)
      .map((c) => ({
        id: c.id,
        code: c.code,
        kind: c.kind,
        text: c.text,
        verified: c.verified,
        itemCount: counts.get(c.id)?.itemCount ?? 0,
        approvedCount: counts.get(c.id)?.approvedCount ?? 0,
        children: [],
      })),
  });
  const group = (strandId: string | null) => {
    const own = expectations.filter((e) => e.strandId === strandId);
    const tops = own.filter((e) => e.parentId === null || !known.has(e.parentId)).sort(byOrder);
    // A specific attente is shown under its overall attente, even from another domaine.
    return tops.map(view);
  };
  const grouped: CurriculumStrandView[] = [...strands]
    .sort(byOrder)
    .map((s) => ({ id: s.id, code: s.code, label: s.label, expectations: group(s.id) }))
    .filter((s) => s.expectations.length > 0);
  const knownStrands = new Set(strands.map((s) => s.id));
  const loose = expectations.filter(
    (e) =>
      (e.strandId === null || !knownStrands.has(e.strandId)) &&
      (e.parentId === null || !known.has(e.parentId)),
  );
  if (loose.length) {
    grouped.push({
      id: null,
      code: null,
      label: null,
      expectations: [...loose].sort(byOrder).map(view),
    });
  }
  return grouped;
}
