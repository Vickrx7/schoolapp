import { describe, expect, it } from 'vitest';
import { CLASS, event, SCHOOL, seededDaysOff, YEAR } from '../year-plan/test-calendar';
import { schoolWeeks, type SchoolWeek } from '../year-plan/weeks';
import { newsletterReminderDue, newsletterReminders, weekSchoolDays } from './reminder';

/** The demo year's weeks, with the seed's days off (2026-10-09 is a PA day, 10-12 a holiday). */
const weeks = schoolWeeks({ ...YEAR, events: seededDaysOff(), schoolId: SCHOOL, classId: CLASS });
const week = (monday: string): SchoolWeek => weeks.find((w) => w.monday === monday)!;
const off = (date: string) => ({ date, title: 'Congé', type: 'holiday' as const });

describe('newsletterReminderDue (« Aujourd’hui », D-142)', () => {
  it('is due on the last two school days of an ordinary week, Thursday and Friday', () => {
    const w = week('2026-09-28');
    expect(weekSchoolDays(w)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
    expect(
      ['2026-09-28', '2026-09-29', '2026-09-30'].some((d) => newsletterReminderDue(w, d)),
    ).toBe(false);
    expect(newsletterReminderDue(w, '2026-10-01')).toBe(true);
    expect(newsletterReminderDue(w, '2026-10-02')).toBe(true);
    // The weekend after is not the week's.
    expect(newsletterReminderDue(w, '2026-10-03')).toBe(false);
  });

  it('a PA Friday makes it Wednesday and Thursday', () => {
    const w = week('2026-10-05');
    expect(w.daysOff.map((d) => d.date)).toEqual(['2026-10-09']);
    expect(newsletterReminderDue(w, '2026-10-06')).toBe(false);
    expect(newsletterReminderDue(w, '2026-10-07')).toBe(true);
    expect(newsletterReminderDue(w, '2026-10-08')).toBe(true);
    expect(newsletterReminderDue(w, '2026-10-09')).toBe(false);
  });

  it('a short week: the year starting on a Wednesday, a week with one school day, none', () => {
    // The year starts on Wednesday 2026-09-02: Thursday and Friday are its last two.
    const first = week('2026-08-31');
    expect(first.days).toEqual(['2026-09-02', '2026-09-03', '2026-09-04']);
    expect(newsletterReminderDue(first, '2026-09-02')).toBe(false);
    expect(newsletterReminderDue(first, '2026-09-03')).toBe(true);
    // A board's week off from Tuesday: Monday is its only school day.
    const [short] = schoolWeeks({
      ...YEAR,
      events: [
        event('off', {
          eventType: 'holiday',
          startsOn: '2026-11-17',
          endsOn: '2026-11-20',
          affectsSchedule: true,
        }),
      ],
      schoolId: SCHOOL,
      classId: CLASS,
    }).filter((w) => w.monday === '2026-11-16');
    expect(weekSchoolDays(short!)).toEqual(['2026-11-16']);
    expect(newsletterReminderDue(short!, '2026-11-16')).toBe(true);
    // A week without school never reminds.
    const none = { days: ['2026-12-28', '2026-12-29'], daysOff: [] };
    expect(newsletterReminderDue({ ...none, daysOff: none.days.map(off) }, '2026-12-29')).toBe(
      false,
    );
  });

  it('a class’s own event never closes the school', () => {
    const [w] = schoolWeeks({
      ...YEAR,
      events: [event('own', { eventType: 'pa_day', startsOn: '2026-10-23', classId: CLASS })],
      schoolId: SCHOOL,
      classId: CLASS,
    }).filter((x) => x.monday === '2026-10-19');
    expect(newsletterReminderDue(w!, '2026-10-23')).toBe(true);
  });
});

describe('newsletterReminders', () => {
  const thursday = '2026-10-01';
  const input = (
    id: string,
    messages: { weekOf: string; status: 'draft' | 'sent' }[],
    w: SchoolWeek | null = week('2026-09-28'),
  ) => ({ cls: { id }, week: w, messages });

  it('reminds classes that use « Info-parents », until the week’s message is marked sent', () => {
    const reminders = newsletterReminders(
      [
        // Never used: no reminder (no nagging).
        input('unused', []),
        // Used last week, nothing this week yet.
        input('last-week', [{ weekOf: '2026-09-21', status: 'sent' }]),
        // This week's message is a draft: still to send.
        input('draft', [{ weekOf: '2026-09-28', status: 'draft' }]),
        // This week's message is sent: done.
        input('sent', [
          { weekOf: '2026-09-21', status: 'sent' },
          { weekOf: '2026-09-28', status: 'sent' },
        ]),
        // Next week's sent early does not count for this week.
        input('next-week', [{ weekOf: '2026-10-05', status: 'sent' }]),
        // Outside the class's school year.
        input('outside', [{ weekOf: '2026-09-21', status: 'sent' }], null),
      ],
      thursday,
    );
    expect(reminders).toEqual([
      { cls: { id: 'last-week' }, weekOf: '2026-09-28' },
      { cls: { id: 'draft' }, weekOf: '2026-09-28' },
      { cls: { id: 'next-week' }, weekOf: '2026-09-28' },
    ]);
  });

  it('says nothing on the other days of the week', () => {
    expect(
      newsletterReminders([input('a', [{ weekOf: '2026-09-21', status: 'sent' }])], '2026-09-30'),
    ).toEqual([]);
  });
});
