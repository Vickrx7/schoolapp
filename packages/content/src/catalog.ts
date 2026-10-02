/**
 * The library catalogue (SPEC 9.3, DECISIONS D-061, D-129): 6 buckets and 26 item types, with the
 * flags the rest of the package (and the database) rely on. The bucket of each type must match
 * the newest `app.library_bucket_for` (`supabase/migrations/20260928160700_library.sql`, replaced
 * by `20270118090100_report_comments.sql` for the 26th type, the comment bank).
 */

export const LIBRARY_BUCKETS = [
  'enseigner',
  'pratiquer',
  'explorer',
  'evaluer',
  'jouer',
  'relier',
] as const;
export type LibraryBucket = (typeof LIBRARY_BUCKETS)[number];

/** Same order as the `library_item_type` enum. */
export const LIBRARY_ITEM_TYPES = [
  // enseigner
  'lesson_plan',
  'anchor_chart',
  'worked_example',
  'teacher_guide',
  // pratiquer
  'worksheet',
  'learning_centre',
  'reading_passage',
  'vocabulary_bank',
  'exit_ticket',
  // explorer
  'experiment',
  'stem_challenge',
  'project',
  'outdoor_activity',
  // evaluer
  'quiz',
  'unit_test',
  'diagnostic',
  'rubric',
  'report_comments',
  // jouer
  'game',
  'brain_break',
  'song',
  'riddle',
  'weekly_challenge',
  // relier
  'catholic_reflection',
  'culture_hook',
  'parent_guide',
] as const;
export type LibraryItemType = (typeof LIBRARY_ITEM_TYPES)[number];

export function isLibraryItemType(value: unknown): value is LibraryItemType {
  return typeof value === 'string' && (LIBRARY_ITEM_TYPES as readonly string[]).includes(value);
}

export interface ItemFormats {
  printable: boolean;
  projectable: boolean;
  interactive: boolean;
}

export interface TypeInfo {
  bucket: LibraryBucket;
  /** French label, also the `libraryCommon.types.<type>` message. */
  labelFr: string;
  /**
   * Who the item is written for. `teacher` items have no student sheet (`studentContent` is
   * null); `family` items are the bilingual family guide.
   */
  audience: 'student' | 'teacher' | 'family';
  /** An answer key is required (quiz, tests, exit tickets, riddles). */
  keyed: boolean;
  /**
   * The item may carry an answer key: questions with answers, or a solution (expected results
   * of an experiment, the solution of a weekly challenge). Every keyed type is included.
   */
  mayHaveQuestions: boolean;
  /** Versions per language level make sense for this type. */
  levelable: boolean;
  /** Board approval needs a version for every active board level (D-067). */
  levelsForApproval: boolean;
  /** Structured safety notes are required to leave draft (SPEC 9.3). */
  needsSafety: boolean;
  /** May be marked reviewed without a linked attente (D-067). */
  expectationsOptional: boolean;
  /**
   * May be marked sub-friendly. Experiments and STEM challenges also need
   * `supervision = 'standard'` (see `subFriendlyAllowed`).
   */
  subFriendlyAllowed: boolean;
  /**
   * Material a lesson uses (true for every type but the comment bank, D-129). A type that is not
   * has no duration, materials or formats to choose, and never goes into a lesson (`LXK01`),
   * class mode, the projector or a substitute plan.
   */
  teachingMaterial: boolean;
  /** The AI feature that writes this type (« Créer avec l'IA » or the bank's own, D-132). */
  aiGenerator: 'library_item' | 'report_comment_bank';
  defaultFormats: ItemFormats;
  /** Minutes; always within the AI request range (5–240). Null when not teaching material. */
  defaultDuration: number | null;
}

const PRINT: ItemFormats = { printable: true, projectable: false, interactive: false };
const PRINT_PROJECT: ItemFormats = { printable: true, projectable: true, interactive: false };
const PROJECT: ItemFormats = { printable: false, projectable: true, interactive: false };
const PLAY: ItemFormats = { printable: true, projectable: true, interactive: true };

interface Flags {
  keyed?: boolean;
  questions?: boolean;
  levelable?: boolean;
  levelsForApproval?: boolean;
  safety?: boolean;
  expectationsOptional?: boolean;
  neverSubFriendly?: boolean;
  teachingMaterial?: boolean;
  aiGenerator?: TypeInfo['aiGenerator'];
}

function info(
  bucket: LibraryBucket,
  labelFr: string,
  audience: TypeInfo['audience'],
  flags: Flags,
  defaultFormats: ItemFormats,
  defaultDuration: number | null,
): TypeInfo {
  const keyed = flags.keyed ?? false;
  return {
    bucket,
    labelFr,
    audience,
    keyed,
    mayHaveQuestions: keyed || (flags.questions ?? false),
    levelable: flags.levelable ?? false,
    levelsForApproval: flags.levelsForApproval ?? false,
    needsSafety: flags.safety ?? false,
    expectationsOptional: flags.expectationsOptional ?? false,
    subFriendlyAllowed: !(flags.neverSubFriendly ?? false),
    teachingMaterial: flags.teachingMaterial ?? true,
    aiGenerator: flags.aiGenerator ?? 'library_item',
    defaultFormats,
    defaultDuration,
  };
}

// Letters of the plan's type table: K keyed, Q questions, L levelable, A levels for approval,
// S safety, E attentes optional, ⊘ never sub-friendly; the comment bank is not teaching material.
export const TYPE_INFO: Record<LibraryItemType, TypeInfo> = {
  lesson_plan: info('enseigner', 'Plan de leçon', 'teacher', {}, PRINT, 60),
  anchor_chart: info('enseigner', 'Référentiel', 'student', { levelable: true }, PRINT_PROJECT, 20),
  worked_example: info(
    'enseigner',
    'Exemple résolu',
    'student',
    { questions: true, levelable: true },
    PRINT_PROJECT,
    20,
  ),
  teacher_guide: info(
    'enseigner',
    'Guide pédagogique',
    'teacher',
    { neverSubFriendly: true },
    PRINT,
    15,
  ),
  worksheet: info(
    'pratiquer',
    'Fiche d’exercices',
    'student',
    { questions: true, levelable: true, levelsForApproval: true },
    PRINT,
    30,
  ),
  learning_centre: info(
    'pratiquer',
    'Centre d’apprentissage',
    'student',
    { levelable: true },
    PRINT,
    30,
  ),
  reading_passage: info(
    'pratiquer',
    'Texte de lecture',
    'student',
    { questions: true, levelable: true, levelsForApproval: true },
    PRINT_PROJECT,
    30,
  ),
  vocabulary_bank: info(
    'pratiquer',
    'Banque de mots',
    'student',
    { levelable: true },
    PRINT_PROJECT,
    20,
  ),
  exit_ticket: info(
    'pratiquer',
    'Billet de sortie',
    'student',
    { keyed: true, levelable: true, levelsForApproval: true },
    PRINT,
    5,
  ),
  experiment: info(
    'explorer',
    'Expérience',
    'student',
    { questions: true, levelable: true, safety: true },
    PRINT,
    50,
  ),
  stem_challenge: info(
    'explorer',
    'Défi STIM',
    'student',
    { questions: true, levelable: true, safety: true },
    PRINT,
    60,
  ),
  project: info(
    'explorer',
    'Projet',
    'student',
    { levelable: true, neverSubFriendly: true },
    PRINT,
    240,
  ),
  outdoor_activity: info(
    'explorer',
    'Activité extérieure',
    'student',
    { levelable: true },
    PRINT,
    40,
  ),
  quiz: info(
    'evaluer',
    'Quiz',
    'student',
    { keyed: true, levelable: true, levelsForApproval: true },
    PLAY,
    20,
  ),
  unit_test: info(
    'evaluer',
    'Évaluation de fin d’unité',
    'student',
    { keyed: true, levelable: true, neverSubFriendly: true },
    PRINT,
    50,
  ),
  diagnostic: info(
    'evaluer',
    'Évaluation diagnostique',
    'student',
    { keyed: true, levelable: true, neverSubFriendly: true },
    PRINT,
    30,
  ),
  rubric: info('evaluer', 'Grille d’évaluation', 'student', { neverSubFriendly: true }, PRINT, 10),
  report_comments: info(
    'evaluer',
    'Banque de commentaires de bulletin',
    'teacher',
    {
      neverSubFriendly: true,
      expectationsOptional: true,
      teachingMaterial: false,
      aiGenerator: 'report_comment_bank',
    },
    PRINT,
    null,
  ),
  game: info('jouer', 'Jeu', 'student', { questions: true, levelable: true }, PLAY, 20),
  brain_break: info('jouer', 'Pause active', 'student', { expectationsOptional: true }, PROJECT, 5),
  song: info('jouer', 'Chanson', 'student', { expectationsOptional: true }, PRINT_PROJECT, 10),
  riddle: info('jouer', 'Devinettes', 'student', { keyed: true, levelable: true }, PLAY, 10),
  weekly_challenge: info(
    'jouer',
    'Défi de la semaine',
    'student',
    { questions: true, levelable: true },
    PRINT_PROJECT,
    15,
  ),
  catholic_reflection: info(
    'relier',
    'Réflexion catholique',
    'student',
    { levelable: true, expectationsOptional: true },
    PRINT_PROJECT,
    10,
  ),
  culture_hook: info(
    'relier',
    'Amorce culturelle',
    'student',
    { levelable: true, expectationsOptional: true },
    PRINT_PROJECT,
    15,
  ),
  parent_guide: info(
    'relier',
    'Guide pour les familles',
    'family',
    { neverSubFriendly: true },
    PRINT,
    10,
  ),
};

/** The types « Créer avec l'IA » writes (`library_item`): every type but the comment bank. */
export type LibraryItemAiType = Exclude<LibraryItemType, 'report_comments'>;

/**
 * The types whose AI generator is `library_item` (« Créer avec l'IA », bulk generation), in
 * catalogue order. A comment bank has its own request (D-132).
 */
export const LIBRARY_ITEM_AI_TYPES = LIBRARY_ITEM_TYPES.filter(
  (t): t is LibraryItemAiType => TYPE_INFO[t].aiGenerator === 'library_item',
) as unknown as readonly [LibraryItemAiType, ...LibraryItemAiType[]];

export function isLibraryItemAiType(value: unknown): value is LibraryItemAiType {
  return typeof value === 'string' && (LIBRARY_ITEM_AI_TYPES as readonly string[]).includes(value);
}

/** A type's default duration for an AI request (5–240 minutes): only « Créer avec l'IA » types. */
export function aiDefaultDuration(type: LibraryItemAiType): number {
  return Math.min(240, Math.max(5, TYPE_INFO[type].defaultDuration ?? 30));
}

export const BUCKET_LABELS_FR: Record<LibraryBucket, string> = {
  enseigner: 'Enseigner',
  pratiquer: 'Pratiquer',
  explorer: 'Explorer',
  evaluer: 'Évaluer',
  jouer: 'Jouer',
  relier: 'Relier',
};

export function bucketOf(type: LibraryItemType): LibraryBucket {
  return TYPE_INFO[type].bucket;
}

/** The types of a bucket, in catalogue order. */
export function typesOf(bucket: LibraryBucket): LibraryItemType[] {
  return LIBRARY_ITEM_TYPES.filter((t) => TYPE_INFO[t].bucket === bucket);
}

/**
 * Mirrors the `library_items_sub_friendly_allowed` constraint: the ⊘ types never, and
 * experiments and STEM challenges only under standard supervision.
 */
export function subFriendlyAllowed(type: LibraryItemType, safetyNotes: unknown): boolean {
  if (!TYPE_INFO[type].subFriendlyAllowed) return false;
  if (!TYPE_INFO[type].needsSafety) return true;
  return (
    typeof safetyNotes === 'object' &&
    safetyNotes !== null &&
    (safetyNotes as { supervision?: unknown }).supervision === 'standard'
  );
}
