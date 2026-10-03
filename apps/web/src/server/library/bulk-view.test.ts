import { describe, expect, it } from 'vitest';
import { runSummary } from './bulk-view';

describe('runSummary', () => {
  it('reads the report of an ended run', () => {
    expect(
      runSummary(
        {
          requests: 50,
          created: 42,
          similarTitles: 3,
          skipped: { covered: 6, costCap: 0, cancelled: 0 },
          failed: { aiRefused: 1, invalidOutput: 1 },
          spentUsd: 6.84,
          worstCaseUsd: 24.1,
          maxCostUsd: 25,
        },
        25,
        6.84,
      ),
    ).toEqual({ created: 42, similarTitles: 3, failed: 2, spentUsd: 6.84, maxCostUsd: 25 });
  });

  it('has no summary until the run has ended', () => {
    expect(runSummary(null, 25, 0)).toBeNull();
    expect(runSummary([], 25, 0)).toBeNull();
  });

  it('reads anything unexpected as zero, and falls back to what the run spent', () => {
    expect(
      runSummary(
        { created: -1, similarTitles: 'x', failed: { a: 2, b: 'y' }, spentUsd: 'z' },
        5,
        1.5,
      ),
    ).toEqual({ created: 0, similarTitles: 0, failed: 2, spentUsd: 1.5, maxCostUsd: 5 });
  });
});
