import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  reportMarkers,
  reportPeriodInYear,
  typicalReportPeriods,
  type ReportPeriod,
} from './report-periods';
import { YEAR, event, seededDaysOff } from './test-calendar';

const typical = typicalReportPeriods(YEAR, seededDaysOff());

describe('« Préremplir avec les dates habituelles » (D-124)', () => {
  it('proposes the usual Ontario dates for 2026-2027, moved to school days', () => {
    expect(typical).toEqual([
      {
        kind: 'progress',
        startsOn: '2026-09-02',
        endsOn: '2026-10-30',
        dueOn: '2026-11-06',
        issuedOn: '2026-11-13',
      },
      {
        kind: 'term1',
        startsOn: '2026-09-02',
        endsOn: '2027-01-29',
        dueOn: '2027-02-05',
        issuedOn: '2027-02-12',
      },
      {
        kind: 'term2',
        startsOn: '2027-02-01',
        endsOn: '2027-06-11',
        dueOn: '2027-06-16',
        issuedOn: '2027-06-25',
      },
    ]);
  });

  it('is what the demo seed holds', () => {
    const seed = readFileSync(
      new URL('../../../../supabase/seeds/50_year_plan_demo.sql', import.meta.url),
      'utf8',
    );
    const rows = [
      ...seed.matchAll(/\(v_year, '(\w+)', '([\d-]+)', '([\d-]+)', '([\d-]+)', '([\d-]+)'\)/g),
    ].map((m): ReportPeriod => ({
      kind: m[1] as ReportPeriod['kind'],
      startsOn: m[2]!,
      endsOn: m[3]!,
      dueOn: m[4]!,
      issuedOn: m[5]!,
    }));
    expect(rows).toEqual(typical);
  });

  it('moves the first term’s « remise » off Family Day', () => {
    const withoutFamilyDay = seededDaysOff().filter((e) => e.title !== 'Jour de la Famille');
    expect(typicalReportPeriods(YEAR, withoutFamilyDay)[1]!.issuedOn).toBe('2027-02-15');
    expect(typical[1]!.issuedOn).toBe('2027-02-12');
  });

  it('moves a date off a PA day and the weekend before it', () => {
    const periods = typicalReportPeriods(YEAR, [
      event('pa', { eventType: 'pa_day', startsOn: '2026-10-30' }),
    ]);
    expect(periods[0]!.endsOn).toBe('2026-10-29');
  });

  it('starts the second term on the first school day of February', () => {
    const periods = typicalReportPeriods({ startsOn: '2027-09-01', endsOn: '2028-06-28' }, []);
    // 1 February 2028 is a Tuesday; 31 January 2028 a Monday.
    expect(periods.map((p) => [p.kind, p.startsOn, p.endsOn])).toEqual([
      ['progress', '2027-09-01', '2027-10-29'],
      ['term1', '2027-09-01', '2028-01-31'],
      ['term2', '2028-02-01', '2028-06-09'],
    ]);
    expect(periods[2]!.issuedOn).toBe('2028-06-28');
  });

  it('keeps every date inside a short year, and leaves out a period that cannot fit', () => {
    const periods = typicalReportPeriods({ startsOn: '2026-09-02', endsOn: '2026-12-18' }, []);
    expect(periods.map((p) => p.kind)).toEqual(['progress', 'term1']);
    expect(periods[1]).toMatchObject({ endsOn: '2026-12-18', dueOn: '2026-12-18' });
  });
});

describe('report markers and the year (D-124)', () => {
  it('lists each period’s last day, saisie and remise in date order', () => {
    const markers = reportMarkers(typical);
    expect(markers.slice(0, 3)).toEqual([
      { kind: 'progress', what: 'end', date: '2026-10-30' },
      { kind: 'progress', what: 'due', date: '2026-11-06' },
      { kind: 'progress', what: 'issued', date: '2026-11-13' },
    ]);
    expect(markers).toHaveLength(9);
    expect(
      reportMarkers([{ ...typical[0]!, dueOn: null, issuedOn: null }]).map((m) => m.what),
    ).toEqual(['end']);
  });

  it('says when a period is outside its year (a year edited later)', () => {
    expect(reportPeriodInYear(typical[0]!, YEAR)).toBe(true);
    expect(reportPeriodInYear(typical[0]!, { startsOn: '2026-09-08', endsOn: YEAR.endsOn })).toBe(
      false,
    );
  });
});
