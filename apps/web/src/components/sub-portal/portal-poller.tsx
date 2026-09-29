'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { pollSubPortal } from '@/server/actions/sub-portal';

const POLL_MS = 60_000;

/**
 * Checks every minute (while the page is visible) whether the plan changed or was released,
 * and reloads it; the teacher can edit during the day. An access that ended goes back to
 * « Accès suppléance ». `knownVersion` is null while waiting for release.
 */
export function PortalPoller({ knownVersion }: { knownVersion: number | null }) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped || document.hidden) return;
      try {
        const result = await pollSubPortal(knownVersion);
        if (stopped || !result.ok) return;
        if (result.data.status === 'expired') router.replace('/suppleance?ended=1');
        else if (result.data.status === 'changed') router.refresh();
      } catch {
        // Offline for a moment: the plan stays on screen; try again at the next tick.
      }
    };
    const timer = window.setInterval(() => void tick(), POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [knownVersion, router]);
  return null;
}
