import { describe, expect, it } from 'vitest';
import { systemLineState } from './system-status';

describe('systemLineState (D-112, Phase 6 review)', () => {
  it('says « prévu » for what has not run yet on a new install, never « normal »', () => {
    expect(systemLineState({ ok: true, at: null })).toBe('scheduled');
    expect(systemLineState({ ok: true, at: '2026-10-02T07:00:00Z' })).toBe('ok');
    expect(systemLineState({ ok: false, at: null })).toBe('problem');
    expect(systemLineState({ ok: false, at: '2026-09-01T07:00:00Z' })).toBe('problem');
  });
});
