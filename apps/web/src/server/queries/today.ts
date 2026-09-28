import 'server-only';
import {
  assignLessonsToSlots,
  isTeachable,
  isTeachersBlock,
  nextLessons,
  resolveSchoolDay,
  type BlockStatus,
  type CalendarEventType,
  type DayKeyResult,
  type LocalDate,
  type ProgressStatus,
  type TeachingSlot,
} from '@lynx/domain';
import { localized } from '@/i18n/config';
import type { SchoolContext, SessionContext } from '../session';
import { teachingSchools } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { eventsForSchool, scheduleFor, toCalendarEvent, toTimetableBlock } from './mappers';

export interface TodayLesson {
  id: string;
  title: string;
  sequenceNumber: number;
  objectives: string | null;
  materials: string | null;
  unitId: string;
  unitTitle: string;
  taught: boolean;
}

export interface TodayBlock {
  id: string;
  classId: string;
  className: string;
  kind: string;
  title: string | null;
  subject: { id: string; label: string; color: string | null } | null;
  startTime: string;
  endTime: string;
  effectiveStart: string;
  effectiveEnd: string;
  status: BlockStatus;
  affectedBy: { title: string; type: CalendarEventType } | null;
  roomName: string | null;
  lesson: TodayLesson | null;
  lessonState: 'taught' | 'assigned' | 'no_active_unit' | 'unit_finished' | null;
  gapTitle: string | null;
}

export interface TodaySchoolDay {
  schoolId: string;
  schoolName: string;
  day: DayKeyResult;
  events: {
    id: string;
    title: string;
    type: CalendarEventType;
    startTime: string | null;
    endTime: string | null;
    affectsSchedule: boolean;
  }[];
}

export interface TodayData {
  date: LocalDate;
  hasClasses: boolean;
  schoolDays: TodaySchoolDay[];
  blocks: TodayBlock[];
}

export async function loadToday(
  session: SessionContext,
  date: LocalDate,
  locale: string,
): Promise<TodayData> {
  const schools = teachingSchools(session);
  const supabase = await createSupabaseServerClient();

  const { data: teamRows } = await supabase
    .from('class_teachers')
    .select('class_id, role, classes!inner(id, name, school_id)')
    .eq('user_id', session.userId);
  const myClasses = (teamRows ?? []).filter((r) =>
    schools.some((s) => s.id === r.classes.school_id),
  );
  const classIds = myClasses.map((r) => r.class_id);
  if (classIds.length === 0) return { date, hasClasses: false, schoolDays: [], blocks: [] };

  const homeroom = new Set(myClasses.filter((r) => r.role === 'homeroom').map((r) => r.class_id));
  const classById = new Map(myClasses.map((r) => [r.class_id, r.classes]));
  const schoolIds = [...new Set(myClasses.map((r) => r.classes.school_id))];

  const [blocksRes, anchorsRes, unitsRes, progressRes, subjectsRes, roomsRes] = await Promise.all([
    supabase
      .from('timetable_blocks')
      .select(
        'id, class_id, day_key, start_time, end_time, kind, subject_id, title, teacher_id, room_id',
      )
      .in('class_id', classIds),
    supabase
      .from('school_cycle_anchors')
      .select('school_id, anchor_date, cycle_day')
      .in('school_id', schoolIds),
    supabase
      .from('units')
      .select(
        'id, class_id, subject_id, title, unit_lessons(id, sequence_number, title, objectives, materials)',
      )
      .in('class_id', classIds)
      .eq('status', 'active'),
    supabase
      .from('lesson_progress')
      .select('lesson_id, status, taught_on')
      .in('class_id', classIds),
    supabase.from('subjects').select('id, label_fr, label_en, color'),
    supabase.from('rooms').select('id, name').in('school_id', schoolIds),
  ]);

  const anchors = anchorsRes.data ?? [];
  const earliestAnchor = anchors.reduce<string>(
    (min, a) => (a.anchor_date < min ? a.anchor_date : min),
    date,
  );
  const { data: eventRows } = await supabase
    .from('school_calendar_events')
    .select(
      'id, board_id, school_id, class_id, event_type, title, starts_on, ends_on, start_time, end_time, affects_schedule',
    )
    .lte('starts_on', date)
    .gte('ends_on', earliestAnchor);

  const subjects = new Map(
    (subjectsRes.data ?? []).map((s) => [
      s.id,
      { id: s.id, label: localized(locale, s.label_fr, s.label_en), color: s.color },
    ]),
  );
  const rooms = new Map((roomsRes.data ?? []).map((r) => [r.id, r.name]));
  const allBlocks = (blocksRes.data ?? []).map(toTimetableBlock);
  const progress = new Map<string, ProgressStatus>(
    (progressRes.data ?? []).map((p) => [p.lesson_id, p.status]),
  );
  const taughtOn = new Map((progressRes.data ?? []).map((p) => [p.lesson_id, p.taught_on]));

  type LessonWithUnit = TodayLesson;
  const activeUnits = new Map<string, { unitId: string; lessons: LessonWithUnit[] }>();
  for (const u of unitsRes.data ?? []) {
    activeUnits.set(`${u.class_id}:${u.subject_id}`, {
      unitId: u.id,
      lessons: u.unit_lessons.map((l) => ({
        id: l.id,
        title: l.title,
        sequenceNumber: l.sequence_number,
        objectives: l.objectives,
        materials: l.materials,
        unitId: u.id,
        unitTitle: u.title,
        taught: false,
      })),
    });
  }

  const schoolDays: TodaySchoolDay[] = [];
  const resolvedBlocks: Array<
    ReturnType<typeof resolveSchoolDay>['blocks'][number] & { className: string }
  > = [];

  for (const schoolId of schoolIds) {
    const school = schools.find((s) => s.id === schoolId) as SchoolContext;
    const schoolEvents = eventsForSchool(eventRows ?? [], school).map(toCalendarEvent);
    const schedule = scheduleFor(
      school,
      anchors
        .filter((a) => a.school_id === schoolId)
        .map((a) => ({ anchorDate: a.anchor_date, cycleDay: a.cycle_day })),
    );
    let day: DayKeyResult | null = null;
    const todaysEvents = new Map<string, TodaySchoolDay['events'][number]>();
    for (const [classId, cls] of classById) {
      if (cls.school_id !== schoolId) continue;
      const resolved = resolveSchoolDay({
        date,
        classId,
        schedule,
        events: schoolEvents,
        blocks: allBlocks,
      });
      day = resolved.day;
      for (const e of resolved.events) {
        todaysEvents.set(e.id, {
          id: e.id,
          title: e.title,
          type: e.eventType,
          startTime: e.startTime,
          endTime: e.endTime,
          affectsSchedule: e.affectsSchedule,
        });
      }
      for (const b of resolved.blocks) {
        if (isTeachersBlock(b, session.userId, homeroom))
          resolvedBlocks.push({ ...b, className: cls.name });
      }
    }
    if (day)
      schoolDays.push({
        schoolId,
        schoolName: school.name,
        day,
        events: [...todaysEvents.values()],
      });
  }

  resolvedBlocks.sort(
    (a, b) =>
      a.effectiveStart.localeCompare(b.effectiveStart) || a.className.localeCompare(b.className),
  );

  const slots: TeachingSlot[] = resolvedBlocks
    .filter((b) => isTeachable(b) && b.subjectId)
    .map((b) => ({ slotId: b.id, date, classId: b.classId, subjectId: b.subjectId! }));
  const assignments = new Map(
    assignLessonsToSlots(slots, activeUnits, progress, { taughtOn }).map((a) => [a.slotId, a]),
  );

  const blocks: TodayBlock[] = resolvedBlocks.map((b) => {
    const assignment = assignments.get(b.id);
    const unit = b.subjectId ? activeUnits.get(`${b.classId}:${b.subjectId}`) : undefined;
    const gaps = unit ? nextLessons(unit.lessons, progress).gaps : [];
    return {
      id: b.id,
      classId: b.classId,
      className: b.className,
      kind: b.kind,
      title: b.title,
      subject: b.subjectId ? (subjects.get(b.subjectId) ?? null) : null,
      startTime: b.startTime,
      endTime: b.endTime,
      effectiveStart: b.effectiveStart,
      effectiveEnd: b.effectiveEnd,
      status: b.status,
      affectedBy: b.affectedBy ? { title: b.affectedBy.title, type: b.affectedBy.eventType } : null,
      roomName: b.roomId ? (rooms.get(b.roomId) ?? null) : null,
      lesson: assignment?.lesson
        ? { ...assignment.lesson, taught: assignment.reason === 'taught' }
        : null,
      lessonState: assignment?.reason ?? null,
      gapTitle: assignment?.reason === 'assigned' && gaps[0] ? gaps[0].title : null,
    };
  });

  return { date, hasClasses: true, schoolDays, blocks };
}
