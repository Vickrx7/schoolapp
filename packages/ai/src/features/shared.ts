/**
 * Pieces the AI features share: teacher text put in a prompt, the words that are not Canadian
 * French, and spotting (or taking out) a language level's name in text given to students. No
 * dependencies: the web server imports it too (`@lynx/ai/features/shared`).
 */

/** Wraps teacher text in a tag that the text itself cannot close. */
export function tagged(tag: string, content: string): string {
  const safe = content.replaceAll(`</${tag}>`, `< /${tag}>`);
  return `<${tag}>\n${safe}\n</${tag}>`;
}

/** Words that are European French or anglicisms in Ontario French schools (lowercase). */
export const NOT_CANADIAN = [
  'septante',
  'nonante',
  'week-end',
  'weekend',
  'e-mail',
  'email',
  'parking',
  'shopping',
  'petit-dej',
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A level's name as a whole word, in any case; accents count. Null for a blank name. */
function levelLabelWord(label: string): RegExp | null {
  const name = label.trim();
  return name ? new RegExp(`(?<!\\p{L})${escapeRegExp(name)}(?!\\p{L})`, 'giu') : null;
}

/**
 * Whether `text` names one of the language levels as a word, in any case (« Débutant » in
 * « Groupe débutant »). Accents count: « avance » (a verb) is not « Avancé ». Student copies must
 * never label anyone with a level (D-042).
 */
export function mentionsLevelLabel(text: string, labels: readonly string[]): boolean {
  return labels.some((label) => levelLabelWord(label)?.test(text) ?? false);
}

/**
 * `text` with every level name that mentionsLevelLabel finds replaced by `replacement`, longest
 * names first (« Très avancé » before « Avancé »). For what is printed for students after the
 * answer was checked: a level may have been renamed since (the students' activity sheets).
 */
export function replaceLevelLabels(
  text: string,
  labels: readonly string[],
  replacement: string,
): string {
  return [...labels]
    .sort((a, b) => b.trim().length - a.trim().length)
    .reduce((out, label) => {
      const word = levelLabelWord(label);
      return word ? out.replace(word, replacement) : out;
    }, text);
}
