/**
 * The screens of a class device (DECISIONS D-084 to D-088, D-090), drawn as HTML the way the
 * server renders them: the device's number and team, each question kind with big targets and the
 * content's language, « Réponse envoyée! », its own result only (never the right answer), the
 * ranking and the end. Every state goes through `deviceStateSchema` first, as in the app, with
 * key-shaped fields planted: none of them is ever drawn.
 */
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fr from '../../../messages/fr-CA.json';
import { deviceStateSchema, type DeviceOkState } from '../../server/class-portal/schemas';
import { Game } from './game';
import { GameOver } from './game-over';
import { JoinForm } from './join-form';

const SENTINEL = 'SENTINELLE-CORRIGE';

/** Server rendering, as the app does, with the messages this surface gets. */
function render(node: ReactNode): string {
  // A .ts test cannot use JSX: the provider's children go in its props.
  const props = {
    locale: 'fr-CA',
    timeZone: 'America/Toronto',
    messages: { classPortal: fr.classPortal },
    children: node,
  };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props));
}

/** Text only, with the no-break spaces of the messages as spaces. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[\s\u00a0]+/g, ' ');

const LEAKS = {
  explanation: SENTINEL,
  correctChoiceIds: ['c2'],
  accepted: [SENTINEL],
  sampleAnswer: SENTINEL,
  answer: SENTINEL,
};

function state(overrides: {
  session?: Partial<DeviceOkState['session']>;
  me?: Partial<DeviceOkState['me']>;
  question?: Record<string, unknown> | null;
  myAnswer?: unknown;
  leaderboard?: unknown;
  myTotal?: number | null;
}): DeviceOkState {
  const raw = {
    status: 'ok',
    version: 3,
    serverNow: '2026-11-03T14:05:00.123456+00:00',
    ...LEAKS,
    session: {
      title: 'Quiz : les nombres jusqu’à 1 000',
      lang: 'fr-CA',
      mode: 'teams',
      phase: 'lobby',
      index: -1,
      total: 5,
      closesAt: null,
      joiningOpen: true,
      teamChoice: 'random',
      teams: ['huards', 'castors'],
      ...overrides.session,
    },
    me: { device: 7, team: 'castors', ...overrides.me },
    question: overrides.question === null ? undefined : overrides.question,
    myAnswer: overrides.myAnswer,
    leaderboard: overrides.leaderboard,
    myTotal: overrides.myTotal ?? undefined,
  };
  const parsed = deviceStateSchema.parse(raw);
  if (parsed.status !== 'ok') throw new Error('not ok');
  return parsed;
}

const mc = {
  id: 'q1',
  kind: 'multiple_choice',
  prompt: 'Quel nombre vient juste après 999?',
  multipleAnswers: false,
  choices: [
    { id: 'c1', text: '990', correct: SENTINEL },
    { id: 'c2', text: '1 000' },
    { id: 'c3', text: '1 001' },
    { id: 'c4', text: '9 999' },
  ],
  scorable: true,
  ...LEAKS,
};

const game = (s: DeviceOkState) => render(createElement(Game, { initial: s }));

describe('a class device', () => {
  it('shows its number and team in the lobby, and can leave', () => {
    const html = text(game(state({})));
    expect(html).toContain('Tu es l’appareil 7.');
    expect(html).toContain('Ton équipe : Les Castors');
    expect(html).toContain('Regarde l’écran : la partie va commencer.');
    expect(html).toContain('Quitter la partie');
  });

  it('offers the session’s teams when students choose', () => {
    const html = game(
      state({
        session: { teamChoice: 'device', teams: ['huards', 'castors', 'orignaux'] },
        me: { team: null },
      }),
    );
    expect(text(html)).toContain('Choisis ton équipe');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
    for (const team of ['Les Huards', 'Les Castors', 'Les Orignaux'])
      expect(text(html)).toContain(team);
    expect(text(html)).not.toContain('Les Ours');
  });

  it('draws a multiple-choice question with big lettered buttons and no key', () => {
    const html = game(
      state({
        session: { phase: 'question', index: 0, closesAt: '2099-01-01T00:00:00+00:00' },
        question: mc,
      }),
    );
    expect(text(html)).toContain('Question 1 sur 5');
    expect(text(html)).toContain('Quel nombre vient juste après 999?');
    expect(html).toContain('aria-label="Réponse A : 990"');
    expect(html).toContain('aria-label="Réponse B : 1 000"');
    expect(html).toContain('min-h-24');
    // The countdown uses the device's clock: drawn once the page is interactive, never in the
    // server's HTML (which would not match the first client render).
    expect(html).not.toContain('role="timer"');
    expect(html).toContain('text-[28px]');
    expect(html).not.toContain(SENTINEL);
    expect(html).not.toContain('Bonne réponse');
  });

  it('says « Réponse envoyée! » once answered, without the inputs', () => {
    const html = text(
      game(
        state({
          session: { phase: 'question', index: 0 },
          question: mc,
          myAnswer: { answered: true, result: { correct: true, points: 100 } },
        }),
      ),
    );
    expect(html).toContain('Réponse envoyée!');
    expect(html).not.toContain('Réponse A');
    // Its result waits for the reveal.
    expect(html).not.toContain('Bonne réponse!');
  });

  it('learns only its own result after the reveal', () => {
    const reveal = { phase: 'reveal', index: 0 } as const;
    const right = text(
      game(
        state({
          session: reveal,
          question: mc,
          myAnswer: { answered: true, result: { correct: true, points: 100 } },
        }),
      ),
    );
    expect(right).toContain('Bonne réponse!');
    expect(right).toContain('+100 points');
    expect(right).toContain('Regarde l’écran pour la bonne réponse.');
    // Never the choices, so never which one was right.
    expect(right).not.toContain('1 000');

    const wrong = text(
      game(
        state({
          session: reveal,
          question: mc,
          myAnswer: { answered: true, result: { correct: false, points: 0 } },
        }),
      ),
    );
    expect(wrong).toContain('Pas cette fois.');
    expect(wrong).not.toContain('+0');

    // Answers hidden, or a question that is not scored.
    const hidden = text(
      game(state({ session: reveal, question: mc, myAnswer: { answered: true } })),
    );
    expect(hidden).toContain('Réponse enregistrée');
    expect(hidden).not.toContain('Regarde l’écran pour la bonne réponse.');

    expect(text(game(state({ session: reveal, question: mc })))).toContain(
      'Pas de réponse pour cette question.',
    );
  });

  it('draws every other kind for fingers and keyboards, in the content’s language', () => {
    const q = (question: Record<string, unknown>, lang: 'fr-CA' | 'en-CA' = 'fr-CA') =>
      game(state({ session: { phase: 'question', index: 1, lang }, question }));
    const tf = q({ id: 'q2', kind: 'true_false', prompt: '500 est plus grand que 499.' });
    expect(text(tf)).toMatch(/Vrai.*Faux/);
    expect(tf).toContain('min-h-[32dvh]');

    const matching = q({
      id: 'q3',
      kind: 'matching',
      prompt: 'Associe.',
      left: [
        { id: 'l1', text: 'cent' },
        { id: 'l2', text: 'mille' },
      ],
      right: [
        { id: 'ra', text: '1 000' },
        { id: 'rc', text: '100' },
      ],
    });
    expect(matching.match(/<select/g)).toHaveLength(2);
    expect(text(matching)).toContain('Choisis…');

    const ordering = q({
      id: 'q4',
      kind: 'ordering',
      prompt: 'Place ces nombres.',
      items: [
        { id: 'i1', text: '500' },
        { id: 'i2', text: '900' },
        { id: 'i3', text: '100' },
      ],
    });
    expect(ordering).toContain('aria-label="Monter « 100 »"');
    expect(ordering).toMatch(/disabled="" title="Monter" aria-label="Monter « 500 »"/);

    const short = q({ id: 'q5', kind: 'short_answer', prompt: 'Write one thousand.' }, 'en-CA');
    expect(short).toMatch(/<input[^>]*lang="en-CA"/);
    for (const attribute of [
      'autoComplete="off"',
      'autoCorrect="off"',
      'autoCapitalize="off"',
      'spellCheck="false"',
    ]) {
      expect(short.toLowerCase()).toContain(attribute.toLowerCase());
    }
    expect(text(short)).toContain('Ta réponse');
  });

  it('shows the team ranking, and its own total at the end', () => {
    const board = text(
      game(
        state({
          session: { phase: 'leaderboard', index: 4 },
          question: mc,
          leaderboard: [
            { team: 'huards', members: 3, score: 300 },
            { team: 'castors', members: 2, score: 300 },
            { team: 'orignaux', members: 0, score: null },
          ],
        }),
      ),
    );
    expect(board).toContain('Classement des équipes');
    expect(board).toMatch(/1er Les Huards 300 points/);
    expect(board).toMatch(/1er Les Castors Ton équipe 300 points/);
    expect(board).toContain('—');

    const end = text(
      game(
        state({
          session: { phase: 'finished', index: 4, mode: 'solo', teams: null },
          myTotal: 400,
        }),
      ),
    );
    expect(end).toContain('La partie est terminée. Merci!');
    expect(end).toContain('Ton total : 400 points');
  });

  it('says when the game is over for it', () => {
    expect(text(render(createElement(GameOver, { reason: 'gone' })))).toContain(
      'Cette partie est terminée pour toi. Merci!',
    );
    expect(text(render(createElement(GameOver, { reason: 'ended' })))).toContain(
      'La partie est terminée. Merci!',
    );
  });

  it('joins with a big code field that keeps what is typed to itself', () => {
    const html = render(createElement(JoinForm));
    expect(text(html)).toContain('Code de la partie');
    expect(html.toLowerCase()).toContain('autocomplete="off"');
    expect(html.toLowerCase()).toContain('spellcheck="false"');
    expect(html).toContain('min-h-16');
    // Disabled until the page is interactive (a tap before would be lost).
    expect(html).toMatch(/<button type="submit" disabled=""/);
    // No name: a native submit before hydration cannot put the code in the address.
    expect(html).not.toMatch(/<input[^>]*name=/);
  });
});
