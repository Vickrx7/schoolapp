/**
 * Blocks shared by the type schemas. Sizes are in characters.
 */
import type { Kit } from '../kit';
import type { QuestionSchemas } from '../questions';

export interface SchemaContext {
  k: Kit;
  q: QuestionSchemas;
}

/** Every type has these. `title: ''` means the item's title; `teacherNote` is teacher-only. */
export function common(k: Kit) {
  return {
    title: k.optText(200),
    /** Labelled « Intention d’apprentissage ». */
    objective: k.optText(1000),
    teacherNote: k.optText(2000),
  };
}

export function glossaryEntry(k: Kit) {
  return k.obj({ term: k.text(80), definition: k.optText(500) });
}

export function step(k: Kit) {
  return k.obj({
    minutes: k.int(1, 240).nullable(),
    instruction: k.text(1000),
    /** What to say, word for word (« À dire »). */
    say: k.optText(500),
  });
}
