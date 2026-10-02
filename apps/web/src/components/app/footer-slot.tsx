import type { SessionContext } from '@/server/session';

/**
 * The footer of the signed-in app: « Confidentialité », « Nouveautés » and the version (DECISIONS
 * D-110, D-117), and the banner when the pilot terms changed (D-109). Phase 6's slice S6 fills
 * it, so only this file changes; empty until then.
 */
export async function FooterSlot({ session: _session }: { session: SessionContext }) {
  return null;
}
