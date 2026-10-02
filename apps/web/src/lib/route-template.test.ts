import { describe, expect, it } from 'vitest';
import { routeTemplate } from './route-template';

describe('routeTemplate', () => {
  it('replaces ids', () => {
    expect(routeTemplate('/classes/0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b/planning')).toBe(
      '/classes/[id]/planning',
    );
    expect(
      routeTemplate(
        '/absences/0B5E7C1A-2F3D-4E5F-8A9B-0C1D2E3F4A5B/plans/1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f/pdf',
      ),
    ).toBe('/absences/[id]/plans/[id]/pdf');
    expect(routeTemplate('/items/1234567')).toBe('/items/[id]');
  });

  it('drops the query and the fragment', () => {
    expect(routeTemplate('/library?q=Samuel')).toBe('/library');
    expect(routeTemplate('/suppleance#code=K7P2QX9M')).toBe('/suppleance');
    expect(routeTemplate('/jouer#k=abcdef')).toBe('/jouer');
  });

  it('keeps the route names and turns anything typed into [x]', () => {
    expect(routeTemplate('/')).toBe('/');
    expect(routeTemplate('')).toBe('/');
    expect(routeTemplate('/auth/no-access')).toBe('/auth/no-access');
    expect(routeTemplate('/classes/x/class-mode/results')).toBe('/classes/x/class-mode/results');
    expect(routeTemplate('/isabelle.tremblay@demo.lynx.test')).toBe('/[x]');
    expect(routeTemplate('/classes/L%C3%A9a')).toBe('/classes/[x]');
    expect(routeTemplate('/classes/Léa Tremblay')).toBe('/classes/[x]');
    expect(routeTemplate('/library/K7P2QX')).toBe('/library/[x]');
    expect(routeTemplate('/library/oen1234')).toBe('/library/[x]');
    expect(routeTemplate('/%E0%A4%A')).toBe('/[x]');
  });

  it("keeps Next's own route templates", () => {
    expect(routeTemplate('/(app)/classes/[classId]/planning/[unitId]/page')).toBe(
      '/(app)/classes/[classId]/planning/[unitId]/page',
    );
    expect(routeTemplate('/api/health/ready')).toBe('/api/health/ready');
  });

  it('keeps at most 12 segments', () => {
    expect(routeTemplate(`/${'a/'.repeat(30)}`).split('/')).toHaveLength(13);
  });
});
