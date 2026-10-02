import { describe, expect, it } from 'vitest';
import {
  PURGE_NOTICE_DAYS,
  SAMPLE_CLASS_DAYS,
  samplePurgeDate,
  showsPurgeNotice,
  studentPurgeDate,
} from './retention';
import { parseBoardSettings } from './settings';

describe('when students and sample classes go (D-105, D-109)', () => {
  it('removes a class’s students the day after its year end plus the board’s setting', () => {
    // The demo year ends on 2027-06-25; 365 days later is 2028-06-24 (2028 is a leap year).
    expect(studentPurgeDate('2027-06-25', parseBoardSettings({}))).toBe('2028-06-25');
    const longer = parseBoardSettings({ retention: { classDaysAfterYearEnd: 730 } });
    expect(studentPurgeDate('2027-06-25', longer)).toBe('2029-06-25');
    // A value below a year never shortens it (the default applies).
    const tooShort = parseBoardSettings({ retention: { classDaysAfterYearEnd: 30 } });
    expect(studentPurgeDate('2027-06-25', tooShort)).toBe('2028-06-25');
  });

  it('deletes a sample class 60 days after it was created', () => {
    expect(SAMPLE_CLASS_DAYS).toBe(60);
    expect(samplePurgeDate('2026-12-05')).toBe('2027-02-03');
    expect(samplePurgeDate('2027-01-01')).toBe('2027-03-02');
  });

  it('announces a purge in the 60 days before it, never after', () => {
    expect(PURGE_NOTICE_DAYS).toBe(60);
    const purge = '2028-06-25';
    expect(showsPurgeNotice('2028-04-25', purge)).toBe(false); // 61 days before
    expect(showsPurgeNotice('2028-04-26', purge)).toBe(true); // 60 days before
    expect(showsPurgeNotice('2028-06-24', purge)).toBe(true);
    expect(showsPurgeNotice('2028-06-25', purge)).toBe(true); // the day itself
    expect(showsPurgeNotice('2028-06-26', purge)).toBe(false); // gone
  });
});
