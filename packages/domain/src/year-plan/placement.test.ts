import { describe, expect, it } from 'vitest';
import { placeUnits, unitWindow, type PlacementUnit } from './placement';
import { CLASS, SCHOOL, YEAR, seededDaysOff } from './test-calendar';
import { schoolWeeks } from './weeks';

const MAT = 'mat';
const FRA = 'fra';
const weeks = schoolWeeks({ ...YEAR, events: seededDaysOff(), schoolId: SCHOOL, classId: CLASS });
const TODAY = '2026-10-02';

const unit = (id: string, overrides: Partial<PlacementUnit> = {}): PlacementUnit => ({
  id,
  subjectId: MAT,
  title: id,
  status: 'planned',
  plannedStartOn: null,
  plannedEndOn: null,
  taughtOn: [],
  ...overrides,
});

describe('units on the year (D-123, D-126)', () => {
  it('places a unit on its planned window', () => {
    const placed = placeUnits(
      [unit('fractions', { plannedStartOn: '2027-01-11', plannedEndOn: '2027-02-05' })],
      weeks,
      TODAY,
    );
    expect(placed.bySubject.get(MAT)).toEqual([
      [
        expect.objectContaining({
          startsOn: '2027-01-11',
          endsOn: '2027-02-05',
          inferred: false,
          lateStart: false,
          lane: 0,
        }),
      ],
    ]);
    expect(placed.overlaps).toEqual([]);
    expect(placed.outsideYear).toEqual([]);
    expect(placed.unplaced).toEqual([]);
  });

  it('puts overlapping units of a subject on lanes, and names the overlap', () => {
    const placed = placeUnits(
      [
        unit('fractions', { plannedStartOn: '2026-10-05', plannedEndOn: '2026-10-30' }),
        unit('nombres', { plannedStartOn: '2026-09-08', plannedEndOn: '2026-10-16' }),
        unit('mesure', { plannedStartOn: '2026-11-02', plannedEndOn: '2026-11-27' }),
        unit('lecture', {
          subjectId: FRA,
          plannedStartOn: '2026-10-05',
          plannedEndOn: '2026-10-30',
        }),
      ],
      weeks,
      TODAY,
    );
    const lanes = placed.bySubject.get(MAT)!;
    expect(lanes.map((l) => l.map((p) => p.unit.id))).toEqual([
      ['nombres', 'mesure'],
      ['fractions'],
    ]);
    expect(placed.overlaps).toEqual([
      {
        subjectId: MAT,
        first: 'nombres',
        second: 'fractions',
        from: '2026-10-05',
        to: '2026-10-16',
      },
    ]);
    expect(placed.bySubject.get(FRA)!).toHaveLength(1);
  });

  it('lists a unit whose window is outside the school year', () => {
    const placed = placeUnits(
      [unit('early', { plannedStartOn: '2026-08-24', plannedEndOn: '2026-09-11' })],
      weeks,
      TODAY,
    );
    expect(placed.outsideYear.map((p) => p.unit.id)).toEqual(['early']);
  });

  it('infers the window of a unit under way or finished from its lessons taught', () => {
    const active = unit('active', { status: 'active', taughtOn: ['2026-09-15', '2026-09-10'] });
    const done = unit('done', {
      status: 'completed',
      subjectId: FRA,
      taughtOn: ['2026-09-10', '2026-09-15'],
    });
    expect(unitWindow(active, TODAY)).toEqual({
      startsOn: '2026-09-10',
      endsOn: TODAY,
      inferred: true,
    });
    expect(unitWindow(done, TODAY)).toEqual({
      startsOn: '2026-09-10',
      endsOn: '2026-09-15',
      inferred: true,
    });
    const placed = placeUnits([active, done], weeks, TODAY);
    expect(placed.bySubject.get(MAT)![0]![0]).toMatchObject({ inferred: true, endsOn: TODAY });
    expect(placed.unplaced).toEqual([]);
  });

  it('a saved window wins over the lessons taught', () => {
    expect(
      unitWindow(
        unit('a', {
          status: 'active',
          plannedStartOn: '2026-09-08',
          plannedEndOn: '2026-10-16',
          taughtOn: ['2026-09-02'],
        }),
        TODAY,
      ),
    ).toEqual({ startsOn: '2026-09-08', endsOn: '2026-10-16', inferred: false });
  });

  it('leaves units with no dates aside, and archived units out', () => {
    const placed = placeUnits(
      [
        unit('idea'),
        unit('started', { status: 'active' }),
        unit('old', {
          status: 'archived',
          plannedStartOn: '2026-09-08',
          plannedEndOn: '2026-09-25',
        }),
      ],
      weeks,
      TODAY,
    );
    expect(placed.unplaced.map((u) => u.id)).toEqual(['idea', 'started']);
    expect(placed.bySubject.size).toBe(0);
  });

  it('flags a planned unit whose start has passed', () => {
    const placed = placeUnits(
      [
        unit('late', { plannedStartOn: '2026-09-28', plannedEndOn: '2026-10-23' }),
        unit('soon', {
          subjectId: FRA,
          plannedStartOn: '2026-10-05',
          plannedEndOn: '2026-10-23',
        }),
      ],
      weeks,
      TODAY,
    );
    expect(placed.bySubject.get(MAT)![0]![0]!.lateStart).toBe(true);
    expect(placed.bySubject.get(FRA)![0]![0]!.lateStart).toBe(false);
  });
});
