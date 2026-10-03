/**
 * « Vérifier avant d'envoyer » for « Créer une banque avec l'IA » (DECISIONS D-132): from the
 * request the database builds (`report_comment_bank_ai_preview`), exactly the message that would be
 * sent, with the names the app knows replaced and highlighted; the personal details that block it
 * (a title before a name the app does not know in the note included, D-139); and the note's
 * capitalized words to check before « J'ai vérifié ». The worker builds the same message from the
 * same request with a roster never narrower. Pure, so it is unit tested.
 */
import {
  reportCommentBankFeature,
  type ReportCommentBankInput,
} from '@lynx/ai/features/report-comment-bank';
import { Redactor, type BlockedKind, type KnownPerson, type Segment } from '@lynx/ai/privacy';
import { capitalizedWords } from '@lynx/ai/unknown-names';
import { segmentMessage } from './ai-preview';

export interface ReportBankPreview {
  /** Exactly the text sent, split around the names replaced by markers. */
  message: Segment[];
  replaced: number;
  /** Personal details that block the request until the teacher removes them. */
  blocked: { kind: BlockedKind; match: string }[];
  /** A note is sent (de-identified): « J'ai vérifié » is needed. */
  note: boolean;
  /** The note's capitalized words that may be a name the app does not know. */
  words: string[];
}

export function buildReportBankPreview(
  input: ReportCommentBankInput,
  people: readonly KnownPerson[],
  now = new Date(),
): ReportBankPreview {
  const redactor = new Redactor(people, now);
  const { input: sent, blocked } = reportCommentBankFeature.redactInput(input, redactor);
  const message = reportCommentBankFeature.buildUserMessage(sent);
  return {
    message: segmentMessage(message, redactor.replacements()),
    replaced: redactor.replacements().length,
    blocked: blocked.map((b) => ({ kind: b.kind, match: b.match.trim() })),
    note: sent.teacherNote.trim() !== '',
    words: capitalizedWords([sent.teacherNote]),
  };
}
