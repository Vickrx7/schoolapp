/**
 * The free text of a substitute's end-of-day report (DECISIONS D-054): a note per lesson block,
 * « Comportement et événements » and « Notes pour l'enseignant·e ». The web server encrypts it
 * with the alerts key ring, bound to the plan (`sub-report:<planId>`), before it reaches the
 * database, and decrypts it only for the absent teacher and the direction. Outcomes and the
 * absent students stay in the report's plain `content`. Not server-only, so it can be tested.
 */
import { subReportNotesSchema, type SubReportNotes } from '@lynx/domain';
import { decryptText, encryptText, type KeyRing } from '../alerts-crypto';

/** What the ciphertext is bound to: a report's notes cannot be moved to another plan. */
export const reportNotesAad = (planId: string) => `sub-report:${planId}`;

export const EMPTY_REPORT_NOTES: SubReportNotes = {
  lessonNotes: {},
  behaviour: '',
  forTeacher: '',
};

/** Whether there is any text to store (an empty report stores no ciphertext at all). */
export function hasReportNotes(notes: SubReportNotes): boolean {
  return (
    notes.behaviour.trim() !== '' ||
    notes.forTeacher.trim() !== '' ||
    Object.values(notes.lessonNotes).some((n) => n.trim() !== '')
  );
}

/** The notes without blank entries, ready to encrypt. */
export function compactReportNotes(notes: SubReportNotes): SubReportNotes {
  return {
    lessonNotes: Object.fromEntries(
      Object.entries(notes.lessonNotes)
        .map(([key, text]) => [key, text.trim()] as const)
        .filter(([, text]) => text !== ''),
    ),
    behaviour: notes.behaviour.trim(),
    forTeacher: notes.forTeacher.trim(),
  };
}

/** Encrypts the notes for one plan's report, or null when there is nothing to store. */
export function encryptReportNotes(
  notes: SubReportNotes,
  planId: string,
  ring: KeyRing,
): { ciphertext: string; keyVersion: number } | null {
  const compact = compactReportNotes(notes);
  if (!hasReportNotes(compact)) return null;
  return encryptText(JSON.stringify(compact), reportNotesAad(planId), ring);
}

/**
 * The notes of one plan's report, or null when they cannot be read (another plan's ciphertext,
 * an unknown key version, a damaged value). Never throws: a page shows « illisibles » instead.
 */
export function decryptReportNotes(
  ciphertext: string,
  planId: string,
  ring: KeyRing,
): SubReportNotes | null {
  try {
    const parsed = subReportNotesSchema.safeParse(
      JSON.parse(decryptText(ciphertext, reportNotesAad(planId), ring)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
