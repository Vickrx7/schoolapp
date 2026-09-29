import { describe, expect, it } from 'vitest';
import { rankTeams } from './ranking';

describe('team ranks (D-087)', () => {
  it('shares a rank between ties and gives no rank to a team without devices', () => {
    expect(rankTeams([{ score: 300 }, { score: 300 }, { score: 150 }, { score: null }])).toEqual([
      1,
      1,
      3,
      null,
    ]);
    expect(rankTeams([{ score: 0 }, { score: 0 }])).toEqual([1, 1]);
    expect(rankTeams([])).toEqual([]);
  });
});
