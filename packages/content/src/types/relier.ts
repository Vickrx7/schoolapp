/**
 * Relier: Catholic reflections, Franco-Ontarian cultural hooks and bilingual family guides.
 */
import type { Kit } from '../kit';
import { common, glossaryEntry, type SchemaContext } from './shared';

export function catholicReflection({ k }: SchemaContext) {
  return k.obj({
    ...common(k),
    theme: k.text(160),
    /** A biblical reference only (« Genèse 1, 31 »), never a quotation. */
    scriptureReference: k.optText(120),
    reflection: k.text(2000),
    /** Discussion questions, not graded questions. */
    questions: k.list(k.text(300), 1, 6),
    prayer: k.optText(1500),
    action: k.optText(500),
  });
}

export function cultureHook({ k }: SchemaContext) {
  return k.obj({
    ...common(k),
    hook: k.text(1000),
    context: k.text(3000),
    discussionQuestions: k.list(k.text(300), 1, 6),
    activity: k.optText(1500),
    /** Teacher-only: facts to check before using the resource. */
    factsToVerify: k.list(k.text(300), 0, 6),
  });
}

function familyPart(k: Kit) {
  return k.obj({
    intro: k.text(1500),
    learning: k.list(k.text(300), 1, 6),
    atHome: k.list(k.text(400), 1, 6),
    words: k.list(glossaryEntry(k), 0, 10),
  });
}

/** The French part, then the English part (D-033: content keeps its own language). */
export function parentGuide({ k }: SchemaContext) {
  return k.obj({
    ...common(k),
    fr: familyPart(k),
    en: familyPart(k),
  });
}
