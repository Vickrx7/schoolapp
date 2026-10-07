/**
 * Lets another part of the plan page save the plan editor's pending changes first. The AI
 * panel does, before its preview: the preview is built from the saved plan, and an autosave
 * landing after it would make « Envoyer à l'IA » refuse the request as out of date.
 */

type Flush = () => Promise<void>;

const flushers = new Map<string, Flush>();

/** Registers the editor of a plan; returns the function that unregisters it. */
export function registerPlanFlush(planId: string, flush: Flush): () => void {
  flushers.set(planId, flush);
  return () => {
    if (flushers.get(planId) === flush) flushers.delete(planId);
  };
}

/**
 * Saves the plan's pending changes now, if an editor is open for it. Never throws: a save
 * that fails is shown by the editor, and the caller goes on with what is saved.
 */
export async function flushPlanEdits(planId: string): Promise<void> {
  try {
    await flushers.get(planId)?.();
  } catch {
    // The editor shows its own save errors.
  }
}
