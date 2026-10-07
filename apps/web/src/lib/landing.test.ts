import { describe, expect, it } from 'vitest';
import { landingPath, type LandingFacts } from './landing';

const nobody: LandingFacts = {
  teaches: false,
  directs: false,
  seesSubstituteBoard: false,
  administersBoard: false,
};
const landing = (facts: Partial<LandingFacts>) => landingPath({ ...nobody, ...facts });

describe('where a signed-in person lands (D-118)', () => {
  it('sends a teacher to Aujourd’hui, whatever else they do', () => {
    expect(landing({ teaches: true })).toBe('/today');
    // A teaching vice-principal of a school with the Teaching module.
    expect(landing({ teaches: true, directs: true, seesSubstituteBoard: true })).toBe('/today');
    expect(landing({ teaches: true, administersBoard: true })).toBe('/today');
  });

  it('sends the direction to its dashboard', () => {
    expect(landing({ directs: true, seesSubstituteBoard: true })).toBe('/direction');
    // At a school without the Teaching module too (the dashboard shows what exists).
    expect(landing({ directs: true })).toBe('/direction');
    expect(landing({ directs: true, administersBoard: true })).toBe('/direction');
  });

  it('sends office staff to Suppléances', () => {
    expect(landing({ seesSubstituteBoard: true })).toBe('/absences');
    expect(landing({ seesSubstituteBoard: true, administersBoard: true })).toBe('/absences');
  });

  it('sends a board admin to Conseil, and anyone else to Calendrier', () => {
    expect(landing({ administersBoard: true })).toBe('/board');
    // Office staff at a school without the Teaching module, a reviewer with no role at a school…
    expect(landing({})).toBe('/calendar');
  });
});
