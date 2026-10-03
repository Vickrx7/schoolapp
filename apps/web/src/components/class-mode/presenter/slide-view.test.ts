/**
 * The projected slides of « Présenter à la classe » (DECISIONS D-082, D-086, D-090), drawn as
 * HTML: every slide of every presentable type draws without a key, a teacher-only field or a
 * safety note; labels follow the content's language; « Afficher la réponse » marks the right
 * choices only once the answer is given; choice marks match the teams' shapes and colours.
 */
import {
  CLASS_TEAMS,
  LIBRARY_ITEM_TYPES,
  TYPE_INFO,
  mapQuestions,
  presentSlides,
  sampleCanonical,
  type DocLang,
  type LibraryItemType,
  type Slide,
} from '@lynx/content';
import { createTranslator } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import en from '../../../../messages/en-CA.json';
import fr from '../../../../messages/fr-CA.json';
import type { PresenterAnswer } from '../../../server/class-mode/presenter';
import { CHOICE_LETTERS, CHOICE_MARKS } from './choice-mark';
import { SlideView, type SlideText } from './slide-view';

const KEY_SENTINEL = 'SENTINELLE-CORRIGE';
const TEACHER_SENTINEL = 'SENTINELLE-ENSEIGNANT';

function slideText(lang: DocLang): SlideText {
  const catalog = lang === 'en-CA' ? en : fr;
  const translate = createTranslator({ locale: lang, messages: catalog.classPresenter.slide });
  return (key, values) => translate(key, values);
}

const html = (slide: Slide, answer?: PresenterAnswer | null, lang: DocLang = 'fr-CA') =>
  renderToStaticMarkup(
    createElement(SlideView, { slide, t: slideText(lang), answer, answerId: 'reponse' }),
  );

const meta = (lang: DocLang = 'fr-CA') => ({
  title: 'Titre de la ressource',
  materials: 'Une éponge par équipe.',
  durationMinutes: 20,
  lang,
});

function withSentinels(type: LibraryItemType): Record<string, unknown> {
  const content = mapQuestions(type, sampleCanonical(type).content, (q) => ({
    ...q,
    category: TEACHER_SENTINEL,
    correctChoiceIds: [KEY_SENTINEL],
    correct: KEY_SENTINEL,
    sampleAnswer: KEY_SENTINEL,
    acceptableAnswers: [KEY_SENTINEL],
    explanation: KEY_SENTINEL,
  })) as Record<string, unknown>;
  return {
    ...content,
    teacherNote: TEACHER_SENTINEL,
    safetyNotes: { hazards: [KEY_SENTINEL], notes: KEY_SENTINEL },
  };
}

/** The choice cards marked « Bonne réponse ». */
const marked = (markup: string) =>
  markup.split('<li').filter((card) => card.includes('data-correct="true"'));

const questionSlide = (slides: Slide[], id: string) => {
  const slide = slides.find((s) => s.kind === 'question' && s.question.id === id);
  if (!slide) throw new Error(`no question ${id}`);
  return slide;
};

describe('projected slides', () => {
  it('draws every slide of every type without a key, a teacher field or a safety note', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      if (TYPE_INFO[type].audience === 'teacher') continue;
      const slides = presentSlides(type, withSentinels(type), meta());
      expect(slides.length, type).toBeGreaterThan(1);
      for (const slide of slides) {
        const markup = html(slide);
        expect(markup, `${type} ${slide.kind}`).not.toContain(KEY_SENTINEL);
        expect(markup, `${type} ${slide.kind}`).not.toContain(TEACHER_SENTINEL);
        expect(markup, `${type} ${slide.kind}`).not.toContain('Bonne réponse');
      }
    }
  });

  it('labels slides in the content’s language', () => {
    const steps = presentSlides('brain_break', sampleCanonical('brain_break').content, meta());
    const total = steps.filter((s) => s.kind === 'step').length;
    const first = steps.find((s) => s.kind === 'step')!;
    expect(html(first)).toContain(`Étape 1 sur ${total}`);
    expect(html(first, undefined, 'en-CA')).toContain(`Step 1 of ${total}`);
    expect(html(steps.at(-1)!)).toContain('Fin de l’activité');

    const experiment = presentSlides('experiment', sampleCanonical('experiment').content, meta());
    const safety = html(experiment[1]!);
    expect(safety).toContain('Sécurité');
    // No reminder is written for students in an experiment: the generic one is projected.
    expect(safety).toContain('Écoute les consignes de sécurité de ton enseignant·e.');
    expect(html(experiment[2]!)).toContain('Matériel');
    expect(html(experiment[0]!)).toContain('20 min');
  });

  it('keeps the English half of a family guide in English', () => {
    const slides = presentSlides('parent_guide', sampleCanonical('parent_guide').content, meta());
    const markup = slides.map((s) => html(s)).join('');
    expect(markup).toContain('<section lang="en-CA"');
    expect(markup).toContain('<section lang="fr-CA"');
  });

  it('marks the right choices only once the answer is shown', () => {
    const slides = presentSlides('quiz', sampleCanonical('quiz').content, meta());
    const mc = questionSlide(slides, 'mc1');
    const hidden = html(mc);
    expect(hidden).toContain('Question 1 sur 5');
    expect(hidden).not.toContain('data-correct');
    expect(hidden).toContain('<div id="reponse" aria-live="polite"');

    const shown = html(mc, {
      kind: 'multiple_choice',
      correctChoiceIds: ['c1'],
      explanation: '893 a 8 centaines.',
    });
    expect(marked(shown)).toHaveLength(1);
    expect(marked(shown)[0]).toContain('>893<');
    expect(shown).toContain('Bonne réponse');
    expect(shown).toContain('Explication : 893 a 8 centaines.');

    const tf = html(questionSlide(slides, 'tf1'), {
      kind: 'true_false',
      correct: false,
      explanation: '',
    });
    expect(marked(tf)).toHaveLength(1);
    expect(marked(tf)[0]).toContain('>Faux<');

    const matching = html(questionSlide(slides, 'ma1'), {
      kind: 'matching',
      pairs: [
        { leftId: 'l1', rightId: 'r1' },
        { leftId: 'l2', rightId: 'r2' },
      ],
      explanation: '',
    });
    expect(matching).toContain('Bonnes associations');
    expect(matching).toContain('1. 300 + 40 + 5 → C) 345');
    expect(matching).toContain('2. 500 + 4 → A) 504');

    const ordering = html(questionSlide(slides, 'or1'), {
      kind: 'ordering',
      orderedIds: ['i1', 'i2', 'i3'],
      explanation: '',
    });
    expect(ordering).toMatch(/Ordre attendu.*<li>170<\/li><li>701<\/li><li>710<\/li>/);

    const short = html(questionSlide(slides, 'sa1'), {
      kind: 'short_answer',
      sampleAnswer: 'Le chiffre des centaines est plus grand.',
      acceptableAnswers: [],
      explanation: '',
    });
    expect(short).toContain('Exemple de réponse');
    expect(short).toContain('Le chiffre des centaines est plus grand.');

    // Asked, but the key has nothing for this question.
    expect(html(mc, null)).toContain('Le corrigé n’a pas de réponse pour cette question.');
  });

  it('marks choices with the teams’ letters, shapes and colours', () => {
    expect(CHOICE_MARKS.map((m) => m.shape)).toEqual(CLASS_TEAMS.map((team) => team.shape));
    CHOICE_MARKS.forEach((mark, i) => {
      const colour = CLASS_TEAMS[i]!.colorToken.replace('team-', '');
      expect(mark.fill, colour).toMatch(new RegExp(`^fill-${colour}-\\d+$`));
    });
    expect(CHOICE_LETTERS).toHaveLength(CHOICE_MARKS.length);

    const slides = presentSlides('quiz', sampleCanonical('quiz').content, meta());
    const markup = html(questionSlide(slides, 'mc1'));
    expect(markup.match(/data-shape="(\w+)"/g)).toEqual([
      'data-shape="circle"',
      'data-shape="triangle"',
      'data-shape="square"',
    ]);
    expect(markup).toContain('<span>A</span>');
    expect(markup).toContain('<span>C</span>');
  });
});
