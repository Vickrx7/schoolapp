'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/**
 * False while the server renders and while the page hydrates, true after: a countdown computed
 * from this device's clock is drawn only then, so the server's HTML and the first client render
 * always match.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
