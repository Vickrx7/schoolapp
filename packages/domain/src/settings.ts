/**
 * Board and school settings stored as JSON (boards.settings, schools.settings).
 *
 * Everything that differs between boards lives here or in data tables, never in code, so a
 * new board is configuration only (DECISIONS.md, D-003). Parsing is lenient: a missing or
 * invalid value falls back to its default instead of breaking the app.
 */
import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const boardSettingsSchema = z.object({
  /** First grade (ordinal: K1 = -1, K2 = 0, 1..8) where Anglais is taught. */
  anglaisStartGrade: z.number().int().min(-1).max(8).catch(4),
  /** When an unreviewed substitute plan is released automatically (school local time). */
  subPlanAutoReleaseTime: hhmm.catch('07:30'),
  /**
   * AI budgets (read by the database too: app.ai_budget_status and request_ai_job).
   * Amounts are the provider cost in US dollars per month.
   */
  ai: z
    .object({
      /** False: no school of the board can use AI, whatever its principal chooses. */
      allowed: z.boolean().catch(true),
      /** Allowance for schools without their own budget (set with the admin CLI). */
      defaultMonthlyAllowanceUsd: z.number().min(0).max(100_000).catch(50),
      /** Default ceiling for borrowing from the pool: allowance x this. */
      ceilingMultiplier: z.number().min(1).max(10).catch(2),
      /** Whether schools may borrow what other schools of the board have not used. */
      pooling: z.boolean().catch(true),
    })
    .catch({ allowed: true, defaultMonthlyAllowanceUsd: 50, ceilingMultiplier: 2, pooling: true }),
  /** Retention for class-mode results kept by teachers, in days. */
  classModeResultsRetentionDays: z.number().int().min(1).max(3650).catch(365),
});

export type BoardSettings = z.infer<typeof boardSettingsSchema>;

export const schoolSettingsSchema = z.object({
  contact: z
    .object({
      officePhone: z.string().max(40).optional().catch(undefined),
      officeEmail: z.email().max(320).optional().catch(undefined),
    })
    .catch({}),
  /** Typical first bell and dismissal, used to prefill new timetables. */
  dayStart: hhmm.catch('08:45'),
  dayEnd: hhmm.catch('15:20'),
});

export type SchoolSettings = z.infer<typeof schoolSettingsSchema>;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseBoardSettings(value: unknown): BoardSettings {
  return boardSettingsSchema.parse(asObject(value));
}

export function parseSchoolSettings(value: unknown): SchoolSettings {
  return schoolSettingsSchema.parse(asObject(value));
}
