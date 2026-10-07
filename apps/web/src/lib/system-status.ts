/**
 * One line of « État du système » (DECISIONS D-112): `ok` (it ran recently), `scheduled` (it never
 * ran, and the database does not count that as a problem yet: a new install, before its first
 * night), or `problem`. « Jamais … normal » read as a contradiction on install day (Phase 6
 * review), so a component that has not run yet says when it will.
 */
export type SystemLineState = 'ok' | 'scheduled' | 'problem';

export function systemLineState(component: { ok: boolean; at: string | null }): SystemLineState {
  if (!component.ok) return 'problem';
  return component.at === null ? 'scheduled' : 'ok';
}
