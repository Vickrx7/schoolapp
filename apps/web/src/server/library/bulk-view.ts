/**
 * The summary line of a bulk generation run in « Brouillons du conseil » (DECISIONS D-095):
 * « Lot du 3 novembre : 42 créées · 3 titres semblables · 2 échecs · 6,84 $ US sur 25 $ US », from
 * the run's report (`app.library_bulk_finish`). Pure, so it is unit-tested.
 */

export interface RunSummary {
  created: number;
  similarTitles: number;
  /** Every failed request, whatever its code. */
  failed: number;
  spentUsd: number;
  maxCostUsd: number;
}

const count = (value: unknown) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

/** The run's report as the summary line reads it; null until the run has ended (no report). */
export function runSummary(
  report: unknown,
  maxCostUsd: number,
  spentUsd: number,
): RunSummary | null {
  if (typeof report !== 'object' || report === null || Array.isArray(report)) return null;
  const r = report as Record<string, unknown>;
  const failed =
    typeof r.failed === 'object' && r.failed !== null
      ? Object.values(r.failed as Record<string, unknown>).reduce<number>((n, v) => n + count(v), 0)
      : 0;
  const spent = Number(r.spentUsd);
  return {
    created: count(r.created),
    similarTitles: count(r.similarTitles),
    failed,
    spentUsd: Number.isFinite(spent) && spent >= 0 ? spent : spentUsd,
    maxCostUsd,
  };
}
