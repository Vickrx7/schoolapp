'use client';

import type { ClassTeamKey } from '@lynx/content';
import {
  ArrowRight,
  Eye,
  Flag,
  Lock,
  LockOpen,
  Maximize,
  Minimize,
  Play,
  Trophy,
  WifiOff,
  X,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
  type RefObject,
} from 'react';
import { toast } from 'sonner';
import { EndSessionDialog } from '@/components/class-mode/end-session-dialog';
import { SLIDE_TYPE } from '@/components/class-mode/presenter/slide-view';
import { parseInstant, secondsLeft } from '@/components/class-portal/polling';
import { useHydrated } from '@/components/class-portal/use-hydrated';
import { Button } from '@/components/ui/button';
import { useErrorText } from '@/hooks/use-action';
import { openAsNewDocument } from '@/lib/new-document';
import { cn } from '@/lib/utils';
import { controlSession, type SessionAction } from '@/server/actions/class-mode';
import type { LiveState } from '@/server/class-portal/schemas';
import { DevicesPanel } from './devices-panel';
import { LobbyTeams } from './lobby-teams';
import { QuestionBoard } from './question-board';
import { TeamLeaderboard } from './team-leaderboard';
import { useProjectorState } from './use-projector-state';

/**
 * The projector of « Quiz sur les appareils » (DECISIONS D-084 to D-090), the teacher's own
 * signed-in page on the classroom computer: the lobby (address, code, QR code, teams), each
 * question with its answer count, « Afficher la réponse » with the class's answers, the ranking
 * and the end. It polls the session every second; every control sends the version on screen, so
 * a double click or another tab gets « La séance a changé » instead of skipping a question. The
 * session lives on the server: a refresh or a closed tab loses nothing (« Reprendre la
 * projection » on the class tab). Large type, colour always with a shape and a letter, no sound.
 */

const subscribeFullscreen = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
};

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function ProjectorShell({
  sessionId,
  classId,
  initial,
  joinPanel,
  retentionDays,
}: {
  sessionId: string;
  classId: string;
  initial: LiveState;
  /** « Rejoignez la partie »: address, code and QR code, rendered on the server. */
  joinPanel: ReactNode;
  retentionDays: number;
}) {
  const t = useTranslations('classMode');
  const format = useFormatter();
  const errorText = useErrorText();
  const { state, offline, offsetMs, apply, refresh } = useProjectorState(sessionId, initial);
  const [pending, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const classTab = `/classes/${classId}/class-mode`;

  // The new screen's heading takes the focus when the session moves on.
  useEffect(() => {
    headingRef.current?.focus();
  }, [state.phase, state.index]);

  const fullscreenEnabled = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenEnabled,
    () => false,
  );
  const fullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null,
    () => false,
  );
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  const act = (action: SessionAction, participantId?: string, team?: ClassTeamKey) =>
    new Promise<void>((resolve) =>
      startTransition(async () => {
        try {
          const result = await controlSession(
            sessionId,
            action,
            state.version,
            participantId,
            team,
          );
          if (result.ok) apply(result.data);
          else if (result.error === 'classSessionChanged') {
            toast.info(t('projector.changed'));
            refresh();
          } else {
            toast.error(errorText(result.error));
            refresh();
          }
        } catch {
          toast.error(errorText('network'));
        } finally {
          resolve();
        }
      }),
    );

  // The countdown and « expired » use this computer's clock: drawn after hydration only.
  const hydrated = useHydrated();
  const timed = hydrated && state.phase === 'question' && state.closesAt !== null;
  const now = useNow(timed);

  if (state.status === 'closed') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 ref={headingRef} tabIndex={-1} className={cn(SLIDE_TYPE.heading, 'font-bold')}>
          {t('projector.ended')}
        </h1>
        {hydrated && parseInstant(state.expiresAt) <= now + offsetMs ? (
          <p className={cn(SLIDE_TYPE.small, 'text-slate-800')}>{t('expired')}</p>
        ) : null}
        <p className={cn(SLIDE_TYPE.small, 'text-slate-800')}>{t('projector.endedBody')}</p>
        <Button asChild size="lg">
          <a href={classTab}>{t('projector.backToClass')}</a>
        </Button>
      </div>
    );
  }

  const last = state.total > 0 && state.index >= state.total - 1;
  const position = t('question.position', { n: state.index + 1, total: state.total });
  const left = timed ? secondsLeft(state.closesAt, offsetMs, now) : null;
  const joiningUntil =
    state.joiningOpen && state.joiningClosesAt
      ? format.dateTime(new Date(parseInstant(state.joiningClosesAt)), {
          hour: 'numeric',
          minute: '2-digit',
        })
      : null;

  let main: ReactNode;
  let controls: ReactNode;
  switch (state.phase) {
    case 'lobby':
      main = (
        <div className="grid grid-cols-[3fr_2fr] gap-[3vw]">
          {joinPanel}
          <div className="space-y-[2vh]">
            <h2 ref={headingRef} tabIndex={-1} className="sr-only">
              {t('lobby.title')}
            </h2>
            <LobbyTeams state={state} />
            <p className={cn(SLIDE_TYPE.small, 'flex items-center gap-[0.4em] text-slate-800')}>
              {state.joiningOpen ? (
                <LockOpen aria-hidden className="size-[1em]" />
              ) : (
                <Lock aria-hidden className="size-[1em]" />
              )}
              {joiningUntil ? t('lobby.open', { time: joiningUntil }) : t('lobby.closed')}
            </p>
          </div>
        </div>
      );
      controls = (
        <>
          <Button
            variant="secondary"
            size="lg"
            disabled={pending}
            onClick={() => void act(state.joiningOpen ? 'lock' : 'unlock')}
          >
            {state.joiningOpen ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
            {state.joiningOpen ? t('lobby.lock') : t('lobby.unlock')}
          </Button>
          <Button
            size="lg"
            className="min-h-14 px-8 text-lg"
            disabled={pending || state.total === 0}
            title={t('lobby.startHint')}
            onClick={() => void act('next')}
          >
            <Play aria-hidden />
            {t('lobby.start')}
          </Button>
        </>
      );
      break;

    case 'question':
    case 'reveal':
      main = (
        <div className="space-y-[3vh]">
          <QuestionHeader
            headingRef={headingRef}
            position={position}
            scorable={state.question?.scorable ?? false}
            secondsLeft={left}
          />
          {state.question ? (
            <QuestionBoard
              question={state.question}
              lang={state.lang}
              reveal={state.phase === 'reveal' ? state.reveal : null}
              answered={state.answered}
            />
          ) : null}
        </div>
      );
      controls =
        state.phase === 'question' ? (
          <Button
            size="lg"
            className="min-h-14 px-8 text-lg"
            disabled={pending}
            onClick={() => void act('reveal')}
          >
            <Eye aria-hidden />
            {t('question.reveal')}
          </Button>
        ) : (
          <>
            {!state.revealAnswers && !last ? (
              <p className="text-sm text-slate-700">{t('leaderboard.later')}</p>
            ) : null}
            <Button
              variant="secondary"
              size="lg"
              disabled={pending || !(state.revealAnswers || last)}
              onClick={() => void act('leaderboard')}
            >
              <Trophy aria-hidden />
              {t('leaderboard.show')}
            </Button>
            <NextOrFinish last={last} pending={pending} act={act} />
          </>
        );
      break;

    case 'leaderboard':
      main = (
        <div className="space-y-[3vh]">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className={cn(SLIDE_TYPE.small, 'font-semibold text-slate-700 focus:outline-none')}
          >
            {position}
          </h2>
          <TeamLeaderboard state={state} />
        </div>
      );
      controls = <NextOrFinish last={last} pending={pending} act={act} />;
      break;

    case 'finished':
      main = (
        <div className="space-y-[3vh]">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className={cn(SLIDE_TYPE.hero, 'font-bold focus:outline-none')}
          >
            {t('finished.title')}
          </h2>
          <TeamLeaderboard state={state} />
          <p className={cn(SLIDE_TYPE.small, 'text-slate-800')}>{t('finished.body')}</p>
        </div>
      );
      controls = (
        <EndSessionDialog
          sessionId={sessionId}
          keep={state.keep}
          retentionDays={retentionDays}
          onEnded={() => openAsNewDocument(classTab)}
          size="lg"
          variant="primary"
        />
      );
      break;
  }

  // Answers so far, out of the devices in the game (announced as they arrive).
  const counter =
    state.phase === 'question' || state.phase === 'reveal' ? (
      <p aria-live="polite" className="text-lg font-semibold text-slate-900 tabular-nums">
        {t('question.answered', { count: state.answered, total: state.devices.count })}
      </p>
    ) : null;

  return (
    <div className="flex h-dvh flex-col bg-white text-slate-950">
      <h1 className="sr-only">{t('projector.pageTitle', { title: state.title ?? '' })}</h1>
      <div
        role="group"
        aria-label={t('projector.controls')}
        className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2"
      >
        <p className="min-w-0 flex-1 truncate font-semibold text-slate-900">{state.title}</p>
        {offline ? (
          <p role="status" className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <WifiOff aria-hidden className="size-4" />
            {t('projector.offline')}
          </p>
        ) : null}
        <DevicesPanel
          state={state}
          pending={pending}
          onMove={(participantId, team) => void act('move', participantId, team)}
          onRemove={(participantId) => act('remove', participantId)}
          onJoining={(open) => void act(open ? 'unlock' : 'lock')}
        />
        {fullscreenEnabled ? (
          <Button variant="ghost" onClick={toggleFullscreen}>
            {fullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
            {fullscreen ? t('projector.exitFullscreen') : t('projector.fullscreen')}
          </Button>
        ) : null}
        {state.phase !== 'finished' ? (
          <EndSessionDialog
            sessionId={sessionId}
            keep={state.keep}
            retentionDays={retentionDays}
            onEnded={() => openAsNewDocument(classTab)}
          />
        ) : null}
        <Button asChild variant="ghost">
          <a href={classTab} title={t('projector.exitHint')}>
            <X aria-hidden />
            {t('projector.exit')}
          </a>
        </Button>
      </div>

      {/* The projector layout is the page's <main>. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-[4vw] py-[3vh]">{main}</div>

      <div
        role="group"
        aria-label={t('projector.actions')}
        className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3"
      >
        <div className="mr-auto">{counter}</div>
        {controls}
      </div>
    </div>
  );
}

function QuestionHeader({
  headingRef,
  position,
  scorable,
  secondsLeft,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  position: string;
  scorable: boolean;
  secondsLeft: number | null;
}) {
  const t = useTranslations('classMode');
  return (
    <div className="flex flex-wrap items-center gap-[1.5vw]">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className={cn(SLIDE_TYPE.heading, 'font-semibold text-slate-700 focus:outline-none')}
      >
        {position}
      </h2>
      {!scorable ? (
        <span
          className={cn(
            SLIDE_TYPE.small,
            'rounded-full border-2 border-slate-400 px-[0.6em] font-semibold text-slate-800',
          )}
        >
          {t('question.notScored')}
        </span>
      ) : null}
      {secondsLeft !== null ? (
        <span
          role="timer"
          className={cn(
            SLIDE_TYPE.small,
            'ml-auto rounded-full bg-slate-950 px-[0.7em] font-bold text-white tabular-nums',
          )}
        >
          {secondsLeft > 0
            ? t('question.timeLeft', { seconds: secondsLeft })
            : t('question.timeUp')}
        </span>
      ) : null}
    </div>
  );
}

function NextOrFinish({
  last,
  pending,
  act,
}: {
  last: boolean;
  pending: boolean;
  act: (action: SessionAction) => Promise<void>;
}) {
  const t = useTranslations('classMode');
  return last ? (
    <Button
      size="lg"
      className="min-h-14 px-8 text-lg"
      disabled={pending}
      onClick={() => void act('finish')}
    >
      <Flag aria-hidden />
      {t('leaderboard.finish')}
    </Button>
  ) : (
    <Button
      size="lg"
      className="min-h-14 px-8 text-lg"
      disabled={pending}
      onClick={() => void act('next')}
    >
      {t('leaderboard.next')}
      <ArrowRight aria-hidden />
    </Button>
  );
}
