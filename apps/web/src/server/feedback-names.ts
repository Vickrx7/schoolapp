/**
 * Pilot feedback keeps no student's first name (DECISIONS D-116, as amended in the Phase 6
 * review): the names of the students of the sender's schools are replaced with a marker before
 * the message is stored, with the AI privacy tools' matching (accents, case, « Marie-Ève » and
 * « Marie Eve », names that are everyday words only when capitalized). Staff names stay. The
 * roster comes from `feedback_student_names` (office staff included, who cannot read students).
 * Personal details (an address, a phone number…) are reported, not replaced: the sender removes
 * them. Pure, so it is unit-tested.
 */
import { Redactor, type BlockedKind } from '@lynx/ai/privacy';

/** What replaces a first name, in the sender's language. */
export function studentMarker(locale: string): string {
  return locale.startsWith('en') ? '[student]' : '[élève]';
}

export function withoutStudentNames(
  message: string,
  firstNames: readonly string[],
  marker: string,
): { text: string; blocked: BlockedKind[] } {
  const redactor = new Redactor(firstNames.map((name) => ({ name, kind: 'student' as const })));
  const { segments, blocked } = redactor.redact(message);
  return {
    text: segments.map((s) => (s.placeholder ? marker : s.text)).join(''),
    blocked: [...new Set(blocked.map((b) => b.kind))],
  };
}
