import { describe, expect, it } from 'vitest';
import {
  clearAllDrafts,
  decideDraft,
  DRAFT_PREFIX,
  draftStorage,
  forgetSentDrafts,
  removeDrafts,
  serializeDraft,
} from './draft-storage';

/** A localStorage stand-in. */
function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

const initial = { title: '', text: '' };

describe('restoring drafts', () => {
  it('restores what the teacher typed', () => {
    const raw = serializeDraft({ title: 'Le castor', text: 'Il construit un barrage.' });
    expect(decideDraft(raw, initial)).toEqual({
      kind: 'restore',
      value: { title: 'Le castor', text: 'Il construit un barrage.' },
    });
  });

  it('drops a copy identical to the form instead of announcing a restored draft', () => {
    expect(decideDraft(serializeDraft({ ...initial }), initial)).toEqual({ kind: 'drop' });
    expect(decideDraft('{not json', initial)).toEqual({ kind: 'drop' });
    expect(decideDraft(null, initial)).toEqual({ kind: 'none' });
  });

  it('never restores edits made on an older version over newer saved content', () => {
    const server = { title: 'Saved on the laptop', text: 'S1' };
    const phone = serializeDraft({ title: 'Edited on the phone', text: 'S0' }, { version: 'v0' });
    expect(decideDraft(phone, server, { version: 'v1' })).toEqual({
      kind: 'offer',
      value: { title: 'Edited on the phone', text: 'S0' },
    });
    // Edits made on the current version come back as usual.
    const current = serializeDraft({ title: 'Edited', text: 'S1' }, { version: 'v1' });
    expect(decideDraft(current, server, { version: 'v1' }).kind).toBe('restore');
  });

  it('keeps a sent draft until its request succeeds, and brings it back if it failed', () => {
    const raw = serializeDraft({ title: 'Le castor', text: 'Texte' }, { sentAs: 'job-1' });
    const status = (s: string) => () =>
      s === 'failed' ? 'restore' : s === 'succeeded' ? 'drop' : 'keep';
    expect(decideDraft(raw, initial, { sentPolicy: status('failed') })).toEqual({
      kind: 'restore',
      value: { title: 'Le castor', text: 'Texte' },
      sentAs: 'job-1',
    });
    expect(decideDraft(raw, initial, { sentPolicy: status('running') })).toEqual({ kind: 'keep' });
    expect(decideDraft(raw, initial, { sentPolicy: status('succeeded') })).toEqual({
      kind: 'drop',
    });
  });
});

describe('removing drafts', () => {
  it('forgets only the drafts sent as the request that succeeded', () => {
    const storage = memoryStorage({
      [`${DRAFT_PREFIX}differentiate:new:u1`]: serializeDraft({ text: 'a' }, { sentAs: 'job-1' }),
      [`${DRAFT_PREFIX}differentiate:new:u1:job-0`]: serializeDraft(
        { text: 'b' },
        { sentAs: 'job-1' },
      ),
      [`${DRAFT_PREFIX}differentiate:new:u1:job-9`]: serializeDraft(
        { text: 'c' },
        { sentAs: 'job-2' },
      ),
      [`${DRAFT_PREFIX}differentiate:new:u2`]: serializeDraft({ text: 'd' }, { sentAs: 'job-1' }),
    });
    forgetSentDrafts('differentiate:new:u1', 'job-1', storage);
    expect(storage.getItem(`${DRAFT_PREFIX}differentiate:new:u1`)).toBeNull();
    expect(storage.getItem(`${DRAFT_PREFIX}differentiate:new:u1:job-0`)).toBeNull();
    expect(storage.getItem(`${DRAFT_PREFIX}differentiate:new:u1:job-9`)).not.toBeNull();
    expect(storage.getItem(`${DRAFT_PREFIX}differentiate:new:u2`)).not.toBeNull();
  });

  it('clears every draft (sign-out) but nothing else', () => {
    const storage = memoryStorage({
      [`${DRAFT_PREFIX}differentiate:new:u1`]: serializeDraft({ text: 'Zoé' }),
      [`${DRAFT_PREFIX}lesson:unit:new`]: serializeDraft({ title: 'L1' }),
      locale: 'fr-CA',
    });
    clearAllDrafts(storage);
    expect(storage.length).toBe(1);
    expect(storage.getItem('locale')).toBe('fr-CA');
  });

  it('removes drafts by key', () => {
    const storage = memoryStorage({
      [`${DRAFT_PREFIX}differentiate:new`]: serializeDraft({ text: 'old' }),
      [`${DRAFT_PREFIX}differentiate:new:u1`]: serializeDraft({ text: 'mine' }),
    });
    removeDrafts((key) => key === 'differentiate:new', storage);
    expect(storage.getItem(`${DRAFT_PREFIX}differentiate:new`)).toBeNull();
    expect(storage.getItem(`${DRAFT_PREFIX}differentiate:new:u1`)).not.toBeNull();
  });
});

describe('where drafts are kept', () => {
  it('keeps drafts on the device, or for the tab only (the substitute’s report)', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    const g = globalThis as { window?: unknown };
    g.window = { localStorage: local, sessionStorage: session };
    try {
      expect(draftStorage()).toBe(local);
      expect(draftStorage('local')).toBe(local);
      expect(draftStorage('session')).toBe(session);
      // Clearing a tab's drafts leaves the device's alone, and the other way round.
      local.setItem(`${DRAFT_PREFIX}lesson:1`, serializeDraft({ title: 'x' }));
      session.setItem(`${DRAFT_PREFIX}sub-report:p1`, serializeDraft({ behaviour: 'x' }));
      removeDrafts((key) => key.startsWith('sub-report:'), draftStorage('session'));
      expect(session.length).toBe(0);
      expect(local.length).toBe(1);
    } finally {
      delete g.window;
    }
    expect(draftStorage('session')).toBeNull();
  });
});
