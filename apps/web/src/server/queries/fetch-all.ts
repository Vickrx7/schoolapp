/**
 * Every row of a read that can pass PostgREST's cap (`max_rows`: 1,000 on hosted Supabase, in
 * supabase/config.toml, in the board-hosted compose and in the lite stack): a class's lesson
 * progress passes 1,000 rows in the spring, a board's calendar can too. PostgREST cuts such an
 * answer silently, and a `.limit()` above the cap does not raise it (post-MVP review), so these
 * reads go page by page, on a stable order. Pure (no Supabase import), so it is unit tested with
 * a capped fake.
 */

/** PostgREST answers at most this many rows at a time. */
export const ROW_PAGE = 1000;

/** At most this many pages (100,000 rows): far more than any class or board holds. */
const MAX_PAGES = 100;

type PageResult<T, E> = { data: T[] | null; error: E | null };

/**
 * The rows of every page. `page(from, to)` must order the rows on a unique key (or end its order
 * with one: `.order('starts_on').order('id')`) and take `.range(from, to)`. The first error stops
 * the read and is returned (no rows: a partial list would be wrong without a word).
 */
export async function fetchAllRows<T, E>(
  page: (from: number, to: number) => PromiseLike<PageResult<T, E>>,
): Promise<{ data: T[]; error: null } | { data: null; error: E }> {
  const rows: T[] = [];
  for (let n = 0; n < MAX_PAGES; n++) {
    const from = n * ROW_PAGE;
    const { data, error } = await page(from, from + ROW_PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < ROW_PAGE) break;
  }
  return { data: rows, error: null };
}
