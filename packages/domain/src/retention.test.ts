import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PURGE_NOTICE_DAYS,
  SAMPLE_CLASS_DAYS,
  samplePurgeDate,
  showsPurgeNotice,
  studentPurgeDate,
} from './retention';
import { parseBoardSettings, RETENTION_LIMITS } from './settings';

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

describe('the database reads retention as the app does (D-105)', () => {
  const migration = readFileSync(
    new URL('../../../supabase/migrations/20261201090200_audit_retention.sql', import.meta.url),
    'utf8',
  );

  it('has the same bounds and defaults as RETENTION_LIMITS', () => {
    // app.retention_limits(): ('auditDays', 730, 365, 3650), ...
    const body = migration.slice(migration.indexOf('create function app.retention_limits()'));
    const rows = [
      ...body.slice(0, body.indexOf('$$;')).matchAll(/\('([A-Za-z]+)', (\d+), (\d+), (\d+)\)/g),
    ].map(([, key, def, min, max]) => [
      key,
      { default: Number(def), min: Number(min), max: Number(max) },
    ]);
    expect(Object.fromEntries(rows)).toEqual(RETENTION_LIMITS);
  });

  it('purges a class’s students on studentPurgeDate and a sample class on samplePurgeDate', () => {
    // The nightly job compares with the school's local date: students once the year's end plus
    // classDaysAfterYearEnd is before it (studentPurgeDate is the day after), sample classes once
    // their creation date plus SAMPLE_CLASS_DAYS is reached.
    expect(migration).toContain('y.ends_on + v_class_days < (now() at time zone s.timezone)::date');
    expect(migration).toContain(
      `(c.created_at at time zone s.timezone)::date + ${SAMPLE_CLASS_DAYS} <= (now() at time zone s.timezone)::date`,
    );
  });
});
