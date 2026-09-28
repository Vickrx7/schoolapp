'use client';

import type { TimetableBlock } from '@lynx/domain';
import { AlertTriangle, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/page';
import { formatTimeRange } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SubjectOption } from '@/server/queries/subjects';
import { BlockForm } from './block-form';

export type BoardBlock = TimetableBlock & { notes: string | null; overlaps: boolean };

export function TimetableBoard({
  classId,
  scheduleType,
  dayCount,
  blocks,
  subjects,
  team,
  rooms,
  defaults,
}: {
  classId: string;
  scheduleType: 'weekly' | 'cycle';
  dayCount: number;
  blocks: BoardBlock[];
  subjects: SubjectOption[];
  team: { id: string; name: string }[];
  rooms: { id: string; name: string }[];
  defaults: { start: string; end: string };
}) {
  const t = useTranslations();
  const [editing, setEditing] = useState<BoardBlock | 'new' | null>(null);
  const days = Array.from({ length: dayCount }, (_, i) => i + 1);
  const dayLabel = (d: number) =>
    scheduleType === 'cycle' ? t('days.cycleDay', { n: d }) : t(`days.${d}` as 'days.1');
  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('timetable.title')}</h2>
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden />
          {t('timetable.addBlock')}
        </Button>
      </div>

      {blocks.length === 0 ? (
        <EmptyState title={t('timetable.empty')} body={t('timetable.emptyHelp')} />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <div
            className="grid gap-3 md:min-w-[48rem] md:[grid-template-columns:repeat(var(--days),minmax(9rem,1fr))]"
            style={{ '--days': dayCount } as CSSProperties}
          >
            {days.map((d) => (
              <section key={d} aria-label={dayLabel(d)}>
                <h3 className="mb-2 text-sm font-semibold text-slate-700 capitalize">
                  {dayLabel(d)}
                </h3>
                <ul className="space-y-1.5">
                  {blocks
                    .filter((b) => b.dayKey === d)
                    .map((b) => {
                      const subject = b.subjectId ? subjectById.get(b.subjectId) : undefined;
                      return (
                        <li key={b.id}>
                          <button
                            type="button"
                            onClick={() => setEditing(b)}
                            className={cn(
                              'w-full rounded-lg border bg-white p-2 text-left text-sm shadow-sm hover:border-brand-400',
                              b.kind === 'subject'
                                ? 'border-slate-200'
                                : 'border-dashed border-slate-300 bg-slate-50',
                              b.overlaps && 'border-amber-400',
                            )}
                            style={
                              subject?.color
                                ? { borderLeft: `4px solid ${subject.color}` }
                                : undefined
                            }
                          >
                            <span className="block text-xs text-slate-500 tabular-nums">
                              {formatTimeRange(b.startTime, b.endTime)}
                            </span>
                            <span className="block font-medium">
                              {subject?.label ?? b.title ?? t(`timetable.kinds.${b.kind}`)}
                            </span>
                            {b.teacherId ? (
                              <span className="block text-xs text-slate-500">
                                {team.find((m) => m.id === b.teacherId)?.name}
                              </span>
                            ) : null}
                            {b.overlaps ? (
                              <span className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                                <AlertTriangle className="size-3" aria-hidden />
                                {t('timetable.overlap')}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing !== null ? (
          <DialogContent
            title={editing === 'new' ? t('timetable.addBlock') : t('timetable.editBlock')}
            closeLabel={t('common.close')}
          >
            <BlockForm
              classId={classId}
              block={editing === 'new' ? null : editing}
              days={days}
              dayLabel={dayLabel}
              subjects={subjects}
              team={team}
              rooms={rooms}
              defaults={defaults}
              onDone={() => setEditing(null)}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
