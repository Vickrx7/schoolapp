import 'server-only';
import {
  absenceParts,
  formalStaffName,
  localDateIn,
  localDateSchema,
  subPlanEditsSchema,
  subPlanV1Schema,
  type AbsencePart,
  type LocalDate,
  type SubPlanEdits,
  type SubPlanV1,
} from '@lynx/domain';
import { z } from 'zod';
import type { PlanContext, PlanLevel, RosterStudent } from '@/components/sub-plans/types';
import type { SessionContext } from '../session';
import { findSchool } from '../session';
import { withClassManagementKey } from '../sub-plans/office-copy';
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

const staffPlanSchema = z.union([
  z.object({ released: z.literal(false), releaseAt: z.string() }),
  z.object({
    released: z.literal(true),
    planId: z.string(),
    absenceId: z.string(),
    planDate: localDateSchema,
    part: z.enum(absenceParts),
    note: z.string().nullable(),
    contentVersion: z.number().int(),
    plan: z.unknown(),
    edits: z.unknown(),
    school: z.object({
      name: z.string(),
      officePhone: z.string().nullable(),
      arrivalInstructions: z.string().nullable(),
      emergencyInfo: z.string().nullable(),
      timezone: z.string(),
    }),
    teacherName: z.string(),
    roster: z.array(z.object({ id: z.string(), classId: z.string(), firstName: z.string() })),
    levels: z.array(
      z.object({
        id: z.string(),
        labelFr: z.string(),
        labelEn: z.string().nullable(),
        descriptionFr: z.string().nullable(),
        sortOrder: z.number(),
      }),
    ),
    role: z.enum(['direction', 'office']),
  }),
]);

export type StaffPlan =
  | { released: false; releaseAt: string }
  | {
      released: true;
      role: 'direction' | 'office';
      absenceId: string;
      planDate: LocalDate;
      contentVersion: number;
      /** Null when the stored plan cannot be read. */
      plan: SubPlanV1 | null;
      edits: SubPlanEdits | null;
      context: PlanContext;
      roster: RosterStudent[];
      levels: PlanLevel[];
    };

/**
 * A plan for direction or office (DECISIONS D-056): only once released, through
 * get_sub_plan_for_staff, which audits every view and leaves « Gestion de classe » out for the
 * office. Null when the caller is neither (or the plan does not exist).
 */
export async function loadPlanForStaff(planId: string): Promise<StaffPlan | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('get_sub_plan_for_staff', {
    p_plan_id: planId,
    p_purpose: 'view',
  });
  if (error || !data) return null;
  const parsed = staffPlanSchema.safeParse(data);
  if (!parsed.success) return null;
  const d = parsed.data;
  if (!d.released) return { released: false, releaseAt: d.releaseAt };
  const plan = subPlanV1Schema.safeParse(withClassManagementKey(d.plan));
  const edits = d.edits == null ? null : subPlanEditsSchema.safeParse(d.edits);
  return {
    released: true,
    role: d.role,
    absenceId: d.absenceId,
    planDate: d.planDate,
    contentVersion: d.contentVersion,
    plan: plan.success ? plan.data : null,
    edits: edits?.success ? edits.data : null,
    context: {
      planId: d.planId,
      planDate: d.planDate,
      part: d.part,
      schoolName: d.school.name,
      timezone: d.school.timezone,
      officePhone: d.school.officePhone?.trim() || null,
      arrivalInstructions: d.school.arrivalInstructions,
      emergencyInfo: d.school.emergencyInfo,
      teacherName: d.teacherName,
      absenceNote: d.note,
    },
    roster: d.roster,
    levels: d.levels,
  };
}
