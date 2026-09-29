import { describe, expect, it, vi } from 'vitest';
import {
  MAX_PLAN_BYTES,
  buildAbsencePlans,
  buildMinimalSubPlan,
  isThinLesson,
  type AbsenceInput,
} from './build';
import { subPlanV1Schema } from './schema';
import type * as Scripts from './scripts';
import {
  C3,
  C5,
  DEBUTANTS_3E,
  LEVEL,
  NOW,
  WEEK,
  block,
  event,
  isabelleSources,
  lesson,
  parse,
  paulSources,
  twoClassSources,
} from './test-fixtures';

// A lesson titled '__throw__' makes the step templates throw, to test the per-day fallback.
vi.mock('./scripts', async (importOriginal) => {
  const actual = await importOriginal<typeof Scripts>();
  return {
    ...actual,
    lessonSteps: (...args: Parameters<typeof actual.lessonSteps>) => {
      if (args[0].title === '__throw__') throw new Error('template failure');
      return actual.lessonSteps(...args);
    },
  };
});

type Raw = ReturnType<typeof isabelleSources>;

const absence = (overrides: Partial<AbsenceInput> = {}): AbsenceInput => ({
  startsOn: WEEK.mon,
  endsOn: WEEK.mon,
  part: 'full_day',
  catholicConnection: true,
  ...overrides,
});

const build = (raw: Raw, a: Partial<AbsenceInput> = {}, now = NOW) =>
  buildAbsencePlans(parse(raw), absence(a), { now });

describe('buildAbsencePlans', () => {
  it('builds a valid 3e Monday plan with the teacher’s notes, contacts and groups', () => {
    const { plans, noSchool } = build(isabelleSources());
    expect(noSchool).toEqual([]);
    expect(plans).toHaveLength(1);
    const { plan, classIds, date } = plans[0]!;
    expect(date).toBe(WEEK.mon);
    expect(classIds).toEqual([C3]);
    expect(subPlanV1Schema.parse(plan)).toEqual(plan);

    const french = plan.blocks.find((b) => b.key === block(C3, 1, '08:55'))!;
    expect(french.lesson).toMatchObject({
      lessonId: lesson('fra3', 4),
      title: 'Trouver l’idée principale',
      assignment: 'assigned',
    });
    expect(french.steps.map((s) => s.text).join('\n')).toContain(
      'version illustrée du texte (bac vert).',
    );
    expect(french.steps.reduce((sum, s) => sum + (s.minutes ?? 0), 0)).toBe(50);

    expect(plan.endOfDay.time).toBe('15:20');
    expect(plan.endOfDay.checklist.length).toBeGreaterThan(0);
    expect(plan.classNotes).toHaveLength(1);
    expect(plan.classNotes[0]!.neighbour).toEqual({
      name: 'M. Gagnon',
      note: 'Local 104, juste à côté',
    });
    expect(plan.classNotes[0]!.team).toEqual([{ name: 'M. Leblanc', role: 'subject' }]);
    expect(plan.classes).toEqual([
      {
        classId: C3,
        name: '3e année – Mme Tremblay',
        gradeLabels: ['3e année'],
        roomName: 'Local 101',
      },
    ]);
    expect(plan.groups[0]).toEqual({
      key: 'G1',
      classId: C3,
      levelId: LEVEL.debutant,
      studentIds: DEBUTANTS_3E,
    });
    expect(plan.day).toEqual({ kind: 'weekly', dayKey: 1 });
    expect(plan.faith).not.toBeNull();
    expect(plan.warnings).toEqual([]);
  });

  it('shows the Friday mass on the Math block and moves the Math lesson to the next Math slot', () => {
    const mass = event({
      startsOn: WEEK.fri,
      title: 'Messe de l’école',
      startTime: '09:45',
      endTime: '10:35',
      notes: 'Au gymnase. Les classes s’y rendent à 9 h 40.',
    });
    const { plans } = build(
      { ...isabelleSources(), events: [mass] },
      {
        startsOn: WEEK.fri,
        endsOn: WEEK.nextMon,
      },
    );
    expect(plans.map((p) => p.date)).toEqual([WEEK.fri, WEEK.nextMon]);
    const math = plans[0]!.plan.blocks.find((b) => b.start === '09:45')!;
    expect(math).toMatchObject({
      status: 'replaced',
      subjectLabel: 'Mathématiques',
      lesson: null,
      warnings: [],
      event: { title: 'Messe de l’école', notes: 'Au gymnase. Les classes s’y rendent à 9 h 40.' },
    });
    expect(math.steps.map((s) => s.text).join('\n')).toContain('Au gymnase.');
    const mondayMath = plans[1]!.plan.blocks.find((b) => b.start === '09:45')!;
    expect(mondayMath.lesson?.lessonId).toBe(lesson('mat3', 5));
  });

  it('keeps the lesson for the minutes an assembly or an early dismissal leaves', () => {
    const assembly = event({
      startsOn: WEEK.mon,
      eventType: 'assembly',
      title: 'Rassemblement',
      startTime: '11:15',
      endTime: '11:35',
    });
    const monday = build({ ...isabelleSources(), events: [assembly] }).plans[0]!.plan;
    const french = monday.blocks.find((b) => b.start === '11:15')!;
    expect(french).toMatchObject({ status: 'interrupted', lesson: { sequenceNumber: 5 } });
    expect(french.steps[0]!.text).toBe(
      'Rassemblement de 11 h 15 à 11 h 35 : accompagnez les élèves, puis reprenez la période au retour.',
    );
    expect(french.steps.reduce((sum, s) => sum + (s.minutes ?? 0), 0)).toBe(30);

    const early = event({ startsOn: WEEK.wed, eventType: 'early_dismissal', startTime: '14:05' });
    const wednesday = build(
      { ...isabelleSources(), events: [early] },
      {
        startsOn: WEEK.wed,
        endsOn: WEEK.wed,
      },
    ).plans[0]!.plan;
    const afternoon = wednesday.blocks.find((b) => b.start === '13:35')!;
    expect(afternoon).toMatchObject({
      status: 'shortened',
      end: '14:05',
      lesson: { sequenceNumber: 5 },
    });
    expect(afternoon.steps.reduce((sum, s) => sum + (s.minutes ?? 0), 0)).toBe(30);
    expect(wednesday.endOfDay.time).toBe('14:05');
  });

  it('shortens very long lessons so the plan fits the database limit', () => {
    const raw = twoClassSources();
    raw.units = raw.units!.map((u) => ({
      ...u,
      lessons: u.lessons!.map((l) => ({ ...l, content: '€'.repeat(20000) })), // 60 KB each
    }));
    const [built] = build(raw).plans;
    const plan = built!.plan;
    expect(plan.warnings).toEqual([]);
    expect(plan.blocks.filter((b) => b.lesson).length).toBeGreaterThanOrEqual(5);
    expect(new TextEncoder().encode(JSON.stringify(plan)).length).toBeLessThanOrEqual(
      MAX_PLAN_BYTES,
    );
    const content = plan.blocks.find((b) => b.lesson)!.lesson!.content!;
    expect(content.length).toBeLessThanOrEqual(4000);
    expect(content.endsWith('…')).toBe(true);
  });

  it('never lets a name added to the sources reach the plan', () => {
    const raw = isabelleSources() as Raw & { students: Record<string, unknown>[] };
    raw.students = raw.students.map((s, i) => ({ ...s, firstName: i === 5 ? 'Samuel' : 'Zoé' }));
    (raw as Record<string, unknown>).roster = [{ firstName: 'Samuel' }];
    (raw.teacher as Record<string, unknown>).email = 'isabelle.tremblay@demo.lynx.test';
    const json = JSON.stringify(build(raw));
    expect(json).not.toContain('Samuel');
    expect(json).not.toContain('Zoé');
    expect(json).not.toContain('@demo.lynx.test');
    expect(parse(raw).students[0]).not.toHaveProperty('firstName');
  });

  it('flags a thin lesson', () => {
    const raw = isabelleSources();
    raw.units = raw.units!.map((u) => ({
      ...u,
      lessons: u.lessons!.map((l) =>
        l.id === lesson('fra3', 4)
          ? { ...l, objectives: null, materials: '  ', content: 'Lire le texte.' }
          : l,
      ),
    }));
    const plan = build(raw).plans[0]!.plan;
    expect(plan.blocks.find((b) => b.start === '08:55')!.warnings).toEqual(['thin_lesson']);
    expect(plan.blocks.find((b) => b.start === '11:15')!.warnings).toEqual([]);
    expect(isThinLesson({ objectives: null, materials: null, content: 'x'.repeat(80) })).toBe(
      false,
    );
  });

  it('leaves the faith moment out when the toggle is off', () => {
    expect(build(isabelleSources(), { catholicConnection: false }).plans[0]!.plan.faith).toBeNull();
    expect(
      build(isabelleSources(), { catholicConnection: true }).plans[0]!.plan.faith,
    ).toMatchObject({
      title: 'Prendre soin de la création', // Monday has Sciences et technologie
      type: 'reflection',
    });
  });

  it('gives identical plans for the same sources, except the generation time', () => {
    const later = new Date('2026-10-19T11:30:00.000Z');
    const a = build(isabelleSources(), { endsOn: WEEK.fri });
    const b = build(isabelleSources(), { endsOn: WEEK.fri }, later);
    expect(b.plans[0]!.plan.generator.generatedAt).toBe(later.toISOString());
    const strip = (r: typeof a) =>
      JSON.stringify(r, (k, v: unknown) => (k === 'generatedAt' ? undefined : v));
    expect(strip(b)).toBe(strip(a));
  });

  it('falls back to a minimal plan for the one day whose build throws', () => {
    const raw = isabelleSources();
    raw.units = raw.units!.map((u) => ({
      ...u,
      lessons: u.lessons!.map((l) =>
        l.id === lesson('fra3', 5) ? { ...l, title: '__throw__' } : l,
      ),
    }));
    const errors: string[] = [];
    const { plans } = buildAbsencePlans(parse(raw), absence({ endsOn: WEEK.tue }), {
      now: NOW,
      onError: (date) => errors.push(date),
    });
    expect(errors).toEqual([WEEK.mon]);
    const [monday, tuesday] = plans;
    expect(monday!.plan.warnings.map((w) => w.code)).toEqual(['generation_failed']);
    expect(monday!.plan.blocks.every((b) => b.lesson === null)).toBe(true);
    expect(monday!.plan.blocks.map((b) => b.start)).toContain('08:45'); // schedule and routines
    expect(monday!.plan.classNotes[0]!.neighbour?.name).toBe('M. Gagnon'); // contacts
    expect(monday!.classIds).toEqual([C3]);
    expect(subPlanV1Schema.safeParse(monday!.plan).success).toBe(true);
    // Tuesday is built normally and continues after Monday's lessons.
    expect(tuesday!.plan.warnings).toEqual([]);
    expect(tuesday!.plan.blocks.find((b) => b.start === '08:55')!.lesson?.sequenceNumber).toBe(6);
  });

  it('can always build a minimal plan', () => {
    const sources = parse(isabelleSources());
    const plan = buildMinimalSubPlan(sources, WEEK.mon, { part: 'am' }, { now: NOW });
    expect(subPlanV1Schema.parse(plan)).toEqual(plan);
    expect(plan).toMatchObject({ part: 'am', split: '12:55', faith: null });
    expect(plan.blocks.at(-1)!.start).toBe('12:05');
    const empty = buildMinimalSubPlan(
      parse({ ...isabelleSources(), classes: [], blocks: [] }),
      WEEK.mon,
      { part: 'full_day' },
      { now: NOW },
    );
    expect(subPlanV1Schema.parse(empty)).toEqual(empty);
    expect(empty.warnings.map((w) => w.code)).toEqual(['generation_failed', 'no_classes']);
  });

  it('lists exactly the classes with covered or handover blocks that day', () => {
    expect(
      build(isabelleSources(), { startsOn: WEEK.tue, endsOn: WEEK.tue }).plans[0]!.classIds,
    ).toEqual([C3]);
    const paul = build(paulSources(), { endsOn: WEEK.tue }).plans;
    expect(paul.map((p) => p.classIds)).toEqual([[C5], [C3]]);
    expect(paul[0]!.plan.classes.map((c) => c.classId)).toEqual([C5]);
    expect(paul[0]!.plan.groups.every((g) => g.classId === C5)).toBe(true);
    expect(paul[0]!.plan.classNotes.map((n) => n.classId)).toEqual([C5]);
    expect(build(twoClassSources()).plans[0]!.classIds).toEqual([C3, C5]);
  });

  it('writes the handover as a sentence the substitute can follow', () => {
    const plan = build(isabelleSources(), { startsOn: WEEK.tue, endsOn: WEEK.tue }).plans[0]!.plan;
    const eps = plan.blocks.find((b) => b.start === '13:35')!;
    expect(eps).toMatchObject({
      kind: 'handover',
      title: 'Éducation physique et santé avec M. Leblanc',
      otherAdult: 'M. Leblanc',
      roomName: 'Gymnase',
      lesson: null,
      warnings: [],
    });
    expect(eps.steps[0]!.text).toBe(
      'Éducation physique et santé avec M. Leblanc (Gymnase) : accompagnez les élèves à 13 h 35 et revenez les chercher à 14 h 25.',
    );
  });

  it('skips past days, days without school and days that are already fixed', () => {
    const pa = event({ startsOn: WEEK.fri, eventType: 'pa_day', title: 'Journée pédagogique' });
    // Today is Wednesday and a substitute already signed in: Wednesday is a fixed snapshot.
    const wednesday = {
      planDate: WEEK.wed,
      refreshable: false,
      hasSession: true,
      reportStatus: 'none' as const,
      assignedLessonIds: [lesson('fra3', 4), lesson('fra3', 5), lesson('mat3', 5)],
    };
    const raw: Raw = {
      ...isabelleSources(),
      today: WEEK.wed,
      events: [pa],
      siblings: [
        wednesday,
        {
          planDate: WEEK.thu,
          refreshable: true,
          hasSession: false,
          reportStatus: 'none',
          assignedLessonIds: [],
        },
      ],
    };
    const { plans, noSchool } = build(raw, { startsOn: WEEK.mon, endsOn: WEEK.nextMon });
    expect(plans.map((p) => p.date)).toEqual([WEEK.thu, WEEK.nextMon]);
    expect(noSchool).toEqual([
      { date: WEEK.fri, reason: 'pa_day', eventTitle: 'Journée pédagogique' },
    ]);
    const first = (r: typeof plans, start: string) =>
      r[0]!.plan.blocks.find((b) => b.start === start)!.lesson?.sequenceNumber;
    // Nobody has reported on Wednesday yet: its lessons count as taught.
    expect([first(plans, '08:55'), first(plans, '09:45')]).toEqual([6, 6]);

    // Wednesday's report says Leçon 4 was done and Leçon 5 was not: actual progress applies.
    const reported: Raw = {
      ...raw,
      progress: [
        ...raw.progress!,
        { lessonId: lesson('fra3', 4), status: 'pending_confirmation', taughtOn: WEEK.wed },
      ],
      siblings: [{ ...wednesday, reportStatus: 'submitted' }, raw.siblings![1]!],
    };
    const rebuilt = build(reported, { startsOn: WEEK.mon, endsOn: WEEK.nextMon }).plans;
    expect([first(rebuilt, '08:55'), first(rebuilt, '09:45')]).toEqual([5, 5]);
  });
});
