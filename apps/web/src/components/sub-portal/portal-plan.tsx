'use client';

import type { ComposedSubPlan } from '@lynx/domain';
import { ArrowRight, Phone } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { BlockCard, TypedText } from '@/components/sub-plans/block-card';
import { GroupsPanel } from '@/components/sub-plans/groups-panel';
import { PlanSection } from '@/components/sub-plans/plan-view';
import { Timeline } from '@/components/sub-plans/timeline';
import type { PlanLevel, RosterStudent } from '@/components/sub-plans/types';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { useOnline } from '@/hooks/use-online';
import { formatTime, formatTimeRange } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PortalAlerts } from './portal-alerts';

const TABS = ['schedule', 'students', 'contacts', 'endOfDay'] as const;
type Tab = (typeof TABS)[number];

export interface PortalPlanContext {
  planDate: string;
  timezone: string;
  teacherName: string;
  absenceNote: string | null;
  officePhone: string | null;
  arrivalInstructions: string | null;
  emergencyInfo: string | null;
  contentVersion: number;
  alertsAvailable: boolean;
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
 * « Plan de la journée » for the substitute, on a phone first: « Horaire » (with « Maintenant »
 * and « Ensuite »), « Élèves » (groups, alerts on request, class management), « Contacts » and
 * « Fin de journée ». Plan content is the teacher's French; labels follow the interface.
 */
export function PortalPlan({
  plan,
  context,
  roster,
  levels,
}: {
  plan: ComposedSubPlan;
  context: PortalPlanContext;
  roster: RosterStudent[];
  levels: PlanLevel[];
}) {
  const t = useTranslations('subPortal');
  const tPlan = useTranslations('subPlan');
  const tRoot = useTranslations();
  const locale = useLocale();
  const online = useOnline();
  const [tab, setTab] = useState<Tab>('schedule');

  const multipleClasses = plan.classes.length > 1;
  const className = (id: string) => plan.classes.find((c) => c.classId === id)?.name ?? '';
  const withClass = (label: string, classId: string) =>
    multipleClasses ? `${label} · ${className(classId)}` : label;
  const neighbours = plan.classNotes.filter((n) => n.neighbour);
  const team = plan.classNotes.flatMap((n) => n.team.map((m) => ({ ...m, classId: n.classId })));
  const arrivalNotes = plan.classNotes.filter((n) => n.arrival || n.routines);
  const managementNotes = plan.classNotes.filter((n) => n.classManagement);
  const dismissalNotes = plan.classNotes.filter((n) => n.dismissal);
  const fallbackNotes = plan.classNotes.filter((n) => n.fallbackActivities);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.indexOf(tab);
    const next =
      e.key === 'ArrowRight'
        ? TABS[(i + 1) % TABS.length]
        : e.key === 'ArrowLeft'
          ? TABS[(i + TABS.length - 1) % TABS.length]
          : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    document.getElementById(`portal-tab-${next}`)?.focus();
  };

  const panel = (key: Tab, children: ReactNode) => (
    <div
      role="tabpanel"
      id={`portal-panel-${key}`}
      aria-labelledby={`portal-tab-${key}`}
      hidden={tab !== key}
      className="space-y-4"
    >
      {children}
    </div>
  );

  return (
    <div className="space-y-4">
      {!online ? <Notice tone="warning">{t('offline')}</Notice> : null}

      <div
        role="tablist"
        aria-label={t('tabsLabel')}
        className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1"
      >
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`portal-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`portal-panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            onKeyDown={onTabKey}
            className={cn(
              'min-h-11 rounded-lg px-1 text-sm leading-tight font-medium text-slate-700',
              tab === key ? 'bg-white text-slate-900 shadow-sm' : 'hover:bg-white/60',
            )}
          >
            {t(`tabs.${key}`)}
          </button>
        ))}
      </div>

      {panel(
        'schedule',
        <>
          {context.absenceNote || plan.overview ? (
            <PlanSection title={t('teacherNote')}>
              {context.absenceNote ? (
                <TypedText text={context.absenceNote} className="text-sm text-slate-800" />
              ) : null}
              <Note label={tPlan('overview')} text={plan.overview} />
            </PlanSection>
          ) : null}

          <Timeline
            blocks={plan.blocks.map((b) => ({
              key: b.key,
              start: b.start,
              end: b.end,
              title: b.title,
            }))}
            planDate={context.planDate}
            timeZone={context.timezone}
          />

          {arrivalNotes.length > 0 ? (
            <PlanSection title={tPlan('sections.classNotes')}>
              {arrivalNotes.map((n) => (
                <div key={n.classId} className="space-y-2">
                  <Note
                    label={withClass(tPlan('classNotes.arrival'), n.classId)}
                    text={n.arrival}
                  />
                  <Note
                    label={withClass(tPlan('classNotes.routines'), n.classId)}
                    text={n.routines}
                  />
                </div>
              ))}
            </PlanSection>
          ) : null}

          {plan.dayEvents.length > 0 ? (
            <PlanSection title={tPlan('sections.events')}>
              <ul className="space-y-1 text-sm">
                {plan.dayEvents.map((e, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2">
                    <span className="font-medium">{e.title}</span>
                    {e.start ? (
                      <span className="text-slate-600">
                        {e.end
                          ? formatTimeRange(e.start, e.end, locale)
                          : formatTime(e.start, locale)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </PlanSection>
          ) : null}

          <section aria-labelledby="portal-schedule" className="space-y-3">
            <h2 id="portal-schedule" className="text-lg font-semibold text-slate-900">
              {tPlan('sections.schedule')}
            </h2>
            <ol className="space-y-3">
              {plan.blocks.map((b) => (
                <li key={b.key} id={`block-${b.key}`} className="scroll-mt-40">
                  <BlockCard block={b} audience="substitute" showClass={multipleClasses} />
                </li>
              ))}
            </ol>
          </section>

          {fallbackNotes.length > 0 ? (
            <PlanSection title={tPlan('classNotes.fallbackActivities')}>
              {fallbackNotes.map((n) => (
                <TypedText
                  key={n.classId}
                  text={
                    multipleClasses
                      ? `${className(n.classId)} : ${n.fallbackActivities}`
                      : n.fallbackActivities!
                  }
                  className="text-sm text-slate-800"
                />
              ))}
            </PlanSection>
          ) : null}

          {plan.faith ? (
            <PlanSection title={tPlan('sections.faith')}>
              {plan.faith.title ? (
                <p className="text-sm font-medium text-slate-800">{plan.faith.title}</p>
              ) : null}
              <TypedText text={plan.faith.text} className="text-sm text-slate-800" />
              {plan.faith.linkSentence ? (
                <TypedText text={plan.faith.linkSentence} className="text-sm text-slate-600" />
              ) : null}
            </PlanSection>
          ) : null}
        </>,
      )}

      {panel(
        'students',
        <>
          {context.alertsAvailable && plan.classes.length > 0 ? (
            <PlanSection title={tPlan('sections.alerts')}>
              <PortalAlerts
                contentVersion={context.contentVersion}
                roster={roster}
                classNames={Object.fromEntries(plan.classes.map((c) => [c.classId, c.name]))}
              />
            </PlanSection>
          ) : null}
          <GroupsPanel plan={plan} roster={roster} levels={levels} />
          {managementNotes.length > 0 ? (
            <PlanSection title={tPlan('classNotes.classManagement')}>
              {managementNotes.map((n) => (
                <TypedText
                  key={n.classId}
                  text={
                    multipleClasses
                      ? `${className(n.classId)} : ${n.classManagement}`
                      : n.classManagement!
                  }
                  className="text-sm text-slate-800"
                />
              ))}
            </PlanSection>
          ) : null}
        </>,
      )}

      {panel(
        'contacts',
        <PlanSection title={tPlan('sections.contacts')}>
          <dl className="space-y-2 text-sm" data-testid="plan-contacts">
            {context.officePhone ? (
              <div>
                <dt className="font-medium text-slate-700">{tPlan('contacts.office')}</dt>
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
                  {withClass(tPlan('contacts.neighbour'), n.classId)}
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
                  {withClass(tRoot(`classes.role.${m.role}`), m.classId)}
                </dt>
                <dd className="text-slate-800">{m.name}</dd>
              </div>
            ))}
          </dl>
          <Note label={tPlan('contacts.arrival')} text={context.arrivalInstructions} />
          <Note label={tPlan('contacts.emergency')} text={context.emergencyInfo} />
        </PlanSection>,
      )}

      {panel(
        'endOfDay',
        <>
          <PlanSection title={tPlan('sections.endOfDay')}>
            <p className="text-sm font-medium text-slate-800">
              {tPlan('endOfDayAt', { time: formatTime(plan.endOfDay.time, locale) })}
            </p>
            {plan.endOfDay.checklist.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
                {plan.endOfDay.checklist.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : null}
            {dismissalNotes.map((n) => (
              <Note
                key={n.classId}
                label={withClass(tPlan('classNotes.dismissal'), n.classId)}
                text={n.dismissal}
              />
            ))}
          </PlanSection>
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-700">{t('endDayHint')}</p>
            <Button asChild variant="secondary">
              <Link href="/suppleance/done">
                {t('endDay')}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </>,
      )}
    </div>
  );
}
