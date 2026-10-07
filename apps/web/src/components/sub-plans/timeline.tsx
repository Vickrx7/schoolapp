'use client';

import { localDateIn, localMinutesIn, type LocalDate } from '@lynx/domain';
import { ArrowDown, Clock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { Card } from '@/components/ui/card';
import { formatTime, formatTimeRange } from '@/lib/format';
import { PLAN_CONTENT_LANG } from './block-card';
import { timelineState, type TimelineBlock } from './timeline-state';

const MINUTE = 60_000;

// The device's clock, to the minute (a stable snapshot between ticks; none on the server).
function subscribe(callback: () => void) {
  const timer = window.setInterval(callback, 15_000);
  return () => window.clearInterval(timer);
}
const currentMinute = () => Math.floor(Date.now() / MINUTE);
const noMinute = () => null;

function BlockLine({ label, block }: { label: string; block: TimelineBlock }) {
  const t = useTranslations('subPortal');
  const locale = useLocale();
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">{label}</p>
      <p className="font-medium text-slate-900">
        <span className="tabular-nums">{formatTimeRange(block.start, block.end, locale)}</span> ·{' '}
        <span lang={PLAN_CONTENT_LANG}>{block.title}</span>
      </p>
      <a
        href={`#block-${block.key}`}
        className="inline-flex min-h-11 items-center gap-1 text-sm text-brand-700 underline underline-offset-2"
      >
        <ArrowDown className="size-4" aria-hidden />
        {t('goToBlock', { title: block.title })}
      </a>
    </div>
  );
}

/**
 * « Maintenant » and « Ensuite » at the top of the substitute's schedule, from the device's
 * clock on the school's time zone, on the plan date only. Rendered after hydration (the
 * server does not know the device's time).
 */
export function Timeline({
  blocks,
  planDate,
  timeZone,
}: {
  blocks: TimelineBlock[];
  planDate: LocalDate;
  timeZone: string;
}) {
  const t = useTranslations('subPortal');
  const locale = useLocale();
  const minute = useSyncExternalStore(subscribe, currentMinute, noMinute);
  if (minute === null) return null;
  const instant = new Date(minute * MINUTE);
  const state = timelineState(
    blocks,
    planDate,
    localDateIn(timeZone, instant),
    localMinutesIn(timeZone, instant),
  );
  if (state.kind === 'otherDay') return null;

  return (
    <Card className="border-brand-200 bg-brand-50/60 p-4" data-testid="timeline" aria-live="polite">
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          {state.kind === 'before' ? (
            <>
              <p className="text-sm text-slate-700">
                {t('beforeDay', { time: formatTime(state.next.start, locale) })}
              </p>
              <BlockLine label={t('next')} block={state.next} />
            </>
          ) : state.kind === 'after' ? (
            <p className="text-sm text-slate-700">{t('afterDay')}</p>
          ) : (
            <>
              {state.now ? <BlockLine label={t('now')} block={state.now} /> : null}
              {state.next ? <BlockLine label={t('next')} block={state.next} /> : null}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
