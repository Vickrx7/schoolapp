/**
 * A class's year for the long-range plan's tests (year-plan-model.test.ts, render.test.ts): the
 * demo year with some of the seed's days off, a report period, Mathématiques units with attentes
 * « à vérifier », a Français unit dated from its lessons and one without dates.
 */
import { schoolWeeks, type ReportPeriod, type YearCalendarEvent } from '@lynx/domain';
import en from '../../../messages/en-CA.json';
import fr from '../../../messages/fr-CA.json';
import { yearPlanPdfLabels } from './year-plan-labels';
import type { YearPlanPdfInput, YearPlanPdfUnit } from './year-plan-model';

export const YEAR_PLAN_FR = yearPlanPdfLabels('fr-CA', fr);
export const YEAR_PLAN_EN = yearPlanPdfLabels('en-CA', en as typeof fr);

/** The demo year: 2026-09-02 (a Wednesday) to 2027-06-25, with some of the seed's days off. */
const YEAR = { name: '2026-2027', startsOn: '2026-09-02', endsOn: '2027-06-25' };
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

const PERIODS: ReportPeriod[] = [
  {
    kind: 'progress',
    startsOn: '2026-09-02',
    endsOn: '2026-10-30',
    dueOn: '2026-11-06',
    issuedOn: '2026-11-13',
  },
];

export const unit = (id: string, overrides: Partial<YearPlanPdfUnit> = {}): YearPlanPdfUnit => ({
  id,
  subjectId: 'mat',
  title: id,
  status: 'planned',
  plannedStartOn: null,
  plannedEndOn: null,
  taughtOn: [],
  expectations: [],
  ...overrides,
});

export const UNITS: YearPlanPdfUnit[] = [
  unit('numbers', {
    title: 'Les nombres jusqu’à 1 000',
    status: 'active',
    plannedStartOn: '2026-09-14',
    plannedEndOn: '2026-10-09',
    expectations: [
      {
        code: 'B1.1',
        text: 'Lire et représenter les nombres naturels jusqu’à 1 000.',
        verified: false,
      },
      { code: 'B1.2', text: 'Comparer et ordonner des nombres.', verified: false },
    ],
  }),
  unit('addition', {
    title: 'L’addition et la soustraction',
    plannedStartOn: '2026-10-13',
    plannedEndOn: '2026-11-06',
  }),
  // Dated from its lessons: the first of October to the second.
  unit('read', {
    subjectId: 'fra',
    title: 'Lire pour s’informer',
    status: 'completed',
    taughtOn: ['2026-10-01', '2026-10-02'],
  }),
  unit('fractions', { title: 'Les fractions' }),
];

export const yearPlanInput = (overrides: Partial<YearPlanPdfInput> = {}): YearPlanPdfInput => ({
  className: '3e année',
  schoolName: 'École Sainte-Marie',
  team: [{ name: 'Mme Isabelle Tremblay', role: 'homeroom' }],
  year: YEAR,
  today: '2026-10-02',
  weeks: schoolWeeks({ ...YEAR, events: EVENTS, schoolId: SCHOOL, classId: CLASS }),
  periods: PERIODS,
  units: UNITS,
  subjects: [
    { id: 'fra', label: 'Français', color: null },
    { id: 'mat', label: 'Mathématiques', color: null },
    { id: 'art', label: 'Arts', color: null },
  ],
  blockSubjectIds: new Set(['art']),
  coverage: null,
  ...overrides,
});
