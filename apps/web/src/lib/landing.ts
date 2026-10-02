/**
 * Where a signed-in person lands (DECISIONS D-118): after signing in, and from « Aujourd'hui »
 * (`/today`) when they do not teach. Pure, so the rule is unit-tested; `landingFor(session)` in
 * `server/session.ts` gathers the facts.
 *
 * Each page here lets in exactly the people sent to it, so no redirect loops: « Aujourd'hui »
 * needs a teaching school, « Direction » a principal or vice-principal role, « Suppléances » a
 * school with the Teaching module where the person is office (or direction) staff, « Conseil » a
 * board the person administers; « Calendrier » is for everyone.
 */
export type LandingPath = '/today' | '/direction' | '/absences' | '/board' | '/calendar';

export interface LandingFacts {
  /** Teaches at a school with the Teaching module. */
  teaches: boolean;
  /** Principal or vice-principal of a school. */
  directs: boolean;
  /** Sees a school's « Suppléances » board (office or direction, Teaching module). */
  seesSubstituteBoard: boolean;
  /** Administers a board. */
  administersBoard: boolean;
}

/** A teacher (a teaching principal too) → Aujourd'hui; direction; office; board admin; else Calendrier. */
export function landingPath(facts: LandingFacts): LandingPath {
  if (facts.teaches) return '/today';
  if (facts.directs) return '/direction';
  if (facts.seesSubstituteBoard) return '/absences';
  if (facts.administersBoard) return '/board';
  return '/calendar';
}
