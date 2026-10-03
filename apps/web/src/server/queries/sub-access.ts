import 'server-only';
import { z } from 'zod';
import type { SubAccess } from '@/components/sub-codes/access-view';
import type { ServerSupabase } from '../supabase';

const accessSchema = z.object({
  codes: z.array(
    z.object({
      codeId: z.string(),
      createdAt: z.string(),
      createdByName: z.string().nullable(),
      validFrom: z.string(),
      expiresAt: z.string(),
      revokedAt: z.string().nullable(),
      deviceCount: z.number().int(),
    }),
  ),
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      codeId: z.string(),
      deviceNumber: z.number().int(),
      startedAt: z.string(),
      lastSeenAt: z.string().nullable(),
      expiresAt: z.string(),
      revokedAt: z.string().nullable(),
      cut: z.boolean(),
    }),
  ),
}) satisfies z.ZodType<SubAccess>;

/**
 * A plan's substitute codes and devices (list_sub_plan_access: owner, direction, office). Null
 * when the caller may not see them, or on error: the codes panel is then left out.
 */
export async function loadSubAccess(
  supabase: ServerSupabase,
  planId: string,
): Promise<SubAccess | null> {
  const { data, error } = await supabase.rpc('list_sub_plan_access', { p_plan_id: planId });
  if (error) return null;
  const parsed = accessSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
