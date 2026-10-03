/**
 * The teacher copy (« Guide et corrigé ») and the answer key (DECISIONS D-062, D-075). The
 * teacher document holds every field, the attentes (« à vérifier » while unverified, D-030),
 * safety and faith callouts; the answer key is a separate document so printing can keep it apart.
 */
import { TYPE_INFO, type LibraryItemType } from '../catalog';
import { answerFor } from '../answer-key';
import { isPlainObject } from '../conform';
import { questionsOf } from '../questions-of';
import { isQuestionKind, type AnswerEntry, type AnswerKey, type Question } from '../questions';
import { paragraphsOf, str, strings } from './builder';
import { renderContentBlocks } from './content';
import type { DocBlock, LeafBlock, RenderedDoc } from './doc';
import { DOC_LABELS_FR as L, SUPERVISION_LABELS_FR, labelled, letter } from './labels-fr';

export interface TeacherDocMeta {
  itemTitle: string;
  number?: number | null;
  /** For lesson phase labels. */
  subjectCode?: string | null;
  subjectLabel?: string | null;
  gradeLabels?: readonly string[];
  durationMinutes?: number | null;
  materials?: string | null;
  expectations?: readonly { code: string; text: string; verified: boolean }[];
  safetyNotes?: unknown;
  faith?: { connection: string | null; referenceTitle?: string | null } | null;
}

function safetyCallout(notes: unknown): LeafBlock | null {
  if (!isPlainObject(notes)) return null;
  const supervision = str(notes.supervision);
  const hazards = strings(notes.hazards);
  const items = [
    supervision
      ? labelled(
          L.supervision,
          SUPERVISION_LABELS_FR[supervision as keyof typeof SUPERVISION_LABELS_FR] ?? supervision,
        )
      : '',
    str(notes.ageSuitability) ? labelled(L.ageSuitability, str(notes.ageSuitability)) : '',
    str(notes.allergyAwareMaterials)
      ? labelled(L.allergyAwareMaterials, str(notes.allergyAwareMaterials))
      : '',
    hazards.length ? labelled(L.hazards, hazards.join(' · ')) : '',
    str(notes.notes) ? labelled(L.safetyNotes, str(notes.notes)) : '',
  ].filter(Boolean);
  return items.length
    ? { type: 'callout', tone: 'safety', title: L.safety, text: '', items }
    : null;
}

export function renderTeacherDoc(
  meta: TeacherDocMeta,
  type: LibraryItemType,
  content: unknown,
): RenderedDoc {
  const c = isPlainObject(content) ? content : {};
  const blocks: DocBlock[] = [];

  const details = [
    meta.gradeLabels?.length ? labelled(L.grades, meta.gradeLabels.join(', ')) : '',
    str(meta.subjectLabel) ? labelled(L.subject, str(meta.subjectLabel)) : '',
    meta.durationMinutes ? labelled(L.duration, L.minutes(meta.durationMinutes)) : '',
    str(meta.materials) ? labelled(L.materials, str(meta.materials)) : '',
  ].filter(Boolean);
  if (details.length) blocks.push({ type: 'list', ordered: false, items: details });

  const expectations = (meta.expectations ?? []).map(
    (e) => `${e.code} — ${e.text.trim()}${e.verified ? '' : ` (${L.toVerify})`}`,
  );
  if (expectations.length) {
    blocks.push({ type: 'heading', level: 2, text: L.expectations });
    blocks.push({ type: 'list', ordered: false, items: expectations });
  }

  const safety = safetyCallout(meta.safetyNotes);
  if (safety) blocks.push(safety);

  const connection = str(meta.faith?.connection);
  if (connection) {
    const reference = str(meta.faith?.referenceTitle);
    blocks.push({
      type: 'callout',
      tone: 'faith',
      title: L.faith,
      text: connection,
      items: reference ? [labelled(L.faithReference, reference)] : [],
    });
  }

  if (str(c.objective)) {
    blocks.push({
      type: 'callout',
      tone: 'info',
      title: L.objective,
      text: str(c.objective),
      items: [],
    });
  }
  if (str(c.teacherNote)) {
    blocks.push({
      type: 'callout',
      tone: 'teacher',
      title: L.teacherNote,
      text: str(c.teacherNote),
      items: [],
    });
  }

  blocks.push(
    ...renderContentBlocks(type, c, 'teacher', { subjectCode: meta.subjectCode ?? null }),
  );
  return {
    kind: 'teacher',
    lang: 'fr-CA',
    title: str(c.title) || meta.itemTitle.trim(),
    subtitle: TYPE_INFO[type].labelFr,
    number: meta.number ?? null,
    blocks,
  };
}

function answerBlock(
  question: Question,
  entry: AnswerEntry | undefined,
  number: number,
): LeafBlock {
  const block = {
    type: 'answer' as const,
    number,
    text: '',
    details: [] as string[],
    explanation: '',
  };
  if (!entry || entry.kind !== question.kind) return { ...block, text: L.missingAnswer };
  block.explanation = entry.explanation.trim();
  switch (entry.kind) {
    case 'multiple_choice': {
      const q = question as Extract<Question, { kind: 'multiple_choice' }>;
      block.text = q.choices
        .map((choice, i) => ({ choice, i }))
        .filter(({ choice }) => entry.correctChoiceIds.includes(choice.id))
        .map(({ choice, i }) => `${letter(i)}) ${choice.text}`)
        .join(' · ');
      break;
    }
    case 'true_false':
      block.text = entry.correct ? L.trueLabel : L.falseLabel;
      break;
    case 'matching': {
      const q = question as Extract<Question, { kind: 'matching' }>;
      const rows = q.left.map((left, i) => {
        const rightId = entry.pairs.find((p) => p.leftId === left.id)?.rightId;
        const j = q.right.findIndex((r) => r.id === rightId);
        return {
          short: `${i + 1} → ${j >= 0 ? letter(j) : '?'}`,
          long: `${i + 1}. ${left.text} → ${j >= 0 ? `${letter(j)}. ${q.right[j]!.text}` : '?'}`,
        };
      });
      block.text = rows.map((r) => r.short).join(' · ');
      block.details = rows.map((r) => r.long);
      break;
    }
    case 'ordering': {
      const q = question as Extract<Question, { kind: 'ordering' }>;
      // The numbers to write in the boxes, in the order the items are printed.
      block.text = labelled(
        L.expectedOrder,
        q.items.map((item) => String(entry.orderedIds.indexOf(item.id) + 1)).join(', '),
      );
      block.details = entry.orderedIds.map((id, i) => {
        const item = q.items.find((it) => it.id === id);
        return `${i + 1}. ${item?.text ?? '?'}`;
      });
      break;
    }
    case 'short_answer': {
      const sample = entry.sampleAnswer.trim();
      const accepted = entry.acceptableAnswers.map((a) => a.trim()).filter(Boolean);
      block.text = sample ? labelled(L.sampleAnswer, sample) : L.manualGrading;
      if (accepted.length) block.details = [labelled(L.acceptableAnswers, accepted.join(' · '))];
      break;
    }
  }
  return block;
}

export interface AnswerKeyDocOptions {
  number: number | null;
  itemTitle?: string;
}

/** « Corrigé — version n »: answers numbered like the student sheet, then the solution. */
export function renderAnswerKeyDoc(
  type: LibraryItemType,
  content: unknown,
  key: AnswerKey | null,
  options: AnswerKeyDocOptions,
): RenderedDoc {
  const blocks: DocBlock[] = [];
  // The student sheet skips questions of an unknown kind; so does the key.
  const questions = questionsOf(type, content).filter(({ question }) =>
    isQuestionKind(question.kind),
  );
  questions.forEach(({ question }, i) => {
    blocks.push(answerBlock(question, answerFor(key, question.id), i + 1));
  });
  const solution = paragraphsOf(str(key?.solution));
  if (solution.length) {
    blocks.push({
      type: 'heading',
      level: 2,
      text: type === 'experiment' ? L.expectedResults : L.solution,
    });
    for (const text of solution) blocks.push({ type: 'paragraph', text });
  }
  return {
    kind: 'answerKey',
    lang: 'fr-CA',
    title: options.number ? L.answerKeyVersion(options.number) : L.answerKey,
    subtitle: (options.itemTitle ?? '').trim(),
    number: options.number,
    blocks,
  };
}
