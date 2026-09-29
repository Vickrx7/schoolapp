/**
 * How the generic editor shows each type's content (« Contenu »), field by field, and which
 * fields are for the teacher only (`studentContent` removes those). A test keeps this in step
 * with the schemas: every schema key has an entry, and every entry a schema key.
 */
import { z } from 'zod';
import { LIBRARY_ITEM_TYPES, TYPE_INFO, type LibraryItemType } from './catalog';
import { ACHIEVEMENT_CATEGORIES } from './questions';
import { contentObject } from './schemas';
import { DESIGN_STAGES } from './types/explorer';
import { BRAIN_BREAK_SPACES } from './types/jouer';
import { GRAMMATICAL_GENDERS, WORD_CLASSES } from './types/pratiquer';

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'boolean'
  | 'stringList'
  | 'objectList'
  | 'object'
  | 'questions'
  | 'rubric';

export type FieldAudience = 'student' | 'teacher';

export interface FieldSpec {
  /** The key in the parent object. */
  path: string;
  kind: FieldKind;
  /** `libraryEdit.content.<key>`, nested keys joined with dots (`content.sections.title`). */
  labelKey: string;
  /** `teacher`: never on the student sheet. */
  audience: FieldAudience;
  /** Nested fields of an `object`, or of each element of an `objectList` or `rubric`. */
  fields?: FieldSpec[];
  /** `select` values; labels are `libraryCommon.<optionsKey>.<value>`. */
  options?: readonly string[];
  optionsKey?: string;
  /** A `number`, `select` or `object` that may be left empty (null). */
  nullable?: boolean;
  /** Riddles: short answers only. */
  shortAnswerOnly?: boolean;
  /** The language of the text typed in this field and below (family guide halves). */
  lang?: 'fr-CA' | 'en-CA';
  /** Maximum characters of a text field (from the schema). */
  maxLength?: number;
}

type Draft = Omit<FieldSpec, 'labelKey' | 'fields' | 'maxLength'> & { fields?: Draft[] };
type Options = Partial<Omit<Draft, 'path' | 'kind'>>;

const field =
  (kind: FieldKind) =>
  (path: string, options: Options = {}): Draft => ({
    path,
    kind,
    audience: 'student',
    ...options,
  });
const text = field('text');
const textarea = field('textarea');
const number = field('number');
const strings = field('stringList');
const questions = field('questions');
const select = (path: string, values: readonly string[], optionsKey: string, o: Options = {}) =>
  field('select')(path, { options: values, optionsKey, ...o });
const objects = (path: string, fields: Draft[], o: Options = {}) =>
  field('objectList')(path, { fields, ...o });
const object = (path: string, fields: Draft[], o: Options = {}) =>
  field('object')(path, { fields, ...o });
const teacher: Options = { audience: 'teacher' };

const common = (): Draft[] => [
  text('title'),
  textarea('objective'),
  textarea('teacherNote', teacher),
];
const steps = () => [
  number('minutes', { nullable: true }),
  textarea('instruction'),
  textarea('say'),
];
const glossary = (path: string, o: Options = {}) =>
  objects(path, [text('term'), textarea('definition')], o);
const familyPart = (path: string, lang: 'fr-CA' | 'en-CA') =>
  object(path, [textarea('intro'), strings('learning'), strings('atHome'), glossary('words')], {
    lang,
  });

const SPECS: Record<LibraryItemType, Draft[]> = {
  lesson_plan: [
    ...common(),
    strings('successCriteria'),
    objects('opening', steps()),
    objects('development', steps()),
    objects('closing', steps()),
    textarea('differentiation'),
    textarea('assessment'),
    textarea('subNotes'),
  ],
  anchor_chart: [
    ...common(),
    text('heading'),
    objects('sections', [text('title'), strings('points'), textarea('example')]),
    strings('visualIdeas', teacher),
  ],
  worked_example: [
    ...common(),
    textarea('problem'),
    objects('steps', [textarea('explanation'), textarea('work')]),
    textarea('answer'),
    questions('practice'),
  ],
  teacher_guide: [
    ...common(),
    textarea('bigIdea'),
    textarea('background'),
    glossary('keyVocabulary'),
    objects('misconceptions', [textarea('misconception'), textarea('response')]),
    strings('teachingTips'),
    strings('lookFors'),
  ],
  worksheet: [
    ...common(),
    textarea('instructions'),
    textarea('text'),
    glossary('glossary'),
    questions('questions'),
    strings('visualSupports', teacher),
  ],
  learning_centre: [
    ...common(),
    textarea('setup', teacher),
    text('groupSize'),
    strings('studentSteps'),
    textarea('extension'),
    textarea('cleanup'),
  ],
  reading_passage: [
    ...common(),
    textarea('text'),
    glossary('glossary'),
    questions('questions'),
    strings('visualSupports', teacher),
  ],
  vocabulary_bank: [
    ...common(),
    text('theme'),
    objects('words', [
      text('term'),
      textarea('definition'),
      text('example'),
      select('wordClass', WORD_CLASSES, 'wordClasses', { nullable: true }),
      select('gender', GRAMMATICAL_GENDERS, 'genders', { nullable: true }),
    ]),
    strings('activityIdeas', teacher),
  ],
  exit_ticket: [...common(), text('prompt'), questions('questions')],
  experiment: [
    ...common(),
    textarea('researchQuestion'),
    text('hypothesisPrompt'),
    strings('steps'),
    object('observationTable', [strings('columns'), number('rows')], { nullable: true }),
    questions('conclusionQuestions'),
    textarea('communication'),
  ],
  stem_challenge: [
    ...common(),
    textarea('challenge'),
    strings('constraints'),
    strings('criteria'),
    objects('designStages', [select('stage', DESIGN_STAGES, 'designStages'), textarea('prompt')]),
    questions('reflectionQuestions'),
  ],
  project: [
    ...common(),
    textarea('drivingQuestion'),
    textarea('overview'),
    objects('milestones', [
      text('title'),
      textarea('description'),
      number('sessions', { nullable: true }),
    ]),
    strings('deliverables'),
    strings('successCriteria'),
  ],
  outdoor_activity: [
    ...common(),
    text('location'),
    textarea('setup', teacher),
    strings('steps'),
    strings('safetyReminders'),
    textarea('weatherAlternative', teacher),
  ],
  quiz: [...common(), textarea('instructions'), questions('questions')],
  unit_test: [
    ...common(),
    textarea('instructions'),
    objects('sections', [text('title'), questions('questions')]),
  ],
  diagnostic: [
    ...common(),
    textarea('purpose', teacher),
    questions('questions'),
    objects('interpretation', [textarea('signal'), textarea('nextStep')], teacher),
  ],
  rubric: [
    ...common(),
    textarea('task'),
    field('rubric')('criteria', {
      fields: [
        select('category', ACHIEVEMENT_CATEGORIES, 'categories'),
        text('criterion'),
        object('levels', [
          textarea('level1'),
          textarea('level2'),
          textarea('level3'),
          textarea('level4'),
        ]),
      ],
    }),
  ],
  game: [
    ...common(),
    text('grouping'),
    textarea('setup', teacher),
    strings('rules'),
    textarea('howToWin'),
    strings('variations'),
    questions('questions'),
  ],
  brain_break: [
    ...common(),
    select('space', BRAIN_BREAK_SPACES, 'spaces'),
    strings('steps'),
    textarea('calmVariant', teacher),
  ],
  song: [
    ...common(),
    text('tune'),
    objects('verses', [text('label'), strings('lines')]),
    strings('gestures', teacher),
  ],
  riddle: [...common(), questions('riddles', { shortAnswerOnly: true })],
  weekly_challenge: [
    ...common(),
    textarea('challenge'),
    objects('days', [text('label'), textarea('task')]),
    strings('hints'),
    textarea('extension'),
  ],
  catholic_reflection: [
    ...common(),
    text('theme'),
    text('scriptureReference'),
    textarea('reflection'),
    strings('questions'),
    textarea('prayer'),
    textarea('action'),
  ],
  culture_hook: [
    ...common(),
    textarea('hook'),
    textarea('context'),
    strings('discussionQuestions'),
    textarea('activity'),
    strings('factsToVerify', teacher),
  ],
  parent_guide: [...common(), familyPart('fr', 'fr-CA'), familyPart('en', 'en-CA')],
};

/** The object schema of a field's elements (or of the field itself for an object). */
function innerObject(schema: z.ZodType | undefined): z.ZodObject | undefined {
  let s: unknown = schema;
  while (s instanceof z.ZodNullable || s instanceof z.ZodArray) {
    s = s instanceof z.ZodNullable ? s.unwrap() : s.element;
  }
  return s instanceof z.ZodObject ? s : undefined;
}

function finish(
  drafts: Draft[],
  schema: z.ZodObject | undefined,
  prefix: string,
  audience: FieldAudience | null,
): FieldSpec[] {
  const shape = (schema?.shape ?? {}) as Record<string, z.ZodType>;
  return drafts.map((d) => {
    const labelKey = `${prefix}.${d.path}`;
    const fieldSchema = shape[d.path];
    const plain =
      fieldSchema instanceof z.ZodNullable ? (fieldSchema.unwrap() as z.ZodType) : fieldSchema;
    const { fields, ...rest } = d;
    const own = audience ?? rest.audience;
    const spec: FieldSpec = { ...rest, labelKey, audience: own };
    if (plain instanceof z.ZodString && plain.maxLength !== null) spec.maxLength = plain.maxLength;
    // The fields inside a teacher-only field are teacher-only too.
    if (fields) {
      spec.fields = finish(
        fields,
        innerObject(fieldSchema),
        labelKey,
        own === 'teacher' ? own : null,
      );
    }
    return spec;
  });
}

/** The editor spec of every type. Teacher-only types have every field `teacher`. */
export const EDITOR_SPEC: Record<LibraryItemType, FieldSpec[]> = Object.fromEntries(
  LIBRARY_ITEM_TYPES.map((type) => [
    type,
    finish(
      SPECS[type],
      contentObject(type, 'draft'),
      'content',
      TYPE_INFO[type].audience === 'teacher' ? 'teacher' : null,
    ),
  ]),
) as Record<LibraryItemType, FieldSpec[]>;

/** Label of `answerKey.solution` for the types that may have one. */
export function solutionLabelKey(type: LibraryItemType): string | null {
  if (!TYPE_INFO[type].mayHaveQuestions) return null;
  if (type === 'experiment') return 'content.solution.experiment';
  if (type === 'weekly_challenge' || type === 'stem_challenge') return 'content.solution.challenge';
  return 'content.solution.default';
}
