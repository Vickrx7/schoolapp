/**
 * The long-range plan PDF's interface words (DECISIONS D-127), in the reader's language: most are
 * « Mon année »'s own (`yearPlan.*`, `reportPeriods.*`, `units.*`), so screen and paper say the
 * same thing; `yearPlan.pdf.*` holds what only paper needs. The plan's content (unit titles, the
 * curriculum's attentes) is printed as typed. Not server-only, so the model and the renderer are
 * unit-tested with real messages.
 */
import type { LiturgicalBandSeason, ReportMarker, ReportPeriodKind } from '@lynx/domain';
import { createTranslator } from 'next-intl';
import type messages from '../../../messages/fr-CA.json';
import type { AppLocale } from '../../i18n/config';

export type TeamRole = 'homeroom' | 'subject' | 'support';

export interface YearPlanPdfLabels {
  locale: AppLocale;
  title: string;
  documentTitle: (className: string, year: string) => string;
  /** The file name's first words (ASCII): « plan-a-long-terme ». */
  fileName: string;
  subtitle: (className: string, year: string) => string;
  team: (names: string) => string;
  member: (name: string, role: TeamRole) => string;
  printedOn: (date: string) => string;
  glance: string;
  subject: string;
  monthDays: (count: number) => string;
  calendar: string;
  reports: string;
  seasons: string;
  dayOff: (title: string, dates: string) => string;
  season: (season: LiturgicalBandSeason, dates: string) => string;
  marker: (marker: ReportMarker, date: string) => string;
  inferredMark: string;
  inferredLegend: string;
  bySubject: string;
  window: (start: string, end: string) => string;
  length: (weeks: number, days: number) => string;
  inferred: string;
  expectations: string;
  noExpectations: string;
  toVerify: string;
  unplaced: (titles: string) => string;
  /** « Hors de l'année scolaire », and what replaces a unit's weeks there. */
  outsideYear: string;
  outsideYearLength: string;
  noUnits: string;
  coverage: {
    title: string;
    intro: (date: string) => string;
    how: string;
    none: string;
    columns: Record<'subject' | 'total' | 'taught' | 'planned' | 'notPlanned', string>;
  };
  footerToVerify: string;
  page: (page: number, total: number) => string;
  /** Shown instead of the PDF when it cannot be rendered, with a way back. */
  failed: string;
  failedBack: string;
}

export function yearPlanPdfLabels(locale: AppLocale, catalog: typeof messages): YearPlanPdfLabels {
  const t = createTranslator({ locale, messages: catalog });
  return {
    locale,
    title: t('yearPlan.pdf.title'),
    documentTitle: (className, year) => t('yearPlan.pdf.documentTitle', { className, year }),
    fileName: t('yearPlan.pdf.fileName'),
    subtitle: (className, year) => t('yearPlan.pdf.subtitle', { className, year }),
    team: (names) => t('yearPlan.pdf.team', { names }),
    member: (name, role) => t('yearPlan.pdf.member', { name, role: t(`classes.role.${role}`) }),
    printedOn: (date) => t('yearPlan.pdf.printedOn', { date }),
    glance: t('yearPlan.pdf.glance'),
    subject: t('yearPlan.pdf.subject'),
    monthDays: (count) => t('yearPlan.pdf.monthDays', { count }),
    calendar: t('yearPlan.grid.calendar'),
    reports: t('yearPlan.grid.reports'),
    seasons: t('yearPlan.grid.seasons'),
    dayOff: (title, dates) => t('yearPlan.pdf.dayOff', { title, dates }),
    season: (season, dates) =>
      t('yearPlan.pdf.season', { season: t(`yearPlan.seasons.${season}`), dates }),
    marker: (marker, date) =>
      t('yearPlan.reports.marker', {
        kind: t(`yearPlan.reports.short.${marker.kind as ReportPeriodKind}`),
        what: t(`yearPlan.reports.whatShort.${marker.what}`, { date }),
      }),
    inferredMark: t('yearPlan.pdf.inferredMark'),
    inferredLegend: t('yearPlan.pdf.inferredLegend'),
    bySubject: t('yearPlan.pdf.bySubject'),
    window: (start, end) => t('yearPlan.pdf.window', { start, end }),
    length: (weeks, days) => t('yearPlan.unit.summary', { weeks, days }),
    inferred: t('yearPlan.pdf.inferred'),
    expectations: t('yearPlan.unit.expectations'),
    noExpectations: t('yearPlan.unit.noExpectations'),
    toVerify: t('yearPlan.pdf.toVerify'),
    unplaced: (titles) => t('yearPlan.pdf.unplaced', { titles }),
    outsideYear: t('yearPlan.pdf.outsideYear'),
    outsideYearLength: t('yearPlan.pdf.outsideYearLength'),
    noUnits: t('yearPlan.pdf.noUnits'),
    coverage: {
      title: t('yearPlan.pdf.coverageTitle'),
      intro: (date) => t('yearPlan.pdf.coverageIntro', { date }),
      how: t('yearPlan.pdf.coverageHow'),
      none: t('yearPlan.pdf.coverageNone'),
      columns: {
        subject: t('yearPlan.pdf.columns.subject'),
        total: t('yearPlan.pdf.columns.total'),
        taught: t('yearPlan.pdf.columns.taught'),
        planned: t('yearPlan.pdf.columns.planned'),
        notPlanned: t('yearPlan.pdf.columns.notPlanned'),
      },
    },
    footerToVerify: t('yearPlan.pdf.footerToVerify'),
    page: (page, total) => t('pdf.page', { page, total }),
    failed: t('yearPlan.pdf.failed'),
    failedBack: t('yearPlan.pdf.failedBack'),
  };
}
