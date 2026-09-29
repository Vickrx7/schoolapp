import {
  buildAbsencePlans,
  subPlanSourcesSchema,
  type SubPlanSourcesInput,
  type SubPlanV1,
} from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import { summarizeAbsence, summarizePlan } from './summary';

const CLASS = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function block(
  n: number,
  overrides: Partial<SubPlanV1['blocks'][number]> = {},
): SubPlanV1['blocks'][number] {
  return {
    key: uuid(n),
    classId: CLASS,
    className: '3e année',
    kind: 'subject',
    start: '08:55',
    end: '09:45',
    status: 'normal',
    title: 'Français',
    subjectLabel: 'Français',
    roomName: null,
    otherAdult: null,
    event: null,
    notes: null,
    lesson: null,
    steps: [],
    warnings: [],
    library: null,
    ...overrides,
  };
}

function plan(overrides: Partial<SubPlanV1> = {}): SubPlanV1 {
  return {
    schemaVersion: 1,
    date: '2026-10-16',
    part: 'full_day',
    window: { start: '08:45', end: '15:20' },
    split: '12:55',
    day: { kind: 'weekly', dayKey: 5 },
    classes: [],
    groups: [],
    dayEvents: [],
    blocks: [],
    classNotes: [],
    endOfDay: { time: '15:20', checklist: [] },
    faith: null,
    warnings: [],
    generator: { version: 'domain-1', generatedAt: '2026-10-01T10:00:00.000Z' },
    ...overrides,
  };
}

describe('plan summaries', () => {
  it('counts the periods to cover and lists the day’s events once, in time order', () => {
    const mass = { title: 'Messe de l’école', notes: 'Au gymnase.', start: '09:45', end: '10:35' };
    const summary = summarizePlan(
      plan({
        blocks: [
          block(1, { kind: 'routine', title: 'Entrée', start: '08:45', end: '08:55' }),
          block(2),
          block(3, { start: '09:45', end: '10:35', status: 'replaced', event: mass }),
          block(4, {
            classId: OTHER,
            start: '09:45',
            end: '10:35',
            status: 'replaced',
            event: mass,
          }),
          block(5, { kind: 'handover', title: 'EPS avec M. Leblanc', otherAdult: 'M. Leblanc' }),
          block(6, { start: '13:35', end: '14:25', warnings: ['thin_lesson'] }),
        ],
        dayEvents: [{ title: 'Photo de classe', type: 'other', start: null, end: null }],
        warnings: [
          { code: 'students_without_level', blockKey: null },
          { code: 'students_without_level', blockKey: null },
        ],
      }),
    );
    expect(summary.periods).toBe(4);
    expect(summary.handovers).toBe(1);
    expect(summary.events).toEqual([
      { title: 'Messe de l’école', start: '09:45' },
      { title: 'Photo de classe', start: null },
    ]);
    expect(summary.planWarnings).toEqual(['students_without_level']);
    expect(summary.blockWarnings).toBe(1);
    expect(summary.split).toBe('12:55');
    expect(summary).toMatchObject({ dayKey: 5, cycle: false });
  });

  it('summarizes a built absence, days without school included', () => {
    const sources: SubPlanSourcesInput = {
      today: '2026-10-01',
      teacher: { id: uuid(90), displayName: 'Isabelle Tremblay', honorific: 'Mme' },
      school: {
        id: uuid(91),
        boardId: uuid(92),
        timezone: 'America/Toronto',
        scheduleType: 'weekly',
        cycleLength: null,
        settings: {},
      },
      classes: [{ id: CLASS, name: '3e année', roomId: null, role: 'homeroom', grades: [] }],
      blocks: [
        {
          id: uuid(10),
          classId: CLASS,
          dayKey: 4,
          startTime: '08:55',
          endTime: '09:45',
          kind: 'subject',
          subjectId: null,
          title: 'Lecture',
          teacherId: null,
          roomId: null,
          notes: null,
        },
      ],
      events: [
        {
          id: uuid(20),
          eventType: 'pa_day',
          title: 'Journée pédagogique',
          notes: null,
          startsOn: '2026-10-16',
          endsOn: '2026-10-16',
          startTime: null,
          endTime: null,
          affectsSchedule: true,
          classId: null,
        },
      ],
    };
    const result = buildAbsencePlans(
      subPlanSourcesSchema.parse(sources),
      { startsOn: '2026-10-15', endsOn: '2026-10-19', part: 'full_day', catholicConnection: false },
      { now: new Date('2026-10-01T10:00:00Z') },
    );
    const summary = summarizeAbsence(result);
    expect(summary.days.map((d) => d.date)).toEqual(['2026-10-15', '2026-10-19']);
    expect(summary.days[0]!.periods).toBe(1);
    expect(summary.days[1]!.periods).toBe(0);
    expect(summary.noSchool).toEqual([
      { date: '2026-10-16', reason: 'pa_day', title: 'Journée pédagogique' },
    ]);
  });
});
