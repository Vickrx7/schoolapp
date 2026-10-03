/**
 * Database helpers of the curriculum coverage specs (Phase 5, « Couverture du curriculum »,
 * DECISIONS D-094): a standard subject's id and an attente without approved resources, found the
 * way the page counts (`app.library_coverage_rows`, called as the database owner like `db.ts`).
 */
import { SEED, query } from './db';

/** A standard subject's id by its code (`mat`, `fra`, `sci`…). */
export async function subjectId(code: string): Promise<string> {
  const [row] = await query<{ id: string }>(
    'select id from public.subjects where code = $1 and board_id is null',
    [code],
  );
  if (!row) throw new Error(`no standard subject ${code}`);
  return row.id;
}

/**
 * The first attente (in curriculum order) of a grade and standard subject that the demo board
 * has no approved resource for and that the page counts (a specific attente, or an overall
 * attente without children): what « Aucune ressource approuvée » is shown for.
 */
export async function coverageGap(
  gradeCode: string,
  subjectCode: string,
): Promise<{ id: string; code: string }> {
  const [row] = await query<{ id: string; code: string }>(
    `select r.expectation_id as id, r.code
     from app.library_coverage_rows($1, $2, (select id from public.subjects
       where code = $3 and board_id is null)) r
     where r.approved_count = 0 and (r.kind = 'specific' or not r.has_children)
     order by r.sort_order, r.code
     limit 1`,
    [SEED.board, gradeCode, subjectCode],
  );
  if (!row) throw new Error(`every attente of ${gradeCode} ${subjectCode} has approved resources`);
  return row;
}
