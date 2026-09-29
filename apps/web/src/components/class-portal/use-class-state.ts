'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceOkState } from '../../server/class-portal/schemas';
import { busyDelay, clockOffset, devicePollDelay } from './polling';

/**
 * A class device's view of the game (DECISIONS D-085): it polls `GET /jouer/api/state?v=…` every
 * 1.5 s while the page is visible, backs off to 5 s after a failure (the offline banner shows),
 * pauses while the page is hidden and asks again as soon as it shows. The answer is `unchanged`
 * unless the teacher moved the game on. The transport stays in this hook, so it can move to
 * Server-Sent Events without touching the screens.
 *
 * Nothing is stored in the browser: the view lives in this component only (D-088).
 */

export type GameOver = 'gone' | 'ended';

export interface ClassState {
  /** Null until the first answer arrives (« Connexion… »). */
  state: DeviceOkState | null;
  /** The game is over for this device: its token no longer works. */
  over: GameOver | null;
  /** The last poll failed; the banner says « Connexion perdue… on réessaie. » */
  offline: boolean;
  /** The server's clock minus this device's (for a question's countdown). */
  offsetMs: number;
  /** Takes a newer view received with an answer or a team choice. */
  apply: (next: DeviceOkState) => void;
  /** The game ended for this device (an answer came back gone or ended). */
  end: (reason: GameOver) => void;
}

type StateBody =
  | DeviceOkState
  | { status: 'unchanged'; serverNow: string }
  | { status: 'gone' | 'ended' | 'notConfigured' | 'error' };

export function useClassState(initial: DeviceOkState | null): ClassState {
  const [state, setState] = useState<DeviceOkState | null>(initial);
  const [over, setOver] = useState<GameOver | null>(null);
  const [offline, setOffline] = useState(false);
  const [offsetMs, setOffsetMs] = useState(() => clockOffset(initial?.serverNow));
  const versionRef = useRef<number | null>(initial?.version ?? null);

  const apply = useCallback((next: DeviceOkState) => {
    // A reply that raced a newer poll must not take the screen back.
    if (versionRef.current !== null && next.version < versionRef.current) return;
    versionRef.current = next.version;
    setState(next);
    setOffsetMs(clockOffset(next.serverNow));
  }, []);

  const end = useCallback((reason: GameOver) => setOver(reason), []);

  useEffect(() => {
    if (over) return;
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
      // A hidden page waits until it shows again (below).
      if (stopped || busy || document.visibilityState === 'hidden') return;
      busy = true;
      let delay = devicePollDelay(0);
      try {
        const known = versionRef.current;
        const response = await fetch(`/jouer/api/state${known === null ? '' : `?v=${known}`}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (response.status === 503) {
          delay = busyDelay(response.headers.get('retry-after'));
        } else {
          if (!response.ok) throw new Error(String(response.status));
          const body = (await response.json()) as StateBody;
          failures = 0;
          setOffline(false);
          if (body.status === 'ok') apply(body);
          else if (body.status === 'unchanged') setOffsetMs(clockOffset(body.serverNow));
          else if (body.status === 'gone' || body.status === 'ended') {
            stopped = true;
            setOver(body.status);
            return;
          } else throw new Error(body.status);
        }
      } catch {
        failures += 1;
        setOffline(true);
        delay = devicePollDelay(failures);
      } finally {
        busy = false;
      }
      if (!stopped) schedule(delay);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stopped && timer === undefined && !busy) {
        schedule(0);
      }
    };

    schedule(versionRef.current === null ? 0 : devicePollDelay(0));
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [over, apply]);

  return { state, over, offline, offsetMs, apply, end };
}
