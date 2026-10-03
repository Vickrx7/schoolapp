import 'server-only';
import {
  addDays,
  formalStaffName,
  isTeachersBlock,
  localDateIn,
  mondayOf,
  newsletterContentSchema,
  newsletterFacts,
  newsletterReminders,
  schoolWeeks,
  type LocalDate,
  type NewsletterContent,
  type NewsletterFacts,
  type NewsletterGuide,
  type NewsletterReference,
  type NewsletterUnit,
  type ProgressStatus,
  type ReportPeriod,
  type ReportPeriodKind,
  type YearCalendarEvent,
} from '@lynx/domain';
import { z } from 'zod';
import { instantInZone } from '@/lib/format';
import { reportError } from '../errors';
import { newsletterNames, type NewsletterNames } from '../newsletter/names';
import { sortNewsletterRows, type NewsletterListRow } from '../newsletter/view-model';
import { findSchool, teachingSchools, type SessionContext } from '../session';
import { createSupabaseServerClient } from '../supabase';
import type { ClassDetail } from './classes';
import { eventsForSchool, scheduleFor, toCalendarEvent, toTimetableBlock } from './mappers';
import type { ClassYear } from './year-plan';

/**
 * « Info-parents » (DECISIONS D-136 to D-138): a class's messages to families and what the first
 * draft is made of, read under row level security as the signed-in teacher (the class team only).
 * Never an event's notes, an attente's text, the coverage, a level, an alert or a student's record:
 * the roster's first names only serve « Des élèves sont nommés ».
 */

export interface NewsletterListData {
  year: ClassYear | null;
  today: LocalDate;
  rows: NewsletterListRow[];
}

/** PostgREST answers at most this many rows at a time. */
const PAGE = 1000;

const nameOf = (u: { display_name: string; honorific: string | null } | null) =>
  u ? formalStaffName(u.display_name, u.honorific) : null;

/** The class's messages, newest week first, and its school year. */
export async function loadNewsletterList(
  session: SessionContext,
  cls: ClassDetail,
): Promise<NewsletterListData | null> {
  const school = findSchool(session, cls.schoolId);
  if (!school) return null;
  const supabase = await createSupabaseServerClient();
  const [rowsRes, yearRes] = await Promise.all([
    supabase
      .from('class_newsletters')
      .select(
        'id, week_of, status, sent_at, updated_at, users!class_newsletters_updated_by_fkey(display_name, honorific)',
      )
      .eq('class_id', cls.id)
      .order('week_of', { ascending: false })
      .limit(PAGE),
    supabase
      .from('classes')
      .select('school_years(id, name, starts_on, ends_on)')
      .eq('id', cls.id)
      .maybeSingle(),
  ]);
  if (rowsRes.error || yearRes.error) {
    reportError('loadNewsletterList', rowsRes.error ?? yearRes.error);
    return null;
  }
  const y = yearRes.data?.school_years;
  return {
    year: y ? { id: y.id, name: y.name, startsOn: y.starts_on, endsOn: y.ends_on } : null,
    today: localDateIn(school.timezone),
    rows: sortNewsletterRows(
      (rowsRes.data ?? []).map((r) => ({
        id: r.id,
        weekOf: r.week_of,
        status: r.status === 'sent' ? ('sent' as const) : ('draft' as const),
        sentOn: r.sent_at ? instantInZone(r.sent_at, school.timezone).date : null,
        updatedOn: instantInZone(r.updated_at, school.timezone).date,
        updatedBy: nameOf(r.users),
      })),
    ),
  };
}

/**
 * What « Préparer le message » needs: the class's school year, and whether colleagues teach blocks
 * of the class (then « Inclure les matières enseignées par mes collègues » shows).
 */
export async function loadPrepareContext(
  session: SessionContext,
  cls: ClassDetail,
): Promise<{ year: ClassYear | null; colleagues: boolean }> {
  const supabase = await createSupabaseServerClient();
  const [yearRes, blocksRes] = await Promise.all([
    supabase
      .from('classes')
      .select('school_years(id, name, starts_on, ends_on)')
      .eq('id', cls.id)
      .maybeSingle(),
    supabase
      .from('timetable_blocks')
      .select('class_id, teacher_id')
      .eq('class_id', cls.id)
      .eq('kind', 'subject'),
  ]);
  if (yearRes.error || blocksRes.error)
    reportError('loadPrepareContext', yearRes.error ?? blocksRes.error);
  const y = yearRes.data?.school_years;
  const homeroom = new Set(cls.myRole === 'homeroom' ? [cls.id] : []);
  return {
    year: y ? { id: y.id, name: y.name, startsOn: y.starts_on, endsOn: y.ends_on } : null,
    colleagues: (blocksRes.data ?? []).some(
      (b) =>
        !isTeachersBlock(
          { classId: b.class_id, teacherId: b.teacher_id },
          session.userId,
          homeroom,
        ),
    ),
  };
}

export interface NewsletterData {
  id: string;
  weekOf: LocalDate;
  status: 'draft' | 'sent';
  sentOn: LocalDate | null;
  revision: number;
  /** Null when the stored content does not fit the schema (the page says so). */
  content: NewsletterContent | null;
  /** The class's students named and the details found, in the saved message. */
  names: NewsletterNames;
}

/**
 * The class's message for a week; null when there is none. `names: false` (the PDF) reads no
 * roster: the names are then left empty.
 */
export async function loadNewsletter(
  session: SessionContext,
  cls: ClassDetail,
  weekOf: LocalDate,
  options: { names?: boolean } = {},
): Promise<NewsletterData | null> {
  const school = findSchool(session, cls.schoolId);
  if (!school) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('class_newsletters')
    .select('id, week_of, status, sent_at, revision, content')
    .eq('class_id', cls.id)
    .eq('week_of', weekOf)
    .maybeSingle();
  if (error) reportError('loadNewsletter', error);
  if (!data) return null;
  const parsed = newsletterContentSchema.safeParse(data.content);
  const content = parsed.success ? parsed.data : null;
  return {
    id: data.id,
    weekOf: data.week_of,
    status: data.status === 'sent' ? 'sent' : 'draft',
    sentOn: data.sent_at ? instantInZone(data.sent_at, school.timezone).date : null,
    revision: data.revision,
    content,
    names:
      content && options.names !== false
        ? newsletterNames(content, await loadRoster(cls.id))
        : { studentNames: [], details: [] },
  };
}

/** The class's students' first names (as « Élèves » shows them), for the names check only. */
export async function loadRoster(classId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('students')
    .select('first_name')
    .eq('class_id', classId)
    .limit(PAGE);
  if (error) reportError('loadRoster', error);
  return (data ?? []).map((s) => s.first_name);
}

export interface NewsletterOptions {
  /** « Inclure les matières enseignées par mes collègues » */
  colleagues: boolean;
  /** « Inclure un moment de foi » */
  faith: boolean;
  /** « Inclure des conseils des guides pour les familles » (Library module only) */
  guides: boolean;
}

/** A row of `search_library`'s answer (only what the guides need). */
const searchSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), status: z.string(), mine: z.boolean() })),
});

/** What a family guide's base version holds that the message uses. */
const guideContentSchema = z.object({
  fr: z.object({ atHome: z.array(z.string()) }),
  en: z.object({ atHome: z.array(z.string()) }),
});

/**
 * The facts of a class's week (`newsletterFacts`), as the signed-in teacher sees them: her school's
 * calendar, the class's timetable, units, lessons and progress, its report periods, the Catholic
 * references of her board and the family guides she may use. Null when the class's school year
 * cannot be read (reported).
 */
export async function loadNewsletterFacts(
  session: SessionContext,
  cls: ClassDetail,
  weekOf: LocalDate,
  options: NewsletterOptions,
): Promise<NewsletterFacts | null> {
  const school = findSchool(session, cls.schoolId);
  if (!school) return null;
  const supabase = await createSupabaseServerClient();
  const preparedOn = localDateIn(school.timezone);
  const until = addDays(weekOf, 18);

  const [yearRes, blocksRes, anchorsRes, unitsRes, progressRes, subjectsRes, refsRes] =
    await Promise.all([
      supabase
        .from('classes')
        .select(
          'school_years(id, name, starts_on, ends_on, report_periods(kind, starts_on, ends_on, due_on, issued_on))',
        )
        .eq('id', cls.id)
        .maybeSingle(),
      supabase
        .from('timetable_blocks')
        .select(
          'id, class_id, day_key, start_time, end_time, kind, subject_id, title, teacher_id, room_id',
        )
        .eq('class_id', cls.id),
      supabase
        .from('school_cycle_anchors')
        .select('anchor_date, cycle_day')
        .eq('school_id', cls.schoolId),
      supabase
        .from('units')
        .select(
          'id, subject_id, title, status, planned_start_on, planned_end_on, unit_expectations(expectation_id), unit_lessons(id, sequence_number, title, library_item_id, unit_lesson_expectations(expectation_id))',
        )
        .eq('class_id', cls.id)
        .neq('status', 'archived'),
      supabase
        .from('lesson_progress')
        .select('lesson_id, status, taught_on')
        .eq('class_id', cls.id)
        .limit(5 * PAGE),
      supabase.from('subjects').select('id, label_fr, label_en'),
      options.faith
        ? supabase
            .from('catholic_references')
            .select(
              'id, board_id, type, title, text_fr, text_en, grade_min, grade_max, liturgical_season, tags',
            )
            .eq('active', true)
        : Promise.resolve({ data: [], error: null }),
    ]);
  const failed =
    yearRes.error ??
    blocksRes.error ??
    anchorsRes.error ??
    unitsRes.error ??
    progressRes.error ??
    subjectsRes.error ??
    refsRes.error;
  if (failed) {
    reportError('loadNewsletterFacts', failed);
    return null;
  }
  const y = yearRes.data?.school_years;
  if (!y) return null;

  // The calendar from the earliest cycle anchor (a cycle day is counted from it) to the end of the
  // dates window: the board's and the school's events, and the class's own.
  const anchors = (anchorsRes.data ?? []).map((a) => ({
    anchorDate: a.anchor_date,
    cycleDay: a.cycle_day,
  }));
  const from = anchors.reduce((min, a) => (a.anchorDate < min ? a.anchorDate : min), weekOf);
  const { data: eventRows, error: eventsError } = await supabase
    .from('school_calendar_events')
    .select(
      'id, board_id, school_id, class_id, event_type, title, starts_on, ends_on, start_time, end_time, affects_schedule',
    )
    .eq('board_id', cls.boardId)
    .lte('starts_on', until)
    .gte('ends_on', from)
    .limit(5 * PAGE);
  if (eventsError) {
    reportError('loadNewsletterFacts', eventsError);
    return null;
  }

  const units: NewsletterUnit[] = (unitsRes.data ?? []).map((u) => ({
    id: u.id,
    subjectId: u.subject_id,
    title: u.title,
    status: u.status,
    plannedStartOn: u.planned_start_on,
    plannedEndOn: u.planned_end_on,
    expectationIds: u.unit_expectations.map((e) => e.expectation_id),
    lessons: u.unit_lessons.map((l) => ({
      id: l.id,
      sequenceNumber: l.sequence_number,
      title: l.title,
      libraryItemId: l.library_item_id,
      expectationIds: l.unit_lesson_expectations.map((e) => e.expectation_id),
    })),
  }));
  const progress = new Map<string, ProgressStatus>(
    (progressRes.data ?? []).map((p) => [p.lesson_id, p.status]),
  );
  const taughtOn = new Map((progressRes.data ?? []).map((p) => [p.lesson_id, p.taught_on]));
  const periods: ReportPeriod[] = (y.report_periods ?? []).map((p) => ({
    kind: p.kind as ReportPeriodKind,
    startsOn: p.starts_on,
    endsOn: p.ends_on,
    dueOn: p.due_on,
    issuedOn: p.issued_on,
  }));
  const refs: NewsletterReference[] = (refsRes.data ?? []).map((r) => ({
    id: r.id,
    boardId: r.board_id,
    type: r.type,
    title: r.title,
    textFr: r.text_fr,
    textEn: r.text_en,
    gradeMin: r.grade_min,
    gradeMax: r.grade_max,
    liturgicalSeason: r.liturgical_season,
    tags: r.tags,
  }));
  const guides = options.guides ? await loadGuides(cls, units) : { guides: [], parents: new Map() };

  return newsletterFacts({
    classId: cls.id,
    weekOf,
    preparedOn,
    year: { startsOn: y.starts_on, endsOn: y.ends_on },
    schedule: scheduleFor(school, anchors),
    events: eventsForSchool(eventRows ?? [], school).map(toCalendarEvent),
    blocks: (blocksRes.data ?? []).map(toTimetableBlock),
    units,
    progress,
    taughtOn,
    periods,
    subjects: new Map(
      (subjectsRes.data ?? []).map((s) => [s.id, { fr: s.label_fr, en: s.label_en ?? s.label_fr }]),
    ),
    teacherId: session.userId,
    homeroom: cls.myRole === 'homeroom',
    includeColleagues: options.colleagues,
    refs,
    gradeOrdinals: cls.gradeOrdinals,
    boardId: cls.boardId,
    guides: guides.guides,
    expectationParents: guides.parents,
  });
}

/**
 * The family guides (`parent_guide`) the teacher may use for the class's grades: those a lesson
 * of the class uses first, then the library's (`search_library`: her own, and the reviewed or
 * approved ones shared with her; the board's approved first), with their attentes and the parent
 * of every attente involved, for D-069's rule. A guide that cannot be read is left out.
 */
async function loadGuides(
  cls: ClassDetail,
  units: readonly NewsletterUnit[],
): Promise<{ guides: NewsletterGuide[]; parents: Map<string, string | null> }> {
  const supabase = await createSupabaseServerClient();
  const linked = [
    ...new Set(
      units.flatMap((u) => u.lessons.flatMap((l) => (l.libraryItemId ? [l.libraryItemId] : []))),
    ),
  ];
  const searches = await Promise.all(
    cls.gradeCodes.map((gradeCode) =>
      supabase.rpc('search_library', {
        p_filters: { types: ['parent_guide'], gradeCode },
        p_limit: 50,
        p_offset: 0,
      }),
    ),
  );
  const found: string[] = [];
  for (const { data, error } of searches) {
    if (error) {
      reportError('loadNewsletterGuides', error);
      continue;
    }
    const parsed = searchSchema.safeParse(data);
    if (!parsed.success) continue;
    for (const item of parsed.data.items) {
      // A guide for families: approved or reviewed, or her own draft.
      const usable =
        item.status === 'board_approved' ||
        item.status === 'teacher_reviewed' ||
        (item.mine && item.status === 'draft');
      if (usable && !found.includes(item.id)) found.push(item.id);
    }
  }
  const ids = [...new Set([...linked, ...found])];
  if (ids.length === 0) return { guides: [], parents: new Map() };

  const [itemsRes, versionsRes, expectationsRes] = await Promise.all([
    supabase.from('library_items').select('id, type, title, status').in('id', ids),
    supabase
      .from('library_item_versions')
      .select('item_id, content')
      .in('item_id', ids)
      .is('language_level_id', null),
    supabase.from('library_item_expectations').select('item_id, expectation_id').in('item_id', ids),
  ]);
  const failed = itemsRes.error ?? versionsRes.error ?? expectationsRes.error;
  if (failed) {
    reportError('loadNewsletterGuides', failed);
    return { guides: [], parents: new Map() };
  }
  const items = new Map(
    (itemsRes.data ?? [])
      .filter(
        (i) => i.type === 'parent_guide' && i.status !== 'archived' && i.status !== 'rejected',
      )
      .map((i) => [i.id, i]),
  );
  const contents = new Map(
    (versionsRes.data ?? []).flatMap((v) => {
      const parsed = guideContentSchema.safeParse(v.content);
      return parsed.success ? [[v.item_id, parsed.data] as const] : [];
    }),
  );
  const attentes = new Map<string, string[]>();
  for (const e of expectationsRes.data ?? []) {
    attentes.set(e.item_id, [...(attentes.get(e.item_id) ?? []), e.expectation_id]);
  }
  const guides: NewsletterGuide[] = ids.flatMap((id) => {
    const item = items.get(id);
    const content = contents.get(id);
    if (!item || !content) return [];
    return [
      {
        id,
        title: item.title,
        expectationIds: attentes.get(id) ?? [],
        atHomeFr: content.fr.atHome,
        atHomeEn: content.en.atHome,
      },
    ];
  });

  // The parent of every attente involved (the units' and the guides'), for D-069's rule.
  const involved = [
    ...new Set([
      ...units.flatMap((u) => [...u.expectationIds, ...u.lessons.flatMap((l) => l.expectationIds)]),
      ...guides.flatMap((g) => g.expectationIds),
    ]),
  ];
  const parents = new Map<string, string | null>();
  for (let i = 0; i < involved.length; i += 200) {
    const { data, error } = await supabase
      .from('curriculum_expectations')
      .select('id, parent_id')
      .in('id', involved.slice(i, i + 200));
    if (error) {
      reportError('loadNewsletterGuides', error);
      break;
    }
    for (const e of data ?? []) parents.set(e.id, e.parent_id);
  }
  return { guides, parents };
}

// ---------------------------------------------------------------------------------------
// « Aujourd'hui »: « Info-parents : préparez le message de la semaine » (D-142)
// ---------------------------------------------------------------------------------------

export interface NewsletterReminderRow {
  classId: string;
  className: string;
  /** The week to prepare: its Monday. */
  weekOf: LocalDate;
}

/**
 * The classes to remind about today (`newsletterReminders`): each class where the teacher is
 * homeroom, at a school where she teaches with the Teaching module (never a sample class), that
 * already has a message; on the last two school days of its week (the board's and the school's
 * days off counted), until this week's message is marked sent. Classes by name. The calendar is
 * read only when a class could be reminded.
 */
export async function loadNewsletterReminders(
  session: SessionContext,
): Promise<NewsletterReminderRow[]> {
  const schools = new Map(teachingSchools(session).map((s) => [s.id, s]));
  if (schools.size === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('class_teachers')
    .select(
      'classes!inner(id, name, school_id, sample_owner_id, school_years(starts_on, ends_on), class_newsletters(week_of, status))',
    )
    .eq('user_id', session.userId)
    .eq('role', 'homeroom');
  if (error) {
    reportError('loadNewsletterReminders', error);
    return [];
  }
  const candidates = (data ?? []).flatMap(({ classes: c }) => {
    const school = schools.get(c.school_id);
    const year = c.school_years;
    if (!school || !year || c.sample_owner_id !== null || c.class_newsletters.length === 0) {
      return [];
    }
    const today = localDateIn(school.timezone);
    const monday = mondayOf(today);
    // This week, inside the class's school year (empty outside it).
    const friday = addDays(monday, 4);
    const startsOn = year.starts_on > monday ? year.starts_on : monday;
    const endsOn = year.ends_on < friday ? year.ends_on : friday;
    if (endsOn < startsOn) return [];
    const messages = c.class_newsletters.map((m) => ({
      weekOf: m.week_of,
      status: m.status === 'sent' ? ('sent' as const) : ('draft' as const),
    }));
    if (messages.some((m) => m.weekOf === monday && m.status === 'sent')) return [];
    return [{ id: c.id, name: c.name, school, today, startsOn, endsOn, messages }];
  });
  if (candidates.length === 0) return [];

  const from = candidates.reduce((min, c) => (c.startsOn < min ? c.startsOn : min), '9999-12-31');
  const until = candidates.reduce((max, c) => (c.endsOn > max ? c.endsOn : max), '0000-01-01');
  const { data: events, error: eventsError } = await supabase
    .from('school_calendar_events')
    .select(
      'id, board_id, school_id, class_id, event_type, title, starts_on, ends_on, start_time, end_time, affects_schedule',
    )
    .in('board_id', [...new Set(candidates.map((c) => c.school.boardId))])
    .lte('starts_on', until)
    .gte('ends_on', from)
    .limit(PAGE);
  if (eventsError) {
    reportError('loadNewsletterReminders', eventsError);
    return [];
  }
  return candidates
    .flatMap((c) => {
      const calendar: YearCalendarEvent[] = (events ?? [])
        .filter((e) => e.board_id === c.school.boardId)
        .map((e) => ({ ...toCalendarEvent(e), schoolId: e.school_id }));
      const [week] = schoolWeeks({
        startsOn: c.startsOn,
        endsOn: c.endsOn,
        events: calendar,
        schoolId: c.school.id,
        classId: c.id,
      });
      return newsletterReminders([{ cls: c, week: week ?? null, messages: c.messages }], c.today);
    })
    .map(({ cls, weekOf }) => ({ classId: cls.id, className: cls.name, weekOf }))
    .sort((a, b) => a.className.localeCompare(b.className, 'fr-CA'));
}

/** The signed-in teacher's latest « Traduire en anglais (IA) » request for a message (D-139). */
export interface NewsletterTranslationState {
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string;
  /** A key under `errors` when it failed (newsletterChanged, aiBudgetReached…). */
  errorCode: string | null;
  /** Paragraphs written when it succeeded. */
  applied: number | null;
  /**
   * Nothing changed in the message since the request was answered (or asked, for a failure):
   * its notice shows only then.
   */
  current: boolean;
}

/**
 * The teacher's own latest request for this message (row level security: a person's own jobs),
 * read for the editor: while it is open, the message is read-only and the progress shows;
 * afterwards, what it did, until the message changes.
 */
export async function loadNewsletterTranslation(
  newsletterId: string,
  revision: number,
): Promise<NewsletterTranslationState | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('ai_jobs')
    .select('id, status, error_code, created_at, asked:input->revision, applied:result->applied')
    .eq('feature', 'newsletter_translate')
    .eq('input->>newsletterId', newsletterId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) reportError('loadNewsletterTranslation', error);
  if (!data) return null;
  const asked = typeof data.asked === 'number' ? data.asked : null;
  const applied = typeof data.applied === 'number' ? data.applied : null;
  return {
    jobId: data.id,
    status: data.status,
    createdAt: data.created_at,
    errorCode: data.error_code,
    applied,
    current:
      asked !== null &&
      (data.status === 'succeeded' ? asked + (applied ? 1 : 0) === revision : asked === revision),
  };
}
