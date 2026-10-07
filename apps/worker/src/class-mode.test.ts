import { describe, expect, it, vi } from 'vitest';
import { classModeMaintenance } from './class-mode';

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('classModeMaintenance', () => {
  it('runs the database sweep and logs its counts, and nothing else', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          counts: {
            sessionsClosed: 1,
            responsesDeleted: 3,
            participantsDeleted: 2,
            joinFailuresDeleted: 0,
            sessionsDeleted: 0,
            resultsDeleted: 0,
          },
        },
      ],
    }));
    const log = logger();
    const counts = await classModeMaintenance({ db: { query } as never, logger: log });
    expect(query).toHaveBeenCalledWith('select app.class_sessions_maintenance() as counts');
    expect(counts).toEqual({
      sessionsClosed: 1,
      responsesDeleted: 3,
      participantsDeleted: 2,
      joinFailuresDeleted: 0,
      sessionsDeleted: 0,
      resultsDeleted: 0,
    });
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith('class mode maintenance done', counts);
  });

  it('stays quiet when there was nothing to do (it runs every 5 minutes)', async () => {
    const query = vi.fn(async () => ({
      rows: [{ counts: { sessionsClosed: 0, responsesDeleted: 0 } }],
    }));
    const log = logger();
    const counts = await classModeMaintenance({ db: { query } as never, logger: log });
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(log.info).not.toHaveBeenCalled();
  });

  it('logs counts only, whatever else the database returns', async () => {
    const query = vi.fn(async () => ({
      rows: [
        { counts: { sessionsClosed: 2, itemTitle: 'Quiz', responsesDeleted: 'x', ids: ['a'] } },
      ],
    }));
    const log = logger();
    await classModeMaintenance({ db: { query } as never, logger: log });
    const data = log.info.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(
      [
        'joinFailuresDeleted',
        'participantsDeleted',
        'responsesDeleted',
        'resultsDeleted',
        'sessionsClosed',
        'sessionsDeleted',
      ].sort(),
    );
    expect(Object.values(data).every((v) => typeof v === 'number')).toBe(true);
    expect(data.sessionsClosed).toBe(2);
    expect(data.responsesDeleted).toBe(0);
  });
});
