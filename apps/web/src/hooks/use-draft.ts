'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  DRAFT_PREFIX,
  decideDraft,
  draftStorage,
  serializeDraft,
  type DraftStorageKind,
  type SentDraftPolicy,
} from './draft-storage';

export { clearAllDrafts, forgetSentDrafts, removeDrafts } from './draft-storage';

export interface DraftOptions {
  /**
   * The server version of `initial` (e.g. its updated_at). A draft edited from another version
   * is not restored over newer content: it is offered instead (`offered`, `recover()`).
   */
  version?: string;
  /** What to do with a stored draft that was already sent as a request (see `markSent`). */
  sentPolicy?: SentDraftPolicy;
  /**
   * 'local' (default) keeps the draft on the device; 'session' keeps it for this tab only, for
   * a form on a device that is not the writer's own (the substitute's report).
   */
  storage?: DraftStorageKind;
}

function write(kind: DraftStorageKind, storageKey: string, text: string) {
  try {
    draftStorage(kind)?.setItem(storageKey, text);
  } catch {
    // Ignore quota or private-mode errors.
  }
}

function remove(kind: DraftStorageKind, storageKey: string) {
  try {
    draftStorage(kind)?.removeItem(storageKey);
  } catch {
    // ignore
  }
}

/**
 * Form state that is also kept in the browser once the teacher edits it, so a crash, a lost
 * connection or a closed tab never loses their work (D-035). Opening a form stores nothing, and
 * a stored copy identical to `initial` is dropped. Call `clear()` after a successful save.
 * Include the user id in `key`: another account on the same browser must never get the draft.
 */
export function useDraft<T extends object>(key: string, initial: T, options: DraftOptions = {}) {
  const storageKey = DRAFT_PREFIX + key;
  const kind: DraftStorageKind = options.storage ?? 'local';
  const [value, setValueState] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const [sentAs, setSentAs] = useState<string | null>(null);
  const [offered, setOffered] = useState<T | null>(null);
  // Only a real edit is saved: a snapshot taken on mount would later hide newer server content.
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const version = useRef(options.version);

  useEffect(() => {
    version.current = options.version;
  }, [options.version]);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = draftStorage(kind)?.getItem(storageKey) ?? null;
    } catch {
      // Storage unavailable (private mode): start fresh.
    }
    const decision = decideDraft(raw, initial, {
      version: options.version,
      sentPolicy: options.sentPolicy,
    });
    if (decision.kind === 'drop') remove(kind, storageKey);
    if (decision.kind === 'restore') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from storage on mount
      setValueState(decision.value);
      setRestored(true);
      setSentAs(decision.sentAs ?? null);
    }
    if (decision.kind === 'offer') setOffered(decision.value);
    // Only on mount / key change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, storageKey]);

  useEffect(() => {
    if (!dirty.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      write(kind, storageKey, serializeDraft(value, { version: version.current }));
    }, 400);
    return () => window.clearTimeout(timer.current);
  }, [kind, storageKey, value]);

  const setValue: Dispatch<SetStateAction<T>> = useCallback((next) => {
    dirty.current = true;
    setValueState(next);
  }, []);

  const update = useCallback(<K extends keyof T>(field: K, v: T[K]) => {
    dirty.current = true;
    setValueState((prev) => ({ ...prev, [field]: v }));
  }, []);

  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    dirty.current = false;
    remove(kind, storageKey);
    setRestored(false);
    setSentAs(null);
    setOffered(null);
  }, [kind, storageKey]);

  const discard = useCallback(() => {
    clear();
    setValueState(initial);
  }, [clear, initial]);

  /** Takes the offered draft over the server content (it is then saved as the current draft). */
  const recover = useCallback(() => {
    if (!offered) return;
    dirty.current = true;
    setValueState(offered);
    setOffered(null);
    setRestored(true);
  }, [offered]);

  /**
   * Keeps `sent` stored, tagged with the request it became, instead of clearing it: if that
   * request fails, the text comes back (see `sentPolicy`); once it succeeds, `forgetSentDrafts`.
   */
  const markSent = useCallback(
    (requestId: string, sent: T) => {
      window.clearTimeout(timer.current);
      dirty.current = false;
      write(kind, storageKey, serializeDraft(sent, { sentAs: requestId }));
    },
    [kind, storageKey],
  );

  return {
    value,
    setValue,
    update,
    restored,
    /** The request the restored draft had been sent as (it did not succeed), if any. */
    sentAs,
    offered: offered !== null,
    recover,
    clear,
    discard,
    markSent,
  };
}
