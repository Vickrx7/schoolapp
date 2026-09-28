import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-path';

describe('safeNextPath', () => {
  it('keeps same-site paths with their query', () => {
    expect(safeNextPath('/classes')).toBe('/classes');
    expect(safeNextPath('/today?date=2026-10-05')).toBe('/today?date=2026-10-05');
  });

  it('rejects anything that could leave the site', () => {
    for (const bad of [
      null,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/%09/evil.example'.replace('%09', '\t'),
      'javascript:alert(1)',
    ]) {
      expect(safeNextPath(bad), String(bad)).toBe('/today');
    }
  });
});
