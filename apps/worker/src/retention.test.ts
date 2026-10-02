import { describe, expect, it, vi } from 'vitest';
import { RETENTION_COUNT_KEYS, retentionMaintenance, toRetentionTotals } from './retention';

describe('toRetentionTotals (D-105)', () => {
  it('keeps counts only, every key present', () => {
    expect(
      toRetentionTotals({
        boards: 2,
        subPlans: 3,
        students: 41,
        outbox: '7',
        authLogs: 12,
        absences: -1,
        classes: 1.5,
        extra: 'Léa',
      }),
    ).toEqual({
      boards: 2,
      subPlans: 3,
      absences: 0,
      classes: 0,
      students: 41,
      sampleClasses: 0,
      aiUsage: 0,
      feedback: 0,
      invitationsExpired: 0,
      invitationsDeleted: 0,
      auditRows: 0,
      outbox: 7,
      signInAttempts: 0,
      authLogs: 12,
    });
  });

  it('says when the database may not purge Supabase Auth’s log', () => {
    expect(toRetentionTotals({ authLogs: 'not_permitted' }).authLogs).toBe('not_permitted');
    expect(toRetentionTotals(null).authLogs).toBe(0);
  });
});

describe('retentionMaintenance', () => {
  it('runs the database function and logs its totals, nothing else', async () => {
    const query = vi.fn(async () => ({
      rows: [{ totals: { subPlans: 2, authLogs: 'not_permitted' } }],
    }));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const totals = await retentionMaintenance({ db: { query } as never, logger });
    expect(query).toHaveBeenCalledWith('select app.retention_maintenance() as totals');
    expect(totals.subPlans).toBe(2);
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [message, data] = logger.info.mock.calls[0]!;
    expect(message).toBe('retention done');
    expect(Object.keys(data).sort()).toEqual([...RETENTION_COUNT_KEYS, 'authLogs'].sort());
  });
});
