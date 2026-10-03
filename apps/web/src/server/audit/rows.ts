/**
 * One entry of « Journal d'audit » as `public.list_audit_entries` returns it (DECISIONS D-103):
 * labels already checked for the viewer (a null label means the viewer may not read it), details
 * already whitelisted (scalar values only), flags such as `office_issued_code`. Parsed with Zod so
 * an unexpected row never reaches a page or a file. Pure (no server-only import), so the audit
 * modules that use it are unit tested.
 */
import { z } from 'zod';

export const AUDIT_ACTOR_TYPES = ['user', 'substitute', 'system', 'service'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const auditRowSchema = z.object({
  id: z.coerce.number().int().positive(),
  occurred_at: z.string(),
  action: z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/),
  category: z.string(),
  actor_type: z.enum(AUDIT_ACTOR_TYPES),
  actor_user_id: z.string().nullable(),
  actor_label: z.string().nullable(),
  issuer_label: z.string().nullable(),
  subject_label: z.string().nullable(),
  school_id: z.string().nullable(),
  school_name: z.string().nullable(),
  entity_type: z.string().nullable(),
  entity_id: z.string().nullable(),
  entity_label: z.string().nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).catch({}),
  flags: z
    .array(z.string())
    .nullable()
    .transform((flags) => flags ?? []),
});

export type AuditRow = z.infer<typeof auditRowSchema>;

/**
 * The rows of one call. A row that does not parse throws rather than being left out: an audit
 * log that silently skips entries would mislead (the page shows its error panel instead).
 */
export function parseAuditRows(data: unknown): AuditRow[] {
  return z.array(auditRowSchema).parse(data ?? []);
}
