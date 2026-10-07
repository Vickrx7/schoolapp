/**
 * What « Plan à long terme » prints (DECISIONS D-127), as plain strings ready to lay out:
 * - page 1, landscape: the year at a glance, one column per month and one row each for the
 *   calendar (days off and masses), the report dates, the liturgical seasons and every subject of
 *   the year view (the units that touch the month, with their dates);
 * - then the units by subject, in date order: their dates, weeks and school days, and the
 *   attentes they aim at (code and text, « à vérifier » while a summary), then those without
 *   dates;
 * - only when asked (`?coverage=1`), « Couverture des attentes »: the whole year's counts per
 *   subject, as « Couverture » computes them (D-125). Off by default: the plan is not a scorecard.
 *
 * It never reads students: its input has none. Unit titles are the teacher's own words, printed
 * as typed; a unit's description is not printed. Labels follow the reader's language. The year
 * view's model (`buildYearView`) places the units, so screen and paper agree.
 *
 * Pure and not server-only, so it can be unit tested.
 */
import {
  unitSchoolDays,
  weeksOf,
  type CoverageCounts,
  type LocalDate,
  type PlacedUnit,
  type PlacementUnit,
  type ReportPeriod,
  type SchoolWeek,
} from '@lynx/domain';
import type { AppLocale } from '../../i18n/config';
import { formatLocalDate } from '../../lib/format';
import { buildYearView, type YearViewSubject } from '../planning/year-view';
import { pdfFileSlug } from './library-model';
import type { TeamRole, YearPlanPdfLabels } from './year-plan-labels';

/** An attente a unit aims at, as printed. */
export interface YearPlanPdfExpectation {
  code: string;
  text: string;
  verified: boolean;
}

export interface YearPlanPdfUnit extends PlacementUnit {
  /** Its unit-level attentes, in the curriculum's order. */
  expectations: YearPlanPdfExpectation[];
}

export interface YearPlanPdfInput {
  className: string;
  schoolName: string;
  /** The class team, as the class page names it. */
  team: { name: string; role: TeamRole }[];
  year: { name: string; startsOn: LocalDate; endsOn: LocalDate };
  /** The school's date today. */
  today: LocalDate;
  weeks: readonly SchoolWeek[];
  periods: readonly ReportPeriod[];
  /** The class's units, archived ones aside. */
  units: readonly YearPlanPdfUnit[];
  /** The rows' subjects, in order (the year view's). */
  subjects: readonly YearViewSubject[];
  blockSubjectIds: ReadonlySet<string>;
  /** `?coverage=1`: the whole year's counts per subject (and grade); null otherwise. */
  coverage: {
    rows: { label: string; counts: CoverageCounts }[];
    /** Some attente counted is a summary « à vérifier ». */
    unverified: boolean;
  } | null;
}

/** A line in a cell of the year at a glance: a unit's title and dates, a day off, a season. */
export interface YearPlanPdfCellItem {
  text: string;
  detail: string | null;
}

export interface YearPlanPdfRow {
  kind: 'calendar' | 'reports' | 'seasons' | 'subject';
  label: string;
  /** One cell per month. */
  cells: YearPlanPdfCellItem[][];
}

export interface YearPlanPdfUnitEntry {
  key: string;
  title: string;
  /** « Du 14 septembre au 9 octobre » */
  when: string;
  /** « 4 semaines · 19 jours de classe » */
  length: string;
  /** « Dates d'après les leçons données », for dates not saved yet. */
  inferred: string | null;
  expectations: { code: string; text: string; toVerify: string | null }[];
}

export interface YearPlanPdfSection {
  key: string;
  subject: string;
  units: YearPlanPdfUnitEntry[];
  /**
   * Units dated wholly outside the school year (a year edited afterwards), under « Hors de l'année
   * scolaire », as the year view lists them (post-MVP review).
   */
  outsideYear: { title: string; units: YearPlanPdfUnitEntry[] } | null;
  /** « Unités sans dates : … » */
  unplaced: string | null;
}

export interface YearPlanPdfModel {
  info: { title: string; language: AppLocale };
  /** ASCII only: `plan-a-long-terme-3e-annee-2026-2027.pdf`. */
  fileName: string;
  header: { school: string; title: string; subtitle: string; lines: string[] };
  glance: {
    title: string;
    subjectLabel: string;
    months: { key: string; label: string; days: string }[];
    rows: YearPlanPdfRow[];
    /** « † Dates d'après les leçons données… », when a unit's dates are inferred. */
    legend: string | null;
  };
  bySubject: {
    title: string;
    /** « Attentes visées », and what a unit without any says. */
    expectationsLabel: string;
    noExpectations: string;
    sections: YearPlanPdfSection[];
    /** « Aucune unité pour l'instant. » */
    empty: string | null;
  };
  coverage: {
    title: string;
    intro: string;
    columns: string[];
    rows: { key: string; label: string; values: string[] }[];
    notes: string[];
  } | null;
  footer: {
    left: string;
    /** « Les attentes « à vérifier » sont des résumés. », when one is printed. */
    note: string | null;
    page: (page: number, total: number) => string;
  };
}

const MASS_TYPES = new Set(['mass', 'liturgy']);

export function buildYearPlanPdfModel(
  input: YearPlanPdfInput,
  labels: YearPlanPdfLabels,
): YearPlanPdfModel {
  const { locale } = labels;
  // A date never breaks across lines (« 9 oct. », « 1er octobre »).
  const date = (value: LocalDate, options: Intl.DateTimeFormatOptions) =>
    formatLocalDate(value, locale, options).replace(/ /g, '\u00a0');
  const short = (value: LocalDate) => date(value, { day: 'numeric', month: 'short' });
  const long = (value: LocalDate) => date(value, { day: 'numeric', month: 'long' });
  const dated = (value: LocalDate) =>
    date(value, { day: 'numeric', month: 'long', year: 'numeric' });
  const range = (from: LocalDate, to: LocalDate) =>
    from === to ? short(from) : `${short(from)}–${short(to)}`;
  const monthName = (month: LocalDate) => {
    const text = formatLocalDate(month, locale, { month: 'long' });
    return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
  };

  const view = buildYearView({
    year: input.year,
    weeks: input.weeks,
    periods: input.periods,
    units: input.units,
    subjects: input.subjects,
    blockSubjectIds: input.blockSubjectIds,
    today: input.today,
  });

  // The year at a glance: one column per month.
  const months = view.monthList;
  const unitItem = (p: PlacedUnit<YearPlanPdfUnit>): YearPlanPdfCellItem => ({
    text: p.unit.title,
    detail: `${range(p.startsOn, p.endsOn)}${p.inferred ? ` ${labels.inferredMark}` : ''}`,
  });
  const rows: YearPlanPdfRow[] = [
    {
      kind: 'calendar',
      label: labels.calendar,
      cells: months.map((m) => [
        ...m.daysOff.map((d) => ({
          text: labels.dayOff(d.title, range(d.from, d.to)),
          detail: null,
        })),
        ...m.events
          .filter((e) => MASS_TYPES.has(e.type))
          .map((e) => ({ text: labels.dayOff(e.title, range(e.from, e.to)), detail: null })),
      ]),
    },
    {
      kind: 'reports',
      label: labels.reports,
      cells: months.map((m) =>
        m.markers.map((marker) => ({
          text: labels.marker(marker, short(marker.date)),
          detail: null,
        })),
      ),
    },
    {
      kind: 'seasons',
      label: labels.seasons,
      cells: months.map((m) =>
        m.seasons.map((s) => ({
          text: labels.season(s.season, range(s.from, s.to)),
          detail: null,
        })),
      ),
    },
    ...view.rows.map((row) => ({
      kind: 'subject' as const,
      label: row.subject.label,
      cells: months.map((m) =>
        m.units.filter((p) => p.unit.subjectId === row.subject.id).map(unitItem),
      ),
    })),
  ];

  // The units by subject, in date order, then those without dates.
  let unverified = input.coverage?.unverified ?? false;
  const entry = (p: PlacedUnit<YearPlanPdfUnit>): YearPlanPdfUnitEntry => {
    if (p.unit.expectations.some((e) => !e.verified)) unverified = true;
    return {
      key: p.unit.id,
      title: p.unit.title,
      when: labels.window(long(p.startsOn), long(p.endsOn)),
      length: labels.length(weeksOf(p, input.weeks).length, unitSchoolDays(p, input.weeks)),
      inferred: p.inferred ? labels.inferred : null,
      expectations: p.unit.expectations.map((e) => ({
        code: e.code,
        text: e.text,
        toVerify: e.verified ? null : labels.toVerify,
      })),
    };
  };
  const placed = view.rows.map((row) => ({
    subject: row.subject,
    units: row.lanes
      .flat()
      .flatMap((cell) => (cell.kind === 'unit' ? [cell.placed] : []))
      .sort(
        (a, b) =>
          a.startsOn.localeCompare(b.startsOn) || a.unit.title.localeCompare(b.unit.title, 'fr-CA'),
      ),
  }));
  const sections: YearPlanPdfSection[] = input.subjects.flatMap((subject) => {
    const units = placed.find((p) => p.subject.id === subject.id)?.units ?? [];
    const outside = view.outsideYear.filter((p) => p.unit.subjectId === subject.id);
    const unplaced = view.unplaced.filter((u) => u.subjectId === subject.id);
    if (units.length === 0 && outside.length === 0 && unplaced.length === 0) return [];
    return [
      {
        key: subject.id,
        subject: subject.label,
        units: units.map(entry),
        outsideYear: outside.length
          ? {
              title: labels.outsideYear,
              units: outside.map((p) => ({ ...entry(p), length: labels.outsideYearLength })),
            }
          : null,
        unplaced: unplaced.length ? labels.unplaced(unplaced.map((u) => u.title).join(', ')) : null,
      },
    ];
  });

  const coverage = input.coverage
    ? {
        title: labels.coverage.title,
        intro: labels.coverage.intro(dated(input.today)),
        columns: [
          labels.coverage.columns.subject,
          labels.coverage.columns.total,
          labels.coverage.columns.taught,
          labels.coverage.columns.planned,
          labels.coverage.columns.notPlanned,
        ],
        rows: input.coverage.rows.map((r, i) => ({
          key: String(i),
          label: r.label,
          values: [r.counts.total, r.counts.taught, r.counts.planned, r.counts.notPlanned].map(
            (n) => n.toLocaleString(locale),
          ),
        })),
        notes: input.coverage.rows.length ? [labels.coverage.how] : [labels.coverage.none],
      }
    : null;

  const title = labels.documentTitle(input.className, input.year.name);
  return {
    info: { title, language: locale },
    fileName: `${labels.fileName}-${pdfFileSlug(`${input.className} ${input.year.name}`)}.pdf`,
    header: {
      school: input.schoolName,
      title: labels.title,
      subtitle: labels.subtitle(input.className, input.year.name),
      lines: [
        ...(input.team.length
          ? [labels.team(input.team.map((m) => labels.member(m.name, m.role)).join(', '))]
          : []),
        labels.printedOn(dated(input.today)),
      ],
    },
    glance: {
      title: labels.glance,
      subjectLabel: labels.subject,
      months: months.map((m) => ({
        key: m.month,
        label: monthName(m.month),
        days: labels.monthDays(m.schoolDays),
      })),
      rows,
      legend: view.inferred.length ? labels.inferredLegend : null,
    },
    bySubject: {
      title: labels.bySubject,
      expectationsLabel: labels.expectations,
      noExpectations: labels.noExpectations,
      sections,
      empty: sections.length ? null : labels.noUnits,
    },
    coverage,
    footer: {
      left: title,
      note: unverified ? labels.footerToVerify : null,
      page: labels.page,
    },
  };
}
