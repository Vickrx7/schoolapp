/**
 * « Des élèves sont nommés » (DECISIONS D-138): before a message is copied, printed or marked sent,
 * the teacher is told which of the class's students it names, and which personal details it holds
 * (a phone number, an e-mail address, a birth date…), with the AI privacy tools (as the library's
 * first-name guard, `server/library/share-guard.ts`). It goes to every family in the class, so a
 * name is fine for news everyone may read, never for a behaviour, health or an evaluation; the
 * check catches accidents and blocks nothing. Nothing is stored or sent. Pure (the roster comes
 * from the caller), so it is unit tested.
 */
import { findBlockedDetails, findPersonalInfo, type BlockedKind } from '@lynx/ai/privacy';
import type { NewsletterContent } from '@lynx/domain';

export interface NewsletterNames {
  /** The class's students named, as the roster spells them, in the order found. */
  studentNames: string[];
  /** Personal details found, each once (kind and the text matched). */
  details: { kind: BlockedKind; match: string }[];
}

/** The texts the families get: every paragraph of the sections shown, in both languages. */
export function newsletterTexts(content: NewsletterContent): string[] {
  return content.sections
    .filter((s) => !s.off)
    .flatMap((s) => s.items.flatMap((i) => [i.fr, i.en]))
    .filter((text) => text.trim() !== '');
}

export function newsletterNames(
  content: NewsletterContent,
  students: readonly string[],
): NewsletterNames {
  const texts = newsletterTexts(content);
  const { studentNames } = findPersonalInfo(
    texts,
    students.map((name) => ({ name, kind: 'student' as const })),
  );
  const details: NewsletterNames['details'] = [];
  for (const text of texts) {
    for (const finding of findBlockedDetails(text)) {
      const match = finding.match.trim();
      if (!details.some((d) => d.kind === finding.kind && d.match === match)) {
        details.push({ kind: finding.kind, match });
      }
    }
  }
  return { studentNames, details };
}
