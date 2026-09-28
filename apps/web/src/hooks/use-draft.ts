'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'lynx-draft:';

/**
 * Form state that is also kept in localStorage while the teacher types, so a crash, a lost
 * connection or a closed tab never loses their work. Call `clear()` after a successful save.
 */
export function useDraft<T extends object>(key: string, initial: T) {
  const storageKey = PREFIX + key;
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as { value: T };
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from storage on mount
        setValue({ ...initial, ...parsed.value });
        setRestored(true);
      }
    } catch {
      // Storage unavailable (private mode) or corrupt: start fresh.
    }
    loaded.current = true;
    // Only on mount / key change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!loaded.current) return;
    const handle = window.setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ value, savedAt: Date.now() }));
      } catch {
        // Ignore quota or private-mode errors.
      }
    }, 400);
    return () => window.clearTimeout(handle);
  }, [storageKey, value]);

  const update = useCallback(<K extends keyof T>(field: K, v: T[K]) => {
    setValue((prev) => ({ ...prev, [field]: v }));
  }, []);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    setRestored(false);
  }, [storageKey]);

  const discard = useCallback(() => {
    clear();
    setValue(initial);
  }, [clear, initial]);

  return { value, setValue, update, restored, clear, discard };
}
