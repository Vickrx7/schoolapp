/**
 * How drafts are kept in localStorage and when a stored one is brought back (D-035). Plain
 * functions, no React, so the rules can be unit-tested.
 */

export const DRAFT_PREFIX = 'lynx-draft:';

export interface StoredDraft<T> {
  value: T;
  savedAt: number;
  /** The server version (e.g. updated_at) of what the teacher was editing, when there is one. */
  version?: string;
  /** Set when the draft was sent as a request (an AI job id): kept until that request succeeds. */
  sentAs?: string;
}

/** What to do with a draft that was sent as a request: show it, keep it hidden, or delete it. */
export type SentDraftPolicy = (sentAs: string) => 'restore' | 'keep' | 'drop';

export type DraftDecision<T> =
  /** Nothing stored. */
  | { kind: 'none' }
  /** Stale, unreadable or identical to the form: delete it. */
  | { kind: 'drop' }
  /** Leave it stored without showing it. */
  | { kind: 'keep' }
  | { kind: 'restore'; value: T; sentAs?: string }
  /** Edited from an older server version: offer it instead of replacing newer content. */
  | { kind: 'offer'; value: T };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Decides whether a stored draft (raw localStorage text) replaces the form's initial value. */
export function decideDraft<T extends object>(
  raw: string | null,
  initial: T,
  options: { version?: string; sentPolicy?: SentDraftPolicy } = {},
): DraftDecision<T> {
  if (raw === null) return { kind: 'none' };
  let stored: Partial<StoredDraft<T>> | null;
  try {
    stored = JSON.parse(raw) as Partial<StoredDraft<T>> | null;
  } catch {
    return { kind: 'drop' };
  }
  if (!stored || typeof stored.value !== 'object' || stored.value === null) return { kind: 'drop' };
  if (stored.sentAs) {
    const policy = options.sentPolicy?.(stored.sentAs) ?? 'restore';
    if (policy !== 'restore') return { kind: policy };
  }
  const value = { ...initial, ...stored.value };
  if (same(value, initial)) return { kind: 'drop' };
  if (options.version !== undefined && stored.version !== options.version) {
    return { kind: 'offer', value };
  }
  return stored.sentAs
    ? { kind: 'restore', value, sentAs: stored.sentAs }
    : { kind: 'restore', value };
}

export function serializeDraft<T>(
  value: T,
  meta: { version?: string; sentAs?: string } = {},
  now = Date.now(),
): string {
  const draft: StoredDraft<T> = { value, savedAt: now, ...meta };
  return JSON.stringify(draft);
}

/** localStorage, or null where it is unavailable (server, private mode, blocked). */
export function draftStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Removes every draft whose key (without the prefix) matches. */
export function removeDrafts(match: (key: string) => boolean, storage = draftStorage()): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(DRAFT_PREFIX) && match(key.slice(DRAFT_PREFIX.length))) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

/**
 * Removes every draft on this device. For sign-out: drafts can hold students' names and must
 * not stay behind on a shared computer.
 */
export function clearAllDrafts(storage = draftStorage()): void {
  removeDrafts(() => true, storage);
}

/**
 * Removes the drafts under `keyPrefix` that were sent as this request (once it has succeeded).
 */
export function forgetSentDrafts(
  keyPrefix: string,
  sentAs: string,
  storage = draftStorage(),
): void {
  if (!storage) return;
  removeDrafts((key) => {
    if (key !== keyPrefix && !key.startsWith(`${keyPrefix}:`)) return false;
    try {
      const raw = storage.getItem(DRAFT_PREFIX + key);
      return raw !== null && (JSON.parse(raw) as Partial<StoredDraft<unknown>>).sentAs === sentAs;
    } catch {
      return false;
    }
  }, storage);
}
