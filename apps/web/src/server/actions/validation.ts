import 'server-only';
import type { z } from 'zod';
import { fail, type ActionResult } from '@/lib/action-result';

/** Parses input with a Zod schema; on failure returns field errors keyed by path. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): { ok: true; data: z.infer<S> } | { ok: false; result: ActionResult<never> } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.') || 'form';
    // Our schemas use translation keys as messages; Zod's defaults become "invalid".
    fieldErrors[key] ??= /^[a-zA-Z]+$/.test(issue.message) ? issue.message : 'invalid';
  }
  return { ok: false, result: fail('invalid', fieldErrors) };
}
