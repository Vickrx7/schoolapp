import { describe, expect, it } from 'vitest';
import { requestPath, welcomeHref, welcomeNext } from './request-path';

describe('the page « Bienvenue » comes back to (D-109)', () => {
  it('keeps the path and query, without Next’s own parameter', () => {
    expect(requestPath('/classes/abc/planning', '')).toBe('/classes/abc/planning');
    expect(requestPath('/today', '?date=2026-11-12&_rsc=1x2y')).toBe('/today?date=2026-11-12');
    expect(requestPath('/today', '?_rsc=1x2y')).toBe('/today');
  });

  it('goes back to a local page, never to « Bienvenue » or another site', () => {
    expect(welcomeNext('/classes/abc/students')).toBe('/classes/abc/students');
    expect(welcomeNext('/today?date=2026-11-12')).toBe('/today?date=2026-11-12');
    expect(welcomeNext('/today')).toBe('/today');
    for (const bad of [
      null,
      undefined,
      '',
      '/',
      '/bienvenue',
      '/bienvenue?next=/today',
      'https://evil.example/',
      '//evil.example',
      '/\t/evil.example',
      'today',
    ]) {
      expect(welcomeNext(bad), String(bad)).toBeNull();
    }
  });

  it('builds the address of « Bienvenue »', () => {
    expect(welcomeHref('/classes/abc/students')).toBe(
      '/bienvenue?next=%2Fclasses%2Fabc%2Fstudents',
    );
    expect(welcomeHref('/bienvenue')).toBe('/bienvenue');
    expect(welcomeHref(null)).toBe('/bienvenue');
  });
});
