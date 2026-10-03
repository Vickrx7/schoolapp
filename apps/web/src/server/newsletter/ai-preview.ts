/**
 * « Vérifier avant d'envoyer » for « Traduire en anglais (IA) » (DECISIONS D-139): from the request
 * the database builds (`newsletter_ai_preview`), exactly the message that would be sent, with the
 * names the app knows replaced and highlighted; the paragraphs left out (« Non envoyé —
 * traduisez-le vous-même ») and why; the capitalized words to check; and the keys of the
 * paragraphs sent, which the request confirms (`sendKeys`). The worker builds the same message
 * from the same request with a roster never narrower (apps/worker/src/ai.ts loadKnownPeople), so
 * it never sends a paragraph shown here as not sent. Pure, so it is unit tested.
 */
import {
  capitalizedWords,
  newsletterTranslateUserMessage,
  redactNewsletterTranslateInput,
  type NewsletterTranslateInput,
  type NewsletterTranslateSection,
} from '@lynx/ai/features/newsletter-translate';
import { Redactor, type BlockedKind, type KnownPerson, type Segment } from '@lynx/ai/privacy';
import { segmentMessage } from '../library/ai-preview';

/** A paragraph left out, as the teacher reads it: her own French and what was found in it. */
export interface NewsletterNotSentView {
  key: string;
  section: NewsletterTranslateSection;
  text: string;
  reasons: { kind: BlockedKind; match: string }[];
}

export interface NewsletterTranslatePreview {
  scope: NewsletterTranslateInput['scope'];
  /** The message's revision: the request refuses another (`newsletterStale`). */
  revision: number;
  /** Exactly the message sent, split around the names replaced by markers. Empty: nothing sent. */
  message: Segment[];
  /** People replaced by a marker. */
  replaced: number;
  /** The keys of the paragraphs sent, in order. */
  sendKeys: string[];
  notSent: NewsletterNotSentView[];
  /** Capitalized words of what is sent that may be a name the app does not know. */
  words: string[];
}

const hasMarker = (text: string, marker: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${marker}(?![\\p{L}\\p{N}])`, 'u').test(text);

export function buildTranslatePreview(
  input: NewsletterTranslateInput,
  people: readonly KnownPerson[],
  now = new Date(),
): NewsletterTranslatePreview {
  const redactor = new Redactor(people, now);
  const { input: sent, notSent } = redactNewsletterTranslateInput(
    { ...input, sendKeys: null },
    redactor,
  );
  const replacements = redactor.replacements();
  const original = new Map(input.items.map((i) => [i.key, i.text]));
  return {
    scope: input.scope,
    revision: input.revision,
    message: sent.items.length
      ? segmentMessage(newsletterTranslateUserMessage(sent), replacements)
      : [],
    // Only the people of what is sent: a name in a paragraph left out is not.
    replaced: replacements.filter((r) => sent.items.some((i) => hasMarker(i.text, r.placeholder)))
      .length,
    sendKeys: sent.items.map((i) => i.key),
    notSent: notSent.map((n) => ({
      key: n.key,
      section: n.section,
      text: original.get(n.key) ?? '',
      reasons: n.findings.map((f) => ({ kind: f.kind, match: f.match.trim() })),
    })),
    words: capitalizedWords(sent.items.map((i) => i.text)),
  };
}

/** The confirmed keys are the preview's, whatever their order. */
export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');
}
