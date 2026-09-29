/**
 * The deterministic plan builder (DECISIONS D-047, D-052, D-055, D-077). The web server runs it
 * in the absence request and the worker runs it again when a source changes; both pass the same
 * `app.sub_plan_sources` JSON (with `app.sub_plan_library_sources` merged in as `library`), so
 * both build the same plan. Pure: `now` is passed in and only stamps `generatedAt`.
 */
import { timeToMinutes, type LocalDate, type LocalTime } from '../dates';
import type { CalendarEventType } from '../calendar';
import { pickCatholicReference } from './catholic';
import {
  absenceSchoolDays,
  coverageForDay,
  scheduleOf,
  type CoverageBlock,
  type DayCoverage,
} from './coverage';
import { plannedMinutes } from './ai-input';
import { groupStudentsByLevel, type StudentGroup } from './groupings';
import {
  MAX_LIBRARY_PLAN_BYTES,
  attachLibrary,
  detachLibrary,
  librarySnapshot,
  rankLibraryCandidates,
  reservedLibraryItems,
} from './library';
import {
  SUB_PLAN_GENERATOR_VERSION,
  SUB_PLAN_SCHEMA_VERSION,
  subPlanV1Schema,
  type AbsencePart,
  type BlockWarningCode,
  type PlanWarningCode,
  type SubPlanBlock,
  type SubPlanStep,
  type SubPlanV1,
} from './schema';
import {
  breakSteps,
  dutySteps,
  endOfDayChecklist,
  eventSteps,
  fallbackSteps,
  handoverSteps,
  isThinLesson,
  lessonSteps,
  otherSteps,
  prepSteps,
  reviewSteps,
  routineSteps,
} from './scripts';
import { assignAbsenceLessons, slotKey, type AbsenceSlotAssignment } from './sequence';
import type { SubPlanSourceProfile, SubPlanSources } from './sources';
import { formalStaffName } from './compose';
import { clip, clipOrNull, compareFr } from './text';

// Moved to scripts.ts (the library's blocks need it too); still exported from here.
export { isThinLesson } from './scripts';

export interface AbsenceInput {
  startsOn: LocalDate;
  endsOn: LocalDate;
  /** Half days are single days (checked by the form and the database). */
  part: AbsencePart;
  catholicConnection: boolean;
}

export interface BuiltPlan {
  date: LocalDate;
  /** Classes the plan covers: the database derives roster, alerts and report scope from them. */
  classIds: string[];
  plan: SubPlanV1;
}

export interface AbsencePlansResult {
  plans: BuiltPlan[];
  /** Weekdays of the absence without school (PA days, holidays): listed, no plan. */
  noSchool: { date: LocalDate; reason: CalendarEventType; eventTitle: string }[];
}

export interface BuildOptions {
  now: Date;
  /** Called when a day falls back to the minimal plan (for logs: date and error only). */
  onError?: (date: LocalDate, error: unknown) => void;
}

const DEFAULT_TITLES: Record<SubPlanBlock['kind'], string> = {
  subject: 'Période',
  routine: 'Routine',
  recess: 'Récréation',
  lunch: 'Dîner',
  nutrition_break: 'Pause santé',
  prep: 'Période de planification',
  duty: 'Surveillance',
  other: 'Activité',
  handover: 'Période',
};

function overlapMinutes(
  block: { effectiveStart: LocalTime; effectiveEnd: LocalTime },
  event: { startTime: LocalTime | null; endTime: LocalTime | null },
): number {
  const from = Math.max(
    timeToMinutes(block.effectiveStart),
    event.startTime ? timeToMinutes(event.startTime) : 0,
  );
  const to = Math.min(
    timeToMinutes(block.effectiveEnd),
    event.endTime ? timeToMinutes(event.endTime) : 24 * 60,
  );
  return Math.max(0, to - from);
}

/** Lookups shared by every day of one build. */
function contextOf(sources: SubPlanSources) {
  const classById = new Map(sources.classes.map((c) => [c.id, c]));
  const rooms = new Map(sources.rooms.map((r) => [r.id, r.name]));
  const profiles = new Map(sources.profiles.map((p) => [p.classId, p]));
  const library = {
    items: new Map(sources.library.items.map((i) => [i.id, i])),
    candidates: new Map(sources.library.lessonCandidates.map((l) => [l.lessonId, l.candidates])),
  };
  return { classById, rooms, profiles, library };
}
type BuildContext = ReturnType<typeof contextOf>;

function planDay(sources: SubPlanSources, dayKey: number | null): SubPlanV1['day'] {
  return { kind: scheduleOf(sources).type, dayKey };
}

function classEntries(ctx: BuildContext, classIds: readonly string[]): SubPlanV1['classes'] {
  return classIds.slice(0, 12).flatMap((id) => {
    const cls = ctx.classById.get(id);
    if (!cls) return [];
    return [
      {
        classId: cls.id,
        name: clip(cls.name, 80),
        gradeLabels: [...cls.grades]
          .sort((a, b) => a.ordinal - b.ordinal)
          .slice(0, 4)
          .map((g) => clip(g.labelFr, 40)),
        roomName: cls.roomId ? clipOrNull(ctx.rooms.get(cls.roomId), 60) : null,
      },
    ];
  });
}

function classNotesEntries(
  sources: SubPlanSources,
  ctx: BuildContext,
  classIds: readonly string[],
): SubPlanV1['classNotes'] {
  return classIds.slice(0, 12).map((classId) => {
    const p = ctx.profiles.get(classId);
    const team = sources.team
      .filter((m) => m.classId === classId && m.userId !== sources.teacher.id)
      .sort(
        (a, b) =>
          (a.role === 'homeroom' ? 0 : 1) - (b.role === 'homeroom' ? 0 : 1) ||
          compareFr(a.displayName, b.displayName),
      )
      .slice(0, 8)
      .map((m) => ({ name: clip(formalStaffName(m.displayName, m.honorific), 120), role: m.role }));
    return {
      classId,
      arrival: clipOrNull(p?.arrivalNotes, 2000),
      routines: clipOrNull(p?.routinesNotes, 2000),
      classManagement: clipOrNull(p?.classroomManagementNotes, 2000),
      dismissal: clipOrNull(p?.dismissalNotes, 2000),
      fallbackActivities: clipOrNull(p?.fallbackActivities, 2000),
      neighbour: p?.neighbour
        ? {
            name: clip(formalStaffName(p.neighbour.displayName, p.neighbour.honorific), 120),
            note: clipOrNull(p.neighbourNote, 200),
          }
        : null,
      team,
    };
  });
}

function warningList(codes: readonly PlanWarningCode[]): SubPlanV1['warnings'] {
  return [...new Set(codes)].slice(0, 40).map((code) => ({ code, blockKey: null }));
}

function generator(now: Date): SubPlanV1['generator'] {
  return { version: SUB_PLAN_GENERATOR_VERSION, generatedAt: now.toISOString() };
}

/**
 * The database refuses plans over 256 KB (sub_plans_plan_size). Staying under this size
 * uncompressed guarantees it, whatever the compression.
 */
export const MAX_PLAN_BYTES = 240_000;

function planBytes(plan: SubPlanV1): number {
  return new TextEncoder().encode(JSON.stringify(plan)).length;
}

/**
 * Library snapshots come off the last blocks first until the plan is under
 * MAX_LIBRARY_PLAN_BYTES, with the plan warning `library_trimmed` (D-077). The periods keep
 * their lessons and steps.
 */
function fitLibrary(plan: SubPlanV1): SubPlanV1 {
  if (planBytes(plan) <= MAX_LIBRARY_PLAN_BYTES) return plan;
  const blocks = [...plan.blocks];
  let trimmed = false;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (!blocks[i]!.library) continue;
    blocks[i] = detachLibrary(blocks[i]!);
    trimmed = true;
    if (planBytes({ ...plan, blocks }) <= MAX_LIBRARY_PLAN_BYTES) break;
  }
  if (!trimmed) return plan;
  return {
    ...plan,
    blocks,
    warnings: plan.warnings.some((w) => w.code === 'library_trimmed')
      ? plan.warnings
      : [...plan.warnings, { code: 'library_trimmed' as const, blockKey: null }].slice(0, 40),
  };
}

/**
 * Long lessons are shortened until the plan fits (the substitute still has the essentials;
 * the teacher's full text stays in her planning). Throws if even that is not enough.
 */
function fitPlanSize(plan: SubPlanV1): SubPlanV1 {
  if (planBytes(plan) <= MAX_PLAN_BYTES) return plan;
  for (const max of [4000, 1000, 300]) {
    const smaller: SubPlanV1 = {
      ...plan,
      blocks: plan.blocks.map((b) =>
        b.lesson
          ? {
              ...b,
              lesson: {
                ...b.lesson,
                objectives: clipOrNull(b.lesson.objectives, max),
                materials: clipOrNull(b.lesson.materials, max),
                content: clipOrNull(b.lesson.content, max),
                subNotes: clipOrNull(b.lesson.subNotes, max),
              },
            }
          : b,
      ),
    };
    if (planBytes(smaller) <= MAX_PLAN_BYTES) return smaller;
  }
  throw new RangeError('plan too large');
}

/** Steps for a block without a lesson of its own (routines, breaks, prep...). */
function nonLessonSteps(
  b: CoverageBlock,
  title: string,
  profile: SubPlanSourceProfile | null,
): SubPlanStep[] {
  const timed = { title, start: b.effectiveStart, end: b.effectiveEnd };
  switch (b.kind) {
    case 'routine':
      return routineSteps(timed, profile);
    case 'recess':
    case 'lunch':
    case 'nutrition_break':
      return breakSteps({ ...timed, kind: b.kind });
    case 'prep':
      return prepSteps(timed);
    case 'duty':
      return dutySteps(timed);
    case 'subject':
      return fallbackSteps(profile);
    default:
      return otherSteps(timed);
  }
}

function buildBlock(
  b: CoverageBlock,
  ctx: BuildContext,
  assignment: AbsenceSlotAssignment | undefined,
): SubPlanBlock {
  const profile = ctx.profiles.get(b.classId) ?? null;
  const cls = ctx.classById.get(b.classId);
  const classRoom = cls?.roomId ? (ctx.rooms.get(cls.roomId) ?? null) : null;
  const event = b.affectedBy
    ? {
        title: clip(b.affectedBy.title, 120),
        notes: clipOrNull(b.eventNotes, 1000),
        start: b.affectedBy.startTime,
        end: b.affectedBy.endTime,
      }
    : null;
  const status = b.status === 'cancelled' ? 'normal' : b.status; // cancelled blocks never get here
  const eventNote = event && status === 'interrupted' ? eventSteps(event, 'interrupted') : [];

  let kind: SubPlanBlock['kind'] = b.kind;
  let title = b.title?.trim() || b.subjectLabel || DEFAULT_TITLES[b.kind];
  let steps: SubPlanStep[];
  let lesson: SubPlanBlock['lesson'] = null;
  const warnings: BlockWarningCode[] = [];

  if (b.role === 'handover') {
    kind = 'handover';
    const subject = b.subjectLabel || b.title?.trim() || DEFAULT_TITLES.handover;
    title = `${subject} avec ${b.otherAdult ?? 'une autre personne de l’équipe-école'}`;
    steps =
      status === 'replaced' && event
        ? eventSteps(event, 'replaced')
        : [
            ...eventNote,
            ...handoverSteps({
              subject,
              otherAdult: b.otherAdult,
              roomName: b.roomName,
              classRoomName: classRoom,
              start: b.effectiveStart,
              end: b.effectiveEnd,
            }),
          ];
  } else if (status === 'replaced' && event) {
    steps = eventSteps(event, 'replaced');
  } else if (b.kind === 'subject' && assignment?.lesson && assignment.unit) {
    const l = assignment.lesson;
    const minutes =
      timeToMinutes(b.effectiveEnd) -
      timeToMinutes(b.effectiveStart) -
      (status === 'interrupted' && b.affectedBy ? overlapMinutes(b, b.affectedBy) : 0);
    lesson = {
      lessonId: l.id,
      unitTitle: clip(assignment.unit.title, 120),
      sequenceNumber: l.sequenceNumber,
      title: clip(l.title, 160),
      objectives: clipOrNull(l.objectives, 4000),
      materials: clipOrNull(l.materials, 4000),
      content: clipOrNull(l.content, 20000),
      subNotes: clipOrNull(l.subNotes, 4000),
      assignment: assignment.reason === 'taught' ? 'taught' : 'assigned',
      gapBefore: assignment.gapBefore ? clip(assignment.gapBefore.title, 160) : null,
    };
    steps = [
      ...eventNote,
      ...(assignment.reason === 'taught'
        ? reviewSteps(l, profile)
        : lessonSteps(l, Math.max(1, minutes), status === 'replaced' ? 'normal' : status)),
    ];
    if (assignment.gapBefore) warnings.push('lesson_gap');
    if (isThinLesson(l)) warnings.push('thin_lesson');
  } else {
    if (b.kind === 'subject') {
      warnings.push(assignment?.reason === 'unit_finished' ? 'unit_finished' : 'no_active_unit');
    }
    steps = [...eventNote, ...nonLessonSteps(b, title, profile)];
  }

  return {
    key: b.id,
    classId: b.classId,
    className: clip(b.className, 80),
    kind,
    start: b.effectiveStart,
    end: b.effectiveEnd,
    status,
    title: clip(title, 160),
    subjectLabel: clipOrNull(b.subjectLabel, 80),
    roomName: clipOrNull(b.roomName, 60),
    otherAdult: b.role === 'handover' ? clipOrNull(b.otherAdult, 120) : null,
    event,
    notes: clipOrNull(b.notes, 500),
    lesson,
    steps: steps.slice(0, 12),
    warnings,
    library: null,
  };
}

/** Resources shared by every day of one build (D-077). */
interface LibraryUse {
  /** Resources already in a period: each is used once per absence. */
  used: Set<string>;
  /** Resources the absence's lessons link themselves, kept for those lessons. */
  reserved: ReadonlySet<string>;
}

/**
 * The library resource of each lesson period (D-077): the best candidate of the lesson whose
 * snapshot can be made, each resource once per absence (`use.used` is shared by every day of
 * the build, in date and time order), a lesson's own resource kept for it. Only lessons the
 * substitute teaches get one.
 */
function withLibrary(
  blocks: readonly SubPlanBlock[],
  groups: readonly StudentGroup[],
  ctx: BuildContext,
  use: LibraryUse,
): SubPlanBlock[] {
  return blocks.map((b) => {
    const lesson = b.lesson;
    if (b.kind !== 'subject' || !lesson || lesson.assignment !== 'assigned') return b;
    const candidates = ctx.library.candidates.get(lesson.lessonId);
    if (!candidates?.length) return b;
    const classGroups = groups.filter((g) => g.classId === b.classId);
    const ranked = rankLibraryCandidates({
      blockMinutes: plannedMinutes(b),
      candidates,
      items: ctx.library.items,
      used: use.used,
      reserved: use.reserved,
    });
    for (const choice of ranked) {
      const snapshot = librarySnapshot(choice.item, classGroups, { reason: choice.reason });
      if (!snapshot) continue;
      use.used.add(choice.item.id);
      return attachLibrary(b, snapshot);
    }
    return b;
  });
}

/** One day's plan from its coverage and the absence-wide lesson assignments. */
function buildDayPlan(
  sources: SubPlanSources,
  ctx: BuildContext,
  coverage: DayCoverage,
  assignments: ReadonlyMap<string, AbsenceSlotAssignment>,
  absence: AbsenceInput,
  now: Date,
  libraryUse: LibraryUse,
): SubPlanV1 {
  const { date, classIds } = coverage;
  const { groups, withoutLevel } = groupStudentsByLevel(sources.students, sources.levels, classIds);
  const blocks = withLibrary(
    coverage.blocks
      .slice(0, 40)
      .map((b) => buildBlock(b, ctx, assignments.get(slotKey(date, b.id)))),
    groups.slice(0, 40),
    ctx,
    libraryUse,
  );

  let faith: SubPlanV1['faith'] = null;
  if (absence.catholicConnection) {
    const ref = pickCatholicReference(sources.catholicReferences, {
      gradeOrdinals: classIds.flatMap(
        (id) => ctx.classById.get(id)?.grades.map((g) => g.ordinal) ?? [],
      ),
      date,
      keywords: blocks.flatMap((b) =>
        [b.subjectLabel, b.lesson?.title].filter((k): k is string => !!k),
      ),
      boardId: sources.school.boardId,
    });
    if (ref) {
      faith = {
        referenceId: ref.id,
        type: ref.type,
        title: clip(ref.title, 160),
        text: clip(ref.textFr, 4000),
      };
    }
  }

  // End-of-day instructions follow the class the substitute is with last.
  const lastClass = [...coverage.covered].reverse()[0]?.classId ?? classIds[0];
  const plan: SubPlanV1 = {
    schemaVersion: SUB_PLAN_SCHEMA_VERSION,
    date,
    part: absence.part,
    window: coverage.window,
    split: coverage.split,
    day: planDay(sources, coverage.day.status === 'instructional' ? coverage.day.dayKey : null),
    classes: classEntries(ctx, classIds),
    groups: groups.slice(0, 40).map((g) => ({ ...g, studentIds: g.studentIds.slice(0, 60) })),
    dayEvents: coverage.dayEvents.slice(0, 10).map((e) => ({
      title: clip(e.title, 120),
      type: e.eventType,
      start: e.startTime,
      end: e.endTime,
    })),
    blocks,
    classNotes: classNotesEntries(sources, ctx, classIds),
    endOfDay: {
      time: coverage.endOfDay,
      checklist: endOfDayChecklist(
        lastClass ? (ctx.profiles.get(lastClass) ?? null) : null,
        absence.part,
      ),
    },
    faith,
    warnings: warningList([
      ...coverage.warnings,
      ...(withoutLevel ? (['students_without_level'] as const) : []),
    ]),
    generator: generator(now),
  };
  return fitPlanSize(fitLibrary(subPlanV1Schema.parse(plan)));
}

/**
 * A plan that can always be built: the schedule, routines and contacts, without lessons,
 * flagged `generation_failed`. Used when building a day throws, so publishing never fails
 * because of the builder.
 */
export function buildMinimalSubPlan(
  sources: SubPlanSources,
  date: LocalDate,
  absence: Pick<AbsenceInput, 'part'>,
  options: Pick<BuildOptions, 'now'>,
): SubPlanV1 {
  const settings = sources.school.settings;
  const bare: SubPlanV1 = {
    schemaVersion: SUB_PLAN_SCHEMA_VERSION,
    date,
    part: absence.part,
    window: { start: settings.dayStart, end: settings.dayEnd },
    split: settings.substitute.halfDaySplit,
    day: planDay(sources, null),
    classes: [],
    groups: [],
    dayEvents: [],
    blocks: [],
    classNotes: [],
    endOfDay: { time: settings.dayEnd, checklist: endOfDayChecklist(null, absence.part) },
    faith: null,
    warnings: warningList(['generation_failed']),
    generator: generator(options.now),
  };

  let base = bare;
  try {
    const ctx = contextOf(sources);
    const homeroom = [...sources.classes]
      .filter((c) => c.role === 'homeroom')
      .sort((a, b) => compareFr(a.name, b.name))
      .map((c) => c.id);
    base = subPlanV1Schema.parse({
      ...bare,
      classes: classEntries(ctx, homeroom),
      classNotes: classNotesEntries(sources, ctx, homeroom),
    });

    const coverage = coverageForDay({ date, sources, part: absence.part });
    const blocks = coverage.blocks.slice(0, 40).map((b) => buildBlock(b, ctx, undefined));
    return subPlanV1Schema.parse({
      ...base,
      window: coverage.window,
      split: coverage.split,
      day: planDay(sources, coverage.day.status === 'instructional' ? coverage.day.dayKey : null),
      classes: classEntries(ctx, coverage.classIds),
      classNotes: classNotesEntries(sources, ctx, coverage.classIds),
      blocks: blocks.map((b) => ({ ...b, warnings: [] })),
      endOfDay: {
        time: coverage.endOfDay,
        checklist: endOfDayChecklist(
          ctx.profiles.get(coverage.classIds[0] ?? '') ?? null,
          absence.part,
        ),
      },
      warnings: warningList(['generation_failed', ...coverage.warnings]),
    });
  } catch {
    return base;
  }
}

/**
 * Builds the plan of every school day of an absence from today on.
 *
 * - Days without school (PA day, holiday) get no plan and are listed in `noSchool`.
 * - Days of this absence that are fixed snapshots (sibling not refreshable: released today,
 *   or a substitute signed in) are not rebuilt. Lessons they assigned count as done for later
 *   days until their report arrives (`reportStatus` none or draft); after that, the progress
 *   the report wrote applies.
 * - The same goes for the teacher's other absence just before this one (`earlierPlans`), so
 *   back-to-back absences continue the sequence instead of repeating the same lessons.
 * - Lessons continue across the days built (one sequence).
 * - A day whose build throws gets `buildMinimalSubPlan` instead; other days are unaffected.
 */
export function buildAbsencePlans(
  sources: SubPlanSources,
  absence: AbsenceInput,
  options: BuildOptions,
): AbsencePlansResult {
  const days = absenceSchoolDays(sources, absence.startsOn, absence.endsOn);
  const noSchool = days.flatMap(({ date, day }) =>
    day.status === 'no_school' && day.event
      ? [{ date, reason: day.event.eventType, eventTitle: day.event.title }]
      : [],
  );

  const fixed = new Set(sources.siblings.filter((s) => !s.refreshable).map((s) => s.planDate));
  const dates = days
    .filter(
      ({ date, day }) => day.status !== 'no_school' && date >= sources.today && !fixed.has(date),
    )
    .map(({ date }) => date);
  const lastDate = dates.at(-1);
  const unreported = (s: { reportStatus: string }) =>
    s.reportStatus === 'none' || s.reportStatus === 'draft';
  const assumeDone = new Set([
    ...sources.siblings
      .filter((s) => !s.refreshable && lastDate !== undefined && s.planDate < lastDate)
      .filter(unreported)
      .flatMap((s) => s.assignedLessonIds),
    // The teacher's absence just before this one (another absence, built separately): its
    // lessons are assumed taught as well. (A morning absence on this afternoon's day needs
    // nothing: a half day already sequences the other half's blocks.)
    ...sources.earlierPlans
      .filter((e) => lastDate !== undefined && e.planDate < absence.startsOn)
      .filter(unreported)
      .flatMap((e) => e.assignedLessonIds),
  ]);

  const failed = new Set<LocalDate>();
  const fail = (date: LocalDate, error: unknown) => {
    failed.add(date);
    options.onError?.(date, error);
  };

  const coverages = new Map<LocalDate, DayCoverage>();
  for (const date of dates) {
    try {
      coverages.set(date, coverageForDay({ date, sources, part: absence.part }));
    } catch (error) {
      fail(date, error);
    }
  }

  let assignments = new Map<string, AbsenceSlotAssignment>();
  try {
    assignments = assignAbsenceLessons({ days: [...coverages.values()], sources, assumeDone });
  } catch (error) {
    for (const date of coverages.keys()) fail(date, error);
  }

  const ctx = contextOf(sources);
  const libraryUse: LibraryUse = {
    used: new Set<string>(),
    reserved: reservedLibraryItems(
      [...assignments.values()].flatMap((a) =>
        a.lesson && a.reason === 'assigned' ? [a.lesson.id] : [],
      ),
      ctx.library.candidates,
      ctx.library.items,
    ),
  };
  const plans = dates.map((date): BuiltPlan => {
    const coverage = coverages.get(date);
    if (coverage && !failed.has(date)) {
      try {
        const plan = buildDayPlan(
          sources,
          ctx,
          coverage,
          assignments,
          absence,
          options.now,
          libraryUse,
        );
        return { date, classIds: plan.classes.map((c) => c.classId), plan };
      } catch (error) {
        fail(date, error);
      }
    }
    const plan = buildMinimalSubPlan(sources, date, absence, options);
    return { date, classIds: plan.classes.map((c) => c.classId), plan };
  });

  return { plans, noSchool };
}
