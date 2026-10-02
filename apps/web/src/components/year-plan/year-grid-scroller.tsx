'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The year grid's sideways-scrolling box (DECISIONS D-126). It opens on the current week (one
 * week of context before it, the subject column staying put), says with a fade on the right that
 * more weeks are that way, and is focusable so the keyboard can scroll it. `relative` keeps the
 * cells' screen-reader text inside the box (HANDOFF quirk), so the page itself never scrolls
 * sideways.
 */
export function YearGridScroller({
  labelledBy,
  children,
}: {
  labelledBy: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [after, setAfter] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const current = el.querySelector<HTMLElement>('[data-current-week]');
    const sticky = el.querySelector<HTMLElement>('[data-sticky-column]');
    if (current) {
      el.scrollLeft = Math.max(
        0,
        current.offsetLeft - (sticky?.offsetWidth ?? 0) - current.offsetWidth,
      );
    }
    const update = () => setAfter(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={box}
        role="region"
        aria-labelledby={labelledBy}
        tabIndex={0}
        className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
      >
        {children}
      </div>
      {after ? (
        <span
          className="pointer-events-none absolute inset-y-px right-px z-30 w-10 rounded-r-xl bg-gradient-to-l from-white"
          aria-hidden
        />
      ) : null}
    </div>
  );
}
