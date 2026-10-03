/**
 * « Info-parents » (DECISIONS D-136, D-137): the family-facing sentences of a message, from the
 * `newsletterText` messages of one catalogue (French from fr-CA, English from en-CA, whatever the
 * interface's language, amending D-033). Dates in words (« Vendredi 9 octobre », « 1er »), times
 * as the families read them (« 13 h 35 », "1:35 p.m."), titles the staff typed quoted as typed.
 * Pure (not server-only), so it is unit tested with the real message files.
 */
import type {
  CalendarEventType,
  LocalDate,
  NewsletterPhrases,
  NewsletterSectionKey,
} from '@lynx/domain';
import { NEWSLETTER_SECTIONS } from '@lynx/domain';
import { createTranslator } from 'next-intl';
import type messages from '../../../messages/fr-CA.json';
import type { AppLocale } from '../../i18n/config';
import { formatLocalDate, formatTime } from '../../lib/format';

export type MessageCatalog = typeof messages;

const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-CA').trim();

/** « Journée pédagogique » → « journée pédagogique », but never an acronym or a proper name. */
const lowerFirst = (s: string, locale: string) =>
  /^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLocaleLowerCase(locale) + s.slice(1) : s;

const upperFirst = (s: string, locale: string) =>
  s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);

/** An app line ends as a sentence does (« … (pas d’école). »), like the tips under it. */
const ended = (s: string) => (/[.!?…]$/u.test(s.trimEnd()) ? s : `${s.trimEnd()}.`);

/** A guide's tip (« chercher des nombres… ») as a sentence. */
export function tipSentence(text: string, locale: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return upperFirst(/[.!?…»”)]$/u.test(trimmed) ? trimmed : `${trimmed}.`, locale);
}

/**
 * One language's sentences. `french` is the French catalogue, whose event types tell a title that
 * only repeats its type (« Journée pédagogique ») in both languages.
 */
export function newsletterPhrases(
  locale: AppLocale,
  catalog: MessageCatalog,
  french: MessageCatalog = catalog,
): NewsletterPhrases {
  const t = createTranslator({ locale, messages: catalog, namespace: 'newsletterText' });
  const types = createTranslator({ locale, messages: catalog, namespace: 'calendar.types' });
  const frenchTypes = createTranslator({
    locale: 'fr-CA',
    messages: french,
    namespace: 'calendar.types',
  });
  const fr = locale.startsWith('fr');
  const day = (date: LocalDate) => formatLocalDate(date, locale);
  const lineDate = (date: LocalDate) => upperFirst(day(date), locale);
  const quote = (s: string) => (fr ? `«\u00a0${s}\u00a0»` : `“${s}”`);
  // « « … », « … » et 6 autres leçons » when the line lists only the first lessons.
  const list = (items: string[], more = 0) =>
    new Intl.ListFormat(locale, { type: 'conjunction' }).format([
      ...items.map(quote),
      ...(more > 0 ? [t('moreLessons', { count: more })] : []),
    ]);
  const time = (value: string) => formatTime(value, locale);
  // An event's name: its title, unless it only repeats its type (« Journée pédagogique »). In
  // English the type comes first, then the French title quoted.
  const typeLabel = (type: CalendarEventType) => types(type);
  const sameAsType = (title: string, type: CalendarEventType) =>
    fold(title) === fold(frenchTypes(type));
  const eventName = (title: string, type: CalendarEventType) => {
    if (fr) return sameAsType(title, type) ? lowerFirst(title, locale) : title;
    return sameAsType(title, type) ? typeLabel(type) : `${typeLabel(type)}, ${quote(title)}`;
  };
  // The title after a line (« départ hâtif à 13 h 35 (Rencontres parents-enseignants) »), unless
  // it says no more than the line.
  const titled = (line: string, title: string, type: CalendarEventType) =>
    sameAsType(title, type) ? line : t('withTitle', { line, title });

  return {
    greeting: t('greeting'),
    closing: t('closing'),
    lessons: ({ subject, unit, lessons, more }) =>
      ended(t('lessons', { subject, unit, lessons: list(lessons, more) })),
    nextLessons: ({ subject, unit, lessons, more }) =>
      ended(t('nextLessons', { subject, unit, lessons: list(lessons, more) })),
    unitStart: ({ subject, title }) => ended(t('unitStart', { subject, title })),
    dayOff: ({ from, to, title, type }) => {
      const name = eventName(title, type);
      return ended(
        from === to
          ? t('dayOff', { date: lineDate(from), title: name })
          : t('dayOffRange', { from: day(from), to: day(to), title: name }),
      );
    },
    earlyDismissal: ({ date, time: at, title }) =>
      ended(
        titled(
          at
            ? t('earlyDismissal', { date: lineDate(date), time: time(at) })
            : t('earlyDismissalNoTime', { date: lineDate(date) }),
          title,
          'early_dismissal',
        ),
      ),
    lateStart: ({ date, time: at, title }) =>
      ended(
        titled(
          at
            ? t('lateStart', { date: lineDate(date), time: time(at) })
            : t('lateStartNoTime', { date: lineDate(date) }),
          title,
          'late_start',
        ),
      ),
    event: ({ from, to, time: at, title, type }) => {
      const name = eventName(title, type);
      if (from !== to) return ended(t('eventRange', { from: day(from), to: day(to), title: name }));
      return ended(
        at
          ? t('event', { date: lineDate(from), time: time(at), title: name })
          : t('eventNoTime', { date: lineDate(from), title: name }),
      );
    },
    report: ({ date, period }) => ended(t(`report.${period}`, { date: lineDate(date) })),
    season: ({ date, season }) => ended(t(`season.${season}`, { date: lineDate(date) })),
    tip: (text) => tipSentence(text, locale),
    // « Notre vertu de la semaine, le respect : « … » »: the reference's French title, mid-sentence.
    faith: ({ type, title, text }) =>
      t(`faith.${type}`, {
        title: fr ? lowerFirst(title.trim(), locale) : title.trim(),
        text: text.trim(),
      }),
  };
}

/** Both languages' sentences, for `buildNewsletterDraft`. */
export function newsletterPhrasePair(catalogs: { fr: MessageCatalog; en: MessageCatalog }): {
  fr: NewsletterPhrases;
  en: NewsletterPhrases;
} {
  return {
    fr: newsletterPhrases('fr-CA', catalogs.fr),
    en: newsletterPhrases('en-CA', catalogs.en, catalogs.fr),
  };
}

/** The section headings of one catalogue (the families' language). */
export function newsletterHeadings(
  locale: AppLocale,
  catalog: MessageCatalog,
): Record<NewsletterSectionKey, string> {
  const t = createTranslator({ locale, messages: catalog, namespace: 'newsletterText.sections' });
  return Object.fromEntries(NEWSLETTER_SECTIONS.map((key) => [key, t(key)])) as Record<
    NewsletterSectionKey,
    string
  >;
}

/** « École … · 3e année · Semaine du 5 octobre 2026 ». */
export function newsletterHeader(
  locale: AppLocale,
  catalog: MessageCatalog,
  values: { school: string; className: string; weekOf: LocalDate },
): string {
  const t = createTranslator({ locale, messages: catalog, namespace: 'newsletterText' });
  return t('header', {
    school: values.school,
    className: values.className,
    date: formatLocalDate(values.weekOf, locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  });
}
