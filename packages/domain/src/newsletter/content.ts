/**
 * « Info-parents » (DECISIONS D-136, D-137): the class's weekly message to families, as stored in
 * `class_newsletters.content`. Fixed sections, each a list of paragraphs written in French and in
 * English. Each paragraph says where it came from (prepared by the app from the class's data, or
 * typed), and how its English was written (`enBy`: by the app, the teacher or the AI) from which
 * French (`enFrom`), so an English paragraph whose French changed since is « à mettre à jour ».
 * The header (school, class, week) is rendered, never stored; the signature is kept apart from
 * the paragraphs. The database checks the kind and size only (D-048).
 */
import { normalizeFrenchTypography, notCanadianWords } from '@lynx/content';
import { z } from 'zod';

/** The sections, in the order the message shows them (`closing` has no heading). */
export const NEWSLETTER_SECTIONS = [
  'message',
  'thisWeek',
  'nextWeek',
  'dates',
  'reminders',
  'atHome',
  'faith',
  'closing',
] as const;
export type NewsletterSectionKey = (typeof NEWSLETTER_SECTIONS)[number];

/** Sections whose heading is never written in the message itself (a letter starts and ends so). */
export const HEADINGLESS_SECTIONS: ReadonlySet<NewsletterSectionKey> = new Set([
  'message',
  'closing',
]);

/** Where a paragraph came from: one of the app's lines, or typed by the teacher. */
export const NEWSLETTER_SOURCES = [
  'greeting',
  'lesson',
  'unitStart',
  'event',
  'dayOff',
  'report',
  'season',
  'guide',
  'faith',
  'closing',
  'typed',
] as const;
export type NewsletterSource = (typeof NEWSLETTER_SOURCES)[number];

/** Who wrote a paragraph's English. */
export const ENGLISH_AUTHORS = ['app', 'teacher', 'ai'] as const;
export type EnglishAuthor = (typeof ENGLISH_AUTHORS)[number];

export const NEWSLETTER_LIMITS = {
  signature: 120,
  fr: 1000,
  en: 1500,
  itemsPerSection: 12,
  items: 60,
  /** The stored content's size, under the database's 64 KB (UTF-8 JSON). */
  bytes: 60_000,
} as const;

const ITEM_ID = /^[a-z0-9]{8}$/;

const itemSchema = z.object({
  id: z.string().regex(ITEM_ID),
  fr: z.string().max(NEWSLETTER_LIMITS.fr, 'tooLong'),
  en: z.string().max(NEWSLETTER_LIMITS.en, 'tooLong'),
  /** The French the English was written from (null when there is no English). */
  enFrom: z.string().max(NEWSLETTER_LIMITS.fr).nullable(),
  enBy: z.enum(ENGLISH_AUTHORS).nullable(),
  from: z.object({
    kind: z.enum(NEWSLETTER_SOURCES),
    /** The id of the lesson's unit, the event, the guide, the reference… (never shown, never sent). */
    ref: z.string().min(1).max(64).optional(),
  }),
});
export type NewsletterItem = z.infer<typeof itemSchema>;

const sectionSchema = z.object({
  key: z.enum(NEWSLETTER_SECTIONS),
  /** « Retirer la section »: kept, not shown in what is copied. */
  off: z.boolean(),
  items: z.array(itemSchema).max(NEWSLETTER_LIMITS.itemsPerSection, 'tooMany'),
});
export type NewsletterSection = z.infer<typeof sectionSchema>;

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/** The stored content (version 1): every section once, in order (D-137). */
export const newsletterContentSchema = z
  .object({
    v: z.literal(1),
    signature: z.string().max(NEWSLETTER_LIMITS.signature, 'tooLong'),
    sections: z.array(sectionSchema).length(NEWSLETTER_SECTIONS.length),
  })
  .superRefine((content, ctx) => {
    content.sections.forEach((section, i) => {
      if (section.key !== NEWSLETTER_SECTIONS[i]) {
        ctx.addIssue({ code: 'custom', path: ['sections', i, 'key'], message: 'invalid' });
      }
    });
    const ids = new Set<string>();
    let count = 0;
    for (const [s, section] of content.sections.entries()) {
      for (const [i, item] of section.items.entries()) {
        count += 1;
        if (ids.has(item.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['sections', s, 'items', i, 'id'],
            message: 'invalid',
          });
        }
        ids.add(item.id);
      }
    }
    if (count > NEWSLETTER_LIMITS.items) {
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'tooMany' });
    }
    if (utf8Length(JSON.stringify(content)) > NEWSLETTER_LIMITS.bytes) {
      ctx.addIssue({ code: 'custom', path: ['form'], message: 'tooLong' });
    }
  });
export type NewsletterContent = z.infer<typeof newsletterContentSchema>;

/** A new paragraph id: eight lowercase letters or digits, unique within a message. */
export function newsletterItemId(random: () => number = secureRandom): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += alphabet[Math.floor(random() * alphabet.length)];
  return id;
}

function secureRandom(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0]! / 2 ** 32;
}

/** An empty message: every section, nothing in it. */
export function emptyNewsletterContent(signature = ''): NewsletterContent {
  return {
    v: 1,
    signature,
    sections: NEWSLETTER_SECTIONS.map((key) => ({ key, off: false, items: [] })),
  };
}

/** A paragraph the teacher adds (« Ajouter un paragraphe »). */
export function typedItem(id: string, fr = '', en = ''): NewsletterItem {
  return withTeacherEnglish(
    { id, fr, en: '', enFrom: null, enBy: null, from: { kind: 'typed' } },
    en,
  );
}

// ---------------------------------------------------------------------------------------
// The English of a paragraph
// ---------------------------------------------------------------------------------------

/**
 * Where a paragraph's English stands (shown in words, never by colour alone):
 * - `none`: an empty paragraph;
 * - `missing`: « English : à écrire »;
 * - `stale`: « English : à mettre à jour (le français a changé) »;
 * - `app`, `teacher`, `ai`: who wrote it, for the French as it is now.
 */
export type EnglishState = 'none' | 'missing' | 'stale' | EnglishAuthor;

/** Two French texts that differ only by spaces or apostrophes are the same text. */
export function sameFrench(a: string, b: string): boolean {
  const key = (s: string) =>
    s
      .replace(/[\s\u00a0\u202f]+/g, ' ')
      .replace(/[’`´]/g, "'")
      .trim();
  return key(a) === key(b);
}

export function englishState(
  item: Pick<NewsletterItem, 'fr' | 'en' | 'enFrom' | 'enBy'>,
): EnglishState {
  const fr = item.fr.trim();
  const en = item.en.trim();
  if (!fr && !en) return 'none';
  if (!en) return 'missing';
  if (item.enFrom !== null && !sameFrench(item.enFrom, item.fr)) return 'stale';
  return item.enBy ?? 'teacher';
}

/** A French paragraph without an up-to-date English version. */
export function needsEnglish(item: Pick<NewsletterItem, 'fr' | 'en' | 'enFrom' | 'enBy'>): boolean {
  const state = englishState(item);
  return item.fr.trim() !== '' && (state === 'missing' || state === 'stale');
}

/** The teacher wrote (or cleared) a paragraph's English: hers, for the French as it is now. */
export function withTeacherEnglish(item: NewsletterItem, en: string): NewsletterItem {
  const written = en.trim() !== '';
  return { ...item, en, enFrom: written ? item.fr : null, enBy: written ? 'teacher' : null };
}

/** The paragraphs shown (sections not removed) that need their English. */
export function itemsNeedingEnglish(content: NewsletterContent): NewsletterItem[] {
  return content.sections.filter((s) => !s.off).flatMap((s) => s.items.filter(needsEnglish));
}

// ---------------------------------------------------------------------------------------
// « Préremplir à nouveau » and « Corriger la typographie »
// ---------------------------------------------------------------------------------------

/**
 * « Préremplir à nouveau » (D-137): the app's paragraphs are replaced by `fresh`'s; the teacher's
 * typed paragraphs, the signature and the sections she removed stay. A typed paragraph keeps its
 * place among the app's: after as many of them as came before it.
 */
export function mergeRefill(
  current: NewsletterContent,
  fresh: NewsletterContent,
): NewsletterContent {
  return {
    v: 1,
    signature: current.signature,
    sections: NEWSLETTER_SECTIONS.map((key) => {
      const before = current.sections.find((s) => s.key === key);
      const next = fresh.sections.find((s) => s.key === key);
      const appItems = [...(next?.items ?? [])].filter((i) => i.from.kind !== 'typed');
      if (!before) return { key, off: next?.off ?? false, items: appItems };
      const items: NewsletterItem[] = [];
      let appSeen = 0;
      let used = 0;
      for (const item of before.items) {
        if (item.from.kind !== 'typed') {
          appSeen += 1;
          continue;
        }
        while (used < Math.min(appSeen, appItems.length)) items.push(appItems[used++]!);
        items.push(item);
      }
      while (used < appItems.length) items.push(appItems[used++]!);
      return { key, off: before.off, items: items.slice(0, NEWSLETTER_LIMITS.itemsPerSection) };
    }),
  };
}

/**
 * The app's French typography (as its own messages): typographic apostrophes, « 3e », no-break
 * spaces inside « » and before the colon, a narrow one before the semicolon, none before ? and !.
 * Idempotent.
 */
export function frenchTypography(text: string): string {
  return normalizeFrenchTypography(text)
    .replace(/(?<=\S)[ \t\u00a0\u202f]?;/g, '\u202f;')
    .replace(/[ \t\u00a0\u202f]+([?!])/g, '$1');
}

/** English typography as the app's own messages: typographic apostrophes between letters. */
export function englishTypography(text: string): string {
  return text.replace(/(?<=\p{L})['`´](?=\p{L})/gu, '’');
}

/**
 * « Corriger la typographie » (D-140): the French of every paragraph, words unchanged. An English
 * version written for the French before the fix stays up to date.
 */
export function fixTypography(content: NewsletterContent): NewsletterContent {
  return {
    ...content,
    sections: content.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        const fr = frenchTypography(item.fr);
        if (fr === item.fr) return item;
        const enFrom = item.enFrom !== null && sameFrench(item.enFrom, item.fr) ? fr : item.enFrom;
        return { ...item, fr, enFrom };
      }),
    })),
  };
}

/** Words a Canadian reader would stumble on (« week-end »), with the paragraph they are in. */
export function newsletterWordNotes(
  content: NewsletterContent,
): { itemId: string; word: string }[] {
  return content.sections.flatMap((section) =>
    section.items.flatMap((item) =>
      [...new Set(notCanadianWords(item.fr))].map((word) => ({ itemId: item.id, word })),
    ),
  );
}
