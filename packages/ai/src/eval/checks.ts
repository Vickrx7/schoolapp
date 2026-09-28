/**
 * Automatic quality checks for « Texte différencié » answers. They catch regressions; a
 * teacher still reads the report for what code cannot judge (natural Canadian French, tone).
 */
import type { DifferentiateOutput } from '../features/differentiate';

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Average words per sentence. */
export function averageSentenceLength(text: string): number {
  const sentences = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /\p{L}/u.test(s));
  if (!sentences.length) return 0;
  const words = sentences.reduce((n, s) => n + (s.match(/[\p{L}\p{N}’'-]+/gu)?.length ?? 0), 0);
  return words / sentences.length;
}

/** Words that are European French or anglicisms in Ontario French schools. */
const NOT_CANADIAN = [
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

export function checkDifferentiation(
  output: DifferentiateOutput,
  options: { levelKeys: string[]; mustKeep: string[]; people: string[] },
): CheckResult[] {
  const results: CheckResult[] = [];
  const byKey = new Map(output.versions.map((v) => [v.level, v]));
  const ordered = options.levelKeys.map((k) => byKey.get(k));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  results.push({
    name: 'every level present once',
    passed: ordered.every(Boolean) && output.versions.length === options.levelKeys.length,
  });
  results.push({ name: 'shared objective stated', passed: output.objective.trim().length >= 10 });

  const missing = options.levelKeys.flatMap((k) => {
    const v = byKey.get(k);
    if (!v) return [];
    const text = fold(`${v.title}\n${v.text}`);
    return options.mustKeep.filter((w) => !text.includes(fold(w))).map((w) => `${k}: ${w}`);
  });
  results.push({
    name: 'key content kept in every version',
    passed: missing.length === 0,
    detail: missing.join(', ') || undefined,
  });

  if (first && last) {
    const a = averageSentenceLength(first.text);
    const b = averageSentenceLength(last.text);
    results.push({
      name: 'most accessible level has short sentences (≤ 12 words)',
      passed: a <= 12,
      detail: a.toFixed(1),
    });
    results.push({
      name: 'sentences get longer from first to last level',
      passed: a <= b,
      detail: `${a.toFixed(1)} → ${b.toFixed(1)}`,
    });
    results.push({
      name: 'most accessible level has a glossary',
      passed: first.glossary.length >= 2,
    });
    results.push({ name: 'last level has questions', passed: last.questions.length >= 1 });
  }

  const all = fold(
    output.versions
      .map((v) =>
        [
          v.title,
          v.text,
          ...v.questions,
          ...v.glossary.map((g) => `${g.term} ${g.definition}`),
        ].join('\n'),
      )
      .join('\n'),
  );
  const european = NOT_CANADIAN.filter((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(all));
  results.push({
    name: 'no European French or anglicisms',
    passed: european.length === 0,
    detail: european.join(', ') || undefined,
  });

  const markers = /(?:[ÉEée]l[èe]ve|[Aa]dulte)\s+[A-Z]{1,3}(?![\p{L}])/u.test(
    output.versions.map((v) => v.text).join('\n'),
  );
  results.push({ name: 'no leftover name markers after restore', passed: !markers });
  if (options.people.length) {
    const kept = options.people.filter((p) => all.includes(fold(p)));
    results.push({
      name: 'names restored in the answer',
      passed: kept.length > 0,
      detail: kept.join(', ') || undefined,
    });
  }
  return results;
}
