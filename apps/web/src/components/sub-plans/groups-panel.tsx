import type { ComposedSubPlan } from '@lynx/domain';
import { useLocale, useTranslations } from 'next-intl';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { localized } from '@/i18n/config';
import type { PlanLevel, RosterStudent } from './types';

/**
 * « G1 · Débutant »: how the AI layer's instructions by group name each group, for adults only
 * (students never see a level name).
 */
export function groupLabels(
  plan: Pick<ComposedSubPlan, 'groups'>,
  levels: readonly PlanLevel[],
  locale: string,
  noLevel: string,
): Record<string, string> {
  const levelById = new Map(levels.map((l) => [l.id, l]));
  return Object.fromEntries(
    plan.groups.map((g) => {
      const level = g.levelId ? levelById.get(g.levelId) : undefined;
      return [
        g.key,
        `${g.key} · ${level ? localized(locale, level.labelFr, level.labelEn) : noLevel}`,
      ];
    }),
  );
}

/**
 * The first names of each group (« G1 » → Samuel, Adam, Aïcha), for the adult handing out each
 * group's version of a library resource. Names come from the roster, never from the plan.
 */
export function groupFirstNames(
  plan: Pick<ComposedSubPlan, 'groups'>,
  roster: readonly RosterStudent[],
): Record<string, string[]> {
  const names = new Map(roster.map((s) => [s.id, s.firstName]));
  return Object.fromEntries(
    plan.groups.map((g) => [
      g.key,
      g.studentIds.map((id) => names.get(id)).filter((n): n is string => !!n),
    ]),
  );
}

/**
 * Groups by language level, with first names joined from the roster the database derived for
 * the plan (the plan JSON holds ids only). Level names are for adults: never read out to the
 * class.
 */
export function GroupsPanel({
  plan,
  roster,
  levels,
}: {
  plan: Pick<ComposedSubPlan, 'groups' | 'classes'>;
  roster: RosterStudent[];
  levels: PlanLevel[];
}) {
  const t = useTranslations('subPlan');
  const locale = useLocale();
  const names = new Map(roster.map((s) => [s.id, s.firstName]));
  const levelById = new Map(levels.map((l) => [l.id, l]));
  const byClass = plan.classes
    .map((c) => ({
      cls: c,
      groups: plan.groups
        .filter((g) => g.classId === c.classId)
        .map((g) => ({
          ...g,
          level: g.levelId ? (levelById.get(g.levelId) ?? null) : null,
          names: g.studentIds.map((id) => names.get(id)).filter((n): n is string => !!n),
        }))
        .filter((g) => g.names.length > 0),
    }))
    .filter((c) => c.groups.length > 0);
  if (byClass.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sections.groups')}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-slate-600">{t('groups.hint')}</p>
        {byClass.map(({ cls, groups }) => (
          <div key={cls.classId} className="space-y-2">
            {byClass.length > 1 ? (
              <h3 className="text-sm font-semibold text-slate-700">{cls.name}</h3>
            ) : null}
            <ul className="grid gap-2 sm:grid-cols-2">
              {groups.map((g) => (
                <li
                  key={g.key}
                  className="rounded-lg border border-slate-200 p-3"
                  data-testid="plan-group"
                >
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-slate-900">
                      {g.level
                        ? localized(locale, g.level.labelFr, g.level.labelEn)
                        : t('groups.noLevel')}
                    </span>
                    <span className="text-xs text-slate-500">
                      {g.key} · {t('groups.count', { count: g.names.length })}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-slate-800">{g.names.join(', ')}</p>
                  {g.level?.descriptionFr ? (
                    <p className="mt-1 text-xs text-slate-500">{g.level.descriptionFr}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
