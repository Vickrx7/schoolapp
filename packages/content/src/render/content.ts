/**
 * The body of each type's document (internal). One renderer per type serves both audiences:
 * student documents are rendered from `studentContent`, so teacher-only fields are not there to
 * render, and the builder's teacher methods do nothing for students anyway. Question lists are
 * rendered in `QUESTION_LISTS` order, so numbers match the answer key.
 */
import type { LibraryItemType } from '../catalog';
import { guillemets } from '../style';
import {
  LEARNING_SKILL_RATINGS,
  LEARNING_SKILLS,
  PROGRESS_MARKS,
  REPORT_ENTRY_KINDS,
} from '../types/report-comments';
import { DocBuilder, records, str, strings, type Audience } from './builder';
import type { LeafBlock } from './doc';
import {
  CATEGORY_LABELS_FR,
  DESIGN_STAGE_LABELS_FR,
  DOC_LABELS_FR as L,
  FAMILY_LABELS,
  GENDER_LABELS_FR,
  labelled,
  LEARNING_SKILL_LABELS_FR,
  LEARNING_SKILL_RATING_LABELS_FR,
  lessonPhaseLabels,
  PROGRESS_MARK_LABELS_FR,
  REPORT_BANK_PERIOD_LABELS_FR,
  REPORT_BANK_SCOPE_LABELS_FR,
  REPORT_ENTRY_KIND_LABELS_FR,
  SPACE_LABELS_FR,
  WORD_CLASS_LABELS_FR,
} from './labels-fr';

export interface RenderContext {
  /** For lesson phase labels (`mat`: « Mise en train / Exploration / Objectivation »). */
  subjectCode?: string | null;
}

type C = Record<string, unknown>;
type Renderer = (c: C, r: DocBuilder, ctx: RenderContext) => void;

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function lessonSteps(value: unknown) {
  return records(value).map((s) => ({
    text: str(s.instruction),
    minutes: num(s.minutes),
    detail: str(s.say) ? labelled(L.say, guillemets(str(s.say))) : '',
  }));
}

const rank = (values: readonly string[], value: unknown) => {
  const i = values.indexOf(str(value));
  return i < 0 ? values.length : i;
};

/** « Niveau 3 · Communication : … », with the feminine and masculine texts on their own lines. */
function commentEntryText(e: C): string {
  const marks = [
    num(e.level) !== null ? L.level(num(e.level)!) : '',
    PROGRESS_MARK_LABELS_FR[str(e.progress) as keyof typeof PROGRESS_MARK_LABELS_FR] ?? '',
    LEARNING_SKILL_RATING_LABELS_FR[
      str(e.rating) as keyof typeof LEARNING_SKILL_RATING_LABELS_FR
    ] ?? '',
    CATEGORY_LABELS_FR[str(e.category) as keyof typeof CATEGORY_LABELS_FR] ?? '',
  ].filter(Boolean);
  const lines = [marks.length ? labelled(marks.join(' · '), str(e.neutral)) : str(e.neutral)];
  if (str(e.feminine)) lines.push(labelled(L.feminine, str(e.feminine)));
  if (str(e.masculine)) lines.push(labelled(L.masculine, str(e.masculine)));
  return lines.join('\n');
}

/** Entries by kind (« Points forts », « Prochaines étapes », « Commentaires »), then by mark. */
function commentEntriesByKind(entries: C[], r: DocBuilder): void {
  for (const kind of REPORT_ENTRY_KINDS) {
    const ofKind = entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => str(e.kind) === kind && str(e.neutral))
      .sort(
        (a, b) =>
          (num(a.e.level) ?? 0) - (num(b.e.level) ?? 0) ||
          rank(PROGRESS_MARKS, a.e.progress) - rank(PROGRESS_MARKS, b.e.progress) ||
          rank(LEARNING_SKILL_RATINGS, a.e.rating) - rank(LEARNING_SKILL_RATINGS, b.e.rating) ||
          a.i - b.i,
      );
    if (!ofKind.length) continue;
    r.heading(REPORT_ENTRY_KIND_LABELS_FR[kind], 3);
    r.list(ofKind.map(({ e }) => commentEntryText(e)));
  }
}

const RENDERERS: Record<LibraryItemType, Renderer> = {
  lesson_plan(c, r, ctx) {
    const phases = lessonPhaseLabels(ctx.subjectCode);
    r.list(c.successCriteria, L.successCriteria);
    r.steps(lessonSteps(c.opening), phases.opening);
    r.steps(lessonSteps(c.development), phases.development);
    r.steps(lessonSteps(c.closing), phases.closing);
    r.text(c.differentiation, L.differentiation);
    r.text(c.assessment, L.assessment);
    r.teacherText(L.subNotes, c.subNotes);
  },
  anchor_chart(c, r) {
    r.heading(c.heading, 2);
    for (const section of records(c.sections)) {
      r.heading(section.title, 3);
      r.list(section.points);
      r.line(L.example, section.example);
    }
    r.teacherList(L.visualIdeas, c.visualIdeas);
  },
  worked_example(c, r) {
    r.text(c.problem, L.problem);
    r.steps(
      records(c.steps).map((s) => ({
        text: str(s.explanation),
        minutes: null,
        detail: str(s.work),
      })),
      L.solutionSteps,
    );
    r.line(L.answer, c.answer);
    r.questions(c.practice, L.practice);
  },
  teacher_guide(c, r) {
    r.text(c.bigIdea, L.bigIdea);
    r.text(c.background, L.background);
    r.glossary(c.keyVocabulary, L.keyVocabulary);
    const misconceptions = records(c.misconceptions).map((m) => [
      str(m.misconception),
      str(m.response),
    ]);
    if (misconceptions.length) {
      r.heading(L.misconceptions);
      r.table(L.misconceptions, [L.misconception, L.response], misconceptions);
    }
    r.list(c.teachingTips, L.teachingTips);
    r.list(c.lookFors, L.lookFors);
  },
  worksheet(c, r) {
    r.text(c.instructions, L.instructions);
    r.text(c.text);
    r.glossary(c.glossary);
    r.questions(c.questions, L.questions);
    r.teacherList(L.visualSupports, c.visualSupports);
  },
  learning_centre(c, r) {
    r.teacherText(L.setup, c.setup);
    r.line(L.groupSize, c.groupSize);
    r.list(c.studentSteps, L.studentSteps, true);
    r.text(c.extension, L.extension);
    r.text(c.cleanup, L.cleanup);
  },
  reading_passage(c, r) {
    r.text(c.text);
    r.glossary(c.glossary);
    r.questions(c.questions, L.questions);
    r.teacherList(L.visualSupports, c.visualSupports);
  },
  vocabulary_bank(c, r) {
    r.heading(c.theme, 2);
    const rows = records(c.words).map((w) => {
      const wordClass = WORD_CLASS_LABELS_FR[str(w.wordClass)] ?? str(w.wordClass);
      const gender = GENDER_LABELS_FR[str(w.gender)] ?? str(w.gender);
      return [
        str(w.term),
        gender ? `${wordClass} (${gender})`.trim() : wordClass,
        str(w.definition),
        str(w.example),
      ];
    });
    r.table(str(c.theme), [L.word, L.wordClass, L.definition, L.example], rows);
    r.teacherList(L.activityIdeas, c.activityIdeas);
  },
  exit_ticket(c, r) {
    r.text(c.prompt);
    r.questions(c.questions);
  },
  experiment(c, r) {
    r.text(c.researchQuestion, L.researchQuestion);
    if (str(c.hypothesisPrompt)) {
      r.heading(L.hypothesis);
      r.text(c.hypothesisPrompt);
      if (!r.forTeacher) r.lines(3);
    }
    r.list(c.steps, L.procedure, true);
    const table = c.observationTable as C | null | undefined;
    if (table) {
      const columns = strings(table.columns);
      const rows = Math.min(12, Math.max(1, num(table.rows) ?? 3));
      if (columns.length) {
        r.heading(L.observations);
        r.table(
          L.observations,
          columns,
          Array.from({ length: rows }, () => columns.map(() => '')),
        );
      }
    }
    r.questions(c.conclusionQuestions, L.conclusion);
    r.text(c.communication, L.communication);
  },
  stem_challenge(c, r) {
    r.text(c.challenge, L.challenge);
    r.list(c.constraints, L.constraints);
    r.list(c.criteria, L.criteria);
    r.steps(
      records(c.designStages).map((s) => ({
        text: labelled(DESIGN_STAGE_LABELS_FR[str(s.stage)] ?? str(s.stage), str(s.prompt)),
        minutes: null,
        detail: '',
      })),
      L.designProcess,
    );
    r.questions(c.reflectionQuestions, L.reflection);
  },
  project(c, r) {
    r.text(c.drivingQuestion, L.drivingQuestion);
    r.text(c.overview, L.overview);
    r.steps(
      records(c.milestones).map((m) => ({
        text: str(m.title) ? labelled(str(m.title), str(m.description)) : str(m.description),
        minutes: null,
        detail: num(m.sessions) ? L.sessions(num(m.sessions)!) : '',
      })),
      L.milestones,
    );
    r.list(c.deliverables, L.deliverables);
    r.list(c.successCriteria, L.successCriteria);
  },
  outdoor_activity(c, r) {
    r.line(L.location, c.location);
    r.teacherText(L.setup, c.setup);
    r.list(c.steps, L.steps, true);
    r.callout('safety', L.safetyReminders, '', c.safetyReminders);
    r.teacherText(L.weatherAlternative, c.weatherAlternative);
  },
  quiz(c, r) {
    r.text(c.instructions, L.instructions);
    r.questions(c.questions);
  },
  unit_test(c, r) {
    r.text(c.instructions, L.instructions);
    for (const section of records(c.sections)) {
      r.heading(section.title, 2);
      r.questions(section.questions);
    }
  },
  diagnostic(c, r) {
    r.teacherText(L.purpose, c.purpose);
    r.questions(c.questions);
    if (r.forTeacher) {
      r.callout(
        'teacher',
        L.interpretation,
        '',
        records(c.interpretation).map((i) => `${str(i.signal)} — ${str(i.nextStep)}`),
      );
    }
  },
  rubric(c, r) {
    r.text(c.task, L.task);
    const rows = records(c.criteria).map((criterion) => {
      const levels = (criterion.levels ?? {}) as C;
      const category = str(criterion.category);
      return {
        category: CATEGORY_LABELS_FR[category as keyof typeof CATEGORY_LABELS_FR] ?? category,
        criterion: str(criterion.criterion),
        cells: [str(levels.level1), str(levels.level2), str(levels.level3), str(levels.level4)],
      };
    });
    if (rows.length) {
      r.push({
        type: 'rubric',
        caption: str(c.task) || L.criterion,
        levels: [1, 2, 3, 4].map(L.level),
        rows,
      });
    }
  },
  /** Teacher-only: entries by attente (or learning skill), then kind, then level or mark. */
  report_comments(c, r) {
    r.line(
      L.reportBankScope,
      REPORT_BANK_SCOPE_LABELS_FR[str(c.scope) as keyof typeof REPORT_BANK_SCOPE_LABELS_FR],
    );
    r.line(
      L.reportBankPeriod,
      REPORT_BANK_PERIOD_LABELS_FR[str(c.period) as keyof typeof REPORT_BANK_PERIOD_LABELS_FR],
    );
    const entries = records(c.entries);
    if (str(c.scope) === 'learning_skills') {
      for (const skill of LEARNING_SKILLS) {
        const ofSkill = entries.filter((e) => str(e.skill) === skill);
        if (!ofSkill.length) continue;
        r.heading(LEARNING_SKILL_LABELS_FR[skill], 2);
        commentEntriesByKind(ofSkill, r);
      }
      return;
    }
    // Groups in the order their first entry comes; entries without attente last.
    const groups = new Map<string, C[]>();
    for (const e of entries) {
      const codes = strings(e.expectationCodes);
      const key = codes.join(', ');
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    const keys = [...groups.keys()].sort((a, b) => Number(a === '') - Number(b === ''));
    for (const key of keys) {
      const many = key.includes(', ');
      r.heading(
        key ? `${many ? L.expectationMany : L.expectationOne} ${key}` : L.generalComments,
        2,
      );
      commentEntriesByKind(groups.get(key)!, r);
    }
  },
  game(c, r) {
    r.line(L.grouping, c.grouping);
    r.teacherText(L.setup, c.setup);
    r.list(c.rules, L.rules, true);
    r.text(c.howToWin, L.howToWin);
    r.list(c.variations, L.variations);
    r.questions(c.questions, L.gameQuestions);
  },
  brain_break(c, r) {
    r.line(L.space, SPACE_LABELS_FR[str(c.space)] ?? str(c.space));
    r.list(c.steps, L.steps, true);
    r.teacherText(L.calmVariant, c.calmVariant);
  },
  song(c, r) {
    if (str(c.tune)) r.text(`${L.tune} ${guillemets(str(c.tune))}`);
    for (const verse of records(c.verses)) r.poem(str(verse.label), strings(verse.lines));
    r.teacherList(L.gestures, c.gestures);
  },
  riddle(c, r) {
    r.questions(c.riddles);
  },
  weekly_challenge(c, r) {
    r.text(c.challenge, L.challenge);
    r.list(
      records(c.days).map((d) => labelled(str(d.label), str(d.task))),
      L.days,
    );
    r.list(c.hints, L.hints);
    r.text(c.extension, L.extension);
  },
  catholic_reflection(c, r) {
    r.line(L.theme, c.theme);
    r.line(L.scriptureReference, c.scriptureReference);
    r.text(c.reflection, L.reflection);
    r.list(c.questions, L.discussionQuestions);
    r.poem(L.prayer, str(c.prayer).split('\n'));
    r.text(c.action, L.action);
  },
  culture_hook(c, r) {
    r.text(c.hook, L.hook);
    r.text(c.context, L.context);
    r.list(c.discussionQuestions, L.discussionQuestions);
    r.text(c.activity, L.activity);
    r.teacherList(L.factsToVerify, c.factsToVerify);
  },
  parent_guide() {
    // Rendered as two language sections by `renderContentBlocks`.
  },
};

/** One half of a family guide, in its own language. */
function familySection(part: unknown, lang: 'fr-CA' | 'en-CA', audience: Audience) {
  const labels = FAMILY_LABELS[lang];
  const r = new DocBuilder(audience);
  const c = (part ?? {}) as C;
  r.text(c.intro, labels.intro);
  r.list(c.learning, labels.learning);
  r.list(c.atHome, labels.atHome);
  r.glossary(c.words, labels.words);
  return { type: 'section' as const, lang, title: labels.section, blocks: r.blocks };
}

export function renderContentBlocks(
  type: LibraryItemType,
  content: C,
  audience: Audience,
  ctx: RenderContext = {},
): (LeafBlock | ReturnType<typeof familySection>)[] {
  if (type === 'parent_guide') {
    return [
      familySection(content.fr, 'fr-CA', audience),
      familySection(content.en, 'en-CA', audience),
    ];
  }
  const r = new DocBuilder(audience);
  RENDERERS[type](content, r, ctx);
  return r.blocks;
}
