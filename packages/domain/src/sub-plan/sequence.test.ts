import { describe, expect, it } from 'vitest';
import { isoWeekday } from '../dates';
import { buildAbsencePlans } from './build';
import { coverageForDay } from './coverage';
import type { AbsencePart } from './schema';
import { assignAbsenceLessons, slotKey } from './sequence';
import {
  C3,
  C5,
  NOW,
  WEEK,
  block,
  completed,
  event,
  isabelleSources,
  lesson,
  parse,
  twoClassSources,
} from './test-fixtures';

type Raw = ReturnType<typeof isabelleSources>;

function assign(
  raw: Raw,
  dates: string[],
  options: { part?: AbsencePart; assumeDone?: string[] } = {},
) {
  const sources = parse(raw);
  const days = dates.map((date) =>
    coverageForDay({ date, sources, part: options.part ?? 'full_day' }),
  );
  const map = assignAbsenceLessons({ days, sources, assumeDone: new Set(options.assumeDone) });
  /** The assignment of a class's block starting at `start` on `date`. */
  return (date: string, start: string, classId = C3) =>
    map.get(slotKey(date, block(classId, isoWeekday(date), start)));
}

describe('assignAbsenceLessons', () => {
  it('continues after the last completed lesson (3e Français → Leçon 4)', () => {
    const at = assign(isabelleSources(), [WEEK.mon]);
    expect(at(WEEK.mon, '08:55')).toMatchObject({
      reason: 'assigned',
      lesson: { id: lesson('fra3', 4), title: 'Trouver l’idée principale' },
      unit: { title: 'Lire pour s’informer : les animaux de l’Ontario' },
      gapBefore: null,
    });
    expect(at(WEEK.mon, '09:45')?.lesson?.id).toBe(lesson('mat3', 5));
  });

  it('gives two Français blocks of the same day consecutive lessons', () => {
    const at = assign(isabelleSources(), [WEEK.mon]);
    expect(at(WEEK.mon, '08:55')?.lesson?.id).toBe(lesson('fra3', 4));
    expect(at(WEEK.mon, '11:15')?.lesson?.id).toBe(lesson('fra3', 5));
  });

  it('continues day by day over a multi-day absence', () => {
    const at = assign(isabelleSources(), [WEEK.mon, WEEK.tue]);
    expect(
      [
        at(WEEK.mon, '08:55'),
        at(WEEK.mon, '11:15'),
        at(WEEK.tue, '08:55'),
        at(WEEK.tue, '11:15'),
      ].map((a) => a?.lesson?.sequenceNumber),
    ).toEqual([4, 5, 6, 7]);
  });

  it('reports a unit that runs out and gives fallback steps', () => {
    const raw: Raw = {
      ...isabelleSources(),
      progress: [...completed('fra3', 3), ...completed('mat3', 7)],
    };
    const at = assign(raw, [WEEK.mon, WEEK.tue]);
    expect(at(WEEK.mon, '09:45')).toMatchObject({
      reason: 'assigned',
      lesson: { sequenceNumber: 8 },
    });
    expect(at(WEEK.tue, '09:45')).toMatchObject({ reason: 'unit_finished', lesson: null });
    expect(at(WEEK.tue, '14:25')).toMatchObject({ reason: 'unit_finished', lesson: null });

    const tuesday = buildAbsencePlans(
      parse(raw),
      { startsOn: WEEK.mon, endsOn: WEEK.tue, part: 'full_day', catholicConnection: false },
      { now: NOW },
    ).plans[1]!.plan;
    const math = tuesday.blocks.find((b) => b.start === '09:45')!;
    expect(math.lesson).toBeNull();
    expect(math.warnings).toEqual(['unit_finished']);
    expect(math.steps.map((s) => s.text).join(' ')).toContain(
      'Activités de rechange prévues par l’enseignant·e : Lecture libre (bac jaune)',
    );
  });

  it('keeps lessons taught that morning on their block and gives the afternoon the next one', () => {
    const raw: Raw = {
      ...isabelleSources(),
      progress: [
        ...completed('fra3', 3),
        ...completed('mat3', 4),
        { lessonId: lesson('fra3', 4), status: 'completed', taughtOn: WEEK.wed },
      ],
    };
    const at = assign(raw, [WEEK.wed], { part: 'pm' });
    expect(at(WEEK.wed, '08:55')).toMatchObject({
      reason: 'taught',
      lesson: { sequenceNumber: 4 },
    });
    expect(at(WEEK.wed, '13:35')).toMatchObject({
      reason: 'assigned',
      lesson: { sequenceNumber: 5 },
    });

    // Before she checks it off, the morning block still takes Leçon 4 (she teaches it).
    const before = assign(isabelleSources(), [WEEK.wed], { part: 'pm' });
    expect(before(WEEK.wed, '13:35')?.lesson?.sequenceNumber).toBe(5);

    const plan = buildAbsencePlans(
      parse(raw),
      { startsOn: WEEK.wed, endsOn: WEEK.wed, part: 'pm', catholicConnection: false },
      { now: NOW },
    ).plans[0]!.plan;
    expect(plan.blocks.map((b) => b.start)).not.toContain('08:55');
    expect(plan.blocks.find((b) => b.start === '13:35')?.lesson).toMatchObject({
      sequenceNumber: 5,
      assignment: 'assigned',
    });
  });

  it('counts lessons reported by a substitute and not yet confirmed as done', () => {
    const raw: Raw = {
      ...isabelleSources(),
      progress: [
        ...completed('fra3', 3),
        { lessonId: lesson('fra3', 4), status: 'pending_confirmation', taughtOn: '2026-10-16' },
      ],
    };
    expect(assign(raw, [WEEK.mon])(WEEK.mon, '08:55')?.lesson?.sequenceNumber).toBe(5);
  });

  it('assumes a fixed earlier day’s lessons were taught until its report arrives', () => {
    const assumed = assign(isabelleSources(), [WEEK.tue], {
      assumeDone: [lesson('fra3', 4), lesson('fra3', 5)],
    });
    expect(assumed(WEEK.tue, '08:55')?.lesson?.sequenceNumber).toBe(6);

    // Monday's report came in: Leçon 4 done (pending), Leçon 5 not done. It comes back.
    const reported: Raw = {
      ...isabelleSources(),
      progress: [
        ...completed('fra3', 3),
        ...completed('mat3', 4),
        { lessonId: lesson('fra3', 4), status: 'pending_confirmation', taughtOn: WEEK.mon },
      ],
    };
    const actual = assign(reported, [WEEK.tue]);
    expect(actual(WEEK.tue, '08:55')?.lesson?.sequenceNumber).toBe(5);
  });

  it('assigns a forgotten earlier lesson first, flagged as a gap', () => {
    const raw: Raw = {
      ...isabelleSources(),
      progress: [
        { lessonId: lesson('fra3', 1), status: 'completed', taughtOn: '2026-10-14' },
        { lessonId: lesson('fra3', 3), status: 'completed', taughtOn: '2026-10-16' },
      ],
    };
    const at = assign(raw, [WEEK.mon]);
    expect(at(WEEK.mon, '08:55')).toMatchObject({
      lesson: { sequenceNumber: 2 },
      gapBefore: { sequenceNumber: 3, title: 'Prédire avant de lire' },
    });
    expect(at(WEEK.mon, '11:15')).toMatchObject({ lesson: { sequenceNumber: 4 }, gapBefore: null });

    const plan = buildAbsencePlans(
      parse(raw),
      { startsOn: WEEK.mon, endsOn: WEEK.mon, part: 'full_day', catholicConnection: false },
      { now: NOW },
    ).plans[0]!.plan;
    const first = plan.blocks.find((b) => b.start === '08:55')!;
    expect(first.warnings).toContain('lesson_gap');
    expect(first.lesson?.gapBefore).toBe('Prédire avant de lire');
    expect(plan.blocks.find((b) => b.start === '11:15')!.warnings).not.toContain('lesson_gap');
  });

  it('gives replaced and cancelled blocks no lesson and moves it to the next teachable slot', () => {
    const mass = event({ startsOn: WEEK.fri, startTime: '09:45', endTime: '10:35' });
    const massAt = assign({ ...isabelleSources(), events: [mass] }, [WEEK.fri, WEEK.nextMon]);
    expect(massAt(WEEK.fri, '09:45')).toBeUndefined();
    expect(massAt(WEEK.nextMon, '09:45')?.lesson?.id).toBe(lesson('mat3', 5));

    const early = event({ startsOn: WEEK.wed, eventType: 'early_dismissal', startTime: '13:35' });
    const earlyAt = assign({ ...isabelleSources(), events: [early] }, [WEEK.wed, WEEK.thu]);
    expect(earlyAt(WEEK.wed, '08:55')?.lesson?.sequenceNumber).toBe(4);
    expect(earlyAt(WEEK.wed, '13:35')).toBeUndefined();
    expect(earlyAt(WEEK.thu, '08:55')?.lesson?.sequenceNumber).toBe(5);
  });

  it('sequences the same subject in two classes independently', () => {
    const at = assign(twoClassSources(), [WEEK.mon]);
    expect(at(WEEK.mon, '09:45', C3)?.lesson?.id).toBe(lesson('mat3', 5));
    expect(at(WEEK.mon, '08:55', C5)?.lesson?.id).toBe(lesson('mat5', 6));
    expect(at(WEEK.mon, '13:35', C5)?.lesson?.id).toBe(lesson('sci5', 3));
  });
});
