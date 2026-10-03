'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const REFRESH_MS = 60_000;

/** Keeps the « Suppléances » board current: reloads its data every minute while visible. */
export function BoardRefresher() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);
  return null;
}
