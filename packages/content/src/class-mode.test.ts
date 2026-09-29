/**
 * Class mode (Phase 5 plan D.1, tests C1–C3): what can be presented or played on devices, the
 * projector's slides, the teams and the content language. The slides are checked the way the
 * student sheet is (render test 32): no teacher-only field, answer key or safety note may reach
 * a projected page, even when the content carries them where they don't belong.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIBRARY_ITEM_TYPES, TYPE_INFO, type LibraryItemType } from './catalog';
import {
  CLASS_TEAM_KEYS,
  CLASS_TEAMS,
  canPlayOnDevices,
  canPresent,
  contentLang,
  DEVICE_QUIZ_TYPES,
  PRESENT_KIND,
  presentSlides,
  TEAM_SHAPES,
  type PresentMeta,
  type Slide,
} from './class-mode';
import { studentContent } from './project';
import { mapQuestions, questionsOf } from './questions-of';
import { sampleCanonical } from './samples';
import { answerKeySchema } from './schemas';
import { seedItemSchema } from './seed-pack';
import { allKeys, KEY_SENTINEL, TEACHER_SENTINEL, withTeacherSentinels } from './test-fixtures';

const SAFETY_SENTINEL = 'SENTINELLE-SECURITE';

const meta: PresentMeta = {
  title: 'Titre de la ressource',
  materials: 'Une éponge par équipe.',
  durationMinutes: 20,
  lang: 'fr-CA',
};

const kinds = (slides: Slide[]) => slides.map((s) => s.kind);

/**
 * A sample with a sentinel in every teacher-only field, in every answer field a question or an
 * option could carry (`studentContent` keeps a question's other keys), in key-shaped fields at
 * the top, and in safety-note fields.
 */
function withSentinels(type: LibraryItemType): Record<string, unknown> {
  const tagOptions = (value: unknown) =>
    Array.isArray(value)
      ? value.map((o: Record<string, unknown>) => ({ ...o, correct: KEY_SENTINEL }))
      : value;
  const content = mapQuestions(type, withTeacherSentinels(type), (q) => ({
    ...q,
    category: TEACHER_SENTINEL,
    choices: tagOptions(q.choices),
    left: tagOptions(q.left),
    right: tagOptions(q.right),
    items: tagOptions(q.items),
    correctChoiceIds: [KEY_SENTINEL],
    correct: KEY_SENTINEL,
    pairs: [{ leftId: KEY_SENTINEL, rightId: KEY_SENTINEL }],
    orderedIds: [KEY_SENTINEL],
    sampleAnswer: KEY_SENTINEL,
    acceptableAnswers: [KEY_SENTINEL],
    explanation: KEY_SENTINEL,
    answer: KEY_SENTINEL,
  }));
  return {
    ...content,
    answers: [{ questionId: 'q1', kind: 'short_answer', explanation: KEY_SENTINEL }],
    answerKey: { answers: [], solution: KEY_SENTINEL },
    solution: KEY_SENTINEL,
    safetyNotes: { hazards: [SAFETY_SENTINEL], notes: SAFETY_SENTINEL },
    safety_notes: SAFETY_SENTINEL,
  };
}

const FORBIDDEN_KEYS = [
  'correctChoiceIds',
  'correct',
  'pairs',
  'orderedIds',
  'sampleAnswer',
  'acceptableAnswers',
  'explanation',
  'answers',
  'answerKey',
  'solution',
  'safetyNotes',
  'safety_notes',
  'teacherNote',
];

describe('class mode', () => {
  it('C1. only quizzes, and games with questions, can play on devices', () => {
    expect(PRESENT_KIND).toEqual({
      quiz: 'questions',
      exit_ticket: 'questions',
      game: 'rules',
      brain_break: 'steps',
      experiment: 'steps',
    });
    expect([...DEVICE_QUIZ_TYPES]).toEqual(['quiz', 'game']);

    const playable = LIBRARY_ITEM_TYPES.filter((type) =>
      canPlayOnDevices(type, sampleCanonical(type).content),
    );
    expect(playable).toEqual(['quiz', 'game']);

    // A game without its question bank, or a quiz whose questions are gone, can't.
    const game = sampleCanonical('game').content;
    expect(canPlayOnDevices('game', { ...game, questions: [] })).toBe(false);
    expect(canPlayOnDevices('quiz', { ...sampleCanonical('quiz').content, questions: [] })).toBe(
      false,
    );
    expect(canPlayOnDevices('quiz', null)).toBe(false);

    // Individual and paper assessments never can, whatever they hold.
    const quizQuestions = sampleCanonical('quiz').content.questions;
    for (const type of ['exit_ticket', 'unit_test', 'diagnostic'] as const) {
      const content = sampleCanonical(type).content;
      expect(questionsOf(type, content).length, type).toBeGreaterThan(0);
      expect(canPlayOnDevices(type, content), type).toBe(false);
      expect(canPlayOnDevices(type, { ...content, questions: quizQuestions }), type).toBe(false);
    }
  });

  it('C1b. the special players are presentable; other types only when projectable', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      const teacherOnly = TYPE_INFO[type].audience === 'teacher';
      expect(canPresent(type, true), type).toBe(!teacherOnly);
      expect(canPresent(type, false), type).toBe(PRESENT_KIND[type] !== undefined);
    }
    // An exit ticket can't be played on devices, but it can be presented.
    expect(canPresent('exit_ticket', false)).toBe(true);
    expect(canPresent('song', false)).toBe(false);
    expect(canPresent('song', true)).toBe(true);
    expect(canPresent('lesson_plan', true)).toBe(false);
  });

  it('C2. an experiment starts with safety, then materials, steps and its questions', () => {
    const { content } = sampleCanonical('experiment');
    const slides = presentSlides('experiment', content, meta);
    const steps = content.steps.length;
    const questions = content.conclusionQuestions.length;
    expect(kinds(slides)).toEqual([
      'title',
      'safety',
      'materials',
      ...Array<string>(steps).fill('step'),
      ...Array<string>(questions).fill('question'),
      'end',
    ]);
    // No reminder is written for students in an experiment: the player shows the generic one.
    expect(slides[1]).toEqual({ kind: 'safety', lang: 'fr-CA', reminders: [] });
    expect(slides[2]).toEqual({
      kind: 'materials',
      lang: 'fr-CA',
      paragraphs: ['Une éponge par équipe.'],
    });
    const title = slides[0]!;
    expect(title.kind === 'title' && title.intro).toEqual([
      content.researchQuestion,
      content.hypothesisPrompt,
    ]);
    // No materials, no materials slide; the safety slide stays.
    expect(
      kinds(presentSlides('experiment', content, { ...meta, materials: ' ' })).slice(0, 3),
    ).toEqual(['title', 'safety', 'step']);
  });

  it('C2b. the demo experiment never shows its safety notes', () => {
    const repo = new URL('../../../', import.meta.url);
    const file = new URL('content/library/demo/items/eponges-elastiques.json', repo);
    const item = seedItemSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    const base = item.versions[0]!;
    const slides = presentSlides(item.type, base.content, {
      title: item.title,
      materials: item.materials,
      durationMinutes: item.durationMinutes,
      lang: contentLang(item.subjectCode),
    });
    expect(kinds(slides).slice(0, 4)).toEqual(['title', 'safety', 'materials', 'step']);
    expect(slides.filter((s) => s.kind === 'step')).toHaveLength(9);
    expect(slides.filter((s) => s.kind === 'question')).toHaveLength(6);
    const json = JSON.stringify(slides);
    const notes = item.safetyNotes!;
    for (const text of [notes.allergyAwareMaterials, notes.notes, ...notes.hazards]) {
      expect(json).not.toContain(text);
    }
    const key = answerKeySchema('final').parse(base.answerKey);
    for (const entry of key.answers) {
      if (entry.explanation) expect(json).not.toContain(entry.explanation);
      if (entry.kind === 'short_answer') expect(json).not.toContain(entry.sampleAnswer);
    }
  });

  it('C2c. a brain break has one step per step, a game its rules then its questions', () => {
    const brainBreak = sampleCanonical('brain_break').content;
    const steps = presentSlides('brain_break', brainBreak, meta).filter((s) => s.kind === 'step');
    expect(steps).toEqual(
      brainBreak.steps.map((text, i) => ({
        kind: 'step',
        lang: 'fr-CA',
        number: i + 1,
        total: brainBreak.steps.length,
        text,
      })),
    );

    const game = sampleCanonical('game').content;
    const slides = presentSlides('game', game, meta);
    expect(kinds(slides)).toEqual([
      'title',
      'rules',
      ...Array<string>(game.questions.length).fill('question'),
      'end',
    ]);
    expect(slides[1]).toEqual({
      kind: 'rules',
      lang: 'fr-CA',
      grouping: game.grouping,
      rules: game.rules,
      howToWin: game.howToWin,
      variations: game.variations,
    });
    // The teacher's set-up is not a rule.
    expect(JSON.stringify(slides)).not.toContain(game.setup);
  });

  it('C2d. a quiz has one question per slide, with its choices and nothing else', () => {
    const quiz = sampleCanonical('quiz').content;
    const questions = presentSlides('quiz', quiz, meta).filter((s) => s.kind === 'question');
    expect(questions).toHaveLength(quiz.questions.length);
    questions.forEach((slide, i) => {
      if (slide.kind !== 'question') throw new Error('not a question');
      const source = quiz.questions[i]!;
      expect(slide.number).toBe(i + 1);
      expect(slide.total).toBe(quiz.questions.length);
      expect(slide.question.id).toBe(source.id);
      expect(slide.question.kind).toBe(source.kind);
      expect(Object.keys(slide.question).sort()).toEqual([
        'choices',
        'hint',
        'id',
        'items',
        'kind',
        'left',
        'multipleAnswers',
        'prompt',
        'right',
      ]);
      if (source.kind === 'multiple_choice') expect(slide.question.choices).toEqual(source.choices);
      if (source.kind === 'ordering') expect(slide.question.items).toEqual(source.items);
    });
    const title = presentSlides('quiz', { ...quiz, title: 'Mon quiz' }, meta)[0];
    expect(title).toMatchObject({ kind: 'title', title: 'Mon quiz', durationMinutes: 20 });
    expect(presentSlides('quiz', quiz, meta)[0]).toMatchObject({ title: meta.title });
  });

  it('C2e. a projectable song gives document slides, one verse per slide', () => {
    const song = sampleCanonical('song').content;
    const twoVerses = { ...song, verses: [...song.verses, { label: 'Couplet 2', lines: ['Ho!'] }] };
    const slides = presentSlides('song', twoVerses, meta);
    expect(kinds(slides)).toEqual(['title', 'document', 'document', 'document', 'end']);
    const poems = slides.flatMap((s) =>
      s.kind === 'document' ? s.blocks.filter((b) => b.type === 'poem') : [],
    );
    expect(poems.map((p) => p.type === 'poem' && p.title)).toEqual(['Couplet 1', 'Couplet 2']);
    // Gestures are the teacher's.
    expect(JSON.stringify(slides)).not.toContain(song.gestures[0]);

    // A family guide keeps each language half on a slide of its own.
    const guide = presentSlides('parent_guide', sampleCanonical('parent_guide').content, meta);
    const sections = guide.flatMap((s) =>
      s.kind === 'document' ? s.blocks.filter((b) => b.type === 'section') : [],
    );
    expect(sections.map((s) => s.type === 'section' && s.lang)).toEqual(['fr-CA', 'en-CA']);
  });

  it('C2f. no slide holds a key, a teacher-only field or a safety note, for every type', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      const content = withSentinels(type);
      const slides = presentSlides(type, content, meta);
      if (TYPE_INFO[type].audience === 'teacher') {
        expect(slides, type).toEqual([]);
        continue;
      }
      // The student content still carries the answers planted in questions: only the slides'
      // whitelist keeps them off the projector.
      if (questionsOf(type, content).length) {
        expect(JSON.stringify(studentContent(type, content)), type).toContain(KEY_SENTINEL);
      }
      expect(kinds(slides)[0], type).toBe('title');
      expect(kinds(slides).at(-1), type).toBe('end');
      expect(slides.length, type).toBeGreaterThan(2);
      const json = JSON.stringify(slides);
      expect(json, type).not.toContain(TEACHER_SENTINEL);
      expect(json, type).not.toContain(KEY_SENTINEL);
      expect(json, type).not.toContain(SAFETY_SENTINEL);
      const keys = allKeys(slides);
      expect(
        FORBIDDEN_KEYS.filter((k) => keys.has(k)),
        type,
      ).toEqual([]);
      // Answers from the sample key never appear either.
      const { answerKey } = sampleCanonical(type);
      for (const entry of answerKey?.answers ?? []) {
        if (entry.explanation) expect(json, type).not.toContain(entry.explanation);
        if (entry.kind === 'short_answer' && entry.sampleAnswer) {
          expect(json, type).not.toContain(entry.sampleAnswer);
        }
      }
      if (answerKey?.solution) expect(json, type).not.toContain(answerKey.solution);
      // Projecting first changes nothing: the slides come from the student content only.
      expect(presentSlides(type, studentContent(type, content), meta), type).toEqual(slides);
    }
  });

  it('C3. teams have unique keys, shapes and colours; Anglais content is English', () => {
    expect(CLASS_TEAMS.map((t) => t.key)).toEqual([...CLASS_TEAM_KEYS]);
    expect(CLASS_TEAM_KEYS).toEqual(['huards', 'castors', 'orignaux', 'ours', 'loups', 'renards']);
    for (const field of ['key', 'shape', 'colorToken'] as const) {
      expect(new Set(CLASS_TEAMS.map((t) => t[field])).size, field).toBe(6);
    }
    expect(CLASS_TEAMS.map((t) => t.shape).sort()).toEqual([...TEAM_SHAPES].sort());
    for (const team of CLASS_TEAMS) expect(team.colorToken).toMatch(/^team-[a-z]+$/);

    expect(contentLang('ang')).toBe('en-CA');
    expect(contentLang('fra')).toBe('fr-CA');
    expect(contentLang('mat')).toBe('fr-CA');
    expect(contentLang(null)).toBe('fr-CA');
    expect(
      presentSlides('quiz', sampleCanonical('quiz').content, { ...meta, lang: 'en-CA' }),
    ).toSatisfy((slides: Slide[]) => slides.every((s) => s.lang === 'en-CA'));
  });
});
