'use client';

import type { CommentStatus } from '@lynx/domain';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export interface StudentRow {
  id: string;
  firstName: string;
  status: CommentStatus;
}

const TONES: Record<CommentStatus['kind'], string> = {
  todo: 'bg-slate-100 text-slate-700',
  started: 'bg-amber-50 text-amber-900',
  ready: 'bg-emerald-50 text-emerald-800',
  over: 'bg-red-50 text-red-800',
};

/**
 * The class's students for the chosen subject (DECISIONS D-130), each a link to `#eleve-<id>`
 * (the address's fragment never leaves the browser; Back returns to the list on a phone) with its
 * status in words: « À faire », « Commencé », « Prêt · 612 / 1 000 », « Dépasse de 112
 * caractères ».
 */
export function StudentList({
  students,
  currentId,
  limit,
  onPick,
}: {
  students: StudentRow[];
  currentId: string | null;
  limit: number;
  onPick: () => void;
}) {
  const t = useTranslations('reportComments.students');
  const locale = useLocale();
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);
  const counts = { ready: 0, started: 0, todo: 0, over: 0 };
  for (const s of students) counts[s.status.kind] += 1;
  const label = (status: CommentStatus) =>
    status.kind === 'ready'
      ? t('status.ready', { count: number(status.length), limit: number(limit) })
      : status.kind === 'over'
        ? t('status.over', { over: status.over })
        : t(`status.${status.kind}`);
  return (
    <nav aria-labelledby="report-students" className="min-w-0 space-y-2">
      <div>
        <h3 id="report-students" className="text-base font-semibold text-slate-900">
          {t('heading', { count: students.length })}
        </h3>
        <p className="text-sm text-slate-600" data-testid="report-progress">
          {t('summary', {
            ready: counts.ready + counts.over,
            started: counts.started,
            todo: counts.todo,
          })}
        </p>
      </div>
      <ol className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {students.map((s) => {
          const current = s.id === currentId;
          return (
            <li key={s.id}>
              <a
                href={`#eleve-${s.id}`}
                onClick={onPick}
                aria-current={current ? 'true' : undefined}
                className={cn(
                  'flex min-h-12 items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50',
                  current && 'bg-brand-50 hover:bg-brand-50',
                )}
              >
                <span
                  className={cn(
                    'min-w-0 truncate font-medium text-slate-900',
                    current && 'text-brand-800',
                  )}
                >
                  {s.firstName}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
                    TONES[s.status.kind],
                  )}
                >
                  {label(s.status)}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
