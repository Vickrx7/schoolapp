/**
 * The projector of « Quiz sur les appareils » (DECISIONS D-086, D-087, D-090), drawn as HTML:
 * before the reveal a question shows no answer whatever the state held (`liveStateSchema` drops
 * the reveal outside the reveal phases); after it, the class's answers as bars with the numbers
 * written out, and the right answer with its explanation only when answers are shown. The ranking
 * shares ranks between ties; « Chacun pour soi » shows class figures only.
 */
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fr from '../../../../messages/fr-CA.json';
import { liveStateSchema, type LiveState } from '../../../server/class-portal/schemas';
import { LobbyTeams } from './lobby-teams';
import { QuestionBoard } from './question-board';
import { TeamLeaderboard } from './team-leaderboard';

const EXPLANATION = '999 + 1 = 1 000.';

/** Server rendering, as the app does, with the messages this surface gets. */
function render(node: ReactNode): string {
  // A .ts test cannot use JSX: the provider's children go in its props.
  const props = {
    locale: 'fr-CA',
    timeZone: 'America/Toronto',
    messages: { classMode: fr.classMode },
    children: node,
  };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props));
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[\s\u00a0]+/g, ' ');

const question = {
  id: 'q1',
  kind: 'multiple_choice',
  prompt: 'Quel nombre vient juste après 999?',
  multipleAnswers: false,
  choices: [
    { id: 'c1', text: '990' },
    { id: 'c2', text: '1 000' },
    { id: 'c3', text: '1 001' },
  ],
  scorable: true,
};

const reveal = (answer: unknown) => ({
  distribution: { c1: 1, c2: 3, c3: 0 },
  correctCount: 3,
  answer,
});

function live(overrides: Record<string, unknown>): LiveState {
  return liveStateSchema.parse({
    status: 'open',
    version: 4,
    title: 'Quiz',
    phase: 'question',
    index: 0,
    total: 3,
    mode: 'teams',
    teams: ['huards', 'castors'],
    teamChoice: 'random',
    lang: 'fr-CA',
    joinCode: 'K7M4R9',
    joiningOpen: false,
    joiningClosesAt: null,
    expiresAt: '2026-11-03T16:00:00+00:00',
    closesAt: null,
    serverNow: '2026-11-03T14:00:00+00:00',
    keep: false,
    revealAnswers: true,
    question,
    answered: 4,
    devices: {
      count: 4,
      connected: 4,
      byTeam: [
        { team: 'huards', members: 2 },
        { team: 'castors', members: 2 },
      ],
      list: [],
    },
    ...overrides,
  });
}

const board = (state: LiveState) =>
  render(
    createElement(QuestionBoard, {
      question: state.question!,
      lang: state.lang,
      reveal: state.phase === 'reveal' ? state.reveal : null,
      answered: state.answered,
    }),
  );

const shown = { kind: 'multiple_choice', choiceIds: ['c2'], display: { explanation: EXPLANATION } };

describe('the projector (D-086, D-087)', () => {
  it('shows no answer before the reveal, whatever the state held', () => {
    const html = text(board(live({ reveal: reveal(shown) })));
    expect(html).toContain('Quel nombre vient juste après 999?');
    expect(html).not.toContain('Bonne réponse');
    expect(html).not.toContain(EXPLANATION);
    expect(html).not.toContain('3 réponses');
  });

  it('after the reveal: the bars, the right choice and its explanation', () => {
    const html = text(board(live({ phase: 'reveal', reveal: reveal(shown) })));
    expect(html).toMatch(/1 000 Bonne réponse 3 réponses/);
    expect(html).toMatch(/990 1 réponse/);
    expect(html).toContain('3 bonnes réponses sur 4');
    expect(html).toContain(`Explication : ${EXPLANATION}`);
  });

  it('with answers hidden: the bars only, never how many were right', () => {
    const hidden = live({ phase: 'reveal', revealAnswers: false, reveal: reveal(null) });
    // The schema drops the count the database would send…
    expect(hidden.reveal).toEqual({
      distribution: { c1: 1, c2: 3, c3: 0 },
      correctCount: null,
      answer: null,
    });
    const html = text(board(hidden));
    expect(html).toMatch(/1 000 3 réponses/);
    expect(html).not.toContain('Bonne réponse ');
    expect(html).not.toMatch(/bonnes? réponses? sur/);
    expect(html).toContain('Les bonnes réponses ne sont pas montrées pendant cette séance.');
    // …and the board draws none even if one reached it.
    const leaked = text(
      render(
        createElement(QuestionBoard, {
          question: hidden.question!,
          lang: 'fr-CA',
          reveal: { distribution: { c1: 1, c2: 3, c3: 0 }, correctCount: 3, answer: null },
          answered: 4,
        }),
      ),
    );
    expect(leaked).not.toMatch(/bonnes? réponses? sur/);
  });

  it('keeps the content’s language on the content only (an Anglais quiz)', () => {
    const english = live({
      phase: 'reveal',
      lang: 'en-CA',
      question: {
        id: 'q2',
        kind: 'true_false',
        prompt: '500 is more than 499.',
        hint: 'Look.',
        scorable: true,
      },
      reveal: {
        distribution: { true: 3, false: 1 },
        correctCount: 3,
        answer: { kind: 'true_false', value: true, display: { explanation: 'Five hundreds.' } },
      },
    });
    const html = board(english);
    expect(html).toContain('<p lang="en-CA"');
    expect(html).toMatch(/Explication : <span lang="en-CA">Five hundreds\.<\/span>/);
    // « Vrai » and « Faux » are the interface's words: no language of their own.
    expect(html).not.toContain('lang="fr-CA"');
    expect(text(html)).toMatch(/Vrai Bonne réponse 3 réponses/);

    const hint = board(live({ lang: 'en-CA', question: { ...question, hint: 'Count on.' } }));
    expect(hint).toMatch(/Indice : <span lang="en-CA">Count on\.<\/span>/);
  });

  it('ranks teams with ties sharing a rank, and shows class figures in « Chacun pour soi »', () => {
    const teams = text(
      render(
        createElement(TeamLeaderboard, {
          state: live({
            phase: 'leaderboard',
            reveal: reveal(shown),
            leaderboard: [
              { team: 'huards', members: 2, score: 150 },
              { team: 'castors', members: 2, score: 150 },
            ],
          }),
        }),
      ),
    );
    expect(teams).toMatch(/1er Les Huards 150 points 1er Les Castors 150 points/);

    const solo = text(
      render(
        createElement(TeamLeaderboard, {
          state: live({
            phase: 'leaderboard',
            mode: 'solo',
            teams: null,
            reveal: reveal(shown),
            classStats: { percentCorrect: 74 },
          }),
        }),
      ),
    );
    expect(solo).toContain('Résultats de la classe');
    expect(solo).toContain('74 % de bonnes réponses');
    expect(solo).not.toContain('Appareil');
  });

  it('shows the teams in the lobby with their devices, never a device number', () => {
    const html = text(
      render(createElement(LobbyTeams, { state: live({ phase: 'lobby', index: -1 }) })),
    );
    expect(html).toContain('4 appareils');
    expect(html).toMatch(/Les Huards 2 appareils/);
    expect(html).not.toContain('Appareil ');
  });
});
