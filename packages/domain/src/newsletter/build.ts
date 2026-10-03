/**
 * « Info-parents » (DECISIONS D-136, D-137): the first draft of a week's message, from the facts,
 * written in French and in English at once from the two message catalogues (whatever the
 * interface's language, amending D-033): with the AI off, the teacher still gets an English
 * version of every line the app writes. Titles the staff typed (units, lessons, events) are
 * quoted as typed, with the app's typography (typographic apostrophes, French spacing). The phrases are plain functions (dates, times, lists, each line), so the
 * domain stays free of the message library.
 */
import type { CalendarEventType } from '../calendar';
import type { LocalDate } from '../dates';
import type { CatholicReferenceType } from '../sub-plan/catholic';
import type { ReportPeriodKind } from '../year-plan/report-periods';
import {
  englishTypography,
  frenchTypography,
  NEWSLETTER_LIMITS,
  NEWSLETTER_SECTIONS,
  type NewsletterContent,
  type NewsletterItem,
  type NewsletterSectionKey,
  type NewsletterSource,
} from './content';
import type { NewsletterDate, NewsletterFacts, NewsletterLessonLine } from './facts';

export interface NewsletterPhrases {
  greeting: string;
  closing: string;
  /**
   * « Mathématiques (unité « … ») : « … » et « … » »; with `more`, the list ends « et 6 autres
   * leçons » (a line too long for a paragraph, post-MVP review).
   */
  lessons(line: { subject: string; unit: string; lessons: string[]; more?: number }): string;
  /** A cycle day unknown: « Mathématiques (unité « … »), prochaines leçons : … ». */
  nextLessons(line: { subject: string; unit: string; lessons: string[]; more?: number }): string;
  unitStart(start: { subject: string; title: string; date: LocalDate }): string;
  dayOff(d: { from: LocalDate; to: LocalDate; title: string; type: CalendarEventType }): string;
  earlyDismissal(d: { date: LocalDate; time: string | null; title: string }): string;
  lateStart(d: { date: LocalDate; time: string | null; title: string }): string;
  event(d: {
    from: LocalDate;
    to: LocalDate;
    time: string | null;
    title: string;
    type: CalendarEventType;
  }): string;
  report(d: { date: LocalDate; period: ReportPeriodKind }): string;
  season(d: { date: LocalDate; season: 'avent' | 'noel' | 'careme' | 'paques' }): string;
  /** A guide's tip as a sentence. */
  tip(text: string): string;
  faith(ref: { type: CatholicReferenceType; title: string; text: string }): string;
}

export interface NewsletterDraftOptions {
  /** The signature (`formalStaffName` of the person preparing it, **Assumption**). */
  signature: string;
  /** « Inclure un moment de foi » (on by default, **Assumption**). */
  faith: boolean;
  /** « Inclure des conseils des guides pour les familles ». */
  guides: boolean;
}

/** Builds the message: every section in order, the app's lines in both languages. */
export function buildNewsletterDraft(
  facts: NewsletterFacts,
  phrases: { fr: NewsletterPhrases; en: NewsletterPhrases },
  options: NewsletterDraftOptions,
  newId: () => string,
): NewsletterContent {
  const ids = new Set<string>();
  const id = () => {
    let next = newId();
    while (ids.has(next)) next = newId();
    ids.add(next);
    return next;
  };
  const item: ItemOf = (kind, write, ref) => {
    const fr = frenchTypography(write(phrases.fr, 'fr'));
    return {
      id: id(),
      fr,
      en: englishTypography(write(phrases.en, 'en')),
      enFrom: fr,
      enBy: 'app',
      from: ref ? { kind, ref } : { kind },
    };
  };
  /** A line whose English may be missing (a guide's tip, a reference without English). */
  const partial = (
    kind: NewsletterSource,
    french: string,
    english: string,
    ref: string,
  ): NewsletterItem => {
    const fr = frenchTypography(french);
    const en = englishTypography(english);
    return {
      id: id(),
      fr,
      en,
      enFrom: en ? fr : null,
      enBy: en ? 'app' : null,
      from: { kind, ref },
    };
  };

  // A unit's lessons for the week on one line; a line too long for a paragraph (Français twice a
  // day, long titles) lists the first lessons and ends « et 6 autres leçons », never refusing the
  // whole message (post-MVP review).
  const lessonItem = (line: NewsletterLessonLine, write: 'lessons' | 'nextLessons') => {
    const titles = line.lessons.map((l) => l.title);
    const writeFirst =
      (n: number) =>
      (p: NewsletterPhrases, lang: 'fr' | 'en'): string =>
        p[write]({
          subject: line.subject[lang],
          unit: line.unitTitle,
          lessons: titles.slice(0, n),
          more: titles.length - n,
        });
    let n = titles.length;
    while (
      n > 1 &&
      (frenchTypography(writeFirst(n)(phrases.fr, 'fr')).length > NEWSLETTER_LIMITS.fr ||
        englishTypography(writeFirst(n)(phrases.en, 'en')).length > NEWSLETTER_LIMITS.en)
    ) {
      n--;
    }
    return item('lesson', writeFirst(n), line.unitId);
  };

  const sections: Record<NewsletterSectionKey, NewsletterItem[]> = {
    message: [item('greeting', (p) => p.greeting)],
    thisWeek: facts.thisWeek.map((line) => lessonItem(line, 'lessons')),
    nextWeek: [
      ...facts.nextWeek.map((line) =>
        lessonItem(line, facts.nextLessonsOnly ? 'nextLessons' : 'lessons'),
      ),
      ...facts.unitStarts.map((s) =>
        item(
          'unitStart',
          (p, lang) =>
            p.unitStart({
              subject: s.subject[lang],
              title: s.title,
              date: s.startsOn,
            }),
          s.unitId,
        ),
      ),
    ],
    dates: facts.dates.map((d) => dateItem(d, item)),
    reminders: [],
    atHome: options.guides
      ? facts.guides.flatMap((g) =>
          g.tips.map((t) =>
            partial('guide', phrases.fr.tip(t.fr), t.en ? phrases.en.tip(t.en) : '', g.id),
          ),
        )
      : [],
    faith:
      options.faith && facts.faith
        ? [
            partial(
              'faith',
              phrases.fr.faith({
                type: facts.faith.type,
                title: facts.faith.title,
                text: facts.faith.textFr,
              }),
              facts.faith.textEn?.trim()
                ? phrases.en.faith({
                    type: facts.faith.type,
                    title: facts.faith.title,
                    text: facts.faith.textEn.trim(),
                  })
                : '',
              facts.faith.id,
            ),
          ]
        : [],
    closing: [item('closing', (p) => p.closing)],
  };

  return {
    v: 1,
    signature: options.signature,
    sections: NEWSLETTER_SECTIONS.map((key) => ({
      key,
      off: (key === 'faith' && !options.faith) || (key === 'atHome' && !options.guides),
      // Each section holds at most 12 paragraphs (D-137).
      items: sections[key].slice(0, 12),
    })),
  };
}

type ItemOf = (
  kind: NewsletterSource,
  write: (p: NewsletterPhrases, lang: 'fr' | 'en') => string,
  ref?: string,
) => NewsletterItem;

function dateItem(d: NewsletterDate, item: ItemOf): NewsletterItem {
  switch (d.kind) {
    case 'dayOff':
      return item('dayOff', (p) => p.dayOff(d), d.id);
    case 'earlyDismissal':
      return item(
        'event',
        (p) => p.earlyDismissal({ date: d.from, time: d.time, title: d.title }),
        d.id,
      );
    case 'lateStart':
      return item(
        'event',
        (p) => p.lateStart({ date: d.from, time: d.time, title: d.title }),
        d.id,
      );
    case 'event':
      return item('event', (p) => p.event(d), d.id);
    case 'report':
      return item('report', (p) => p.report({ date: d.from, period: d.period }));
    case 'season':
      return item('season', (p) => p.season({ date: d.from, season: d.season }));
  }
}
