/**
 * A school's AI state as staff should read it: the board's rule comes first (D-039), so a
 * school whose own switch is on is still "off" when its board forbids AI.
 */
export type AiStatus = 'on' | 'off' | 'boardOff';

export function aiStatus(school: { aiEnabled: boolean; boardAllows: boolean }): AiStatus {
  if (!school.boardAllows) return 'boardOff';
  return school.aiEnabled ? 'on' : 'off';
}
