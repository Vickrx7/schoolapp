import { describe, expect, it } from 'vitest';
import {
  absenceDates,
  initialChoice,
  reconcileRestoredDates,
  requestKey,
  type DateFields,
} from './form-dates';

// Tuesday 2026-10-13, the day after Thanksgiving; the next school day is Wednesday.
const morning = {
  today: '2026-10-13',
  todayOpen: true,
  nextSchoolDay: '2026-10-14',
  defaultDate: '2026-10-13',
};
const evening = { ...morning, todayOpen: false, defaultDate: '2026-10-14' };
const fields = (f: Partial<DateFields> = {}): DateFields => ({
  choice: 'today',
  otherDate: '',
  several: false,
  endsOn: '',
  part: 'full_day',
  ...f,
});

describe('absence form dates', () => {
  it('preselects today before dismissal and the next school day after', () => {
    expect(initialChoice(morning)).toBe('today');
    expect(initialChoice(evening)).toBe('next');
    expect(absenceDates(fields(), morning)).toMatchObject({
      startsOn: '2026-10-13',
      endsOn: '2026-10-13',
      valid: true,
    });
    // A draft left on « Aujourd'hui » and restored after dismissal means the next school day.
    expect(absenceDates(fields(), evening).startsOn).toBe('2026-10-14');
    expect(absenceDates(fields({ choice: 'next' }), morning).startsOn).toBe('2026-10-14');
  });

  it('never sends a date in the past or a malformed one', () => {
    expect(
      absenceDates(fields({ choice: 'other', otherDate: '2026-10-12' }), morning),
    ).toMatchObject({
      startsOn: '',
      valid: false,
    });
    expect(absenceDates(fields({ choice: 'other', otherDate: '14/10/2026' }), morning).valid).toBe(
      false,
    );
    expect(
      absenceDates(fields({ choice: 'other', otherDate: '2026-10-20' }), morning),
    ).toMatchObject({ startsOn: '2026-10-20', endsOn: '2026-10-20', valid: true });
  });

  it('keeps half days to a single day and several days to 14', () => {
    const range = fields({ choice: 'next', several: true, endsOn: '2026-10-19', part: 'am' });
    expect(absenceDates(range, morning)).toEqual({
      startsOn: '2026-10-14',
      endsOn: '2026-10-19',
      part: 'full_day',
      valid: true,
    });
    // « Plusieurs jours » without a last day yet: a single day, the part applies.
    expect(absenceDates({ ...range, endsOn: '' }, morning)).toMatchObject({
      endsOn: '2026-10-14',
      part: 'am',
    });
    expect(absenceDates({ ...range, endsOn: '2026-10-27' }, morning).valid).toBe(true);
    expect(absenceDates({ ...range, endsOn: '2026-10-28' }, morning).valid).toBe(false);
    expect(absenceDates({ ...range, endsOn: '2026-10-13' }, morning).valid).toBe(false);
  });
});

describe('a draft restored on a later day', () => {
  // The next morning: Wednesday 2026-10-14, the next school day is Thursday.
  const nextMorning = {
    today: '2026-10-14',
    todayOpen: true,
    nextSchoolDay: '2026-10-15',
    defaultDate: '2026-10-14',
  };

  it('keeps the date it was for, not what « next school day » means now', () => {
    // Saved Tuesday evening on the next-school-day chip (Wednesday), restored Wednesday morning.
    const { fields: f, stale } = reconcileRestoredDates(
      fields({ choice: 'next' }),
      '2026-10-14',
      nextMorning,
    );
    expect(stale).toEqual({ date: '2026-10-14', kept: true });
    expect(f.choice).toBe('today');
    expect(absenceDates(f, nextMorning).startsOn).toBe('2026-10-14');

    // Saved for a later day: « Autre date » with that day.
    const later = reconcileRestoredDates(fields({ choice: 'next' }), '2026-10-16', nextMorning);
    expect(later.fields).toMatchObject({ choice: 'other', otherDate: '2026-10-16' });
    expect(absenceDates(later.fields, nextMorning).startsOn).toBe('2026-10-16');
  });

  it('asks for a date again when the draft’s day is past', () => {
    const { fields: f, stale } = reconcileRestoredDates(fields(), '2026-10-13', nextMorning);
    expect(stale).toEqual({ date: '2026-10-13', kept: false });
    expect(absenceDates(f, nextMorning).valid).toBe(false);
    // Today after dismissal is over too.
    const evening = { ...nextMorning, todayOpen: false, defaultDate: '2026-10-15' };
    expect(reconcileRestoredDates(fields(), '2026-10-14', evening).stale).toEqual({
      date: '2026-10-14',
      kept: false,
    });
  });

  it('changes nothing when the chips still mean the same date', () => {
    const same = reconcileRestoredDates(fields({ choice: 'next' }), '2026-10-15', nextMorning);
    expect(same).toEqual({ fields: fields({ choice: 'next' }), stale: null });
    // A draft from before this was recorded has no date: left as it is.
    expect(reconcileRestoredDates(fields(), '', nextMorning).stale).toBeNull();
  });
});

describe('publish request ids', () => {
  it('stand for one school, dates and part', () => {
    const a = requestKey('s1', { startsOn: '2026-10-14', endsOn: '2026-10-14', part: 'full_day' });
    expect(a).toBe(
      requestKey('s1', { startsOn: '2026-10-14', endsOn: '2026-10-14', part: 'full_day' }),
    );
    expect(a).not.toBe(
      requestKey('s1', { startsOn: '2026-10-15', endsOn: '2026-10-15', part: 'full_day' }),
    );
    expect(a).not.toBe(
      requestKey('s1', { startsOn: '2026-10-14', endsOn: '2026-10-14', part: 'am' }),
    );
    expect(a).not.toBe(
      requestKey('s2', { startsOn: '2026-10-14', endsOn: '2026-10-14', part: 'full_day' }),
    );
  });
});
