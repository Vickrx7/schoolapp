/**
 * Team ranks for « Classement des équipes » (DECISIONS D-087), on the projector and the devices:
 * ties share a rank (1, 1, 3); a team without devices has no score, shows « — » and no rank. The
 * database already orders the teams (best first, then list order). Pure, so it is unit-tested.
 */
export interface ScoreRow {
  score: number | null;
}

export function rankTeams(scores: readonly ScoreRow[]): (number | null)[] {
  return scores.map((row) => {
    if (row.score === null) return null;
    const score = row.score;
    return 1 + scores.filter((other) => other.score !== null && other.score > score).length;
  });
}
