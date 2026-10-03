/**
 * The curriculum's attentes by domaine, in the curriculum's order (DECISIONS D-094, D-125): each
 * overall attente followed by its specific attentes (contenus d'apprentissage), the domaines in
 * their order, then the attentes without a known domaine. Shared by « Couverture du curriculum »
 * (the library, `library/coverage-view.ts`) and a class's « Couverture des attentes »
 * (`planning/coverage-view.ts`), so both list the curriculum the same way.
 *
 * Pure and imported relatively (no `@/` alias), so the lists that use it are drawn in unit tests.
 */

/** What grouping needs of an attente. */
export interface CurriculumRow {
  expectationId: string;
  parentId: string | null;
  strandId: string | null;
  kind: 'overall' | 'specific';
  code: string;
  sortOrder: number;
}

/** A domaine of the subject (`strands`). */
export interface CurriculumStrand {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
}

/** An overall attente with its specific attentes, or an attente on its own. */
export interface DomaineEntry<E> {
  expectation: E;
  children: E[];
}

export interface DomaineGroup<E, S> {
  /** Null for attentes without a known domaine (listed last). */
  strand: S | null;
  entries: DomaineEntry<E>[];
}

/** The curriculum's order: `sort_order`, then the code (« B1.2 » before « B1.10 »), then the id. */
export const byCurriculumOrder = (a: CurriculumRow, b: CurriculumRow): number =>
  a.sortOrder - b.sortOrder ||
  a.code.localeCompare(b.code, 'fr', { numeric: true }) ||
  (a.expectationId < b.expectationId ? -1 : a.expectationId > b.expectationId ? 1 : 0);

/**
 * The attentes by domaine (in the domaines' order, then those without one), each overall attente
 * followed by its specific attentes, all in curriculum order. A specific attente whose overall
 * attente is not among `rows` stands on its own. Every domaine with an attente is listed.
 */
export function groupExpectationsByDomaine<E extends CurriculumRow, S extends CurriculumStrand>(
  rows: readonly E[],
  strands: readonly S[],
): DomaineGroup<E, S>[] {
  const all = [...rows].sort(byCurriculumOrder);
  const byId = new Map(all.map((e) => [e.expectationId, e]));

  // Specific attentes go under their overall attente when it is listed; the rest stand alone.
  const childrenOf = new Map<string, E[]>();
  const tops: E[] = [];
  for (const e of all) {
    const parent = e.parentId ? byId.get(e.parentId) : undefined;
    if (e.kind === 'specific' && parent && parent.kind === 'overall') {
      childrenOf.set(parent.expectationId, [...(childrenOf.get(parent.expectationId) ?? []), e]);
    } else {
      tops.push(e);
    }
  }

  const strandById = new Map(strands.map((s) => [s.id, s]));
  const groups = new Map<string | null, DomaineGroup<E, S>>();
  for (const top of tops) {
    const strand = (top.strandId && strandById.get(top.strandId)) || null;
    const key = strand?.id ?? null;
    let group = groups.get(key);
    if (!group) {
      group = { strand, entries: [] };
      groups.set(key, group);
    }
    group.entries.push({ expectation: top, children: childrenOf.get(top.expectationId) ?? [] });
  }

  return [...groups.values()].sort((a, b) => {
    if (!a.strand || !b.strand) return a.strand ? -1 : b.strand ? 1 : 0;
    return (
      a.strand.sortOrder - b.strand.sortOrder ||
      a.strand.code.localeCompare(b.strand.code, 'fr', { numeric: true })
    );
  });
}
