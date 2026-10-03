import { describe, expect, it } from 'vitest';
import { emptyReportDraft, reportDraftKey } from '@lynx/domain';
import {
  clearAllDrafts,
  decideDraft,
  DRAFT_PREFIX,
  draftsClosed,
  draftStorage,
  forgetNewsletterDrafts,
  forgetReportDrafts,
  forgetSentDrafts,
  newsletterDraftKey,
  readReportDraft,
  reportDraftState,
  removeDrafts,
  serializeDraft,
  storeDraft,
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

describe('handing a draft to another form', () => {
  it('keeps what was typed during a new resource’s first save as its edit page’s draft', () => {
    const storage = memoryStorage();
    const typed = { itemId: 'i1', form: { title: 'Le huard (suite)' } };
    storeDraft('library-item:u1:i1', typed, { version: '1' }, storage);
    const raw = storage.getItem(`${DRAFT_PREFIX}library-item:u1:i1`);
    // The edit page opens revision 1: the draft is brought back as is.
    const saved = { itemId: 'i1', form: { title: 'Le huard' } };
    expect(decideDraft(raw, saved, { version: '1' })).toEqual({ kind: 'restore', value: typed });
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

describe('report card comments on the device (« Bulletins », D-130)', () => {
  const me = 'd0000000-0000-4000-8000-000000000001';
  const other = 'd0000000-0000-4000-8000-000000000002';
  const cls = 'e0000000-0000-4000-8000-000000000003';
  const student = '10000000-0000-4000-8000-000000000001';
  const draft = (expiresOn: string) =>
    serializeDraft({
      ...emptyReportDraft(expiresOn),
      students: {
        [student]: {
          gradeCode: null,
          form: 'neutral',
          notes: '',
          comments: {
            mat: {
              level: 3,
              progress: null,
              ratings: {},
              picks: [],
              text: '{prénom} lit.',
              edited: true,
            },
          },
        },
      },
    });

  it('reads a stored draft until the day it expires', () => {
    expect(readReportDraft(draft('2027-04-13'), '2027-04-13')?.expiresOn).toBe('2027-04-13');
    expect(readReportDraft(draft('2027-04-13'), '2027-04-14')).toBeNull();
    expect(readReportDraft('{pas du JSON', '2027-01-01')).toBeNull();
    expect(readReportDraft(serializeDraft({ v: 2 }), '2027-01-01')).toBeNull();
    expect(readReportDraft(null, '2027-01-01')).toBeNull();
  });

  it('tells an expired draft from one it cannot read (which is never deleted for that)', () => {
    expect(reportDraftState(draft('2027-04-13'), '2027-04-13').kind).toBe('ok');
    expect(reportDraftState(draft('2027-04-13'), '2027-04-14').kind).toBe('expired');
    expect(reportDraftState('{pas du JSON', '2027-01-01').kind).toBe('unreadable');
    expect(
      reportDraftState(serializeDraft({ v: 2, expiresOn: '2027-04-13' }), '2027-01-01'),
    ).toEqual({ kind: 'unreadable' });
    // Its expiry date read on its own, when the rest cannot be read.
    expect(
      reportDraftState(serializeDraft({ v: 2, expiresOn: '2027-04-13' }), '2027-04-14').kind,
    ).toBe('expired');
    expect(reportDraftState(null, '2027-01-01').kind).toBe('none');
  });

  it('removes another account’s report drafts and expired ones, and nothing else', () => {
    const key = (user: string, period: string) => DRAFT_PREFIX + reportDraftKey(user, cls, period);
    const storage = memoryStorage({
      [key(me, 'term1')]: draft('2027-04-13'),
      [key(me, 'progress')]: draft('2027-01-05'),
      [key(me, 'term2')]: '{pas du JSON',
      [key(other, 'term1')]: draft('2027-04-13'),
      [`${DRAFT_PREFIX}report:broken`]: draft('2027-04-13'),
      [`${DRAFT_PREFIX}lesson:${other}:u1:new`]: serializeDraft({ title: 'Le castor' }),
      [`${DRAFT_PREFIX}report-bank-generate:${other}`]: serializeDraft({ note: 'x' }),
      unrelated: 'kept',
    });
    expect(forgetReportDrafts({ userId: me, today: '2027-02-01', storage })).toBe(3);
    const left = Array.from({ length: storage.length }, (_, i) => storage.key(i)).sort();
    expect(left).toEqual(
      [
        key(me, 'term1'),
        // Hers but unreadable: left alone (a sign-out removes it).
        key(me, 'term2'),
        `${DRAFT_PREFIX}lesson:${other}:u1:new`,
        `${DRAFT_PREFIX}report-bank-generate:${other}`,
        'unrelated',
      ].sort(),
    );
    // The day after the expiry, hers go too.
    expect(forgetReportDrafts({ userId: me, today: '2027-04-14', storage })).toBe(1);
    expect(forgetReportDrafts({ userId: me, today: '2027-04-14', storage: null })).toBe(0);
  });

  it('removes another account’s « Info-parents » drafts, and nothing else (D-138)', () => {
    const storage = memoryStorage({
      [DRAFT_PREFIX + newsletterDraftKey(me, 'n1')]: serializeDraft({ v: 1 }),
      [DRAFT_PREFIX + newsletterDraftKey(other, 'n1')]: serializeDraft({ v: 1 }),
      [DRAFT_PREFIX + newsletterDraftKey(other, 'n2')]: serializeDraft({ v: 1 }),
      [`${DRAFT_PREFIX}lesson:${other}:u1:new`]: serializeDraft({ title: 'Le castor' }),
      unrelated: 'kept',
    });
    expect(forgetNewsletterDrafts({ userId: me, storage })).toBe(2);
    const left = Array.from({ length: storage.length }, (_, i) => storage.key(i)).sort();
    expect(left).toEqual(
      [
        DRAFT_PREFIX + newsletterDraftKey(me, 'n1'),
        `${DRAFT_PREFIX}lesson:${other}:u1:new`,
        'unrelated',
      ].sort(),
    );
    expect(forgetNewsletterDrafts({ userId: me, storage: null })).toBe(0);
  });

  it('refuses any write once every draft was cleared for a sign-out', () => {
    const storage = memoryStorage({ [`${DRAFT_PREFIX}report:a:b:term1`]: draft('2027-04-13') });
    clearAllDrafts(storage);
    expect(storage.length).toBe(0);
    expect(draftsClosed()).toBe(true);
  });
});
