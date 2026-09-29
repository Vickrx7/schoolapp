'use client';

import { LogIn } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { openAsNewDocument } from '../../lib/new-document';
import { cn } from '../../lib/utils';
import { busyDelay } from './polling';

/**
 * « Rejoindre la partie » on a class device (DECISIONS D-084).
 *
 * - With the class link (a bookmark, or the QR code: `/jouer#k=…`), the device joins by itself:
 *   while no lobby is open it says « En attente de la partie… » and tries again every 5 s, so a
 *   bookmarked tablet joins as soon as the teacher starts. The fragment never reaches the server;
 *   it stays in the address until the device joins, so the teacher can bookmark the page.
 * - With the code: one big field (spaces, hyphens and lowercase are fine; the server normalizes
 *   it and refuses anything else without a database call) and « Rejoindre ». A link with
 *   `#code=` fills it in and joins; that fragment is removed from the address at once.
 *
 * The device token comes back in an HttpOnly cookie only; the page then opens the game as a new
 * document. Nothing is kept in the browser's storage.
 */

type Outcome =
  | 'ok'
  | 'invalid'
  | 'invalid_link'
  | 'waiting'
  | 'wait'
  | 'locked'
  | 'full'
  | 'notConfigured'
  | 'forbidden'
  | 'busy'
  | 'error';

type JoinView =
  | { kind: 'idle' }
  | { kind: 'joining' }
  | { kind: 'waiting' }
  | { kind: 'wait'; until: number }
  | {
      kind: 'message';
      key: 'invalid' | 'invalidLink' | 'locked' | 'full' | 'notConfigured' | 'busy' | 'error';
    };

type JoinBody = { code: string } | { link: string };

/** A class link waits this long between tries while no lobby is open (D-084). */
const WAITING_RETRY_MS = 5000;

/** `k=` (class link) or `code=` from the address's fragment. */
function readFragment(): { link: string | null; code: string | null } {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const link = params.get('k');
  const code = params.get('code');
  return {
    link: link && link.length <= 64 ? link : null,
    code: code && code.length <= 64 ? code : null,
  };
}

export function JoinForm() {
  const t = useTranslations('classPortal');
  const id = useId();
  const [code, setCode] = useState('');
  const [view, setView] = useState<JoinView>({ kind: 'idle' });
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopped = useRef(false);
  // The latest `join`, for the retries it schedules itself.
  const joinRef = useRef<(body: JoinBody) => Promise<void>>(async () => undefined);

  const join = useCallback(async (body: JoinBody) => {
    clearTimeout(retry.current);
    const byLink = 'link' in body;
    const again = (ms: number) => {
      if (!stopped.current) retry.current = setTimeout(() => void joinRef.current(body), ms);
    };
    // A class link retrying keeps its message on screen (no flicker every 5 s).
    setView((current) => (byLink && current.kind !== 'idle' ? current : { kind: 'joining' }));
    let outcome: Outcome = 'error';
    let retryAfter = 30;
    let response: Response | null = null;
    try {
      response = await fetch('/jouer/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const json = (await response.json().catch(() => null)) as {
        outcome?: Outcome;
        retryAfter?: number;
      } | null;
      outcome = json?.outcome ?? (response.status === 503 ? 'busy' : 'error');
      retryAfter = json?.retryAfter ?? retryAfter;
    } catch {
      outcome = 'error';
    }
    if (stopped.current) return;

    switch (outcome) {
      case 'ok':
        stopped.current = true;
        // A new document: the game page loads the device's state with its new cookie.
        openAsNewDocument('/jouer/partie');
        return;
      case 'waiting':
        setView({ kind: 'waiting' });
        again(WAITING_RETRY_MS);
        return;
      case 'wait':
        setView({ kind: 'wait', until: Date.now() + retryAfter * 1000 });
        if (byLink) again(retryAfter * 1000);
        return;
      case 'invalid':
        setView({ kind: 'message', key: byLink ? 'invalidLink' : 'invalid' });
        return;
      case 'invalid_link':
        setView({ kind: 'message', key: 'invalidLink' });
        return;
      case 'locked':
        setView({ kind: 'message', key: 'locked' });
        // The teacher can reopen joining (« Rouvrir les inscriptions »): a class link keeps trying.
        if (byLink) again(WAITING_RETRY_MS);
        return;
      case 'full':
        setView({ kind: 'message', key: 'full' });
        return;
      case 'notConfigured':
        setView({ kind: 'message', key: 'notConfigured' });
        return;
      case 'busy':
        setView({ kind: 'message', key: 'busy' });
        again(busyDelay(response?.headers.get('retry-after') ?? null));
        return;
      default:
        setView({ kind: 'message', key: 'error' });
        if (byLink) again(WAITING_RETRY_MS);
    }
  }, []);

  useEffect(() => {
    joinRef.current = join;
  }, [join]);

  useEffect(() => {
    stopped.current = false;
    const { link, code: fromLink } = readFragment();
    if (fromLink) {
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      );
    }
    // The fragment only exists in the browser: the form is filled and joins after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    if (link) void join({ link });
    else if (fromLink) {
      setCode(fromLink);
      void join({ code: fromLink });
    }
    return () => {
      stopped.current = true;
      clearTimeout(retry.current);
    };
  }, [join]);

  // The throttle's countdown.
  const waitUntil = view.kind === 'wait' ? view.until : null;
  useEffect(() => {
    if (waitUntil === null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [waitUntil]);
  const secondsToWait = waitUntil === null ? 0 : Math.max(0, Math.ceil((waitUntil - now) / 1000));

  let message: string | null = null;
  if (view.kind === 'waiting') message = t('waiting');
  else if (view.kind === 'wait' && secondsToWait > 0)
    message = t('wait', { seconds: secondsToWait });
  else if (view.kind === 'message') message = t(view.key);

  const busy = view.kind === 'joining' || (view.kind === 'wait' && secondsToWait > 0);
  const tone = view.kind === 'waiting' || view.kind === 'joining' ? 'info' : 'problem';

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && code.trim()) void join({ code });
      }}
    >
      <div className="space-y-3">
        <label htmlFor={id} className="block text-[26px] font-bold text-slate-950">
          {t('codeLabel')}
        </label>
        <input
          id={id}
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          maxLength={16}
          aria-describedby={message ? `${id}-hint ${id}-message` : `${id}-hint`}
          aria-invalid={view.kind === 'message' && view.key === 'invalid' ? true : undefined}
          data-lpignore="true"
          data-1p-ignore="true"
          className="block min-h-20 w-full rounded-2xl border-4 border-slate-400 bg-white px-4 text-center font-mono text-[40px] font-bold tracking-[0.2em] text-slate-950 uppercase focus:border-slate-950 focus:outline-4 focus:outline-offset-2 focus:outline-slate-950"
        />
        <p id={`${id}-hint`} className="text-[22px] text-slate-700">
          {t('codeHint')}
        </p>
      </div>
      <div id={`${id}-message`} role="status" aria-live="polite" className="empty:hidden">
        {message ? (
          <p
            className={cn(
              'rounded-2xl border-2 px-4 py-3 text-[22px] font-semibold',
              tone === 'info'
                ? 'border-slate-400 bg-slate-50 text-slate-950'
                : 'border-red-700 bg-red-50 text-red-900',
            )}
          >
            {message}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={!ready || busy}
        className="inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-slate-950 px-6 text-[26px] font-bold text-white focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-slate-950 disabled:opacity-60"
      >
        <LogIn aria-hidden className="size-8" />
        {view.kind === 'joining' ? t('joining') : t('join')}
      </button>
    </form>
  );
}
