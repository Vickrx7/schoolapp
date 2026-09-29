import 'server-only';
import {
  formalStaffName,
  localDateIn,
  subPlanEditsSchema,
  subPlanV1Schema,
  type AbsencePart,
  type LocalDate,
  type SubPlanEdits,
  type SubPlanV1,
} from '@lynx/domain';
import type { PlanContext, PlanLevel, RosterStudent } from '@/components/sub-plans/types';
import type { SessionContext } from '../session';
import { findSchool } from '../session';
import { createSupabaseServerClient } from '../supabase';

export interface OwnerPlan {
  id: string;
  planDate: LocalDate;
  released: boolean;
  releaseAt: string;
  releasedByHand: boolean;
  contentVersion: number;
  editsRevision: number;
  editedAt: string | null;
  /** Null when the stored plan cannot be read (it is rebuilt by « Mettre à jour le plan »). */
  plan: SubPlanV1 | null;
  /** The teacher's overlay (D-048); an unreadable overlay is ignored rather than shown. */
  edits: SubPlanEdits | null;
  absence: {
    id: string;
    schoolId: string;
    startsOn: LocalDate;
    endsOn: LocalDate;
    part: AbsencePart;
    note: string | null;
    published: boolean;
    refreshing: boolean;
  };
  context: PlanContext;
  roster: RosterStudent[];
  levels: PlanLevel[];
  /** The absence is published and the day is not over: edits are accepted. */
  editable: boolean;
  alertsEnabled: boolean;
}

/**
 * A plan of the signed-in teacher's own absence, read through RLS (sub_plans_select: owner
 * only). First names and levels are read as her too: she teaches the covered classes. Null if
 * the plan is not hers or does not exist.
 */
export async function loadPlanForOwner(
  session: SessionContext,
  planId: string,
): Promise<OwnerPlan | null> {
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from('sub_plans')
    .select(
      'id, plan_date, status, review_deadline, released_at, content_version, edits, edits_revision, edited_at, plan, absences!inner(id, school_id, teacher_id, starts_on, ends_on, part, note, status, sources_changed_at)',
    )
    .eq('id', planId)
    .maybeSingle();
  if (!row || row.absences.teacher_id !== session.userId) return null;
  const school = findSchool(session, row.absences.school_id);
  if (!school) return null;

  const parsedPlan = subPlanV1Schema.safeParse(row.plan);
  const plan = parsedPlan.success ? parsedPlan.data : null;
  const parsedEdits = row.edits === null ? null : subPlanEditsSchema.safeParse(row.edits);
  const classIds = plan?.classes.map((c) => c.classId) ?? [];
  const levelIds = [
    ...new Set(
      (plan?.groups ?? []).map((g) => g.levelId).filter((id): id is string => id !== null),
    ),
  ];

  const [students, levels] = await Promise.all([
    classIds.length
      ? supabase
          .from('students')
          .select('id, class_id, first_name')
          .in('class_id', classIds)
          .eq('active', true)
      : Promise.resolve({ data: [] as { id: string; class_id: string; first_name: string }[] }),
    levelIds.length
      ? supabase
          .from('language_levels')
          .select('id, label_fr, label_en, description_fr, sort_order')
          .in('id', levelIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            label_fr: string;
            label_en: string | null;
            description_fr: string | null;
            sort_order: number;
          }[],
        }),
  ]);

  const now = new Date();
  const absence = row.absences;
  const published = absence.status === 'published';
  return {
    id: row.id,
    planDate: row.plan_date,
    released:
      row.status === 'released' || (row.status === 'ready' && new Date(row.review_deadline) <= now),
    releaseAt: row.status === 'released' && row.released_at ? row.released_at : row.review_deadline,
    releasedByHand: row.status === 'released',
    contentVersion: row.content_version,
    editsRevision: row.edits_revision,
    editedAt: row.edited_at,
    plan,
    edits: parsedEdits?.success ? parsedEdits.data : null,
    absence: {
      id: absence.id,
      schoolId: absence.school_id,
      startsOn: absence.starts_on,
      endsOn: absence.ends_on,
      part: absence.part,
      note: absence.note,
      published,
      refreshing: absence.sources_changed_at !== null,
    },
    context: {
      planId: row.id,
      planDate: row.plan_date,
      part: absence.part,
      schoolName: school.name,
      timezone: school.timezone,
      officePhone: school.settings.contact.officePhone?.trim() || null,
      arrivalInstructions: school.settings.substitute.arrivalInstructions,
      emergencyInfo: school.settings.substitute.emergencyInfo,
      teacherName: formalStaffName(session.displayName, session.honorific),
      absenceNote: absence.note,
    },
    roster: (students.data ?? []).map((s) => ({
      id: s.id,
      classId: s.class_id,
      firstName: s.first_name,
    })),
    levels: (levels.data ?? []).map((l) => ({
      id: l.id,
      labelFr: l.label_fr,
      labelEn: l.label_en,
      descriptionFr: l.description_fr,
      sortOrder: l.sort_order,
    })),
    editable: published && row.plan_date >= localDateIn(school.timezone, now),
    alertsEnabled: school.studentAlertsEnabled,
  };
}
