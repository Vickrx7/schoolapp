import { describe, expect, it } from 'vitest';
import { summarizeAccess, type SubAccess } from './access-view';

const NOW = new Date('2026-10-14T14:00:00Z');
const code = (id: string, extra: Partial<SubAccess['codes'][number]> = {}) => ({
  codeId: id,
  createdAt: '2026-10-14T10:00:00Z',
  createdByName: 'Mme Bergeron',
  validFrom: '2026-10-14T09:00:00Z',
  expiresAt: '2026-10-14T22:00:00Z',
  revokedAt: null,
  deviceCount: 0,
  ...extra,
});
const session = (
  id: string,
  device: number,
  extra: Partial<SubAccess['sessions'][number]> = {},
) => ({
  sessionId: id,
  codeId: 'c1',
  deviceNumber: device,
  startedAt: '2026-10-14T12:00:00Z',
  lastSeenAt: null,
  expiresAt: '2026-10-14T22:00:00Z',
  revokedAt: null,
  cut: false,
  ...extra,
});

describe('codes and devices as the office sees them', () => {
  it('keeps only codes that still work', () => {
    const view = summarizeAccess(
      {
        codes: [
          code('c1'),
          code('c2', { revokedAt: '2026-10-14T12:30:00Z' }),
          code('c3', { expiresAt: '2026-10-14T13:00:00Z' }),
        ],
        sessions: [],
      },
      NOW,
    );
    expect(view.activeCodes.map((c) => c.codeId)).toEqual(['c1']);
  });

  it('shows one line per device, from its latest session', () => {
    const view = summarizeAccess(
      {
        codes: [code('c1')],
        sessions: [
          // Device 1 signed in again: its first session was replaced.
          session('s1', 1, {
            revokedAt: '2026-10-14T12:10:00Z',
            lastSeenAt: '2026-10-14T12:05:00Z',
          }),
          session('s3', 1, {
            startedAt: '2026-10-14T12:10:00Z',
            lastSeenAt: '2026-10-14T13:15:00Z',
          }),
          session('s2', 2, {
            startedAt: '2026-10-14T12:08:00Z',
            revokedAt: '2026-10-14T12:20:00Z',
            cut: true,
          }),
        ],
      },
      NOW,
    );
    expect(view.devices).toEqual([
      {
        deviceNumber: 1,
        sessionId: 's3',
        firstSeenAt: '2026-10-14T12:00:00Z',
        lastSeenAt: '2026-10-14T13:15:00Z',
        active: true,
        cut: false,
      },
      {
        deviceNumber: 2,
        sessionId: 's2',
        firstSeenAt: '2026-10-14T12:08:00Z',
        lastSeenAt: null,
        active: false,
        cut: true,
      },
    ]);
  });

  it('treats an expired session as signed out', () => {
    const view = summarizeAccess(
      { codes: [], sessions: [session('s1', 1, { expiresAt: '2026-10-14T13:00:00Z' })] },
      NOW,
    );
    expect(view.devices[0]).toMatchObject({ active: false, cut: false });
  });
});
