import { appReleaseFrom } from '@lynx/config';
import type { SessionContext } from '@/server/session';
import { AppFooter } from './app-footer';

/**
 * The footer of the signed-in app: « Confidentialité », « Nouveautés » and the version (DECISIONS
 * D-110, D-117). The banner for newer terms (D-109) is at the top of the page (`TermsBanner`).
 */
export async function FooterSlot({ session: _session }: { session: SessionContext }) {
  return <AppFooter release={appReleaseFrom(process.env)} />;
}
