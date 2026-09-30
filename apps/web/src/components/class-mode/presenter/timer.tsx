'use client';

import { Square, Timer as TimerIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The projector's timer (« 30 s », « 1 min », « 2 min », DECISIONS D-082, D-090): a visual
 * countdown the teacher starts for a brain break's step, a question or a discussion. No sound,
 * and no animation when the system asks for reduced motion. It keeps running when the slide
 * changes, until it is stopped. The remaining time is computed from a deadline, so a busy tab
 * that skips ticks never drifts.
 */

export const TIMER_CHOICES = [
  { seconds: 30, key: 's30' },
  { seconds: 60, key: 'm1' },
  { seconds: 120, key: 'm2' },
] as const;

interface Running {
  deadline: number;
  durationMs: number;
}

export interface PresenterTimer {
  running: Running | null;
  /** Milliseconds left (0 once elapsed). */
  remainingMs: number;
  start: (seconds: number) => void;
  stop: () => void;
}

export function usePresenterTimer(): PresenterTimer {
  const [running, setRunning] = useState<Running | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= running.deadline) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [running]);

  return {
    running,
    remainingMs: running ? Math.max(0, running.deadline - now) : 0,
    start: (seconds) => {
      const t = Date.now();
      setNow(t);
      setRunning({ deadline: t + seconds * 1000, durationMs: seconds * 1000 });
    },
    stop: () => setRunning(null),
  };
}

/** « 1:05 » */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** « 30 s », « 1 min », « 2 min », then « Arrêter la minuterie » while one runs. */
export function TimerControls({ timer }: { timer: PresenterTimer }) {
  const t = useTranslations('classPresenter.timer');
  if (timer.running) {
    return (
      <Button variant="secondary" onClick={timer.stop}>
        <Square aria-hidden />
        {t('stop')}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={t('label')} className="flex items-center gap-1">
      <TimerIcon aria-hidden className="size-5 text-slate-600" />
      {TIMER_CHOICES.map(({ seconds, key }) => (
        <Button
          key={key}
          variant="secondary"
          aria-label={t('start', { duration: t(key) })}
          onClick={() => timer.start(seconds)}
        >
          {t(key)}
        </Button>
      ))}
    </div>
  );
}

/**
 * The room the slide leaves on its right while the countdown shows: the countdown's width and
 * its margin (`TimerDisplay`: 2vw from the edge), and 2vw between them, so no word of the slide
 * hides under it.
 */
export const TIMER_SPACE = 'pr-[calc(min(18rem,24vw)_+_4vw)]';

/** The countdown over the slide, large enough to read from the back of the room. */
export function TimerDisplay({ timer }: { timer: PresenterTimer }) {
  const t = useTranslations('classPresenter.timer');
  if (!timer.running) return null;
  const done = timer.remainingMs === 0;
  const left = timer.remainingMs / timer.running.durationMs;
  return (
    <div
      className={cn(
        'pointer-events-none absolute top-[2vh] right-[2vw] w-[min(18rem,24vw)] space-y-2 rounded-2xl border-[3px] bg-white px-4 py-3 shadow-lg',
        done ? 'border-red-700' : 'border-slate-400',
      )}
    >
      {done ? (
        <p
          role="status"
          className="text-[length:clamp(1.5rem,0.5rem_+_2vw,3rem)] font-bold text-red-800"
        >
          {t('done')}
        </p>
      ) : (
        <p
          role="timer"
          aria-label={t('remaining')}
          className="text-[length:clamp(2rem,1rem_+_3vw,4.5rem)] leading-none font-bold tabular-nums"
        >
          {formatRemaining(timer.remainingMs)}
        </p>
      )}
      <div aria-hidden className="h-3 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-brand-700 transition-[width] duration-300 ease-linear motion-reduce:transition-none"
          style={{ width: `${Math.round(left * 1000) / 10}%` }}
        />
      </div>
    </div>
  );
}
