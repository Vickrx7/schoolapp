'use client';

import type { DocLang, Slide } from '@lynx/content';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Maximize, Minimize, X } from 'lucide-react';
import { createTranslator, useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-action';
import { cn } from '@/lib/utils';
import { revealPresenterAnswer } from '@/server/actions/class-mode-present';
import type { PresenterAnswer } from '@/server/class-mode/presenter';
import { SlideView, type SlideMessages, type SlideText } from './slide-view';
import { TIMER_SPACE, TimerControls, TimerDisplay, usePresenterTimer } from './timer';

/**
 * « Présenter à la classe » (DECISIONS D-082, D-086, D-090): the projector player. It receives
 * the slides only, built on the server from the student content; it never has the item, a level
 * name or an answer key. « Afficher la réponse » asks the server for the current question's
 * answer (`revealPresenterAnswer`) and shows it under the question; changing slides hides it.
 *
 * - ← and →, Page Up and Page Down (a presentation remote), Space and Shift+Space, Home and End
 *   change slides; « F » toggles full screen.
 * - The slide number is kept in the address (`?s=`), so a reload comes back to it.
 * - The slide carries the content's language; the controls are in the interface language.
 * - Nothing is written anywhere: no database session, nothing in the browser's storage.
 */

export interface SlidesPlayerProps {
  itemId: string;
  versionId: string;
  /** The title slide's title, the page's (visually hidden) main heading. */
  title: string;
  slides: Slide[];
  lang: DocLang;
  /** `classPresenter.slide` in the content's language. */
  slideMessages: SlideMessages;
  initialIndex: number;
  /** « Quitter la présentation »: back to the item page on the same version. */
  exitHref: string;
  /** Some of the stored content could not be read. */
  partial: boolean;
  /** The version has an answer key: « Afficher la réponse » on question slides. */
  hasKey: boolean;
}

const subscribeFullscreen = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
};

/** Keys typed into a field or pressed on a control keep their usual meaning. */
function ownsKey(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest('input, textarea, select')) return true;
  // Space and Enter press the focused button or follow the focused link.
  return (key === ' ' || key === 'Enter') && target.closest('button, a') !== null;
}

export function SlidesPlayer({
  itemId,
  versionId,
  title,
  slides,
  lang,
  slideMessages,
  initialIndex,
  exitHref,
  partial,
  hasKey,
}: SlidesPlayerProps) {
  const t = useTranslations('classPresenter');
  const answerId = useId();
  const total = slides.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), total - 1));
  const slide = slides[index]!;
  const timer = usePresenterTimer();

  // Slide labels in the content's language (« Étape 2 sur 6 » for French content, « Step 2 of
  // 6 » for Anglais), whatever the interface language.
  const slideText = useMemo<SlideText>(() => {
    const translate = createTranslator({ locale: lang, messages: slideMessages });
    return (key, values) => translate(key, values);
  }, [lang, slideMessages]);

  // The slide on screen, for the keyboard handler and answers that arrive late.
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // « Afficher la réponse »: answers fetched once per question, shown on the slide they were
  // asked on (moving to another slide hides them).
  const [answers, setAnswers] = useState<ReadonlyMap<string, PresenterAnswer | null>>(
    () => new Map(),
  );
  const [revealedAt, setRevealedAt] = useState<number | null>(null);
  const reveal = useAction(revealPresenterAnswer);
  const question = slide.kind === 'question' ? slide.question : null;
  const revealed = question !== null && revealedAt === index && answers.has(question.id);

  const toggleAnswer = async () => {
    if (!question) return;
    if (revealed) {
      setRevealedAt(null);
      return;
    }
    if (answers.has(question.id)) {
      setRevealedAt(index);
      return;
    }
    const asked = index;
    const result = await reveal.run(itemId, versionId, question.id);
    if (!result?.ok) return;
    setAnswers((known) => new Map(known).set(question.id, result.data));
    // Shown only if the teacher is still on that slide.
    if (indexRef.current === asked) setRevealedAt(asked);
  };

  const go = useCallback(
    (next: number) => {
      const target = Math.min(Math.max(next, 0), total - 1);
      indexRef.current = target;
      setIndex(target);
      setRevealedAt(null);
      const url = new URL(window.location.href);
      if (target === 0) url.searchParams.delete('s');
      else url.searchParams.set('s', String(target + 1));
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
    },
    [total],
  );

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

  // Leaving the presentation leaves full screen too (the item page is not a slide show).
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (ownsKey(e.target, e.key)) return;
      const current = indexRef.current;
      let next: number | null = null;
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
          next = current + 1;
          break;
        case 'ArrowLeft':
        case 'PageUp':
          next = current - 1;
          break;
        case ' ':
          next = e.shiftKey ? current - 1 : current + 1;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = total - 1;
          break;
        case 'f':
        case 'F':
          if (fullscreenEnabled) {
            e.preventDefault();
            toggleFullscreen();
          }
          return;
        default:
          return;
      }
      e.preventDefault();
      // At either end, a key does nothing (an answer on screen stays shown).
      const target = Math.min(Math.max(next, 0), total - 1);
      if (target !== current) go(target);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go, total, fullscreenEnabled, toggleFullscreen]);

  const answer = revealed && question ? answers.get(question.id) : undefined;
  const position = t('position', { n: index + 1, total });

  // A long question can push its answer below the fold: bring it into view once shown.
  useEffect(() => {
    if (!revealed) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(answerId)
      ?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [revealed, answerId]);

  return (
    <div className="flex h-dvh flex-col bg-white text-slate-950">
      <h1 className="sr-only">{title}</h1>

      <div className="relative min-h-0 flex-1">
        <section
          key={index}
          lang={lang}
          aria-roledescription={t('slideRole')}
          aria-label={position}
          // Long slides (a game's rules) scroll; the keyboard can reach and scroll them.
          tabIndex={0}
          className={cn(
            'h-full overflow-y-auto px-[5vw] py-[4vh] focus-visible:outline-offset-[-4px]',
            // While the timer runs, the slide keeps clear of it (TIMER_SPACE).
            timer.running && TIMER_SPACE,
          )}
          data-slide-kind={slide.kind}
        >
          <SlideView slide={slide} t={slideText} answer={answer} answerId={answerId} />
        </section>
        <TimerDisplay timer={timer} />
      </div>

      <div
        role="group"
        aria-label={t('controls')}
        className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 print:hidden"
      >
        <Button asChild variant="ghost">
          <Link href={exitHref} prefetch={false}>
            <X aria-hidden />
            {t('exit')}
          </Link>
        </Button>
        {fullscreenEnabled ? (
          <Button variant="ghost" aria-keyshortcuts="F" onClick={toggleFullscreen}>
            {fullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
            {fullscreen ? t('exitFullscreen') : t('fullscreen')}
          </Button>
        ) : null}
        <TimerControls timer={timer} />
        {partial ? <p className="text-sm text-amber-900">{t('partial')}</p> : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {question && hasKey ? (
            <Button
              variant="secondary"
              size="lg"
              aria-expanded={revealed}
              aria-controls={answerId}
              disabled={reveal.pending}
              onClick={() => void toggleAnswer()}
            >
              {revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {revealed ? t('hideAnswer') : t('showAnswer')}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="lg"
            className="min-h-14 px-6"
            aria-keyshortcuts="ArrowLeft PageUp Shift+Space"
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <ArrowLeft aria-hidden />
            {t('previous')}
          </Button>
          <p className="min-w-16 text-center text-lg font-semibold text-slate-800 tabular-nums">
            <span aria-hidden>
              {index + 1} / {total}
            </span>
            {/* Announced when the slide changes. */}
            <span className="sr-only" aria-live="polite">
              {position}
            </span>
          </p>
          <Button
            size="lg"
            className="min-h-14 px-6"
            aria-keyshortcuts="ArrowRight PageDown Space"
            disabled={index === total - 1}
            onClick={() => go(index + 1)}
          >
            {t('next')}
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
