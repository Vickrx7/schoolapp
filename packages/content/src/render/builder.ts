/**
 * Builds document blocks from content fields (internal). Every method skips empty values, so a
 * renderer can call it for any field; teacher-only methods do nothing on student documents.
 */
import { isPlainObject } from '../conform';
import { isQuestionKind } from '../questions';
import type { CalloutTone, DocOption, LeafBlock, QuestionBlock } from './doc';
import { CATEGORY_LABELS_FR, DOC_LABELS_FR, labelled, letter } from './labels-fr';

export type Audience = 'student' | 'teacher';

export const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(str).filter(Boolean) : [];

export const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isPlainObject) : [];

/** Paragraphs are separated by a blank line; single line breaks stay inside a paragraph. */
export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export interface Option {
  id: string;
  text: string;
}

export const optionsOf = (value: unknown): Option[] =>
  records(value).map((o) => ({ id: str(o.id), text: str(o.text) }));

export class DocBuilder {
  readonly blocks: LeafBlock[] = [];
  private questionCount = 0;

  constructor(readonly audience: Audience) {}

  get forTeacher(): boolean {
    return this.audience === 'teacher';
  }

  push(block: LeafBlock): void {
    this.blocks.push(block);
  }

  heading(text: unknown, level: 1 | 2 | 3 = 2): void {
    const value = str(text);
    if (value) this.push({ type: 'heading', level, text: value });
  }

  /** A text field as paragraphs, under an optional heading. */
  text(value: unknown, heading?: string): void {
    const paragraphs = paragraphsOf(str(value));
    if (!paragraphs.length) return;
    if (heading) this.heading(heading);
    for (const text of paragraphs) this.push({ type: 'paragraph', text });
  }

  /** « Label : value » as one paragraph. */
  line(label: string, value: unknown): void {
    const text = str(value);
    if (text) this.push({ type: 'paragraph', text: labelled(label, text) });
  }

  list(value: unknown, heading?: string, ordered = false): void {
    const items = strings(value);
    if (!items.length) return;
    if (heading) this.heading(heading);
    this.push({ type: 'list', ordered, items });
  }

  steps(items: { text: string; minutes: number | null; detail: string }[], heading?: string): void {
    const kept = items.filter((i) => i.text || i.detail);
    if (!kept.length) return;
    if (heading) this.heading(heading);
    this.push({ type: 'steps', items: kept });
  }

  glossary(value: unknown, heading: string = DOC_LABELS_FR.glossary): void {
    const entries = records(value)
      .map((e) => ({ term: str(e.term), definition: str(e.definition) }))
      .filter((e) => e.term);
    if (!entries.length) return;
    this.heading(heading);
    this.push({ type: 'glossary', entries });
  }

  table(caption: string, columns: string[], rows: string[][]): void {
    if (!columns.length || !rows.length) return;
    this.push({ type: 'table', caption, columns, rows });
  }

  lines(count: number): void {
    this.push({ type: 'lines', count });
  }

  callout(tone: CalloutTone, title: string, text: unknown = '', items: unknown = []): void {
    const body = str(text);
    const list = strings(items);
    if (!body && !list.length) return;
    this.push({ type: 'callout', tone, title, text: body, items: list });
  }

  /** A teacher-only field: shown on teacher documents only, marked as such. */
  teacherText(title: string, value: unknown): void {
    if (this.forTeacher) this.callout('teacher', title, value);
  }

  teacherList(title: string, value: unknown): void {
    if (this.forTeacher) this.callout('teacher', title, '', value);
  }

  poem(title: string, lines: string[]): void {
    const kept = lines.map((l) => l.trim()).filter(Boolean);
    if (kept.length) this.push({ type: 'poem', title, lines: kept });
  }

  /** Questions of a list, numbered on from the previous lists. Unknown kinds are skipped. */
  questions(value: unknown, heading?: string): void {
    const questions = records(value).filter((q) => isQuestionKind(q.kind));
    if (!questions.length) return;
    if (heading) this.heading(heading);
    for (const q of questions) this.push(this.question(q));
  }

  private question(q: Record<string, unknown>): QuestionBlock {
    const kind = q.kind as QuestionBlock['kind'];
    const category =
      this.forTeacher && typeof q.category === 'string' && q.category in CATEGORY_LABELS_FR
        ? CATEGORY_LABELS_FR[q.category as keyof typeof CATEGORY_LABELS_FR]
        : null;
    const block: QuestionBlock = {
      type: 'question',
      number: ++this.questionCount,
      kind,
      prompt: str(q.prompt),
      hint: str(q.hint),
      points: typeof q.points === 'number' ? q.points : null,
      category,
      choices: [],
      multipleAnswers: false,
      left: [],
      right: [],
      lines: 0,
    };
    const lettered = (options: Option[]): DocOption[] =>
      options.map((o, i) => ({ label: letter(i), text: o.text }));
    switch (kind) {
      case 'multiple_choice':
        block.choices = lettered(optionsOf(q.choices));
        block.multipleAnswers = q.multipleAnswers === true;
        break;
      case 'true_false':
        block.choices = [
          { label: '', text: DOC_LABELS_FR.trueLabel },
          { label: '', text: DOC_LABELS_FR.falseLabel },
        ];
        break;
      case 'matching':
        block.left = optionsOf(q.left).map((o, i) => ({ label: String(i + 1), text: o.text }));
        block.right = lettered(optionsOf(q.right));
        break;
      case 'ordering':
        block.choices = optionsOf(q.items).map((o) => ({ label: '', text: o.text }));
        break;
      case 'short_answer':
        block.lines =
          typeof q.lines === 'number' ? Math.min(12, Math.max(1, Math.round(q.lines))) : 3;
        break;
    }
    return block;
  }
}
