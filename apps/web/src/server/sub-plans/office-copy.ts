/**
 * The office's copy of a plan (get_sub_plan_for_staff for office staff, DECISIONS D-056) comes
 * without « Gestion de classe »: the database removes the key from each class's notes. It is put
 * back as null so the copy reads as a plan and still holds none of that text. Pure, so it can be
 * unit tested.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function withClassManagementKey(plan: unknown): unknown {
  if (!isRecord(plan) || !Array.isArray(plan.classNotes)) return plan;
  return {
    ...plan,
    classNotes: plan.classNotes.map((n) =>
      isRecord(n) && !('classManagement' in n) ? { ...n, classManagement: null } : n,
    ),
  };
}
