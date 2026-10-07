'use client';

import { useEffect, useRef } from 'react';

/**
 * Calls `hide` when the page is put away: another tab or app comes to the front, the phone is
 * locked (`visibilitychange` to hidden), or the page is left (`pagehide`, which also covers a
 * page kept in the back-forward cache). Used for safety and medical alerts, which must not be
 * on screen when the page comes back.
 */
export function useHideWhenAway(hide: () => void) {
  const latest = useRef(hide);
  useEffect(() => {
    latest.current = hide;
  }, [hide]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') latest.current();
    };
    const onPageHide = () => latest.current();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);
}
