/**
 * Class mode (« Mode classe », DECISIONS D-082, D-086, D-088 and D-090): what can be presented
 * on the projector or played on student devices, the projector's slides, the fixed teams and
 * the language of the content.
 *
 * Slides are built from `studentContent` only, and questions are copied through a whitelist (the
 * fields the device snapshot also keeps), so no answer key, teacher-only field or safety note
 * reaches a projected page: `safety_notes` are the teacher's and can name a child's allergy.
 * Nothing here grades anything; class mode grades in SQL only.
 */
import { TYPE_INFO, type LibraryItemType } from './catalog';
import { isPlainObject } from './conform';
import { studentContent, type StudentContent } from './project';
import { isQuestionKind, type ChoiceOption, type QuestionKind } from './questions';
import { questionsOf } from './questions-of';
import { optionsOf, paragraphsOf, str, strings } from './render/builder';
import { renderContentBlocks } from './render/content';
import type { DocBlock, DocLang } from './render/doc';

// ---------------------------------------------------------------------------------------
// What can be presented or played
// ---------------------------------------------------------------------------------------

/**
 * The special players of « Présenter à la classe ». Any other item marked projectable is shown
 * as its student document, one section per slide.
 */
export type PresentKind = 'questions' | 'steps' | 'rules';

export const PRESENT_KIND: Partial<Record<LibraryItemType, PresentKind>> = {
  quiz: 'questions',
  exit_ticket: 'questions',
  // Rules, then the question bank when it has one.
  game: 'rules',
  brain_break: 'steps',
  // Steps, then the conclusion questions.
  experiment: 'steps',
};

/**
 * The types « Quiz sur les appareils » can play (D-082): unit tests and diagnostics are individual
 * and on paper, and an exit ticket must show who needs help, which anonymous play cannot.
 */
export const DEVICE_QUIZ_TYPES = ['quiz', 'game'] as const satisfies readonly LibraryItemType[];

/**
 * « Présenter à la classe »: the special players, and any item marked projectable. Teacher-only
 * types have no student content, so they are never presented.
 */
export function canPresent(type: LibraryItemType, isProjectable: boolean): boolean {
  if (TYPE_INFO[type].audience === 'teacher') return false;
  return PRESENT_KIND[type] !== undefined || isProjectable;
}

/**
 * « Lancer un quiz sur les appareils »: a quiz or a game with at least one question. A hint for
 * the UI only; `start_class_session` decides.
 */
export function canPlayOnDevices(type: LibraryItemType, content: unknown): boolean {
  if (!(DEVICE_QUIZ_TYPES as readonly LibraryItemType[]).includes(type)) return false;
  return questionsOf(type, content).some(({ question }) => isQuestionKind(question.kind));
}

// ---------------------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------------------

/** A question as the projector shows it: the whitelist of the device snapshot (D-086). */
export interface SlideQuestion {
  /** For « Afficher la réponse », which fetches this question's answer only. */
  id: string;
  kind: QuestionKind;
  prompt: string;
  hint: string;
  /** Multiple choice. */
  choices: ChoiceOption[];
  multipleAnswers: boolean;
  /** Matching: the left column, and the right column in display order. */
  left: ChoiceOption[];
  right: ChoiceOption[];
  /** Ordering: display order, never the answer order. */
  items: ChoiceOption[];
}

/**
 * One projected slide. Every slide carries the content language (`lang` attribute); headings
 * such as « Sécurité », « Matériel » or « Étape 2 sur 6 » are screen labels (`classPresenter`).
 */
export type Slide =
  | {
      kind: 'title';
      lang: DocLang;
      title: string;
      /** « Intention d’apprentissage »; may be empty. */
      objective: string;
      /** The opening text of the type: instructions, prompt, research question… */
      intro: string[];
      durationMinutes: number | null;
    }
  | {
      kind: 'safety';
      lang: DocLang;
      /**
       * The safety reminders written for students in the student content. Empty: the player
       * shows the generic reminder (`classPresenter.safetyGeneric`). Never the item's safety
       * notes.
       */
      reminders: string[];
    }
  | { kind: 'materials'; lang: DocLang; paragraphs: string[] }
  | { kind: 'step'; lang: DocLang; number: number; total: number; text: string }
  | {
      kind: 'rules';
      lang: DocLang;
      grouping: string;
      /** « Déroulement ». */
      rules: string[];
      /** « Pour gagner ». */
      howToWin: string;
      variations: string[];
    }
  | { kind: 'question'; lang: DocLang; number: number; total: number; question: SlideQuestion }
  /** A section of the student document, in large type. */
  | { kind: 'document'; lang: DocLang; blocks: DocBlock[] }
  | { kind: 'end'; lang: DocLang };

export type SlideKind = Slide['kind'];

export interface PresentMeta {
  /** The item's title, used when the version has no title of its own. */
  title: string;
  /** The item's materials (`library_items.materials`), shown before an experiment's steps. */
  materials: string | null;
  durationMinutes: number | null;
  /** The content language: `contentLang(subjectCode)`. */
  lang: DocLang;
}

/** Content fields opening the title slide, per type. */
const INTRO_FIELDS: Partial<Record<LibraryItemType, readonly string[]>> = {
  quiz: ['instructions'],
  exit_ticket: ['prompt'],
  experiment: ['researchQuestion', 'hypothesisPrompt'],
};

function slideQuestion(raw: Record<string, unknown>): SlideQuestion | null {
  const kind = raw.kind;
  if (!isQuestionKind(kind)) return null;
  return {
    id: str(raw.id),
    kind,
    prompt: str(raw.prompt),
    hint: str(raw.hint),
    choices: kind === 'multiple_choice' ? optionsOf(raw.choices) : [],
    multipleAnswers: kind === 'multiple_choice' && raw.multipleAnswers === true,
    left: kind === 'matching' ? optionsOf(raw.left) : [],
    right: kind === 'matching' ? optionsOf(raw.right) : [],
    items: kind === 'ordering' ? optionsOf(raw.items) : [],
  };
}

function questionSlides(type: LibraryItemType, student: StudentContent, lang: DocLang): Slide[] {
  const questions = questionsOf(type, student).flatMap(({ question }) => {
    const slide = isPlainObject(question) ? slideQuestion(question) : null;
    return slide ? [slide] : [];
  });
  return questions.map((question, i) => ({
    kind: 'question',
    lang,
    number: i + 1,
    total: questions.length,
    question,
  }));
}

function stepSlides(student: StudentContent, lang: DocLang): Slide[] {
  const steps = strings(student.steps);
  return steps.map((text, i) => ({ kind: 'step', lang, number: i + 1, total: steps.length, text }));
}

/**
 * The student document, one section per slide: a heading starts a new slide, and each
 * question, verse or language half (family guide) gets a slide of its own, with the headings
 * just before it.
 */
function documentSlides(type: LibraryItemType, student: StudentContent, lang: DocLang): Slide[] {
  const slides: Slide[] = [];
  let current: DocBlock[] = [];
  const flush = () => {
    if (current.length) slides.push({ kind: 'document', lang, blocks: current });
    current = [];
  };
  for (const block of renderContentBlocks(type, student, 'student')) {
    const onlyHeadings = current.every((b) => b.type === 'heading');
    if (block.type === 'heading') {
      if (!onlyHeadings) flush();
      current.push(block);
    } else if (block.type === 'question' || block.type === 'poem' || block.type === 'section') {
      if (!onlyHeadings) flush();
      current.push(block);
      flush();
    } else {
      current.push(block);
    }
  }
  flush();
  return slides;
}

/**
 * The slides of « Présenter à la classe ». `content` is a version's content or its
 * `studentContent`: it is projected again here, so a caller can never pass a teacher-only field
 * through. Answer keys and safety notes are not arguments. Empty for teacher-only types.
 *
 * - Every presentation opens with a `title` slide and closes with an `end` slide.
 * - Types that need safety notes (experiments, STEM challenges) show `safety` right after the
 *   title. An experiment then shows `materials`, one `step` per step and its conclusion
 *   questions.
 * - Brain breaks: one `step` per step. Games: `rules`, then their questions. Quizzes and exit
 *   tickets: one `question` per question.
 * - Any other type: its student document as `document` slides.
 */
export function presentSlides(type: LibraryItemType, content: unknown, meta: PresentMeta): Slide[] {
  const student = studentContent(type, content);
  if (!student) return [];
  const { lang } = meta;
  const intro = (INTRO_FIELDS[type] ?? []).flatMap((field) => paragraphsOf(str(student[field])));
  const slides: Slide[] = [
    {
      kind: 'title',
      lang,
      title: str(student.title) || meta.title.trim(),
      objective: str(student.objective),
      intro,
      durationMinutes: meta.durationMinutes,
    },
  ];
  if (TYPE_INFO[type].needsSafety) {
    slides.push({ kind: 'safety', lang, reminders: strings(student.safetyReminders) });
  }
  switch (PRESENT_KIND[type]) {
    case 'questions':
      slides.push(...questionSlides(type, student, lang));
      break;
    case 'steps': {
      const materials = paragraphsOf(str(meta.materials));
      if (type === 'experiment' && materials.length) {
        slides.push({ kind: 'materials', lang, paragraphs: materials });
      }
      slides.push(...stepSlides(student, lang), ...questionSlides(type, student, lang));
      break;
    }
    case 'rules':
      slides.push({
        kind: 'rules',
        lang,
        grouping: str(student.grouping),
        rules: strings(student.rules),
        howToWin: str(student.howToWin),
        variations: strings(student.variations),
      });
      slides.push(...questionSlides(type, student, lang));
      break;
    default:
      slides.push(...documentSlides(type, student, lang));
  }
  slides.push({ kind: 'end', lang });
  return slides;
}

// ---------------------------------------------------------------------------------------
// Teams and language
// ---------------------------------------------------------------------------------------

export const TEAM_SHAPES = ['circle', 'triangle', 'square', 'diamond', 'star', 'hexagon'] as const;
export type TeamShape = (typeof TEAM_SHAPES)[number];

/**
 * The fixed team names (D-088): `session_participants.team` and `classMode.teams.<key>`
 * (« Les Huards »…). Same order as `app.class_team_keys`, which uses the first `team_count`.
 */
export const CLASS_TEAM_KEYS = [
  'huards',
  'castors',
  'orignaux',
  'ours',
  'loups',
  'renards',
] as const;
export type ClassTeamKey = (typeof CLASS_TEAM_KEYS)[number];

export interface ClassTeam {
  key: ClassTeamKey;
  /** The web app's colour token (`--color-<token>`); always shown with the shape (D-090). */
  colorToken: string;
  shape: TeamShape;
}

export const CLASS_TEAMS: readonly ClassTeam[] = [
  { key: 'huards', colorToken: 'team-blue', shape: 'circle' },
  { key: 'castors', colorToken: 'team-orange', shape: 'triangle' },
  { key: 'orignaux', colorToken: 'team-green', shape: 'square' },
  { key: 'ours', colorToken: 'team-purple', shape: 'diamond' },
  { key: 'loups', colorToken: 'team-slate', shape: 'star' },
  { key: 'renards', colorToken: 'team-red', shape: 'hexagon' },
];

/** The language of a subject's content (D-090): Anglais is `en-CA`, everything else `fr-CA`. */
export function contentLang(subjectCode: string | null | undefined): DocLang {
  return subjectCode === 'ang' ? 'en-CA' : 'fr-CA';
}
