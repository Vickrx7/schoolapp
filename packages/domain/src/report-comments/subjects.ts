/**
 * « Matière » in « Bulletins » (DECISIONS D-130, D-135): the teacher's own subjects first (from the
 * class's timetable), then « Habiletés d'apprentissage et habitudes de travail » (first of all for
 * the homeroom teacher, **Assumption**), then the class's other subjects.
 */

/** The subject key of the learning skills and work habits in the device draft and the address. */
export const LEARNING_SKILLS_KEY = 'learning_skills';

export type ComposerSubjectGroup = 'mine' | 'learning_skills' | 'other';

export interface ComposerSubjectChoice<S> {
  /** The subject's id, or `LEARNING_SKILLS_KEY`. */
  key: string;
  group: ComposerSubjectGroup;
  /** Null for the learning skills. */
  subject: S | null;
}

export interface ComposerBlock {
  subjectId: string | null;
  /** The block's own teacher; null: the homeroom teacher's (D-006). */
  teacherId: string | null;
}

/**
 * The choices of « Matière », in order. Mine: a subject block taught by me, or a block without its
 * own teacher when I am the homeroom teacher (D-006). `subjects` are the class's subjects in the
 * board's order; a block whose subject is not among them is ignored.
 */
export function composerSubjects<S extends { id: string }>({
  blocks,
  userId,
  myRole,
  subjects,
}: {
  blocks: readonly ComposerBlock[];
  userId: string;
  myRole: 'homeroom' | 'subject' | 'support' | null;
  subjects: readonly S[];
}): ComposerSubjectChoice<S>[] {
  const homeroom = myRole === 'homeroom';
  const mine = new Set(
    blocks
      .filter((b) => b.subjectId && (b.teacherId === userId || (b.teacherId === null && homeroom)))
      .map((b) => b.subjectId!),
  );
  const own = subjects
    .filter((s) => mine.has(s.id))
    .map((s) => ({ key: s.id, group: 'mine' as const, subject: s }));
  const skills: ComposerSubjectChoice<S> = {
    key: LEARNING_SKILLS_KEY,
    group: 'learning_skills',
    subject: null,
  };
  const others = subjects
    .filter((s) => !mine.has(s.id))
    .map((s) => ({ key: s.id, group: 'other' as const, subject: s }));
  return homeroom ? [skills, ...own, ...others] : [...own, skills, ...others];
}
