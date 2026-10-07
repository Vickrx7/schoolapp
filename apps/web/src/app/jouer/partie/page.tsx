import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Game } from '@/components/class-portal/game';
import { GameOver } from '@/components/class-portal/game-over';
import { classPortalConfigured } from '@/server/class-portal/db';
import { loadDeviceState } from '@/server/class-portal/portal';
import type { DeviceOkState } from '@/server/class-portal/schemas';
import { requireDevice } from '@/server/class-portal/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('classPortal');
  return { title: t('title') };
}

/**
 * The game on a class device (DECISIONS D-084 to D-088): its number and team, the questions, its
 * own results and the ranking. The first view is loaded here with the device's cookie, then the
 * page polls. The page holds only the device's own view: the snapshot's questions (never a key)
 * and the `classPortal` messages. A device without a token goes back to « Rejoindre la partie ».
 */
export default async function GamePage() {
  if (!classPortalConfigured()) redirect('/jouer');
  const token = await requireDevice();

  let initial: DeviceOkState | null = null;
  let over: 'gone' | 'ended' | null = null;
  try {
    const result = await loadDeviceState(token, null);
    if (result.status === 'ok') {
      const state = result.value;
      if (state.status === 'gone' || state.status === 'ended') over = state.status;
      else if (state.status === 'ok') initial = state;
    }
  } catch {
    // The database is slow or unreachable: the page polls until it answers.
  }
  if (over) return <GameOver reason={over} />;
  return <Game initial={initial} />;
}
