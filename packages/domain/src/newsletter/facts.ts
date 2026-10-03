/**
 * « Info-parents » (DECISIONS D-136, D-137): what the app knows about a class's week, for the
 * first draft of the message to families. Only the class's own planning and calendar: the lessons
 * of the week and the next one, a planned unit about to start, the dates to remember (days off,
 * early dismissals, masses and other events, a report card going home, a liturgical season
 * starting), tips from the library's family guides and a faith moment. Never an event's notes
 * (staff-facing), an attente, the coverage, a level, an alert or anything about a student.
 *
 * Windows (**Assumptions**):
 * - this week: Monday to Friday of `weekOf` (the lessons taught, then those still to come from the
 *   preparation date);
 * - next week: the following Monday to Friday (the lessons the timetable gives from the
 *   preparation date on, so the sequence carries on across days off);
 * - dates: from the day after the preparation date (or `weekOf`, for a week still to come) to the
 *   Friday two weeks after `weekOf`.
 */
import {
  NO_SCHOOL_EVENT_TYPES,
  SHORTENING_EVENT_TYPES,
  type CalendarEvent,
  type CalendarEventType,
} from '../calendar';
import { addDays, type LocalDate } from '../dates';
import {
  assignLessonsToSlots,
  isDone,
  nextLessons,
  type ProgressStatus,
  type TeachingSlot,
} from '../lessons';
import type { ScheduleConfig } from '../schedule';
import { isTeachable, isTeachersBlock, resolveSchoolDay, type TimetableBlock } from '../school-day';
import {
  liturgicalSeasonOn,
  rankCatholicReferences,
  type CatholicReference,
} from '../sub-plan/catholic';
import { compareFr } from '../sub-plan/text';
import type { ReportPeriod, ReportPeriodKind } from '../year-plan/report-periods';
import { plannedUnitFor } from '../year-plan/today';
import type { DateWindow } from '../year-plan/weeks';

export interface NewsletterLesson {
  id: string;
  sequenceNumber: number;
  title: string;
  /** The lesson's attentes (`unit_lesson_expectations`). */
  expectationIds: readonly string[];
  /** The library item the lesson uses, if any. */
  libraryItemId: string | null;
}

export interface NewsletterUnit {
  id: string;
  subjectId: string;
  title: string;
  status: 'planned' | 'active' | 'completed' | 'archived';
  plannedStartOn: LocalDate | null;
  plannedEndOn: LocalDate | null;
  /** The unit's own attentes (`unit_expectations`). */
  expectationIds: readonly string[];
  lessons: readonly NewsletterLesson[];
}

/** A family guide of the library (`parent_guide`) the class may use. */
export interface NewsletterGuide {
  id: string;
  title: string;
  /** Its attentes (`library_item_expectations`). */
  expectationIds: readonly string[];
  /** « À la maison », in French and in English (the guide's two halves, point for point). */
  atHomeFr: readonly string[];
  atHomeEn: readonly string[];
}

export interface NewsletterReference extends CatholicReference {
  textEn: string | null;
}

export interface NewsletterSubjectLabel {
  fr: string;
  en: string;
}

export interface NewsletterFactsInput {
  classId: string;
  /** The week's Monday. */
  weekOf: LocalDate;
  /** The school's date today. */
  preparedOn: LocalDate;
  /** The class's school year. */
  year: DateWindow;
  schedule: ScheduleConfig;
  /** The board's, the school's and the class's events (others are left out here). */
  events: readonly CalendarEvent[];
  /** The class's timetable. */
  blocks: readonly TimetableBlock[];
  /** The class's units, with their lessons. */
  units: readonly NewsletterUnit[];
  progress: ReadonlyMap<string, ProgressStatus>;
  taughtOn: ReadonlyMap<string, LocalDate | null>;
  /** The board's report periods for the class's year. */
  periods: readonly ReportPeriod[];
  subjects: ReadonlyMap<string, NewsletterSubjectLabel>;
  /** Who prepares it: her subjects only, unless `includeColleagues`. */
  teacherId: string;
  homeroom: boolean;
  includeColleagues: boolean;
  /** Active references (the board's and the shared ones); none when the faith moment is off. */
  refs: readonly NewsletterReference[];
  gradeOrdinals: readonly number[];
  boardId: string;
  /** Usable family guides, best first; none when the tips are off. */
  guides: readonly NewsletterGuide[];
  /** The parent of each attente involved (the units' and the guides'), for D-069's rule. */
  expectationParents: ReadonlyMap<string, string | null>;
}

export interface NewsletterLessonLine {
  subjectId: string;
  subject: NewsletterSubjectLabel;
  unitId: string;
  unitTitle: string;
  lessons: { id: string; title: string }[];
}

export interface NewsletterUnitStart {
  subjectId: string;
  subject: NewsletterSubjectLabel;
  unitId: string;
  title: string;
  startsOn: LocalDate;
}

export type NewsletterDate =
  | {
      kind: 'dayOff';
      id: string;
      from: LocalDate;
      to: LocalDate;
      title: string;
      type: CalendarEventType;
    }
  | {
      kind: 'earlyDismissal' | 'lateStart';
      id: string;
      from: LocalDate;
      /** When classes end (early dismissal) or begin (late start). */
      time: string | null;
      title: string;
      type: CalendarEventType;
    }
  | {
      kind: 'event';
      id: string;
      from: LocalDate;
      to: LocalDate;
      time: string | null;
      title: string;
      type: CalendarEventType;
    }
  | { kind: 'report'; from: LocalDate; period: ReportPeriodKind }
  | { kind: 'season'; from: LocalDate; season: 'avent' | 'noel' | 'careme' | 'paques' };

export interface NewsletterGuideTips {
  id: string;
  title: string;
  tips: { fr: string; en: string }[];
}

export interface NewsletterFacts {
  weekOf: LocalDate;
  thisWeek: NewsletterLessonLine[];
  nextWeek: NewsletterLessonLine[];
  /** A cycle school whose next week's days are unknown (no anchor): the next lessons per unit. */
  nextLessonsOnly: boolean;
  unitStarts: NewsletterUnitStart[];
  dates: NewsletterDate[];
  guides: NewsletterGuideTips[];
  faith: NewsletterReference | null;
}

/** At most this many guides, and tips from each (**Assumption**). */
export const NEWSLETTER_GUIDES = 2;
export const NEWSLETTER_TIPS_PER_GUIDE = 3;
/** Lessons shown per unit when a cycle day is unknown. */
const NEXT_LESSONS = 3;

/** The dated events of the message: never `other` (staff meetings and the like). */
const DATED_EVENT_TYPES: readonly CalendarEventType[] = [
  'mass',
  'liturgy',
  'assembly',
  'field_trip',
];

const later = (a: LocalDate, b: LocalDate) => (a > b ? a : b);
const earlier = (a: LocalDate, b: LocalDate) => (a < b ? a : b);

export function newsletterFacts(input: NewsletterFactsInput): NewsletterFacts {
  const { classId, weekOf, preparedOn } = input;
  const friday = addDays(weekOf, 4);
  const nextMonday = addDays(weekOf, 7);
  const nextFriday = addDays(weekOf, 11);
  const events = input.events.filter((e) => e.classId === null || e.classId === classId);
  const homeroom = new Set(input.homeroom ? [classId] : []);
  const label = (subjectId: string) =>
    input.subjects.get(subjectId) ?? { fr: subjectId, en: subjectId };

  // Her subjects: those of her blocks (hers, or the homeroom's blocks without a teacher), and for
  // the homeroom teacher the subjects no block names; everything with « mes collègues ».
  const classBlocks = input.blocks.filter((b) => b.classId === classId);
  const mine = (b: Pick<TimetableBlock, 'teacherId' | 'classId'>) =>
    input.includeColleagues || isTeachersBlock(b, input.teacherId, homeroom);
  const blockSubjects = new Set(classBlocks.flatMap((b) => (b.subjectId ? [b.subjectId] : [])));
  const mySubjects = new Set(
    classBlocks.flatMap((b) =>
      b.subjectId && b.kind === 'subject' && mine(b) ? [b.subjectId] : [],
    ),
  );
  const subjectIncluded = (subjectId: string) =>
    input.includeColleagues ||
    mySubjects.has(subjectId) ||
    (input.homeroom && !blockSubjects.has(subjectId));

  const unitById = new Map(input.units.map((u) => [u.id, u]));
  const lessonUnit = new Map(input.units.flatMap((u) => u.lessons.map((l) => [l.id, u] as const)));

  // The lessons the timetable gives from the preparation date (or the week's Monday) to next
  // Friday, continuing each subject's sequence (`assignLessonsToSlots`).
  const activeUnits = new Map(
    input.units
      .filter((u) => u.status === 'active')
      .map((u) => [`${classId}:${u.subjectId}`, { unitId: u.id, lessons: u.lessons }] as const),
  );
  const slots: (TeachingSlot & { mine: boolean })[] = [];
  let unknownNextWeek = false;
  for (let date = later(preparedOn, weekOf); date <= nextFriday; date = addDays(date, 1)) {
    const day = resolveSchoolDay({
      date,
      classId,
      schedule: input.schedule,
      events,
      blocks: classBlocks,
    });
    if (day.day.status === 'unknown_cycle_day') {
      if (date >= nextMonday) unknownNextWeek = true;
      continue;
    }
    for (const block of day.blocks) {
      if (!isTeachable(block) || !block.subjectId) continue;
      slots.push({
        slotId: `${block.id}@${date}`,
        date,
        classId,
        subjectId: block.subjectId,
        mine: mine(block),
      });
    }
  }
  const assignments = assignLessonsToSlots(slots, activeUnits, input.progress, {
    taughtOn: input.taughtOn,
  });

  const lines = (lessonIds: Iterable<string>): NewsletterLessonLine[] => {
    const byUnit = new Map<string, Set<string>>();
    for (const id of lessonIds) {
      const unit = lessonUnit.get(id);
      if (!unit || !subjectIncluded(unit.subjectId)) continue;
      byUnit.set(unit.id, (byUnit.get(unit.id) ?? new Set()).add(id));
    }
    return [...byUnit.entries()]
      .map(([unitId, ids]) => {
        const unit = unitById.get(unitId)!;
        return {
          subjectId: unit.subjectId,
          subject: label(unit.subjectId),
          unitId,
          unitTitle: unit.title,
          lessons: [...unit.lessons]
            .filter((l) => ids.has(l.id))
            .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
            .map((l) => ({ id: l.id, title: l.title })),
        };
      })
      .sort((a, b) => compareFr(a.subject.fr, b.subject.fr) || compareFr(a.unitTitle, b.unitTitle));
  };

  // This week: what was taught (completed, or reported by a substitute; never skipped), then what
  // the timetable still gives until Friday.
  const thisWeekIds: string[] = [];
  for (const unit of input.units) {
    for (const lesson of unit.lessons) {
      const status = input.progress.get(lesson.id);
      const on = input.taughtOn.get(lesson.id);
      if (status !== 'skipped' && isDone(status) && on && on >= weekOf && on <= friday) {
        thisWeekIds.push(lesson.id);
      }
    }
  }
  const nextWeekIds: string[] = [];
  assignments.forEach((a, i) => {
    const slot = slots[i]!;
    if (!a.lesson || !slot.mine) return;
    if (slot.date <= friday) {
      if (a.reason === 'assigned') thisWeekIds.push(a.lesson.id);
    } else if (slot.date >= nextMonday) {
      nextWeekIds.push(a.lesson.id);
    }
  });

  // A cycle school without an anchor: the next lessons of each unit under way (« Prochaines
  // leçons »), from the lessons not done.
  let nextWeek: NewsletterLessonLine[];
  if (unknownNextWeek) {
    const ids = input.units
      .filter((u) => u.status === 'active' && subjectIncluded(u.subjectId))
      .flatMap((u) =>
        nextLessons(u.lessons, input.progress, { count: NEXT_LESSONS }).next.map((l) => l.id),
      );
    nextWeek = lines(ids);
  } else {
    nextWeek = lines(nextWeekIds);
  }
  const thisWeek = lines(thisWeekIds);

  // A planned unit of her subjects whose window starts by next Friday (« Mon année », D-126).
  const planned = input.units
    .filter((u) => u.status === 'planned' && subjectIncluded(u.subjectId))
    .map((u) => ({ ...u, classId }));
  const unitStarts: NewsletterUnitStart[] = [];
  for (const subjectId of new Set(planned.map((u) => u.subjectId))) {
    const unit = plannedUnitFor({ units: planned, classId, subjectId, date: nextMonday });
    if (unit) {
      unitStarts.push({
        subjectId,
        subject: label(subjectId),
        unitId: unit.id,
        title: unit.title,
        startsOn: later(unit.plannedStartOn!, nextMonday),
      });
    }
  }
  unitStarts.sort((a, b) => compareFr(a.subject.fr, b.subject.fr));

  return {
    weekOf,
    thisWeek,
    nextWeek,
    nextLessonsOnly: unknownNextWeek,
    unitStarts,
    dates: newsletterDates(input, events),
    guides: pickGuides(input, [...thisWeek, ...nextWeek], unitStarts),
    faith: pickFaith(input, [...thisWeek, ...nextWeek], events),
  };
}

/** The window of « Dates à retenir ». */
export function newsletterDatesWindow(weekOf: LocalDate, preparedOn: LocalDate): DateWindow {
  return {
    startsOn: preparedOn >= weekOf ? addDays(preparedOn, 1) : weekOf,
    endsOn: addDays(weekOf, 18),
  };
}

function newsletterDates(
  input: NewsletterFactsInput,
  events: readonly CalendarEvent[],
): NewsletterDate[] {
  const window = newsletterDatesWindow(input.weekOf, input.preparedOn);
  const { startsOn, endsOn } = window;
  const dates: NewsletterDate[] = [];
  for (const e of events) {
    if (e.endsOn < startsOn || e.startsOn > endsOn) continue;
    const from = later(e.startsOn, startsOn);
    const to = earlier(e.endsOn, endsOn);
    if (NO_SCHOOL_EVENT_TYPES.includes(e.eventType)) {
      // Only a day off for the school (as the timetable reads it).
      if (e.classId === null && e.affectsSchedule) {
        dates.push({ kind: 'dayOff', id: e.id, from, to, title: e.title, type: e.eventType });
      }
    } else if (SHORTENING_EVENT_TYPES.includes(e.eventType)) {
      const early = e.eventType === 'early_dismissal';
      dates.push({
        kind: early ? 'earlyDismissal' : 'lateStart',
        id: e.id,
        from,
        time: early ? e.startTime : e.endTime,
        title: e.title,
        type: e.eventType,
      });
    } else if (DATED_EVENT_TYPES.includes(e.eventType)) {
      dates.push({
        kind: 'event',
        id: e.id,
        from,
        to,
        time: e.startTime,
        title: e.title,
        type: e.eventType,
      });
    }
  }
  // A report card going home (« remise aux familles »).
  for (const p of input.periods) {
    if (p.issuedOn && p.issuedOn >= startsOn && p.issuedOn <= endsOn) {
      dates.push({ kind: 'report', from: p.issuedOn, period: p.kind });
    }
  }
  // A liturgical season starting (Ordinary Time aside).
  for (let date = startsOn; date <= endsOn; date = addDays(date, 1)) {
    const season = liturgicalSeasonOn(date);
    if (season !== 'temps_ordinaire' && liturgicalSeasonOn(addDays(date, -1)) !== season) {
      dates.push({ kind: 'season', from: date, season });
    }
  }
  const order: Record<NewsletterDate['kind'], number> = {
    dayOff: 0,
    season: 1,
    report: 2,
    lateStart: 3,
    event: 4,
    earlyDismissal: 5,
  };
  const time = (d: NewsletterDate) => ('time' in d && d.time ? d.time : '');
  return dates.sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      order[a.kind] - order[b.kind] ||
      time(a).localeCompare(time(b)) ||
      ('title' in a && 'title' in b ? compareFr(a.title, b.title) : 0),
  );
}

/**
 * The family guides for the units shown (D-069's rule through overall and specific attentes):
 * first those a lesson of these units uses, then those about one of their attentes, in the order
 * given (the board's approved ones first). At most two guides, three tips each, the English tip
 * beside its French one.
 */
function pickGuides(
  input: NewsletterFactsInput,
  shown: readonly NewsletterLessonLine[],
  starts: readonly NewsletterUnitStart[],
): NewsletterGuideTips[] {
  if (input.guides.length === 0) return [];
  const unitIds = new Set([...shown.map((l) => l.unitId), ...starts.map((s) => s.unitId)]);
  const units = input.units.filter((u) => unitIds.has(u.id));
  const linked = new Set(
    units.flatMap((u) => u.lessons.flatMap((l) => (l.libraryItemId ? [l.libraryItemId] : []))),
  );
  const attentes = new Set(
    units.flatMap((u) => [...u.expectationIds, ...u.lessons.flatMap((l) => l.expectationIds)]),
  );
  const parent = (id: string) => input.expectationParents.get(id) ?? null;
  const related = (guideAttente: string) =>
    attentes.has(guideAttente) ||
    [...attentes].some((a) => parent(a) === guideAttente || parent(guideAttente) === a);

  const usable = input.guides.filter((g) => g.atHomeFr.some((t) => t.trim()));
  const chosen = [
    ...usable.filter((g) => linked.has(g.id)),
    ...usable.filter((g) => !linked.has(g.id) && g.expectationIds.some(related)),
  ].slice(0, NEWSLETTER_GUIDES);
  return chosen.map((g) => ({
    id: g.id,
    title: g.title,
    tips: g.atHomeFr
      .map((fr, i) => ({ fr: fr.trim(), en: (g.atHomeEn[i] ?? '').trim() }))
      .filter((t) => t.fr)
      .slice(0, NEWSLETTER_TIPS_PER_GUIDE),
  }));
}

/**
 * The faith moment (D-058's ranking, as the substitute plans): a reference for every grade of the
 * class and the week's liturgical season, the most tags found in the week's subjects, lessons and
 * events first, the board's own before shared ones, ties turning with the week.
 */
function pickFaith(
  input: NewsletterFactsInput,
  shown: readonly NewsletterLessonLine[],
  events: readonly CalendarEvent[],
): NewsletterReference | null {
  if (input.refs.length === 0) return null;
  const nextFriday = addDays(input.weekOf, 11);
  const keywords = [
    ...shown.flatMap((l) => [l.subject.fr, l.unitTitle, ...l.lessons.map((x) => x.title)]),
    ...events
      .filter((e) => e.startsOn <= nextFriday && e.endsOn >= input.weekOf)
      .map((e) => e.title),
  ];
  return (
    rankCatholicReferences(input.refs, {
      gradeOrdinals: input.gradeOrdinals,
      date: input.weekOf,
      keywords,
      boardId: input.boardId,
    })[0] ?? null
  );
}
