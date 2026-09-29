import 'server-only';
import {
  absenceParts,
  localDateSchema,
  subPlanEditsSchema,
  subPlanV1Schema,
  type SubPlanEdits,
  type SubPlanV1,
  type SubReportContent,
} from '@lynx/domain';
import { z } from 'zod';
import type { PlanLevel, RosterStudent } from '@/components/sub-plans/types';
import { portalQuery } from './db';

/**
 * Typed wrappers around the portal functions (supabase/migrations/…_substitute_portal.sql).
 * Their results are not in the generated types (sub_portal is not an API schema), so they are
 * parsed here. Tokens, codes and keys are never logged.
 */

export const redeemOutcomes = ['ok', 'invalid', 'wait', 'used_up', 'revoked'] as const;
export type RedeemOutcome = (typeof redeemOutcomes)[number];

const redeemRowSchema = z.object({
  outcome: z.enum(redeemOutcomes),
  session_token: z.string().nullable(),
  expires_at: z.coerce.date().nullable(),
  retry_after: z.number().int().nullable(),
});

export interface RedeemResult {
  outcome: RedeemOutcome;
  /** Only for 'ok': shown to this device once, stored as a hash. */
  token: string | null;
  expiresAt: Date | null;
  /** Seconds, for 'wait'. */
  retryAfter: number | null;
}

export async function redeemCode(
  codeMacs: string[],
  deviceKey: string,
  ipKey: string,
): Promise<RedeemResult> {
  const rows = await portalQuery(
    'select outcome, session_token, expires_at, retry_after from sub_portal.redeem($1::text[], $2, $3)',
    [codeMacs, deviceKey, ipKey],
  );
  const row = redeemRowSchema.parse(rows[0]);
  return {
    outcome: row.outcome,
    token: row.session_token,
    expiresAt: row.expires_at,
    retryAfter: row.retry_after,
  };
}

const contextSchema = z.object({
  planId: z.string(),
  planDate: localDateSchema,
  part: z.enum(absenceParts),
  released: z.boolean(),
  releaseAt: z.string(),
  contentVersion: z.number().int(),
  updatedAt: z.string(),
  expiresAt: z.string(),
  schoolName: z.string(),
  schoolTimezone: z.string(),
  officePhone: z.string().nullable(),
  arrivalInstructions: z.string().nullable(),
  emergencyInfo: z.string().nullable(),
  teacherName: z.string(),
  absenceNote: z.string().nullable(),
  alertsAvailable: z.boolean(),
  reportStatus: z.enum(['none', 'draft', 'submitted', 'confirmed']),
});

const reportSchema = z.object({
  status: z.enum(['draft', 'submitted', 'confirmed']),
  content: z.unknown(),
  notesCiphertext: z.string().nullable(),
  notesKeyVersion: z.number().int().nullable(),
  updatedAt: z.string(),
  lockedToOtherDevice: z.boolean(),
});

const loadSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('expired') }),
  z.object({
    status: z.literal('ok'),
    context: contextSchema,
    plan: z.union([
      z.null(),
      z.literal('unchanged'),
      z.object({ plan: z.unknown(), edits: z.unknown(), ai: z.unknown() }),
    ]),
    roster: z
      .array(z.object({ id: z.string(), classId: z.string(), firstName: z.string() }))
      .nullable(),
    levels: z
      .array(
        z.object({
          id: z.string(),
          labelFr: z.string(),
          labelEn: z.string().nullable(),
          descriptionFr: z.string().nullable(),
          sortOrder: z.number(),
        }),
      )
      .nullable(),
    report: reportSchema.nullable(),
  }),
]);

export type PortalContext = z.infer<typeof contextSchema>;
export type PortalReport = z.infer<typeof reportSchema>;

export interface PortalDay {
  context: PortalContext;
  /**
   * null until the plan is released; 'unchanged' when the caller already shows this version.
   * `plan` is null when the stored plan cannot be read (the web view says so).
   */
  plan:
    | {
        plan: SubPlanV1 | null;
        edits: SubPlanEdits | null;
        /** The AI layer (D-052), read leniently by composeSubPlan. */
        ai: unknown;
      }
    | 'unchanged'
    | null;
  roster: RosterStudent[];
  levels: PlanLevel[];
  report: PortalReport | null;
}

export type PortalPurpose = 'view' | 'poll' | 'pdf';

/**
 * The day for a session token, or null when the session is no longer valid (ended, cut,
 * expired, absence cancelled). `purpose` decides what is audited (see sub_portal.load).
 */
export async function loadDay(
  token: string,
  knownVersion: number | null,
  purpose: PortalPurpose,
): Promise<PortalDay | null> {
  const rows = await portalQuery<{ day: unknown }>('select sub_portal.load($1, $2, $3) as day', [
    token,
    knownVersion,
    purpose,
  ]);
  const parsed = loadSchema.parse(rows[0]?.day);
  if (parsed.status === 'expired') return null;
  let plan: PortalDay['plan'] = null;
  if (parsed.plan === 'unchanged') plan = 'unchanged';
  else if (parsed.plan) {
    const p = subPlanV1Schema.safeParse(parsed.plan.plan);
    const e = parsed.plan.edits == null ? null : subPlanEditsSchema.safeParse(parsed.plan.edits);
    plan = {
      plan: p.success ? p.data : null,
      edits: e?.success ? e.data : null,
      ai: parsed.plan.ai ?? null,
    };
  }
  return {
    context: parsed.context,
    plan,
    roster: parsed.roster ?? [],
    levels: parsed.levels ?? [],
    report: parsed.report,
  };
}

const alertRowSchema = z.object({
  alert_id: z.string(),
  student_id: z.string(),
  class_id: z.string(),
  category: z.enum(['allergy', 'medical', 'safety', 'other']),
  body_ciphertext: z.string(),
  key_version: z.number().int(),
});

/** The covered classes' alerts as ciphertext (audited per class by the database). */
export async function portalAlerts(token: string) {
  const rows = await portalQuery(
    'select alert_id, student_id, class_id, category, body_ciphertext, key_version from sub_portal.alerts($1)',
    [token],
  );
  return z.array(alertRowSchema).parse(rows);
}

export const saveReportOutcomes = [
  'expired',
  'not_released',
  'confirmed',
  'locked_other_device',
  'already_submitted',
  'saved',
  'submitted',
] as const;
export type SaveReportOutcome = (typeof saveReportOutcomes)[number];

const saveReportRowSchema = z.object({
  outcome: z.enum(saveReportOutcomes),
  status: z.enum(['draft', 'submitted', 'confirmed']).nullable(),
  updated_at: z.coerce.date().nullable(),
});

/**
 * Saves the day's report (a draft) or sends it (`submit`), for a session token. The notes are
 * already encrypted (server/sub-reports/notes.ts); null when there are none. A malformed report
 * raises 22023 (the caller checked it with the same schema first).
 */
export async function saveReport(
  token: string,
  content: SubReportContent,
  notes: { ciphertext: string; keyVersion: number } | null,
  submit: boolean,
): Promise<{ outcome: SaveReportOutcome; updatedAt: string | null }> {
  const rows = await portalQuery(
    `select outcome, status, updated_at
       from sub_portal.save_report($1, $2::jsonb, $3, $4::smallint, $5)`,
    [token, JSON.stringify(content), notes?.ciphertext ?? null, notes?.keyVersion ?? null, submit],
  );
  const row = saveReportRowSchema.parse(rows[0]);
  return { outcome: row.outcome, updatedAt: row.updated_at?.toISOString() ?? null };
}

/** « Terminer ma journée »: ends this session (a no-op if it already ended). */
export async function endPortalSession(token: string): Promise<void> {
  await portalQuery('select sub_portal.end_session($1)', [token]);
}
