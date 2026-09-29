import type { ComposedBlock, ComposedSubPlan } from '@lynx/domain';
import { Phone } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { formatLocalDate, formatTime, formatTimeRange } from '@/lib/format';
import { BlockCard, TypedText } from './block-card';
import { GroupsPanel } from './groups-panel';
import type { PlanContext, PlanLevel, RosterStudent } from './types';
import { WarningsList } from './warnings-list';

/** Where the editor plugs its controls into the view (the same layout for everyone). */
export interface PlanViewSlots {
  /** Above everything (notices, detached edits). */
  top?: ReactNode;
  /** Replaces the overview paragraph. */
  overview?: ReactNode;
  /** Controls for a block: its steps editor and actions. */
  block?: (block: ComposedBlock) => { steps?: ReactNode; actions?: ReactNode } | undefined;
  /** Replaces the end-of-day checklist. */
  endOfDay?: ReactNode;
  /** Replaces the faith moment. */
  faith?: ReactNode;
  /** Per class: the safety and medical alerts button. */
  alerts?: (cls: ComposedSubPlan['classes'][number]) => ReactNode;
}

/** A titled card of the plan. */
export function PlanSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">{children}</CardBody>
    </Card>
  );
}

function Note({ label, text }: { label: string; text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="text-sm">
      <p className="font-medium text-slate-700">{label}</p>
      <TypedText text={text} className="text-slate-800" />
    </div>
  );
}

/**
 * A substitute plan, composed for its audience (composeSubPlan): the day at a glance, the
 * schedule block by block, groups with first names, the class notes, contacts, the end of the
 * day and the faith moment. Plan content is French whatever the interface language; labels
 * follow the interface. Renders on the server (read-only) or inside the editor.
 */
export function PlanView({
  plan,
  context,
  roster,
  levels,
  slots = {},
}: {
  plan: ComposedSubPlan;
  context: PlanContext;
  roster: RosterStudent[];
  levels: PlanLevel[];
  slots?: PlanViewSlots;
}) {
  const t = useTranslations('subPlan');
  const tRoot = useTranslations();
  const locale = useLocale();
  const multipleClasses = plan.classes.length > 1;
  const classNotes = plan.classNotes.filter(
    (n) => n.arrival || n.routines || n.classManagement || n.dismissal || n.fallbackActivities,
  );
  const neighbours = plan.classNotes.filter((n) => n.neighbour);
  const team = plan.classNotes.flatMap((n) => n.team.map((m) => ({ ...m, classId: n.classId })));
  const className = (id: string) => plan.classes.find((c) => c.classId === id)?.name ?? '';

  return (
    <div className="space-y-4">
      {slots.top}
      {plan.audience === 'owner' ? <WarningsList plan={plan} /> : null}

      <Card>
        <CardBody className="space-y-3 pt-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {plan.classes.length > 0
                ? plan.classes.map((c) => c.name).join(' · ')
                : t('classOf', { name: context.teacherName })}
            </h2>
            <p className="text-sm text-slate-600">
              {[
                formatLocalDate(plan.date, locale, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                }),
                tRoot(`absences.part.${plan.part}`),
                plan.day.kind === 'cycle' && plan.day.dayKey
                  ? t('dayOfCycle', { n: plan.day.dayKey })
                  : null,
                formatTimeRange(plan.window.start, plan.window.end, locale),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {plan.classes.length > 0 ? (
              <p className="text-sm text-slate-600">
                {[
                  t('classOf', { name: context.teacherName }),
                  ...new Set(plan.classes.map((c) => c.roomName).filter(Boolean)),
                ].join(' · ')}
              </p>
            ) : null}
          </div>
          <Note label={t('contacts.absenceNote')} text={context.absenceNote} />
          {slots.overview ??
            (plan.overview ? <Note label={t('overview')} text={plan.overview} /> : null)}
        </CardBody>
      </Card>

      {slots.alerts && plan.classes.length > 0 ? (
        <PlanSection title={t('sections.alerts')}>
          <p className="text-sm text-slate-600">{t('alerts.hint')}</p>
          <div className="space-y-2">
            {plan.classes.map((c) => (
              <div key={c.classId}>{slots.alerts!(c)}</div>
            ))}
          </div>
        </PlanSection>
      ) : null}

      <section aria-labelledby="plan-schedule" className="space-y-3">
        <h2 id="plan-schedule" className="text-lg font-semibold text-slate-900">
          {t('sections.schedule')}
        </h2>
        <ol className="space-y-3">
          {plan.blocks.map((b) => (
            <li key={b.key}>
              <BlockCard
                block={b}
                audience={plan.audience}
                showClass={multipleClasses}
                edit={slots.block?.(b)}
              />
            </li>
          ))}
        </ol>
      </section>

      {plan.dayEvents.length > 0 ? (
        <PlanSection title={t('sections.events')}>
          <ul className="space-y-1 text-sm">
            {plan.dayEvents.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{e.title}</span>
                {e.start ? (
                  <span className="text-slate-600">
                    {e.end ? formatTimeRange(e.start, e.end, locale) : formatTime(e.start, locale)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </PlanSection>
      ) : null}

      <GroupsPanel plan={plan} roster={roster} levels={levels} />

      {classNotes.length > 0 ? (
        <PlanSection title={t('sections.classNotes')}>
          {classNotes.map((n) => (
            <div key={n.classId} className="space-y-2">
              {multipleClasses ? (
                <h3 className="text-sm font-semibold text-slate-700">{className(n.classId)}</h3>
              ) : null}
              <Note label={t('classNotes.arrival')} text={n.arrival} />
              <Note label={t('classNotes.routines')} text={n.routines} />
              <Note label={t('classNotes.classManagement')} text={n.classManagement} />
              <Note label={t('classNotes.dismissal')} text={n.dismissal} />
              <Note label={t('classNotes.fallbackActivities')} text={n.fallbackActivities} />
            </div>
          ))}
        </PlanSection>
      ) : null}

      <PlanSection title={t('sections.contacts')}>
        <dl className="space-y-2 text-sm" data-testid="plan-contacts">
          {context.officePhone ? (
            <div>
              <dt className="font-medium text-slate-700">{t('contacts.office')}</dt>
              <dd>
                <a
                  href={`tel:${context.officePhone.replace(/[^\d+]/g, '')}`}
                  className="inline-flex min-h-11 items-center gap-1.5 text-brand-700 underline underline-offset-2"
                >
                  <Phone className="size-4" aria-hidden />
                  {context.officePhone}
                </a>
              </dd>
            </div>
          ) : null}
          {neighbours.map((n) => (
            <div key={n.classId}>
              <dt className="font-medium text-slate-700">
                {t('contacts.neighbour')}
                {multipleClasses ? ` · ${className(n.classId)}` : ''}
              </dt>
              <dd className="text-slate-800">
                {n.neighbour!.name}
                {n.neighbour!.note ? ` — ${n.neighbour!.note}` : ''}
              </dd>
            </div>
          ))}
          {team.map((m, i) => (
            <div key={`${m.classId}-${i}`}>
              <dt className="font-medium text-slate-700">
                {tRoot(`classes.role.${m.role}`)}
                {multipleClasses ? ` · ${className(m.classId)}` : ''}
              </dt>
              <dd className="text-slate-800">{m.name}</dd>
            </div>
          ))}
        </dl>
        <Note label={t('contacts.arrival')} text={context.arrivalInstructions} />
        <Note label={t('contacts.emergency')} text={context.emergencyInfo} />
      </PlanSection>

      <PlanSection title={t('sections.endOfDay')}>
        <p className="text-sm font-medium text-slate-800">
          {t('endOfDayAt', { time: formatTime(plan.endOfDay.time, locale) })}
        </p>
        {slots.endOfDay ??
          (plan.endOfDay.checklist.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
              {plan.endOfDay.checklist.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null)}
      </PlanSection>

      {slots.faith ??
        (plan.faith ? (
          <PlanSection title={t('sections.faith')}>
            {plan.faith.title ? (
              <p className="text-sm font-medium text-slate-800">{plan.faith.title}</p>
            ) : null}
            <TypedText text={plan.faith.text} className="text-sm text-slate-800" />
            {plan.faith.linkSentence ? (
              <TypedText text={plan.faith.linkSentence} className="text-sm text-slate-600" />
            ) : null}
          </PlanSection>
        ) : null)}
    </div>
  );
}
