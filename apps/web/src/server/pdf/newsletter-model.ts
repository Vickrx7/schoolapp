/**
 * What an « Info-parents » PDF prints (DECISIONS D-141): the week's message as the families read
 * it, one language per page (French, English, or the French then the English), each with the
 * school, « Info-parents » / "Family newsletter", the class and the week at the top, the sections
 * the editor shows (removed and empty ones left out; lists bulleted, the « Moment de foi » set
 * apart) and the teacher's signature at the end. What « Copier » copies, laid out for paper:
 * - the saved message only, never a device draft (the editor asks for a save first);
 * - on the English page, a paragraph without an up-to-date English version is printed in French,
 *   marked « (in French) », as the copied text keeps it in French;
 * - the English page says when some of its paragraphs were translated automatically (`enBy: 'ai'`,
 *   slice S3).
 * The header and the family-facing words come from the families' catalogue of each language
 * (`newsletterText`), whatever the interface's language (D-033 as amended by D-136). Paragraphs are
 * printed as typed: only the spaces that a line must not break at become no-break spaces (inside
 * « », before French punctuation, in « 13 h 35 », « 1 000 », « 5 octobre », "1:35 p.m."). Nothing
 * about a student beyond what the teacher typed, no status, no names check, no event notes.
 *
 * Pure and not server-only, so it can be unit tested with the real message files.
 */
import {
  englishState,
  HEADINGLESS_SECTIONS,
  NEWSLETTER_LIST_SECTIONS,
  newsletterParagraph,
  type LocalDate,
  type NewsletterContent,
  type NewsletterLanguage,
  type NewsletterSectionKey,
  type NewsletterTextLanguage,
} from '@lynx/domain';
import { createTranslator } from 'next-intl';
import type { AppLocale } from '../../i18n/config';
import { formatLocalDate } from '../../lib/format';
import { newsletterHeadings, type MessageCatalog } from '../newsletter/phrases';
import { pdfText } from './doc-blocks';
import { pdfFileSlug } from './library-model';

/** One family language's words for the page (from that language's catalogue). */
export interface NewsletterPdfLabels {
  locale: AppLocale;
  /** « Info-parents » / "Family newsletter" */
  title: string;
  /** « Semaine du 5 octobre 2026 » */
  week: (weekOf: LocalDate) => string;
  headings: Record<NewsletterSectionKey, string>;
  /** « (en français) » / "(in French)" */
  inFrench: string;
  machineTranslated: string;
  /** The file name's first word (ASCII): « info-parents » / "family-newsletter". */
  fileName: string;
  page: (page: number, total: number) => string;
}

const NBSP = '\u00a0';

export function newsletterPdfLabels(
  locale: AppLocale,
  catalog: MessageCatalog,
): NewsletterPdfLabels {
  const t = createTranslator({ locale, messages: catalog, namespace: 'newsletterText.pdf' });
  const pages = createTranslator({ locale, messages: catalog, namespace: 'pdf' });
  return {
    locale,
    title: t('title'),
    week: (weekOf) =>
      t('week', {
        date: formatLocalDate(weekOf, locale, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }).replace(/ /g, NBSP),
      }),
    headings: newsletterHeadings(locale, catalog),
    inFrench: t('inFrench'),
    machineTranslated: t('machineTranslated'),
    fileName: t('fileName'),
    page: (page, total) => pages('page', { page, total }),
  };
}

export interface NewsletterPdfParagraph {
  text: string;
  /** On the English page: no up-to-date English version, so its French (« (in French) »). */
  inFrench: boolean;
}

export interface NewsletterPdfSection {
  key: NewsletterSectionKey;
  /** Null for the greeting's and the closing's sections (a letter starts and ends so). */
  heading: string | null;
  /** `list`: one bullet per paragraph (as copied); `faith`: set apart; `text`: paragraphs. */
  style: 'text' | 'list' | 'faith';
  paragraphs: NewsletterPdfParagraph[];
}

export interface NewsletterPdfPage {
  lang: NewsletterLanguage;
  header: { school: string; title: string; className: string; week: string };
  sections: NewsletterPdfSection[];
  signature: string | null;
  inFrenchLabel: string;
  /** "Some parts of this English version were translated automatically." */
  note: string | null;
  /** « Info-parents · 3e année · Semaine du 5 octobre 2026 », at the foot of every page. */
  footer: string;
  page: (page: number, total: number) => string;
}

export interface NewsletterPdfModel {
  info: { title: string; language: AppLocale };
  /** ASCII only: `info-parents-3e-annee-mme-tremblay-2026-10-05.pdf`. */
  fileName: string;
  pages: NewsletterPdfPage[];
}

export interface NewsletterPdfInput {
  content: NewsletterContent;
  school: string;
  className: string;
  weekOf: LocalDate;
  /** `?lang=`: both languages (French first), or one. */
  lang: NewsletterTextLanguage;
}

/** `?lang=` of the route: both when absent; null for anything else. */
export function newsletterPdfLanguage(value: string | null): NewsletterTextLanguage | null {
  if (value === null || value === 'both') return 'both';
  return value === 'fr' || value === 'en' ? value : null;
}

const FR_MONTHS =
  'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre';
const EN_MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';

/**
 * A paragraph as printed: `pdfText` (accents composed, ligatures and arrows the font lacks), and
 * a no-break space for each plain space a line must not break at. French: inside « », before
 * : ; ! ? », in a time (« 13 h 35 »), a number (« 1 000 », « 2,50 $ ») and a date (« 5 octobre »).
 * English: "October 5", "1:35 p.m.". The characters shown are the teacher's own.
 */
export function printedText(text: string, lang: NewsletterLanguage): string {
  const printed = pdfText(text);
  if (lang === 'en') {
    return printed
      .replace(new RegExp(`\\b(${EN_MONTHS}) (?=\\d)`, 'g'), `$1${NBSP}`)
      .replace(/(?<=\d) (?=[ap]\.m\.)/g, NBSP);
  }
  return printed
    .replace(/« /g, `«${NBSP}`)
    .replace(/ (?=[:;!?»])/g, NBSP)
    .replace(/(?<=\d) (?=h\b)/g, NBSP)
    .replace(/(?<=\bh) (?=\d)/g, NBSP)
    .replace(/(?<=\d) (?=\d{3}\b)/g, NBSP)
    .replace(/(?<=\d) (?=\$)/g, NBSP)
    .replace(new RegExp(`(?<=\\b(?:1er|\\d{1,2})) (?=(?:${FR_MONTHS})\\b)`, 'gi'), NBSP);
}

function page(
  input: NewsletterPdfInput,
  lang: NewsletterLanguage,
  labels: NewsletterPdfLabels,
): NewsletterPdfPage {
  const { content } = input;
  let translated = false;
  const sections: NewsletterPdfSection[] = [];
  for (const section of content.sections) {
    if (section.off) continue;
    const paragraphs: NewsletterPdfParagraph[] = [];
    for (const item of section.items) {
      const { text, inFrench } = newsletterParagraph(item, lang);
      if (!text) continue;
      if (lang === 'en' && !inFrench && englishState(item) === 'ai') translated = true;
      paragraphs.push({ text: printedText(text, inFrench ? 'fr' : lang), inFrench });
    }
    if (paragraphs.length === 0) continue;
    sections.push({
      key: section.key,
      heading: HEADINGLESS_SECTIONS.has(section.key) ? null : labels.headings[section.key],
      style: NEWSLETTER_LIST_SECTIONS.has(section.key)
        ? 'list'
        : section.key === 'faith'
          ? 'faith'
          : 'text',
      paragraphs,
    });
  }
  const week = labels.week(input.weekOf);
  const signature = content.signature.trim();
  return {
    lang,
    header: {
      school: pdfText(input.school),
      title: labels.title,
      className: pdfText(input.className),
      week,
    },
    sections,
    signature: signature ? pdfText(signature) : null,
    inFrenchLabel: labels.inFrench,
    note: translated ? labels.machineTranslated : null,
    footer: [labels.title, pdfText(input.className), week].join(' · '),
    page: labels.page,
  };
}

/** The pages of `input.lang`, French first. */
export function buildNewsletterPdfModel(
  input: NewsletterPdfInput,
  labels: Record<NewsletterLanguage, NewsletterPdfLabels>,
): NewsletterPdfModel {
  const langs: NewsletterLanguage[] = input.lang === 'both' ? ['fr', 'en'] : [input.lang];
  const pages = langs.map((lang) => page(input, lang, labels[lang]));
  const first = labels[langs[0]!];
  const slug = pdfFileSlug(`${first.fileName} ${input.className}`);
  return {
    info: { title: pages[0]!.footer.replace(/\u00a0/g, ' '), language: first.locale },
    fileName: `${slug}-${input.weekOf}${input.lang === 'fr' ? '-fr' : ''}.pdf`,
    pages,
  };
}
