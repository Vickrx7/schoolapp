/**
 * « Info-parents » on « Aujourd'hui » (DECISIONS D-142): « Info-parents : préparez le message de
 * la semaine pour {classe}. » on the week's last two school days (not a fixed Thursday and Friday:
 * a PA day on Friday makes them Wednesday and Thursday), for each class where the teacher is
 * homeroom that already has a message (no nagging those who do not use it), until the week's
 * message is marked sent.
 */
import type { LocalDate } from '../dates';
import type { SchoolWeek } from '../year-plan/weeks';

/** How many of the week's last school days show the reminder (**Assumption**, D-142). */
export const NEWSLETTER_REMINDER_DAYS = 2;

type WeekDays = Pick<SchoolWeek, 'days' | 'daysOff'>;

/** The week's school days (its weekdays inside the school year, days off aside), in order. */
export function weekSchoolDays(week: WeekDays): LocalDate[] {
  const off = new Set(week.daysOff.map((d) => d.date));
  return week.days.filter((day) => !off.has(day));
}

/** Whether `today` is one of the week's last two school days. */
export function newsletterReminderDue(week: WeekDays, today: LocalDate): boolean {
  return weekSchoolDays(week).slice(-NEWSLETTER_REMINDER_DAYS).includes(today);
}

export interface NewsletterReminderInput<C> {
  cls: C;
  /** The class's week of `today` in its school year (`schoolWeeks`); null outside the year. */
  week: (WeekDays & Pick<SchoolWeek, 'monday'>) | null;
  /** The class's messages (any week). */
  messages: readonly { weekOf: LocalDate; status: 'draft' | 'sent' }[];
}

export interface NewsletterReminder<C> {
  cls: C;
  /** The week to prepare: its Monday. */
  weekOf: LocalDate;
}

/**
 * The classes to remind about on `today`, in the order given: a class with at least one message,
 * on one of its week's last two school days, whose message for that week is not marked sent (a
 * draft still reminds).
 */
export function newsletterReminders<C>(
  inputs: readonly NewsletterReminderInput<C>[],
  today: LocalDate,
): NewsletterReminder<C>[] {
  return inputs.flatMap(({ cls, week, messages }) => {
    if (!week || messages.length === 0 || !newsletterReminderDue(week, today)) return [];
    const sent = messages.some((m) => m.weekOf === week.monday && m.status === 'sent');
    return sent ? [] : [{ cls, weekOf: week.monday }];
  });
}
