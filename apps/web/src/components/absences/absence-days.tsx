'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface AbsenceDayTab {
  key: string;
  label: string;
  content: ReactNode;
}

/**
 * One tab per school day of the absence (the panels are rendered on the server). A single day
 * shows its panel without tabs. Arrow keys move between tabs (WAI-ARIA tabs pattern).
 */
export function AbsenceDays({
  tabs,
  initialKey,
  footer,
}: {
  tabs: AbsenceDayTab[];
  initialKey?: string;
  /** Days without school, listed under the tabs. */
  footer?: ReactNode;
}) {
  const t = useTranslations('absences');
  const id = useId();
  const [chosen, setSelected] = useState(
    tabs.find((tab) => tab.key === initialKey)?.key ?? tabs[0]?.key,
  );
  // A day can disappear (the absence was shortened): fall back to the first one.
  const selected = tabs.some((tab) => tab.key === chosen) ? chosen : tabs[0]?.key;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  if (tabs.length <= 1) {
    return (
      <div className="space-y-3">
        {tabs[0]?.content}
        {footer}
      </div>
    );
  }

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : e.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setSelected(tabs[next]!.key);
    refs.current[next]?.focus();
  };

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label={t('days')}
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4"
      >
        {tabs.map((tab, i) => {
          const active = tab.key === selected;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${i}`}
              aria-selected={active}
              aria-controls={`${id}-panel-${i}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setSelected(tab.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-slate-600 hover:text-slate-900',
                active && 'border-brand-600 text-brand-700',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${id}-panel-${i}`}
          aria-labelledby={`${id}-tab-${i}`}
          hidden={tab.key !== selected}
        >
          {tab.content}
        </div>
      ))}
      {footer}
    </div>
  );
}
