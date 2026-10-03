import { describe, expect, it } from 'vitest';
import { fetchAllRows, ROW_PAGE } from './fetch-all';

/** A table behind PostgREST's cap: a range, cut to `cap` rows, as `max_rows` does. */
function cappedTable(rows: number, cap = ROW_PAGE) {
  const table = Array.from({ length: rows }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: table.slice(from, Math.min(to + 1, from + cap)), error: null };
  };
  return { table, calls, page };
}

describe('fetchAllRows: reads past PostgREST’s 1,000-row cap (post-MVP review)', () => {
  it('reads every row, page by page', async () => {
    const t = cappedTable(2_500);
    const result = await fetchAllRows(t.page);
    expect(result.data).toHaveLength(2_500);
    expect(result.data?.map((r) => r.id)).toEqual(t.table.map((r) => r.id));
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('stops after a short page, and reads an exact multiple with one empty page', async () => {
    expect((await fetchAllRows(cappedTable(10).page)).data).toHaveLength(10);
    const exact = cappedTable(2_000);
    expect((await fetchAllRows(exact.page)).data).toHaveLength(2_000);
    expect(exact.calls).toHaveLength(3);
    expect((await fetchAllRows(cappedTable(0).page)).data).toEqual([]);
  });

  it('returns the first error and no rows', async () => {
    let n = 0;
    const result = await fetchAllRows(async () =>
      n++ === 0
        ? { data: Array.from({ length: ROW_PAGE }, (_, i) => i), error: null }
        : { data: null, error: { code: '42501' } },
    );
    expect(result).toEqual({ data: null, error: { code: '42501' } });
  });

  it('is what one capped request is not: a single read stops at the cap', async () => {
    const t = cappedTable(1_500);
    expect((await t.page(0, 4_999)).data).toHaveLength(ROW_PAGE);
    expect((await fetchAllRows(t.page)).data).toHaveLength(1_500);
  });
});
