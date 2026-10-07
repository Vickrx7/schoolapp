/**
 * The result editor edits lists as plain text, one item per line (glossary lines read
 * « mot : définition »). These helpers turn that text into what the server saves and map the
 * server's field errors back to a field and a line number.
 */

export interface EditorVersion {
  languageLevelId: string;
  levelLabel: string;
  title: string;
  text: string;
  glossary: { term: string; definition: string }[];
  visualSupports: string[];
  questions: string[];
  teacherNote: string;
}

export interface EditableVersion {
  languageLevelId: string;
  levelLabel: string;
  title: string;
  text: string;
  glossary: string;
  visualSupports: string;
  questions: string;
  teacherNote: string;
}

export type LineField = 'glossary' | 'visualSupports' | 'questions';
const LINE_FIELDS: readonly string[] = ['glossary', 'visualSupports', 'questions'];
const VERSION_FIELDS: readonly string[] = ['title', 'text', 'teacherNote', ...LINE_FIELDS];

/** Non-empty lines with their 1-based line number in the text box. */
export function numberedLines(s: string): { text: string; line: number }[] {
  return s
    .split('\n')
    .map((text, i) => ({ text: text.trim(), line: i + 1 }))
    .filter((l) => l.text);
}

export const lines = (s: string) => numberedLines(s).map((l) => l.text);

/** "mot : définition"; a line without a colon is a word without definition. */
export function parseGlossaryLine(l: string) {
  const i = l.indexOf(':');
  return i === -1
    ? { term: l, definition: '' }
    : { term: l.slice(0, i).trim(), definition: l.slice(i + 1).trim() };
}

export const parseGlossary = (s: string) => lines(s).map(parseGlossaryLine);

export const toEditable = (v: EditorVersion): EditableVersion => ({
  ...v,
  glossary: v.glossary
    .map((g) => (g.definition ? `${g.term} : ${g.definition}` : g.term))
    .join('\n'),
  visualSupports: v.visualSupports.join('\n'),
  questions: v.questions.join('\n'),
});

/** For each list field, the text-box line number of each item sent. */
export type LineNumbers = Record<LineField, number[]>;

/**
 * What the save actions receive for one version. Every non-empty line is sent, even one the
 * server will refuse (": définition" has no word), so the teacher is told instead of it
 * silently disappearing.
 */
export function versionPayload(x: EditableVersion) {
  const glossary = numberedLines(x.glossary);
  const visualSupports = numberedLines(x.visualSupports);
  const questions = numberedLines(x.questions);
  return {
    payload: {
      languageLevelId: x.languageLevelId,
      title: x.title,
      text: x.text,
      glossary: glossary.map((l) => parseGlossaryLine(l.text)),
      visualSupports: visualSupports.map((l) => l.text),
      questions: questions.map((l) => l.text),
      teacherNote: x.teacherNote,
    },
    lines: {
      glossary: glossary.map((l) => l.line),
      visualSupports: visualSupports.map((l) => l.line),
      questions: questions.map((l) => l.line),
    } satisfies LineNumbers,
  };
}

export interface ResolvedErrors {
  /** Error key per field shown ('title', 'objective', 'versions.0.glossary'...), with a line. */
  fields: Record<string, { error: string; line?: number }>;
  /** The first level with an error: phones show one level at a time. */
  firstVersion: number | null;
  /** Errors no field can show. */
  unmatched: string[];
}

const isIndex = (s: string | undefined) => s !== undefined && /^\d+$/.test(s);

/**
 * Maps the save action's field errors, keyed by path ("versions.0.glossary.2.term"), to the
 * fields of the editor and the line of the text box they come from.
 */
export function resolveFieldErrors(
  fieldErrors: Record<string, string>,
  lineNumbers: readonly LineNumbers[],
): ResolvedErrors {
  const out: ResolvedErrors = { fields: {}, firstVersion: null, unmatched: [] };
  for (const [path, error] of Object.entries(fieldErrors)) {
    const [root, index, field, item] = path.split('.');
    if ((root === 'title' || root === 'objective') && index === undefined) {
      out.fields[root] ??= { error };
      continue;
    }
    if (root !== 'versions' || !isIndex(index) || !field || !VERSION_FIELDS.includes(field)) {
      out.unmatched.push(error);
      continue;
    }
    const i = Number(index);
    const line =
      LINE_FIELDS.includes(field) && isIndex(item)
        ? lineNumbers[i]?.[field as LineField][Number(item)]
        : undefined;
    out.fields[`versions.${i}.${field}`] ??= line === undefined ? { error } : { error, line };
    out.firstVersion = out.firstVersion === null ? i : Math.min(out.firstVersion, i);
  }
  return out;
}
