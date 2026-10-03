import { describe, expect, it } from 'vitest';
import { planStatusView } from './plan-status';

describe('plan release status', () => {
  it('says when an unreviewed plan will be released, on the school’s clock', () => {
    expect(
      planStatusView(
        { planDate: '2026-10-14', released: false, releaseAt: '2026-10-14T11:30:00Z' },
        'America/Toronto',
      ),
    ).toEqual({ kind: 'ready', time: '07:30', date: '2026-10-14', onPlanDate: true });
    // The same deadline for a school in Winnipeg.
    expect(
      planStatusView(
        { planDate: '2026-10-14', released: false, releaseAt: '2026-10-14T12:30:00Z' },
        'America/Winnipeg',
      ),
    ).toMatchObject({ time: '07:30', onPlanDate: true });
  });

  it('tells when the release is not on the plan date', () => {
    expect(
      planStatusView(
        { planDate: '2026-10-14', released: false, releaseAt: '2026-10-14T03:30:00Z' },
        'America/Toronto',
      ),
    ).toEqual({ kind: 'ready', time: '23:30', date: '2026-10-13', onPlanDate: false });
  });

  it('is simply released once released, by hand or automatically', () => {
    expect(
      planStatusView(
        { planDate: '2026-10-14', released: true, releaseAt: '2026-10-14T11:30:00Z' },
        'America/Toronto',
      ),
    ).toEqual({ kind: 'released' });
  });
});
