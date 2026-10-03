'use server';

import { isLibraryItemType, lessonFromItem, parseVersionContent } from '@lynx/content';
import type { Json } from '@lynx/db';
import { isDone } from '@lynx/domain';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { localized } from '@/i18n/config';
import { fail, ok, okVoid, type ActionResult } from '@/lib/action-result';
import { reportError } from '../errors';
import type { PlanningClass, PlanningTargets, UnitStatus } from '../library/planning-targets';
import { requireSession, teachingSchools } from '../session';
import { createSupabaseServerClient } from '../supabase';
import { fetchAllRows } from '../queries/fetch-all';
import { getLocale } from 'next-intl/server';

/**
 * « Ajouter à ma planification » (DECISIONS D-076): a material is attached to a lesson (the
 * lesson's `library_item_id`; row level security and the lessons trigger check that the teacher
 * may use the resource), and a lesson plan or a project can become a new lesson
 * (`add_library_item_to_unit`). Nothing else about the lessons changes, and « Aujourd'hui » and
 * substitute plans follow (Phase 3's triggers mark upcoming absences out of date).
 */

const uuid = z.uuid();

const refresh = (classId: string, unitId: string, itemId?: string | null) => {
  revalidatePath(`/classes/${classId}/planning`);
  revalidatePath(`/classes/${classId}/planning/${unitId}`);
  revalidatePath('/today');
  if (itemId) revalidatePath(`/library/items/${itemId}`);
};

/** Teachers with a class at a school with the Teaching module plan lessons. */
async function planner() {
  const session = await requireSession();
  return teachingSchools(session).length ? session : null;
}

export interface PlanningTargetsResult extends PlanningTargets {
  item: { id: string; type: string; title: string; subjectId: string | null; gradeCodes: string[] };
}

/**
 * The teacher's classes (at schools with the Teaching module), their units (not archived) and
 * lessons with what is done, their attentes and the resource already attached; and the attentes
 * that count as shared with the resource (its own, their overall and specific attentes).
 */
export async function listPlanningTargets(
  itemId: string,
): Promise<ActionResult<PlanningTargetsResult>> {
  const session = await planner();
  if (!session) return fail('forbidden');
  if (!uuid.safeParse(itemId).success) return fail('invalid');
  const locale = await getLocale();
  const supabase = await createSupabaseServerClient();
  const schoolIds = teachingSchools(session).map((s) => s.id);

  const [item, classes] = await Promise.all([
    supabase
      .from('library_items')
      .select(
        'id, type, title, subject_id, library_item_grades(grade_code), library_item_expectations(expectation_id, curriculum_expectations(parent_id))',
      )
      .eq('id', itemId)
      .maybeSingle(),
    supabase
      .from('class_teachers')
      .select(
        'classes!inner(id, name, school_id, class_grades(grade_code), units(id, title, subject_id, status, subjects(label_fr, label_en), unit_lessons(id, sequence_number, title, library_item_id, library_items(id, title), unit_lesson_expectations(expectation_id))))',
      )
      .eq('user_id', session.userId)
      .in('classes.school_id', schoolIds),
  ]);
  if (item.error || classes.error) {
    return fail(reportError('listPlanningTargets', item.error ?? classes.error));
  }
  if (!item.data) return fail('notFound');

  const own = item.data.library_item_expectations.map((e) => e.expectation_id);
  const parents = item.data.library_item_expectations
    .map((e) => e.curriculum_expectations?.parent_id)
    .filter((id): id is string => !!id);
  const children = own.length
    ? ((await supabase.from('curriculum_expectations').select('id').in('parent_id', own)).data ??
      [])
    : [];

  const rows = (classes.data ?? []).map((r) => r.classes);
  const lessonIds = rows.flatMap((c) => c.units.flatMap((u) => u.unit_lessons.map((l) => l.id)));
  // By class, page by page: a teacher's classes pass PostgREST's 1,000 rows in the spring.
  const progress = lessonIds.length
    ? ((
        await fetchAllRows((from, to) =>
          supabase
            .from('lesson_progress')
            .select('lesson_id, status')
            .in(
              'class_id',
              rows.map((c) => c.id),
            )
            .order('lesson_id')
            .range(from, to),
        )
      ).data ?? [])
    : [];
  const status = new Map(progress.map((p) => [p.lesson_id, p.status]));

  const seen = new Set<string>();
  const planningClasses: PlanningClass[] = [];
  for (const c of rows) {
    if (seen.has(c.id)) continue; // homeroom and subject teacher of the same class
    seen.add(c.id);
    planningClasses.push({
      id: c.id,
      name: c.name,
      gradeCodes: c.class_grades.map((g) => g.grade_code).sort(),
      units: c.units
        .filter((u) => u.status !== 'archived')
        .map((u) => ({
          id: u.id,
          title: u.title,
          subjectId: u.subject_id,
          subjectLabel: u.subjects
            ? localized(locale, u.subjects.label_fr, u.subjects.label_en)
            : '',
          status: u.status as UnitStatus,
          lessons: u.unit_lessons
            .map((l) => ({
              id: l.id,
              sequenceNumber: l.sequence_number,
              title: l.title,
              done: isDone(status.get(l.id)),
              expectationIds: l.unit_lesson_expectations.map((e) => e.expectation_id),
              resource: l.library_items
                ? { id: l.library_items.id, title: l.library_items.title }
                : null,
              hasHiddenResource: l.library_item_id !== null && !l.library_items,
            }))
            .sort((a, b) => a.sequenceNumber - b.sequenceNumber),
        })),
    });
  }
  planningClasses.sort((a, b) => a.name.localeCompare(b.name, 'fr-CA', { numeric: true }));

  return ok({
    classes: planningClasses,
    relatedExpectationIds: [...new Set([...own, ...parents, ...children.map((e) => e.id)])],
    item: {
      id: item.data.id,
      type: item.data.type,
      title: item.data.title,
      subjectId: item.data.subject_id,
      gradeCodes: item.data.library_item_grades.map((g) => g.grade_code).sort(),
    },
  });
}

export type AttachResult =
  | {
      status: 'attached';
      lessonId: string;
      sequenceNumber: number;
      classId: string;
      unitId: string;
    }
  /** The lesson already has another resource: « Remplacer « … » ? ». */
  | { status: 'confirm'; currentTitle: string | null };

/**
 * « Joindre à la leçon N ». A lesson that already has another resource is only changed once the
 * teacher confirms (`replace`).
 */
export async function attachItemToLesson(
  itemId: string,
  lessonId: string,
  replace: boolean,
): Promise<ActionResult<AttachResult>> {
  if (!(await planner())) return fail('forbidden');
  if (!uuid.safeParse(itemId).success || !uuid.safeParse(lessonId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { data: lesson, error: readError } = await supabase
    .from('unit_lessons')
    .select('id, sequence_number, library_item_id, library_items(title), units!inner(id, class_id)')
    .eq('id', lessonId)
    .maybeSingle();
  if (readError) return fail(reportError('attachItemToLesson', readError));
  if (!lesson) return fail('notFound');
  if (lesson.library_item_id && lesson.library_item_id !== itemId && !replace) {
    return ok({ status: 'confirm', currentTitle: lesson.library_items?.title ?? null });
  }
  const { data, error } = await supabase
    .from('unit_lessons')
    .update({ library_item_id: itemId })
    .eq('id', lessonId)
    .select('id');
  if (error) return fail(reportError('attachItemToLesson', error));
  if (!data?.length) return fail('forbidden');
  refresh(lesson.units.class_id, lesson.units.id, itemId);
  if (lesson.library_item_id && lesson.library_item_id !== itemId) {
    revalidatePath(`/library/items/${lesson.library_item_id}`);
  }
  return ok({
    status: 'attached',
    lessonId,
    sequenceNumber: lesson.sequence_number,
    classId: lesson.units.class_id,
    unitId: lesson.units.id,
  });
}

/** « Retirer la ressource » from a lesson (the lesson itself stays as it is). */
export async function detachItemFromLesson(lessonId: string): Promise<ActionResult> {
  if (!(await planner())) return fail('forbidden');
  if (!uuid.safeParse(lessonId).success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('unit_lessons')
    .update({ library_item_id: null })
    .eq('id', lessonId)
    .select('id, library_item_id, units!inner(id, class_id)');
  if (error) return fail(reportError('detachItemFromLesson', error));
  const row = data?.[0];
  if (!row) return fail('forbidden');
  refresh(row.units.class_id, row.units.id);
  return okVoid();
}

/**
 * « Nouvelle leçon »: the resource becomes a lesson of the unit at a position (null: at the
 * end), with an outline copied once (`lessonFromItem`: title, objective or attentes, materials,
 * duration, a plain-text outline and the substitute notes of a lesson plan) and the link.
 */
export async function addItemAsLesson(
  itemId: string,
  unitId: string,
  position: number | null,
): Promise<
  ActionResult<{ lessonId: string; sequenceNumber: number; classId: string; unitId: string }>
> {
  if (!(await planner())) return fail('forbidden');
  const input = z
    .object({ itemId: z.uuid(), unitId: z.uuid(), position: z.number().int().min(1).nullable() })
    .safeParse({ itemId, unitId, position });
  if (!input.success) return fail('invalid');
  const supabase = await createSupabaseServerClient();
  const [item, base] = await Promise.all([
    supabase
      .from('library_items')
      .select(
        'type, title, materials, duration_minutes, subjects(code), library_item_expectations(curriculum_expectations(code, text_fr, sort_order))',
      )
      .eq('id', itemId)
      .maybeSingle(),
    supabase
      .from('library_item_versions')
      .select('content')
      .eq('item_id', itemId)
      .is('language_level_id', null)
      .maybeSingle(),
  ]);
  if (!item.data || !isLibraryItemType(item.data.type)) return fail('notFound');
  const type = item.data.type;
  const parsed = parseVersionContent(type, base.data?.content);
  const expectations = item.data.library_item_expectations
    .map((e) => e.curriculum_expectations)
    .filter((e) => e !== null)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((e) => ({ code: e.code, text: e.text_fr }));
  const outline = lessonFromItem(
    {
      type,
      title: item.data.title,
      materials: item.data.materials,
      durationMinutes: item.data.duration_minutes,
      subjectCode: item.data.subjects?.code ?? null,
    },
    parsed.ok ? parsed.content : {},
    expectations,
  );
  const { data: lessonId, error } = await supabase.rpc('add_library_item_to_unit', {
    p_item_id: itemId,
    p_unit_id: unitId,
    p_position: input.data.position as number,
    p_lesson: { ...outline } as unknown as Json,
  });
  if (error) return fail(reportError('addItemAsLesson', error));
  const { data: lesson } = await supabase
    .from('unit_lessons')
    .select('sequence_number, units!inner(class_id)')
    .eq('id', lessonId)
    .maybeSingle();
  if (!lesson) return fail('unexpected');
  refresh(lesson.units.class_id, unitId, itemId);
  return ok({
    lessonId,
    sequenceNumber: lesson.sequence_number,
    classId: lesson.units.class_id,
    unitId,
  });
}
