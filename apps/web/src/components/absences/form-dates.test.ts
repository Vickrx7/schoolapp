import { describe, expect, it } from 'vitest';
import { absenceDates, initialChoice, type DateFields } from './form-dates';

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
