'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { busyDelay, clockOffset, projectorPollDelay } from '@/components/class-portal/polling';
import type { LiveState } from '@/server/class-portal/schemas';

/**
 * The projector's view of a session (DECISIONS D-085): it polls
 * `GET /projector/sessions/<id>/state` every second while the page is visible, backs off to 5 s
 * after a failure, and takes the state every teacher action returns at once. The transport stays
 * in this hook, so it can move to Server-Sent Events without touching the screens.
 */
export interface ProjectorState {
  state: LiveState;
  offline: boolean;
  /** The server's clock minus this computer's (for the countdown). */
  offsetMs: number;
  /** Takes the state a teacher action returned (a newer or equal version). */
  apply: (next: LiveState) => void;
  /** Asks again now (after « La séance a changé dans un autre onglet »). */
  refresh: () => void;
}

export function useProjectorState(sessionId: string, initial: LiveState): ProjectorState {
  const [state, setState] = useState<LiveState>(initial);
  const [offline, setOffline] = useState(false);
  const [offsetMs, setOffsetMs] = useState(() => clockOffset(initial.serverNow));
  const versionRef = useRef(initial.version);
  const pollNow = useRef<() => void>(() => undefined);

  const apply = useCallback((next: LiveState) => {
    if (next.version < versionRef.current) return;
    versionRef.current = next.version;
    setState(next);
    setOffsetMs(clockOffset(next.serverNow));
  }, []);

  useEffect(() => {
    let stopped = false;
    let busy = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void poll(), ms);
    };

    const poll = async () => {
      timer = undefined;
      if (stopped || busy || document.visibilityState === 'hidden') return;
      busy = true;
      let delay = projectorPollDelay(0);
      try {
        const response = await fetch(`/projector/sessions/${sessionId}/state`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (response.status === 503) {
          delay = busyDelay(response.headers.get('retry-after'));
        } else {
          if (!response.ok) throw new Error(String(response.status));
          const next = (await response.json()) as LiveState;
          failures = 0;
          setOffline(false);
          // Every poll carries the answers so far: take it even when the version is the same.
          if (next.version >= versionRef.current) {
            versionRef.current = next.version;
            setState(next);
            setOffsetMs(clockOffset(next.serverNow));
          }
          // A closed session changes no more.
          if (next.status === 'closed') {
            stopped = true;
            return;
          }
        }
      } catch {
        failures += 1;
        setOffline(true);
        delay = projectorPollDelay(failures);
      } finally {
        busy = false;
      }
      if (!stopped) schedule(delay);
    };

    pollNow.current = () => {
      if (!stopped && !busy) schedule(0);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stopped && timer === undefined && !busy) {
        schedule(0);
      }
    };

    schedule(projectorPollDelay(0));
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sessionId]);

  const refresh = useCallback(() => pollNow.current(), []);

  return { state, offline, offsetMs, apply, refresh };
}
