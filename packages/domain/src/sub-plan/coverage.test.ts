import { describe, expect, it } from 'vitest';
import { buildAbsencePlans } from './build';
import { absenceSchoolDays, coverageForDay, halfDaySplit } from './coverage';
import type { AbsencePart } from './schema';
import {
  C3,
  C5,
  GYM,
  NOW,
  WEEK,
  block,
  event,
  isabelleSources,
  parse,
  paulSources,
  twoClassSources,
  type RawEvent,
} from './test-fixtures';

type Raw = ReturnType<typeof isabelleSources>;

const cover = (raw: Raw, date: string, part: AbsencePart = 'full_day') =>
  coverageForDay({ date, sources: parse(raw), part });

const withEvents = (raw: Raw, events: RawEvent[]): Raw => ({ ...raw, events });

describe('coverageForDay', () => {
  it('covers all ten homeroom blocks of a 3e Monday, routines and breaks included, in order', () => {
    const day = cover(isabelleSources(), WEEK.mon);
    expect(day.handovers).toEqual([]);
    expect(day.covered.map((b) => `${b.effectiveStart} ${b.kind}`)).toEqual([
      '08:45 routine',
      '08:55 subject',
      '09:45 subject',
      '10:35 nutrition_break',
      '11:15 subject',
      '12:05 subject',
      '12:55 nutrition_break',
      '13:35 subject',
      '14:25 subject',
      '15:15 routine',
    ]);
    expect(day.covered.every((b) => b.role === 'covered' && b.classId === C3)).toBe(true);
    expect(day.window).toEqual({ start: '08:45', end: '15:20' });
    expect(day.endOfDay).toBe('15:20');
    expect(day.classIds).toEqual([C3]);
    expect(day.warnings).toEqual([]);
  });

  it('hands the Tuesday 13:35 EPS block over to M. Leblanc in the gym', () => {
    const day = cover(isabelleSources(), WEEK.tue);
    const eps = day.blocks.find((b) => b.effectiveStart === '13:35')!;
    expect(eps).toMatchObject({
      role: 'handover',
      otherAdult: 'M. Leblanc',
      roomName: 'Gymnase',
      roomId: GYM,
    });
    expect(day.covered.some((b) => b.id === eps.id)).toBe(false);
    expect(day.handovers.map((b) => b.id)).toEqual([eps.id]);
  });

  it('gives a rotary teacher only the blocks assigned to them, without other classes’ routines', () => {
    const monday = cover(paulSources(), WEEK.mon);
    expect(monday.blocks.map((b) => [b.className, b.effectiveStart, b.subjectLabel])).toEqual([
      ['5e année – M. Gagnon', '11:15', 'Anglais'],
    ]);
    expect(monday.classIds).toEqual([C5]);
    const tuesday = cover(paulSources(), WEEK.tue);
    expect(tuesday.blocks.map((b) => [b.className, b.effectiveStart, b.roomName])).toEqual([
      ['3e année – Mme Tremblay', '13:35', 'Gymnase'],
    ]);
    expect(tuesday.handovers).toEqual([]);
    expect(tuesday.classIds).toEqual([C3]);
  });

  it('lists a PA day with its reason and skips the weekend', () => {
    const pa = event({ startsOn: WEEK.fri, eventType: 'pa_day', title: 'Journée pédagogique' });
    const days = absenceSchoolDays(
      parse(withEvents(isabelleSources(), [pa])),
      WEEK.thu,
      WEEK.nextMon,
    );
    expect(days.map((d) => [d.date, d.day.status])).toEqual([
      [WEEK.thu, 'instructional'],
      [WEEK.fri, 'no_school'],
      [WEEK.nextMon, 'instructional'],
    ]);
    expect(days[1]!.day).toMatchObject({
      reason: 'event',
      event: { title: 'Journée pédagogique' },
    });
  });

  it('counts « Jour » numbers in a cycle school across a PA day, or warns when unknown', () => {
    const cycle: Raw = {
      ...isabelleSources(),
      school: { ...isabelleSources().school!, scheduleType: 'cycle', cycleLength: 5 },
      anchors: [{ anchorDate: WEEK.thu, cycleDay: 1 }],
      events: [event({ startsOn: WEEK.fri, eventType: 'pa_day', title: 'Journée pédagogique' })],
    };
    // Thursday is Jour 1, Friday has no school, so Monday is Jour 2 (Tuesday's blocks).
    const monday = cover(cycle, WEEK.nextMon);
    expect(monday.day).toEqual({ status: 'instructional', dayKey: 2 });
    expect(monday.handovers.map((b) => b.id)).toEqual([block(C3, 2, '13:35')]);
    const plan = buildAbsencePlans(
      parse(cycle),
      { startsOn: WEEK.nextMon, endsOn: WEEK.nextMon, part: 'full_day', catholicConnection: true },
      { now: NOW },
    ).plans[0]!.plan;
    expect(plan.day).toEqual({ kind: 'cycle', dayKey: 2 });

    const unknown = cover({ ...cycle, anchors: [] }, WEEK.nextMon);
    expect(unknown.day).toEqual({ status: 'unknown_cycle_day' });
    expect(unknown.blocks).toEqual([]);
    expect(unknown.warnings).toContain('unknown_cycle_day');
    expect(unknown.classIds).toEqual([C3]);
  });

  it('splits half days at the break nearest midday, a lunch block, or the school setting', () => {
    const am = cover(isabelleSources(), WEEK.mon, 'am');
    expect(am.split).toBe('12:55');
    expect(am.warnings).toEqual(['half_day_split_guessed']);
    expect(am.covered.at(-1)!.effectiveStart).toBe('12:05');
    expect(am.window).toEqual({ start: '08:45', end: '12:55' });
    expect(am.endOfDay).toBe('12:55');

    const pm = cover(isabelleSources(), WEEK.mon, 'pm');
    expect(pm.covered[0]).toMatchObject({ kind: 'nutrition_break', effectiveStart: '12:55' });
    expect(pm.window).toEqual({ start: '12:55', end: '15:20' });
    expect(pm.covered.map((b) => b.effectiveStart)).not.toContain('12:05');

    const breaks = [
      { kind: 'nutrition_break' as const, startTime: '10:35', endTime: '11:15' },
      { kind: 'nutrition_break' as const, startTime: '12:55', endTime: '13:35' },
      { kind: 'routine' as const, startTime: '08:45', endTime: '08:55' },
      { kind: 'routine' as const, startTime: '15:15', endTime: '15:20' },
    ];
    expect(halfDaySplit(breaks, null)).toEqual({ time: '12:55', guessed: true });
    const lunch = [...breaks, { kind: 'lunch' as const, startTime: '11:45', endTime: '12:25' }];
    expect(halfDaySplit(lunch, null)).toEqual({ time: '11:45', guessed: false });
    expect(halfDaySplit(lunch, '12:05')).toEqual({ time: '12:05', guessed: false });
    expect(halfDaySplit([], null)).toEqual({ time: null, guessed: false });

    const set: Raw = {
      ...isabelleSources(),
      school: {
        ...isabelleSources().school!,
        settings: { substitute: { halfDaySplit: '12:05' } },
      },
    };
    const setAm = cover(set, WEEK.mon, 'am');
    expect(setAm.split).toBe('12:05');
    expect(setAm.warnings).toEqual([]);
    expect(setAm.covered.at(-1)!.effectiveStart).toBe('11:15');
  });

  it('marks a block a mass fully covers as replaced and one an assembly cuts into as interrupted', () => {
    const mass = event({
      startsOn: WEEK.fri,
      title: 'Messe de l’école',
      startTime: '09:45',
      endTime: '10:35',
      notes: 'Au gymnase. Les classes s’y rendent à 9 h 40.',
    });
    const assembly = event({
      startsOn: WEEK.fri,
      eventType: 'assembly',
      title: 'Rassemblement',
      startTime: '12:05',
      endTime: '12:30',
    });
    const day = cover(withEvents(isabelleSources(), [mass, assembly]), WEEK.fri);
    const at = (start: string) => day.blocks.find((b) => b.effectiveStart === start)!;
    expect(at('09:45')).toMatchObject({
      status: 'replaced',
      subjectLabel: 'Mathématiques',
      eventNotes: 'Au gymnase. Les classes s’y rendent à 9 h 40.',
    });
    expect(at('12:05')).toMatchObject({
      status: 'interrupted',
      affectedBy: { title: 'Rassemblement' },
    });
    expect(at('08:55').status).toBe('normal');
    expect(day.dayEvents).toEqual([]);
  });

  it('drops blocks an early dismissal cancels and moves the end of the day', () => {
    const early = event({
      startsOn: WEEK.mon,
      eventType: 'early_dismissal',
      title: 'Rencontres parents-enseignants',
      startTime: '13:35',
    });
    const day = cover(withEvents(isabelleSources(), [early]), WEEK.mon);
    expect(day.blocks.map((b) => b.effectiveStart)).not.toContain('13:35');
    expect(day.blocks.at(-1)).toMatchObject({ effectiveStart: '12:55', effectiveEnd: '13:35' });
    expect(day.endOfDay).toBe('13:35');
    expect(day.window.end).toBe('13:35');
    expect(day.dayEvents.map((e) => e.title)).toEqual(['Rencontres parents-enseignants']);
  });

  it('applies a class field trip to that class only and lists informational events', () => {
    const trip = event({
      startsOn: WEEK.mon,
      eventType: 'field_trip',
      title: 'Sortie au musée',
      startTime: '09:00',
      endTime: '14:00',
      classId: C5,
    });
    const notice = event({
      startsOn: WEEK.mon,
      eventType: 'other',
      title: 'Journée du chandail orange',
      affectsSchedule: false,
    });
    const day = cover(withEvents(twoClassSources(), [trip, notice]), WEEK.mon);
    const statuses = (classId: string) =>
      new Set(day.blocks.filter((b) => b.classId === classId).map((b) => b.status));
    expect(statuses(C3)).toEqual(new Set(['normal']));
    expect(statuses(C5)).toEqual(new Set(['normal', 'interrupted', 'replaced']));
    expect(day.dayEvents.map((e) => e.title)).toEqual(['Journée du chandail orange']);

    const alone = cover(withEvents(twoClassSources(), [notice]), WEEK.mon);
    expect(alone.blocks.every((b) => b.status === 'normal')).toBe(true);
    expect(alone.blocks).toHaveLength(cover(twoClassSources(), WEEK.mon).blocks.length);
  });

  it('covers only the classes whose school year includes the day (D-055, Phase 6 review)', () => {
    // The 5e class is from last year: kept, with its timetable, after its students were purged.
    const raw: Raw = {
      ...twoClassSources(),
      classes: twoClassSources().classes!.map((c) =>
        c.id === C5
          ? { ...c, yearStartsOn: '2025-09-02', yearEndsOn: '2026-06-26' }
          : { ...c, yearStartsOn: '2026-09-02', yearEndsOn: '2027-06-25' },
      ),
    };
    const day = cover(raw, WEEK.mon);
    expect(day.classIds).toEqual([C3]);
    expect(day.blocks.every((b) => b.classId === C3)).toBe(true);
    const [built] = buildAbsencePlans(
      parse(raw),
      { startsOn: WEEK.mon, endsOn: WEEK.mon, part: 'full_day', catholicConnection: true },
      { now: NOW },
    ).plans;
    expect(built!.classIds).toEqual([C3]);
    // Last year's class alone on a day of last year; sources without the dates cover both.
    expect(cover(raw, '2026-06-22').classIds).toEqual([C5]);
    expect(cover(twoClassSources(), WEEK.mon).classIds).toEqual([C3, C5]);
  });

  it('gives a teacher with no classes an empty plan with no_classes', () => {
    const raw: Raw = {
      ...isabelleSources(),
      classes: [],
      team: [],
      blocks: [],
      units: [],
      students: [],
    };
    const day = cover(raw, WEEK.mon);
    expect(day.blocks).toEqual([]);
    expect(day.warnings).toEqual(['no_classes']);
    const [built] = buildAbsencePlans(
      parse(raw),
      { startsOn: WEEK.mon, endsOn: WEEK.mon, part: 'full_day', catholicConnection: true },
      { now: NOW },
    ).plans;
    expect(built!.classIds).toEqual([]);
    expect(built!.plan).toMatchObject({ blocks: [], classes: [], groups: [] });
    expect(built!.plan.warnings).toEqual([{ code: 'no_classes', blockKey: null }]);
  });
});
