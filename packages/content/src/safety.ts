/**
 * Structured safety notes for experiments and STEM challenges (SPEC 9.3, DECISIONS P-7).
 * `final` mirrors `app.library_safety_notes_valid`: an age suitability (1–300 characters), the
 * allergy-aware materials (1–600, e.g. nut-free and latex-free alternatives) and a supervision
 * level; `hazards`, when present, is a list. The app is stricter in two ways: unknown keys are
 * refused, and a value made only of blanks counts as empty whatever the blank.
 */
import { z } from 'zod';
import { kit, type SchemaMode } from './kit';

export const SUPERVISION_LEVELS = ['standard', 'close', 'adult_only'] as const;
export type Supervision = (typeof SUPERVISION_LEVELS)[number];

export interface SafetyNotes {
  ageSuitability: string;
  allergyAwareMaterials: string;
  /** `standard` only when an adult without special training can run it safely. */
  supervision: Supervision;
  hazards: string[];
  notes: string;
}

/** What the editor holds before the notes are complete: no supervision chosen yet is `''`. */
export interface SafetyNotesDraft extends Omit<SafetyNotes, 'supervision'> {
  supervision: Supervision | '';
}

export function safetyNotesSchema(mode: 'final'): z.ZodType<SafetyNotes>;
export function safetyNotesSchema(mode: 'draft'): z.ZodType<SafetyNotesDraft>;
export function safetyNotesSchema(mode: SchemaMode): z.ZodType<unknown>;
export function safetyNotesSchema(mode: SchemaMode): z.ZodType<unknown> {
  const k = kit(mode);
  if (mode === 'ai') {
    return z.object({
      ageSuitability: z.string(),
      allergyAwareMaterials: z.string(),
      supervision: z.string(),
      hazards: z.array(z.string()),
      notes: z.string(),
    });
  }
  const final = mode === 'final';
  return k.obj({
    ageSuitability: final ? k.text(300) : k.optText(300),
    allergyAwareMaterials: final ? k.text(600) : k.optText(600),
    supervision: final
      ? k.enumOf(SUPERVISION_LEVELS)
      : z.enum([...SUPERVISION_LEVELS, ''], { error: 'invalid' }),
    // Optional like in SQL; always present after parsing.
    hazards: k.list(k.text(300), 0, 10).default([]),
    notes: k.optText(1000).default(''),
  });
}

export function emptySafetyNotes(): SafetyNotesDraft {
  return { ageSuitability: '', allergyAwareMaterials: '', supervision: '', hazards: [], notes: '' };
}

/** True when the notes would be accepted by `app.library_safety_notes_valid` (and the app). */
export function safetyNotesComplete(notes: unknown): notes is SafetyNotes {
  return safetyNotesSchema('final').safeParse(notes).success;
}
