'use client';

import type { ClassTeamKey } from '@lynx/content';
import { CheckCircle2, Clock, LogOut, Timer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { TeamLabel } from '../class-mode/team-mark';
import { openAsNewDocument } from '../../lib/new-document';
import type {
  AnswerResult,
  ClassAnswer,
  DeviceOkState,
  DeviceQuestion,
  TeamResult,
} from '../../server/class-portal/schemas';
import { MatchingInput } from './inputs/matching';
import { MultipleChoiceInput } from './inputs/multiple-choice';
import { OrderingInput } from './inputs/ordering';
import { ShortAnswerInput } from './inputs/short-answer';
import { TrueFalseInput } from './inputs/true-false';
import { DeviceLeaderboard } from './leaderboard';
import { OfflineBanner } from './offline-banner';
import { busyDelay, secondsLeft } from './polling';
import { ResultCard } from './result-card';
import { TeamPicker } from './team-picker';
import { GameOver } from './game-over';
import { useClassState } from './use-class-state';
import { useHydrated } from './use-hydrated';

/**
 * « Quiz sur les appareils » on a class device (DECISIONS D-084 to D-088): the device's number
 * and team, then each question as the teacher moves on, its own result after « Afficher la
 * réponse » when answers are shown, the team ranking and the end. The screens are French, the
 * content in its own language (`lang`). Big targets and text for a noisy classroom (D-090); focus
 * moves to the heading at each change, and « Réponse envoyée! » is announced.
 *
 * An answer is sent once; if the network fails it is sent again with the same payload until it
 * arrives (the server answers `already` to a repeat), and the choice stays on screen meanwhile.
 * Nothing is kept in the browser's storage (D-088).
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type AnswerBody = { index: number; kind: DeviceQuestion['kind']; response: ClassAnswer };

/** What the device API may answer besides the portal's own results. */
type ApiRefusal = { status: 'forbidden' | 'error' | 'notConfigured' | 'busy' };

/** Ticks while a countdown runs. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function Game({ initial }: { initial: DeviceOkState | null }) {
  const t = useTranslations('classPortal');
  const { state, over, offline, offsetMs, apply, end } = useClassState(initial);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  // Answers: the question being sent, the question whose answer arrived, a refused answer.
  const [sendingIndex, setSendingIndex] = useState<number | null>(null);
  const [sentIndex, setSentIndex] = useState<number | null>(null);
  const [answerFailed, setAnswerFailed] = useState(false);
  const [teamPending, setTeamPending] = useState(false);
  const [teamFailed, setTeamFailed] = useState(false);
  const indexRef = useRef<number | null>(state?.session.index ?? null);
  useEffect(() => {
    indexRef.current = state?.session.index ?? null;
  }, [state?.session.index]);

  const phase = state?.session.phase;
  const index = state?.session.index;
  // Focus the new screen's heading when the game moves on.
  useEffect(() => {
    headingRef.current?.focus();
  }, [phase, index, over]);

  const sendAnswer = useCallback(
    async (body: AnswerBody) => {
      setSendingIndex(body.index);
      setAnswerFailed(false);
      let failures = 0;
      try {
        // Sent again after a network failure, as long as the device is on that question.
        while (indexRef.current === body.index) {
          let response: Response;
          try {
            response = await fetch('/jouer/api/answer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify(body),
              cache: 'no-store',
            });
          } catch {
            failures += 1;
            await sleep(Math.min(1000 * failures, 5000));
            continue;
          }
          if (response.status === 503) {
            await sleep(busyDelay(response.headers.get('retry-after')));
            continue;
          }
          if (response.status >= 500) {
            failures += 1;
            await sleep(Math.min(1000 * failures, 5000));
            continue;
          }
          const result = (await response.json().catch(() => null)) as
            AnswerResult | ApiRefusal | null;
          if (!result || !('status' in result)) {
            setAnswerFailed(true);
            return;
          }
          if (result.status === 'gone' || result.status === 'ended') {
            end(result.status);
            return;
          }
          if (result.status !== 'ok' || result.outcome === 'invalid') {
            setAnswerFailed(true);
            return;
          }
          apply(result.state);
          if (result.outcome === 'recorded' || result.outcome === 'already') {
            setSentIndex(body.index);
          }
          return;
        }
      } finally {
        setSendingIndex((current) => (current === body.index ? null : current));
      }
    },
    [apply, end],
  );

  const chooseTeam = useCallback(
    async (team: ClassTeamKey) => {
      setTeamPending(true);
      setTeamFailed(false);
      try {
        const response = await fetch('/jouer/api/team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ team }),
          cache: 'no-store',
        });
        const result = (await response.json().catch(() => null)) as TeamResult | ApiRefusal | null;
        if (
          result &&
          'status' in result &&
          (result.status === 'gone' || result.status === 'ended')
        ) {
          end(result.status);
        } else if (result && 'status' in result && result.status === 'ok' && 'version' in result) {
          apply(result);
        } else {
          setTeamFailed(true);
        }
      } catch {
        setTeamFailed(true);
      } finally {
        setTeamPending(false);
      }
    },
    [apply, end],
  );

  const leave = async () => {
    try {
      await fetch('/jouer/api/leave', { method: 'POST', cache: 'no-store' });
    } finally {
      openAsNewDocument('/jouer');
    }
  };

  const hydrated = useHydrated();
  const closesAt = phase === 'question' && hydrated ? (state?.session.closesAt ?? null) : null;
  const now = useNow(closesAt !== null);

  if (over) return <GameOver reason={over} />;

  if (!state) {
    return (
      <div className="space-y-6">
        <OfflineBanner offline={offline} />
        <p role="status" className="py-16 text-center text-[26px] text-slate-800">
          {t('joining')}
        </p>
      </div>
    );
  }

  const { session, me, question, myAnswer } = state;
  const teams = session.teams ?? [];
  const canChooseTeam =
    session.mode === 'teams' &&
    session.teamChoice === 'device' &&
    session.phase !== 'finished' &&
    (session.phase === 'lobby' || me.team === null);
  const answered =
    myAnswer?.answered === true || (sentIndex !== null && sentIndex === session.index);
  const left = secondsLeft(closesAt, offsetMs, now);
  const timeUp = left === 0;
  const position = t('questionOf', { n: session.index + 1, total: session.total });

  let body: ReactNode;
  if (session.phase === 'lobby' || (session.phase === 'question' && !question)) {
    body = (
      <div className="space-y-8">
        <Identity headingRef={headingRef} device={me.device} team={me.team} />
        {canChooseTeam ? (
          <TeamPicker
            teams={teams}
            current={me.team}
            pending={teamPending}
            onChoose={(team) => void chooseTeam(team)}
          />
        ) : null}
        {teamFailed ? <Problem>{t('error')}</Problem> : null}
        <p className="text-[26px] font-semibold text-slate-950">{t('lookUp')}</p>
      </div>
    );
  } else if (session.phase === 'question' && question) {
    body = (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Heading headingRef={headingRef}>{position}</Heading>
          {left !== null ? (
            <p
              role="timer"
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-[24px] font-bold text-white tabular-nums"
            >
              <Timer aria-hidden className="size-7" />
              {t('timeLeft', { seconds: left })}
            </p>
          ) : null}
        </div>
        {canChooseTeam ? (
          <TeamPicker
            teams={teams}
            current={me.team}
            pending={teamPending}
            onChoose={(team) => void chooseTeam(team)}
          />
        ) : null}
        <Prompt question={question} lang={session.lang} />
        <div aria-live="polite" role="status" className="empty:hidden">
          {answered ? (
            <p className="flex items-center gap-3 rounded-2xl border-4 border-slate-950 bg-white px-5 py-5 text-[30px] font-bold text-slate-950">
              <CheckCircle2 aria-hidden className="size-10 shrink-0" strokeWidth={2.5} />
              {t('sent')}
            </p>
          ) : timeUp ? (
            <p className="flex items-center gap-3 rounded-2xl border-4 border-slate-700 bg-slate-100 px-5 py-5 text-[30px] font-bold text-slate-950">
              <Clock aria-hidden className="size-10 shrink-0" strokeWidth={2.5} />
              {t('closed')}
            </p>
          ) : sendingIndex === session.index ? (
            <p className="text-[24px] text-slate-800">{t('sending')}</p>
          ) : null}
        </div>
        {answerFailed && !answered ? <Problem>{t('invalidAnswer')}</Problem> : null}
        {!answered && !timeUp ? (
          <AnswerInput
            key={`${session.index}-${question.id}`}
            question={question}
            lang={session.lang}
            disabled={sendingIndex === session.index}
            onSubmit={(response) =>
              void sendAnswer({ index: session.index, kind: question.kind, response })
            }
          />
        ) : null}
        {answered || timeUp ? <p className="text-[24px] text-slate-800">{t('lookUp')}</p> : null}
      </div>
    );
  } else if (session.phase === 'reveal') {
    body = (
      <div className="space-y-6">
        <Heading headingRef={headingRef}>{position}</Heading>
        <ResultCard myAnswer={myAnswer} />
      </div>
    );
  } else if (session.phase === 'leaderboard') {
    body = (
      <div className="space-y-6">
        <Heading headingRef={headingRef}>{position}</Heading>
        <Standings state={state} />
      </div>
    );
  } else {
    body = (
      <div className="space-y-8">
        <Heading headingRef={headingRef}>{t('ended')}</Heading>
        <Standings state={state} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <OfflineBanner offline={offline} />
      {session.phase !== 'lobby' && me.team ? (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[24px] text-slate-800">
          <span>{t('you', { n: me.device })}</span>
          <TeamLabel team={me.team} name={t(`teams.${me.team}`)} />
        </p>
      ) : null}
      {body}
      {session.phase === 'lobby' || session.phase === 'finished' ? (
        <div className="border-t border-slate-200 pt-6">
          <button
            type="button"
            onClick={() => void leave()}
            className="inline-flex min-h-16 items-center gap-2 rounded-2xl px-4 text-[22px] font-semibold text-slate-800 underline underline-offset-4 focus-visible:outline-4 focus-visible:outline-slate-950"
          >
            <LogOut aria-hidden className="size-6" />
            {t('leave')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Heading({
  headingRef,
  children,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
}) {
  return (
    <h2
      ref={headingRef}
      tabIndex={-1}
      className="text-[28px] leading-tight font-bold text-slate-950 focus:outline-none"
    >
      {children}
    </h2>
  );
}

function Identity({
  headingRef,
  device,
  team,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  device: number;
  team: ClassTeamKey | null;
}) {
  const t = useTranslations('classPortal');
  return (
    <div className="space-y-4">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-[40px] leading-tight font-bold text-slate-950 focus:outline-none"
      >
        {t('you', { n: device })}
      </h2>
      {team ? (
        <p className="text-[30px] font-semibold text-slate-950">
          {t.rich('team', {
            name: t(`teams.${team}`),
            team: () => <TeamLabel team={team} name={t(`teams.${team}`)} />,
          })}
        </p>
      ) : null}
    </div>
  );
}

function Prompt({ question, lang }: { question: DeviceQuestion; lang: 'fr-CA' | 'en-CA' }) {
  return (
    <div lang={lang} className="space-y-2">
      <p className="text-[28px] leading-snug font-semibold whitespace-pre-line text-slate-950">
        {question.prompt}
      </p>
      {question.hint ? <p className="text-[22px] text-slate-700">{question.hint}</p> : null}
    </div>
  );
}

function AnswerInput({
  question,
  lang,
  disabled,
  onSubmit,
}: {
  question: DeviceQuestion;
  lang: 'fr-CA' | 'en-CA';
  disabled: boolean;
  onSubmit: (response: ClassAnswer) => void;
}) {
  const props = { question, lang, disabled, onSubmit };
  switch (question.kind) {
    case 'multiple_choice':
      return <MultipleChoiceInput {...props} />;
    case 'true_false':
      return <TrueFalseInput {...props} />;
    case 'matching':
      return <MatchingInput {...props} />;
    case 'ordering':
      return <OrderingInput {...props} />;
    case 'short_answer':
      return <ShortAnswerInput {...props} />;
  }
}

/** The team ranking (team mode) or the device's own total (« Chacun pour soi »). */
function Standings({ state }: { state: DeviceOkState }) {
  const t = useTranslations('classPortal');
  if (state.session.mode === 'teams' && state.leaderboard?.length) {
    return <DeviceLeaderboard scores={state.leaderboard} myTeam={state.me.team} />;
  }
  if (state.myTotal !== null) {
    return (
      <p className="rounded-3xl border-4 border-slate-950 bg-white px-6 py-6 text-center text-[36px] font-bold text-slate-950 tabular-nums">
        {t('total', { points: state.myTotal })}
      </p>
    );
  }
  return <p className="text-[26px] font-semibold text-slate-950">{t('lookUp')}</p>;
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-2xl border-2 border-red-700 bg-red-50 px-4 py-3 text-[22px] font-semibold text-red-900"
    >
      {children}
    </p>
  );
}
