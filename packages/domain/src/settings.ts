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
  /** Monthly AI spending cap per school, in US dollars (the provider bills in USD). */
  aiMonthlyBudgetUsdPerSchool: z.number().min(0).max(10_000).catch(25),
  /** Whether AI features are available at all for this board. */
  aiEnabled: z.boolean().catch(true),
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
