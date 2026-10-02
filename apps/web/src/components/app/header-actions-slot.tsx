import type { SessionContext } from '@/server/session';

/**
 * The actions at the right of the top bar, on every page of the signed-in app. Phase 6's slice S6
 * puts « Commentaires » here (DECISIONS D-116), so only this file changes; empty until then.
 */
export async function HeaderActionsSlot({ session: _session }: { session: SessionContext }) {
  return null;
}
