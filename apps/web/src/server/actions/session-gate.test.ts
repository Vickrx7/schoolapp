/**
 * Server actions are public endpoints: each one gates through `requireSession()` before anything
 * else (DECISIONS D-109), so a person who has not accepted the pilot terms, or whose session
 * ended, is sent to « Bienvenue » or the sign-in page and reaches no data. The planning, progress,
 * roster and timetable actions did not (risk 7 of the « Mon année » plan); « Mon année »'s own
 * actions do from the start.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSession = vi.fn();
const createClient = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'fr-CA') }));
vi.mock('../session', () => ({ requireSession: () => requireSession() }));
vi.mock('../supabase', () => ({ createSupabaseServerClient: () => createClient() }));
vi.mock('../queries/classes', () => ({ loadClass: vi.fn(async () => null) }));
vi.mock('../queries/year-plan', () => ({ loadExpectationChoices: vi.fn(async () => []) }));

const modules = {
  planning: await import('./planning'),
  progress: await import('./progress'),
  students: await import('./students'),
  timetable: await import('./timetable'),
  'year-plan': await import('./year-plan'),
};

const actions = Object.entries(modules).flatMap(([file, mod]) =>
  Object.entries(mod)
    .filter(
      (entry): entry is [string, (...args: unknown[]) => Promise<unknown>] =>
        typeof entry[1] === 'function',
    )
    .map(([name, fn]) => ({ name: `${file}.${name}`, fn })),
);

beforeEach(() => {
  requireSession.mockReset();
  createClient.mockReset();
});

describe('the planning, progress, roster, timetable and year plan actions (D-109)', () => {
  it('are all checked', () => {
    expect(actions.map((a) => a.name).sort()).toEqual([
      'planning.createUnit',
      'planning.deleteLesson',
      'planning.deleteUnit',
      'planning.moveLesson',
      'planning.saveLesson',
      'planning.setUnitStatus',
      'planning.updateUnit',
      'progress.markLessonTaught',
      'progress.unmarkLesson',
      'students.addStudents',
      'students.deleteStudent',
      'students.deleteStudentAlert',
      'students.revealClassAlerts',
      'students.saveStudentAlert',
      'students.updateStudent',
      'timetable.deleteTimetableBlock',
      'timetable.saveTimetableBlock',
      'year-plan.loadExpectationOptions',
      'year-plan.saveUnitPlan',
    ]);
  });

  it('stop at the session gate before reading anything', async () => {
    const redirect = new Error('NEXT_REDIRECT');
    requireSession.mockRejectedValue(redirect);
    for (const { name, fn } of actions) {
      await expect(fn(), name).rejects.toBe(redirect);
    }
    expect(requireSession).toHaveBeenCalledTimes(actions.length);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('go on once the session is there', async () => {
    requireSession.mockResolvedValue({ userId: 'u' });
    const rpc = vi.fn(async () => ({ error: null }));
    createClient.mockResolvedValue({ rpc });
    const { progress } = modules;
    expect(await progress.markLessonTaught('not-a-lesson', '2026-10-02')).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(await progress.unmarkLesson('30000000-0000-4000-8000-000000000301')).toEqual({
      ok: true,
      data: undefined,
    });
    expect(rpc).toHaveBeenCalledWith('unmark_lesson', {
      p_lesson_id: '30000000-0000-4000-8000-000000000301',
    });
  });
});
