/** What every server action returns. Error strings are translation keys (messages: errors.*). */
export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const okVoid = (): ActionResult => ({ ok: true, data: undefined });
export const fail = (error: string, fieldErrors?: Record<string, string>): ActionResult<never> => ({
  ok: false,
  error,
  ...(fieldErrors ? { fieldErrors } : {}),
});
