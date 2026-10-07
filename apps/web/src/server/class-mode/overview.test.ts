import { describe, expect, it } from 'vitest';
import { classModeOverviewSchema } from './overview';

// As `public.class_mode_overview` returns it (probed against the local database).
const overview = {
  open: {
    id: 'a1566968-1411-4ebb-95be-b0285a419f02',
    mine: false,
    mode: 'teams',
    phase: 'question',
    itemId: '7bdc7066-9b8a-5125-8351-bf234b0b11d3',
    expiresAt: '2026-09-29T21:41:15.541458+00:00',
    itemTitle: 'Quiz : les nombres jusqu’à 1 000',
    startedAt: '2026-09-29T19:41:15.541458+00:00',
    startedByName: 'Mme Tremblay',
  },
  hasLink: true,
  library: true,
  results: [
    {
      mode: 'teams',
      savedAt: '2026-09-22T19:03:46.571382+00:00',
      itemTitle: 'Quiz : les nombres jusqu’à 1 000',
      sessionId: '8d30888d-ed50-4359-872c-a9b0ccb15c21',
      questionsPlayed: 9,
      participantCount: 12,
    },
  ],
  retentionDays: 365,
};

describe('the class tab (D-089)', () => {
  it('reads the overview and drops anything else', () => {
    const parsed = classModeOverviewSchema.parse({
      ...overview,
      joinCode: 'K7M4R9',
      open: { ...overview.open, token: 'x'.repeat(43) },
    });
    expect(parsed.open?.startedByName).toBe('Mme Tremblay');
    expect(parsed.results[0]?.participantCount).toBe(12);
    expect(parsed).not.toHaveProperty('joinCode');
    expect(parsed.open).not.toHaveProperty('token');
  });

  it('has no open session when none is open', () => {
    expect(classModeOverviewSchema.parse({ ...overview, open: null }).open).toBeNull();
    expect(classModeOverviewSchema.parse({ ...overview, open: undefined }).open).toBeNull();
  });
});
