'use client';

import {
  COMMENT_LIMIT_DEFAULT,
  draftExpired,
  dropStalePicks,
  emptyReportDraft,
  studentsWithWork,
  type LocalDate,
  type ReportDraft,
} from '@lynx/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DRAFT_PREFIX,
  draftStorage,
  draftsClosed,
  readReportDraft,
  reportDraftState,
  serializeDraft,
} from './draft-storage';

/** How long after the last change the draft is written (and at once when the page is left). */
const WRITE_DELAY_MS = 250;

export interface ReportDraftState {
  draft: ReportDraft;
  /** The stored draft has been read (before that, the page shows the empty draft). */
  loaded: boolean;
  /** Changes the draft; it is written to the device a moment later. */
  update: (change: (draft: ReportDraft) => ReportDraft) => void;
  /** « Effacer mes commentaires de cette période sur cet appareil ». */
  clear: () => void;
  /** The last write failed (the device's storage is full or blocked): the page says so. */
  writeFailed: boolean;
  /** Another tab changed (or erased) this draft: the newest version is shown. */
  changedElsewhere: 'changed' | 'erased' | null;
  /** The period's comments are past their 60 days: nothing is kept on the device any more. */
  expired: boolean;
}

/**
 * The « Bulletins » draft of a class and period on this device (DECISIONS D-130): read and
 * checked against `reportDraftSchema` (an expired one is removed; an unreadable student or comment
 * is left out, and a draft that cannot be read at all is left as it is), written a moment
 * after each change and when the page is hidden, never sent anywhere. Unlike `useDraft`, a write
 * that fails is reported, so a teacher never loses comments without knowing; another tab's
 * changes are taken up (« Modifié dans un autre onglet »); nothing is written once the period's
 * comments have expired or after a sign-out in this page. `key` is the draft's key without
 * `lynx-draft:` (`reportDraftKey`).
 */
export function useReportDraft({
  draftKey,
  expiresOn,
  today,
  bank,
}: {
  draftKey: string;
  expiresOn: LocalDate;
  today: LocalDate;
  /** The bank shown: picks of an older revision of it are dropped. */
  bank: { itemId: string; revision: number } | null;
}): ReportDraftState {
  const storageKey = DRAFT_PREFIX + draftKey;
  const expired = draftExpired(expiresOn, today);
  const [draft, setDraft] = useState<ReportDraft>(() => emptyReportDraft(expiresOn));
  const [loaded, setLoaded] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const [changedElsewhere, setChangedElsewhere] = useState<'changed' | 'erased' | null>(null);
  const latest = useRef(draft);
  // What the page gives each render, read by the listeners without subscribing them again.
  const context = useRef({ bank, expiresOn, today });
  useEffect(() => {
    context.current = { bank, expiresOn, today };
  });
  const pending = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  // Erased in another tab (a sign-out, « Effacer »): this page writes nothing more.
  const stopped = useRef(false);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (!pending.current) return;
    pending.current = false;
    if (expired || stopped.current || draftsClosed()) return;
    const storage = draftStorage();
    try {
      if (!storage) throw new Error('storage unavailable');
      const value = latest.current;
      // Nothing left to keep: no key at all rather than an empty draft.
      const empty =
        studentsWithWork(value).length === 0 &&
        value.limit === COMMENT_LIMIT_DEFAULT &&
        value.plainSpaces;
      if (empty) storage.removeItem(storageKey);
      else storage.setItem(storageKey, serializeDraft(value));
      setWriteFailed(false);
    } catch {
      setWriteFailed(true);
    }
  }, [expired, storageKey]);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = draftStorage()?.getItem(storageKey) ?? null;
    } catch {
      raw = null;
    }
    const state = reportDraftState(raw, today);
    // Past its 60 days: gone. One that cannot be read at all stays as it is (never deleted for
    // that: D-130 as amended); an unreadable student or comment inside one is simply left out.
    if (state.kind === 'expired') {
      try {
        draftStorage()?.removeItem(storageKey);
      } catch {
        // Storage blocked: nothing to remove.
      }
    }
    const stored = state.kind === 'ok' ? state.draft : null;
    let next = stored ? { ...stored, expiresOn } : emptyReportDraft(expiresOn);
    if (bank) next = dropStalePicks(next, bank);
    latest.current = next;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the device's draft on mount
    setDraft(next);
    setLoaded(true);
    stopped.current = false;
    setChangedElsewhere(null);
    // Read once per key (the bank's revision is the page's own: a new one reloads it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== storageKey) return;
      const { bank, expiresOn, today } = context.current;
      if (event.key === null || event.newValue === null) {
        stopped.current = true;
        pending.current = false;
        const empty = emptyReportDraft(expiresOn);
        latest.current = empty;
        setDraft(empty);
        setChangedElsewhere('erased');
        return;
      }
      const stored = readReportDraft(event.newValue, today);
      if (!stored) return;
      const next = bank ? dropStalePicks(stored, bank) : stored;
      latest.current = next;
      pending.current = false;
      setDraft(next);
      setChangedElsewhere('changed');
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush, storageKey]);

  const update = useCallback(
    (change: (draft: ReportDraft) => ReportDraft) => {
      const next = change(latest.current);
      if (next === latest.current) return;
      latest.current = next;
      setDraft(next);
      pending.current = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, WRITE_DELAY_MS);
    },
    [flush],
  );

  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    pending.current = false;
    try {
      draftStorage()?.removeItem(storageKey);
    } catch {
      // Storage blocked: nothing stored either.
    }
    const empty = { ...emptyReportDraft(expiresOn), limit: latest.current.limit };
    latest.current = { ...empty, plainSpaces: latest.current.plainSpaces };
    setDraft(latest.current);
  }, [expiresOn, storageKey]);

  return { draft, loaded, update, clear, writeFailed, changedElsewhere, expired };
}
