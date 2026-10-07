import type { ComposedBlock, SubPlanAudience } from '@lynx/domain';
import { MapPin, Pencil, Sparkles, TriangleAlert, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Badge, Card } from '@/components/ui/card';
import { formatTime, formatTimeRange } from '@/lib/format';
import { cn } from '@/lib/utils';
import { HiddenLibraryNotice, LibraryBlock } from './library-block';

/**
 * The language of plan content: the plan is built in French, and teachers type in French,
 * whatever the interface language (D-033). Marked on the content itself (WCAG 3.1.2), so a
 * screen reader reads it in French when the interface is in English.
 */
export const PLAN_CONTENT_LANG = 'fr-CA';

/** Teacher text shown as typed: line breaks kept, never translated. */
export function TypedText({ text, className }: { text: string; className?: string }) {
  return (
    <p lang={PLAN_CONTENT_LANG} className={cn('whitespace-pre-line break-words', className)}>
      {text}
    </p>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-sm">
      <p className="font-medium text-slate-700">{label}</p>
      <div className="text-slate-800">{children}</div>
    </div>
  );
}

/** Whether a template step already quotes this text (the lesson note, its content). */
const quoted = (block: ComposedBlock, text: string | null) =>
  !!text && block.steps.some((s) => s.text.includes(text.trim()));

/**
 * One block of the day: when, what, where, with whom, the lesson, its steps and its library
 * resource (D-077). The same card for every audience; the editor passes `edit` to replace the
 * steps with its controls and to hide or bring back the resource.
 */
export function BlockCard({
  block,
  audience,
  showClass,
  groupLabels = {},
  groupNames = {},
  edit,
}: {
  block: ComposedBlock;
  audience: SubPlanAudience;
  showClass: boolean;
  /** « G1 · Débutant », for the AI layer's instructions and the resource's versions by group. */
  groupLabels?: Readonly<Record<string, string>>;
  /** First names per group (groups-panel.tsx), for whom gets which version of a resource. */
  groupNames?: Readonly<Record<string, readonly string[]>>;
  edit?: { steps?: ReactNode; actions?: ReactNode; library?: ReactNode };
}) {
  const t = useTranslations('subPlan');
  const tAi = useTranslations('subPlanAi');
  const tRoot = useTranslations();
  const locale = useLocale();
  const lesson = block.lesson;
  const routine = block.kind !== 'subject' && block.kind !== 'handover' && !block.event;

  return (
    <Card
      className={cn('overflow-hidden', routine && 'border-dashed shadow-none')}
      data-testid="plan-block"
    >
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-medium whitespace-nowrap text-slate-600 tabular-nums">
            {formatTimeRange(block.start, block.end, locale)}
          </span>
          <h3 lang={PLAN_CONTENT_LANG} className="font-semibold text-slate-900">
            {block.title}
          </h3>
          {showClass ? <Badge>{block.className}</Badge> : null}
          {block.status !== 'normal' ? (
            <Badge tone="warning">{tRoot(`today.status.${block.status}`)}</Badge>
          ) : null}
          {block.roomName ? (
            <span className="inline-flex items-center gap-1 text-sm text-slate-500">
              <MapPin className="size-3.5" aria-hidden />
              {block.roomName}
            </span>
          ) : null}
          {audience === 'owner' && block.edited ? (
            <Badge tone="brand">
              <Pencil className="size-3" aria-hidden />
              {t('edited')}
            </Badge>
          ) : null}
        </div>

        {block.otherAdult ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <Users className="size-4" aria-hidden />
            {t('block.otherAdult', { name: block.otherAdult })}
          </p>
        ) : null}

        {block.event ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">
              <span lang={PLAN_CONTENT_LANG}>{block.event.title}</span>
              {block.event.start ? ` · ${formatTime(block.event.start, locale)}` : ''}
            </p>
            {block.event.notes ? <TypedText text={block.event.notes} /> : null}
          </div>
        ) : null}

        {lesson ? (
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              {t('block.lesson', { n: lesson.sequenceNumber, unit: lesson.unitTitle })}
              {lesson.assignment === 'taught' ? ` · ${t('block.taught')}` : ''}
            </p>
            <p lang={PLAN_CONTENT_LANG} className="font-medium text-slate-900">
              {lesson.title}
            </p>
            {lesson.gapBefore ? (
              <p className="text-sm text-amber-800">
                {t('block.gap', { title: lesson.gapBefore })}
              </p>
            ) : null}
            {lesson.objectives && !quoted(block, lesson.objectives) ? (
              <Labelled label={t('block.objectives')}>
                <TypedText text={lesson.objectives} />
              </Labelled>
            ) : null}
            {lesson.materials ? (
              <Labelled label={t('block.materials')}>
                <TypedText text={lesson.materials} />
              </Labelled>
            ) : null}
            {lesson.subNotes && !quoted(block, lesson.subNotes) ? (
              <Labelled label={t('block.subNotes')}>
                <TypedText text={lesson.subNotes} />
              </Labelled>
            ) : null}
            {lesson.content && !quoted(block, lesson.content) ? (
              <details className="rounded-lg bg-slate-50 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-slate-700">
                  {t('block.content')}
                </summary>
                <TypedText text={lesson.content} className="mt-2 text-slate-800" />
              </details>
            ) : null}
          </div>
        ) : null}

        {block.notes ? (
          <Labelled label={t('block.notes')}>
            <TypedText text={block.notes} />
          </Labelled>
        ) : null}

        {block.ai?.overview ? (
          <Labelled label={tAi('block.overview')}>
            <TypedText text={block.ai.overview} />
          </Labelled>
        ) : null}

        {edit?.steps ?? (
          <div>
            <p className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">
              {t('block.steps')}
              {block.stepsSource === 'ai' ? (
                <Badge tone="brand">
                  <Sparkles className="size-3" aria-hidden />
                  {tAi('block.badge')}
                </Badge>
              ) : null}
            </p>
            {block.steps.length === 0 ? (
              <p className="text-sm text-slate-500">{t('block.noSteps')}</p>
            ) : (
              <ol className="space-y-1.5 text-sm">
                {block.steps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-14 shrink-0 whitespace-nowrap text-slate-500 tabular-nums">
                      {s.minutes ? t('block.minutes', { n: s.minutes }) : '•'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <TypedText text={s.text} />
                      {s.say ? (
                        <span className="mt-0.5 block text-slate-600 italic">
                          {t('block.say')} <span lang={PLAN_CONTENT_LANG}>{s.say}</span>
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {block.teacherNote ? (
          <Labelled label={t('block.teacherNote')}>
            <TypedText text={block.teacherNote} />
          </Labelled>
        ) : null}

        {block.library ? (
          <LibraryBlock
            library={block.library}
            showItemLink={audience === 'owner'}
            groupLabels={groupLabels}
            groupNames={groupNames}
            actions={edit?.library}
          />
        ) : block.hiddenLibrary && audience === 'owner' ? (
          <HiddenLibraryNotice title={block.hiddenLibrary.title} actions={edit?.library} />
        ) : null}

        {block.ai?.differentiation.length ? (
          <Labelled label={tAi('block.differentiation')}>
            <ul className="mt-1 space-y-1.5" data-testid="plan-ai-groups">
              {block.ai.differentiation.map((d, i) => (
                <li key={i}>
                  <span className="font-medium">{groupLabels[d.group] ?? d.group}</span>
                  <TypedText text={d.instruction} />
                </li>
              ))}
            </ul>
          </Labelled>
        ) : null}
        {block.ai?.activity ? (
          <div
            className="space-y-1.5 rounded-lg border border-slate-200 p-3 text-sm"
            data-testid="plan-ai-activity"
          >
            <p className="font-medium text-slate-700">{tAi('block.activity')}</p>
            <p lang={PLAN_CONTENT_LANG} className="font-medium text-slate-900">
              {block.ai.activity.title}
            </p>
            <TypedText text={block.ai.activity.studentInstructions} className="text-slate-800" />
            {block.ai.activity.perGroup.length ? (
              <ul className="space-y-1.5">
                {block.ai.activity.perGroup.map((g, i) => (
                  <li key={i}>
                    <span className="font-medium text-slate-700">
                      {tAi('block.perGroup', { group: groupLabels[g.group] ?? g.group })}
                    </span>
                    <TypedText text={g.studentInstructions} className="text-slate-800" />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {block.ai?.materialsChecklist.length ? (
          <Labelled label={t('block.materials')}>
            <ul lang={PLAN_CONTENT_LANG} className="list-disc pl-5">
              {block.ai.materialsChecklist.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </Labelled>
        ) : null}
        {block.ai?.ifTimeRemains ? (
          <Labelled label={t('block.ifTime')}>
            <TypedText text={block.ai.ifTimeRemains} />
          </Labelled>
        ) : null}

        {audience === 'owner' && block.warnings.length > 0 ? (
          <ul className="space-y-1">
            {block.warnings.map((w) => (
              <li key={w} className="flex items-start gap-1.5 text-sm text-amber-800">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t(`warnings.${w}`)}
              </li>
            ))}
          </ul>
        ) : null}

        {edit?.actions ? <div className="flex flex-wrap gap-2">{edit.actions}</div> : null}
      </div>
    </Card>
  );
}
