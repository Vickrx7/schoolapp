import {
  schoolWeeks,
  type PlacementUnit,
  type ReportPeriod,
  type YearCalendarEvent,
} from '@lynx/domain';
import { describe, expect, it } from 'vitest';
import { buildYearView, type GridCell } from './year-view';

/** The demo year: 2026-09-02 (a Wednesday) to 2027-06-25, with some of the seed's days off. */
const YEAR = { startsOn: '2026-09-02', endsOn: '2027-06-25' };
const SCHOOL = 'school';
const CLASS = 'class';

const event = (
  id: string,
  overrides: Partial<YearCalendarEvent> & Pick<YearCalendarEvent, 'startsOn'>,
): YearCalendarEvent => ({
  id,
  eventType: 'holiday',
  title: id,
  endsOn: overrides.startsOn,
  startTime: null,
  endTime: null,
  affectsSchedule: true,
  classId: null,
  schoolId: null,
  ...overrides,
});

const EVENTS: YearCalendarEvent[] = [
  event('pa1', { eventType: 'pa_day', title: 'Journée pédagogique', startsOn: '2026-10-09' }),
  event('thanks', { title: 'Action de grâce', startsOn: '2026-10-12' }),
  event('xmas', { title: 'Congé des Fêtes', startsOn: '2026-12-21', endsOn: '2027-01-01' }),
  event('march', { title: 'Congé de mars', startsOn: '2027-03-15', endsOn: '2027-03-19' }),
  event('mass', {
    eventType: 'mass',
    title: 'Messe de l’Action de grâce',
    startsOn: '2026-10-08',
    schoolId: SCHOOL,
  }),
  event('assembly', {
    eventType: 'assembly',
    title: 'Jour du Souvenir',
    startsOn: '2026-11-11',
    schoolId: SCHOOL,
  }),
];

const WEEKS = schoolWeeks({ ...YEAR, events: EVENTS, schoolId: SCHOOL, classId: CLASS });

const PERIODS: ReportPeriod[] = [
  {
    kind: 'progress',
    startsOn: '2026-09-02',
    endsOn: '2026-10-30',
    dueOn: '2026-11-06',
    issuedOn: '2026-11-13',
  },
];

const SUBJECTS = [
  { id: 'fra', label: 'Français', color: '#2563eb' },
  { id: 'mat', label: 'Mathématiques', color: '#16a34a' },
  { id: 'sci', label: 'Sciences', color: '#9333ea' },
  { id: 'art', label: 'Arts', color: null },
];

const unit = (id: string, overrides: Partial<PlacementUnit> = {}): PlacementUnit => ({
  id,
  subjectId: 'mat',
  title: id,
  status: 'planned',
  plannedStartOn: null,
  plannedEndOn: null,
  taughtOn: [],
  ...overrides,
});

const view = (units: PlacementUnit[], blocks: string[] = [], today = '2026-10-02') =>
  buildYearView({
    year: YEAR,
    weeks: WEEKS,
    periods: PERIODS,
    units,
    subjects: SUBJECTS,
    blockSubjectIds: new Set(blocks),
    today,
  });

const weekOf = (v: ReturnType<typeof view>, monday: string) =>
  v.weeks.find((w) => w.monday === monday)!;

const unitCells = (cells: GridCell<PlacementUnit>[]): [string, number, number][] =>
  cells.flatMap((c) =>
    c.kind === 'unit' ? [[c.placed.unit.id, c.start, c.span] as [string, number, number]] : [],
  );

describe('the year view (D-126)', () => {
  it('gives each week its first day, its school days, its days off and its masses', () => {
    const v = view([]);
    const first = v.weeks[0]!;
    expect(first).toMatchObject({ monday: '2026-08-31', first: '2026-09-02', days: 3 });
    expect(first.schoolDays).toBe(3);
    expect(weekOf(v, '2026-10-05')).toMatchObject({
      schoolDays: 4,
      closures: ['Journée pédagogique'],
      noSchool: false,
    });
    expect(weekOf(v, '2026-10-05').masses.map((e) => e.title)).toEqual([
      'Messe de l’Action de grâce',
    ]);
    expect(weekOf(v, '2026-10-12')).toMatchObject({ schoolDays: 4, closures: ['Action de grâce'] });
    for (const monday of ['2026-12-21', '2026-12-28']) {
      expect(weekOf(v, monday)).toMatchObject({
        schoolDays: 0,
        noSchool: true,
        closures: ['Congé des Fêtes'],
      });
    }
    // An assembly is an event, not a mass.
    expect(weekOf(v, '2026-11-09').masses).toEqual([]);
  });

  it('marks the current week, and groups the weeks by month from their first day', () => {
    const v = view([]);
    expect(v.weeks.filter((w) => w.current).map((w) => w.monday)).toEqual(['2026-09-28']);
    expect(v.months[0]).toEqual({ key: '2026-09-01', start: 0, span: 5 });
    expect(v.months[1]).toEqual({ key: '2026-10-01', start: 5, span: 4 });
    expect(v.months.map((m) => m.key)).toEqual([
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
      '2027-03-01',
      '2027-04-01',
      '2027-05-01',
      '2027-06-01',
    ]);
    expect(v.months.reduce((n, m) => n + m.span, 0)).toBe(v.weeks.length);
  });

  it('puts each report date in its week', () => {
    const v = view([]);
    expect(weekOf(v, '2026-10-26').markers).toEqual([
      { kind: 'progress', what: 'end', date: '2026-10-30' },
    ]);
    expect(weekOf(v, '2026-11-02').markers.map((m) => m.what)).toEqual(['due']);
    expect(weekOf(v, '2026-11-09').markers.map((m) => m.what)).toEqual(['issued']);
    expect(v.weeks.flatMap((w) => w.markers)).toHaveLength(3);
  });

  it('spans the liturgical seasons over the weeks, by their Wednesday', () => {
    const v = view([]);
    const named = v.seasons.filter((s) => s.key !== null);
    expect(named.map((s) => [s.key, v.weeks[s.start]!.monday, s.span])).toEqual([
      ['avent', '2026-11-30', 4],
      ['noel', '2026-12-28', 2],
      ['careme', '2027-02-08', 7],
      ['paques', '2027-03-29', 7],
    ]);
    expect(named[0]!.band).toEqual({ season: 'avent', from: '2026-11-29', to: '2026-12-24' });
    // September is Ordinary Time.
    expect(v.seasons[0]).toMatchObject({ key: null, start: 0, band: null });
    expect(v.seasons.reduce((n, s) => n + s.span, 0)).toBe(v.weeks.length);
  });

  it('shows the subjects with units or timetable blocks, in order', () => {
    const v = view(
      [unit('nombres', { plannedStartOn: '2026-09-14', plannedEndOn: '2026-10-09' })],
      ['fra', 'art'],
    );
    expect(v.rows.map((r) => r.subject.id)).toEqual(['fra', 'mat', 'art']);
    // A subject with blocks only: one empty lane, a cell per week.
    expect(v.rows[0]!.lanes).toHaveLength(1);
    expect(v.rows[0]!.lanes[0]).toHaveLength(v.weeks.length);
    expect(v.rows[0]!.lanes[0]!.every((c) => c.kind === 'empty')).toBe(true);
  });

  it('spans a unit over its weeks, and the lane still has one column per week', () => {
    const v = view([unit('nombres', { plannedStartOn: '2026-09-14', plannedEndOn: '2026-10-09' })]);
    const lane = v.rows[0]!.lanes[0]!;
    expect(unitCells(lane)).toEqual([['nombres', 2, 4]]);
    const columns = lane.reduce((n, c) => n + (c.kind === 'unit' ? c.span : 1), 0);
    expect(columns).toBe(v.weeks.length);
  });

  it('gives units that share a week their own lane, and names an overlap of dates', () => {
    const v = view([
      // Shares the week of 5 October with « fractions » but not a day.
      unit('nombres', {
        title: 'Les nombres',
        plannedStartOn: '2026-09-14',
        plannedEndOn: '2026-10-06',
      }),
      unit('fractions', {
        title: 'Les fractions',
        plannedStartOn: '2026-10-07',
        plannedEndOn: '2026-10-30',
      }),
      unit('mesure', {
        title: 'La mesure',
        plannedStartOn: '2026-10-19',
        plannedEndOn: '2026-11-13',
      }),
    ]);
    const lanes = v.rows[0]!.lanes;
    expect(lanes.map(unitCells)).toEqual([
      [
        ['nombres', 2, 4],
        ['mesure', 7, 4],
      ],
      [['fractions', 5, 4]],
    ]);
    expect(
      v.overlaps.map((o) => [o.subject.label, o.first.title, o.second.title, o.from, o.to]),
    ).toEqual([['Mathématiques', 'Les fractions', 'La mesure', '2026-10-19', '2026-10-30']]);
  });

  it('warns of weeks without school inside a unit, and of a unit outside the year', () => {
    const v = view([
      unit('fetes', { plannedStartOn: '2026-12-07', plannedEndOn: '2027-01-15' }),
      unit('mars', { subjectId: 'sci', plannedStartOn: '2027-03-01', plannedEndOn: '2027-03-26' }),
      unit('ete', { plannedStartOn: '2027-06-14', plannedEndOn: '2027-07-09' }),
    ]);
    expect(v.breaks.map((b) => [b.placed.unit.id, b.titles, b.weeks])).toEqual([
      ['fetes', ['Congé des Fêtes'], 2],
      ['mars', ['Congé de mars'], 1],
    ]);
    expect(v.outsideYear.map((p) => p.unit.id)).toEqual(['ete']);
    // Still on the grid, up to the year's last week.
    const ete = v.rows[0]!.lanes.flatMap(unitCells).find(([id]) => id === 'ete')!;
    expect(ete[1] + ete[2]).toBe(v.weeks.length);
  });

  it('dates units under way or finished from their lessons, and lists units without dates', () => {
    const v = view([
      unit('cours', { status: 'active', taughtOn: ['2026-09-21', '2026-09-23'] }),
      unit('fini', {
        subjectId: 'fra',
        status: 'completed',
        taughtOn: ['2026-09-08', '2026-09-18'],
      }),
      unit('plus-tard', { title: 'Plus tard' }),
      unit('vieux', {
        status: 'archived',
        plannedStartOn: '2026-09-08',
        plannedEndOn: '2026-09-18',
      }),
    ]);
    expect(v.inferred.map((p) => [p.unit.id, p.startsOn, p.endsOn])).toEqual([
      ['fini', '2026-09-08', '2026-09-18'],
      // Under way: up to today.
      ['cours', '2026-09-21', '2026-10-02'],
    ]);
    expect(v.unplaced.map((u) => u.id)).toEqual(['plus-tard']);
    // Archived units show nowhere; a subject with only those has no row.
    expect(v.rows.map((r) => r.subject.id)).toEqual(['fra', 'mat']);
  });

  it('lists the months with their school days, days off, events, report dates and units', () => {
    const v = view([
      unit('nombres', {
        title: 'Les nombres',
        plannedStartOn: '2026-09-14',
        plannedEndOn: '2026-10-09',
      }),
      unit('fetes', {
        title: 'Les fêtes',
        plannedStartOn: '2026-12-07',
        plannedEndOn: '2027-01-15',
      }),
    ]);
    expect(v.monthList.map((m) => m.month)).toEqual(v.months.map((m) => m.key));
    const [september, october, november, december, january] = v.monthList;
    expect(september).toMatchObject({ schoolDays: 21, current: false, daysOff: [] });
    expect(september!.units.map((p) => p.unit.id)).toEqual(['nombres']);
    expect(october).toMatchObject({
      schoolDays: 20,
      current: true,
      daysOff: [
        { title: 'Journée pédagogique', from: '2026-10-09', to: '2026-10-09' },
        { title: 'Action de grâce', from: '2026-10-12', to: '2026-10-12' },
      ],
    });
    expect(october!.events.map((e) => e.title)).toEqual(['Messe de l’Action de grâce']);
    expect(october!.markers.map((m) => m.what)).toEqual(['end']);
    expect(november!.events.map((e) => e.title)).toEqual(['Jour du Souvenir']);
    expect(november!.seasons.map((s) => s.season)).toEqual(['avent']);
    // The holidays as one range per month, over the weekend.
    expect(december!.daysOff).toEqual([
      { title: 'Congé des Fêtes', from: '2026-12-21', to: '2026-12-31' },
    ]);
    expect(december!.schoolDays).toBe(14);
    expect(january!.daysOff).toEqual([
      { title: 'Congé des Fêtes', from: '2027-01-01', to: '2027-01-01' },
    ]);
    expect(january!.schoolDays).toBe(20);
    expect(december!.seasons.map((s) => s.season)).toEqual(['avent', 'noel']);
    expect(january!.units.map((p) => p.unit.id)).toEqual(['fetes']);
    expect(v.monthList.at(-1)).toMatchObject({ month: '2027-06-01', schoolDays: 19 });
  });
});
