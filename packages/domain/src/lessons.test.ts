import { describe, expect, it } from 'vitest';
import {
  assignLessonsToSlots,
  nextLessons,
  type LessonRef,
  type ProgressStatus,
  type TeachingSlot,
  type UnitLessons,
} from './lessons';

const lessons: LessonRef[] = [1, 2, 3, 4, 5].map((i) => ({
  id: `l${i}`,
  sequenceNumber: i,
  title: `Leçon ${i}`,
}));
const progress = (entries: Record<string, ProgressStatus>) => new Map(Object.entries(entries));

describe('nextLessons', () => {
  it('starts at the first lesson when nothing is done', () => {
    const r = nextLessons(lessons, progress({}));
    expect(r.lastDone).toBeNull();
    expect(r.next.map((l) => l.id)).toEqual(['l1']);
    expect(r.unitFinished).toBe(false);
  });

  it('continues after the last completed lesson', () => {
    const r = nextLessons(lessons, progress({ l1: 'completed', l2: 'completed' }), { count: 2 });
    expect(r.lastDone?.id).toBe('l2');
    expect(r.next.map((l) => l.id)).toEqual(['l3', 'l4']);
    expect(r.gaps).toEqual([]);
  });

  it('treats skipped lessons as done', () => {
    const r = nextLessons(lessons, progress({ l1: 'completed', l2: 'skipped' }));
    expect(r.next.map((l) => l.id)).toEqual(['l3']);
  });

  it('points back to a forgotten lesson and reports it as a gap', () => {
    const r = nextLessons(lessons, progress({ l1: 'completed', l3: 'completed' }));
    expect(r.lastDone?.id).toBe('l3');
    expect(r.next.map((l) => l.id)).toEqual(['l2']);
    expect(r.gaps.map((l) => l.id)).toEqual(['l2']);
  });

  it('follows the current order after lessons are reordered', () => {
    const reordered = lessons.map((l) => (l.id === 'l5' ? { ...l, sequenceNumber: 0 } : l));
    const r = nextLessons(reordered, progress({ l5: 'completed' }));
    expect(r.next.map((l) => l.id)).toEqual(['l1']);
  });

  it('counts substitute-reported lessons as done unless asked not to', () => {
    const p = progress({ l1: 'completed', l2: 'pending_confirmation' });
    expect(nextLessons(lessons, p).next[0]?.id).toBe('l3');
    expect(nextLessons(lessons, p, { pendingCountsAsDone: false }).next[0]?.id).toBe('l2');
  });

  it('reports a finished unit', () => {
    const all = progress(Object.fromEntries(lessons.map((l) => [l.id, 'completed' as const])));
    const r = nextLessons(lessons, all);
    expect(r.next).toEqual([]);
    expect(r.unitFinished).toBe(true);
  });

  it('handles an empty unit', () => {
    expect(nextLessons([], progress({}))).toEqual({
      lastDone: null,
      next: [],
      gaps: [],
      unitFinished: false,
    });
  });
});

describe('assignLessonsToSlots', () => {
  const fraUnit: UnitLessons = { unitId: 'u-fra', lessons };
  const matUnit: UnitLessons = {
    unitId: 'u-mat',
    lessons: lessons.slice(0, 2).map((l) => ({ ...l, id: `m${l.sequenceNumber}` })),
  };
  const units = new Map([
    ['c3:fra', fraUnit],
    ['c3:mat', matUnit],
  ]);
  const slot = (slotId: string, date: string, subjectId: string): TeachingSlot => ({
    slotId,
    date,
    classId: 'c3',
    subjectId,
  });

  it('continues the sequence across two days of absence', () => {
    const slots = [
      slot('d1-fra', '2026-10-01', 'fra'),
      slot('d1-mat', '2026-10-01', 'mat'),
      slot('d2-fra', '2026-10-02', 'fra'),
      slot('d2-mat', '2026-10-02', 'mat'),
    ];
    const result = assignLessonsToSlots(
      slots,
      units,
      progress({ l1: 'completed', m1: 'completed' }),
    );
    expect(result.map((r) => [r.slotId, r.lesson?.id ?? null, r.reason])).toEqual([
      ['d1-fra', 'l2', 'assigned'],
      ['d1-mat', 'm2', 'assigned'],
      ['d2-fra', 'l3', 'assigned'],
      ['d2-mat', null, 'unit_finished'],
    ]);
  });

  it('gives consecutive lessons to two blocks of the same subject on one day', () => {
    const result = assignLessonsToSlots(
      [slot('a', '2026-10-01', 'fra'), slot('b', '2026-10-01', 'fra')],
      units,
      progress({}),
    );
    expect(result.map((r) => r.lesson?.id)).toEqual(['l1', 'l2']);
  });

  it("keeps a lesson checked off today on today's slot and moves the next one along", () => {
    const slots = [
      slot('am', '2026-10-01', 'fra'),
      slot('pm', '2026-10-01', 'fra'),
      slot('next', '2026-10-02', 'fra'),
    ];
    const result = assignLessonsToSlots(
      slots,
      units,
      progress({ l1: 'completed', l2: 'completed' }),
      {
        taughtOn: new Map([
          ['l1', '2026-09-30'],
          ['l2', '2026-10-01'],
        ]),
      },
    );
    expect(result.map((r) => [r.slotId, r.lesson?.id, r.reason])).toEqual([
      ['am', 'l2', 'taught'],
      ['pm', 'l3', 'assigned'],
      ['next', 'l4', 'assigned'],
    ]);
  });

  it('says so when a subject has no active unit', () => {
    const result = assignLessonsToSlots([slot('a', '2026-10-01', 'sci')], units, progress({}));
    expect(result[0]).toEqual({
      slotId: 'a',
      unitId: null,
      lesson: null,
      reason: 'no_active_unit',
    });
  });
});
