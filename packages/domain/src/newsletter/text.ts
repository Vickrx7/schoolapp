/**
 * « Copier » (DECISIONS D-136): the message as plain text, to paste into the board's own channel
 * (e-mail, portal, agenda). In French, in English, or both (French first). The header (school,
 * class, week) and the signature frame each language; removed and empty sections are left out;
 * `message` and `closing` have no heading (a letter starts with its greeting). A paragraph without
 * an up-to-date English version appears in French in the English text (the editor warns first).
 */
import {
  HEADINGLESS_SECTIONS,
  needsEnglish,
  type NewsletterContent,
  type NewsletterItem,
  type NewsletterSectionKey,
} from './content';

export type NewsletterLanguage = 'fr' | 'en';
export type NewsletterTextLanguage = NewsletterLanguage | 'both';

/** Sections written as lists (one line per paragraph, a bullet before each), copied or printed. */
export const NEWSLETTER_LIST_SECTIONS: ReadonlySet<NewsletterSectionKey> = new Set([
  'thisWeek',
  'nextWeek',
  'dates',
  'reminders',
  'atHome',
]);

/**
 * A paragraph as one language's families read it (copied or printed, D-136, D-141): its French,
 * or its English when it is up to date; a French paragraph without an up-to-date English version
 * appears in French in the English text (`inFrench`). Trimmed; empty when there is nothing to show.
 */
export function newsletterParagraph(
  item: NewsletterItem,
  lang: NewsletterLanguage,
): { text: string; inFrench: boolean } {
  if (lang === 'en' && !needsEnglish(item)) return { text: item.en.trim(), inFrench: false };
  return { text: item.fr.trim(), inFrench: lang === 'en' };
}

export interface NewsletterTextOptions {
  lang: NewsletterTextLanguage;
  /** « École … · 3e année · Semaine du 5 octobre 2026 », per language. */
  header: Record<NewsletterLanguage, string>;
  headings: Record<NewsletterLanguage, Record<NewsletterSectionKey, string>>;
}

/** One language's text: header, sections, signature. */
function textIn(
  content: NewsletterContent,
  lang: NewsletterLanguage,
  options: NewsletterTextOptions,
) {
  const blocks: string[] = [options.header[lang]];
  for (const section of content.sections) {
    if (section.off) continue;
    const paragraphs = section.items
      .map((item) => newsletterParagraph(item, lang).text)
      .filter((text) => text !== '');
    if (paragraphs.length === 0) continue;
    const heading = HEADINGLESS_SECTIONS.has(section.key)
      ? null
      : options.headings[lang][section.key];
    if (NEWSLETTER_LIST_SECTIONS.has(section.key)) {
      const list = paragraphs.map((p) => `• ${p.replace(/\s*\n\s*/g, ' ')}`).join('\n');
      blocks.push(heading ? `${heading}\n${list}` : list);
    } else {
      if (heading) blocks.push(heading);
      blocks.push(...paragraphs);
    }
  }
  if (content.signature.trim()) blocks.push(content.signature.trim());
  return blocks.join('\n\n');
}

/** The text to copy. */
export function newsletterPlainText(
  content: NewsletterContent,
  options: NewsletterTextOptions,
): string {
  if (options.lang !== 'both') return textIn(content, options.lang, options);
  return `${textIn(content, 'fr', options)}\n\n* * *\n\n${textIn(content, 'en', options)}`;
}
