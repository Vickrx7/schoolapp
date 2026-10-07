'use client';

import type { ClassTeamKey } from '@lynx/content';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Shape, teamStyle } from '../class-mode/team-mark';
import { cn } from '../../lib/utils';

/**
 * « Choisis ton équipe » when the teacher let students choose (DECISIONS D-088): the session's
 * teams as up to six very large buttons (name, shape and colour; the chosen one is pressed). A
 * fixed team, never a name typed by a student.
 */
export function TeamPicker({
  teams,
  current,
  pending,
  onChoose,
}: {
  teams: readonly ClassTeamKey[];
  current: ClassTeamKey | null;
  pending: boolean;
  onChoose: (team: ClassTeamKey) => void;
}) {
  const t = useTranslations('classPortal');
  return (
    <section aria-labelledby="team-picker-title" className="space-y-4">
      <h3 id="team-picker-title" className="text-[28px] font-bold text-slate-950">
        {t('chooseTeam')}
      </h3>
      <ul className="grid gap-4 min-[600px]:grid-cols-2">
        {teams.map((team) => {
          const style = teamStyle(team);
          const chosen = current === team;
          return (
            <li key={team}>
              <button
                type="button"
                aria-pressed={chosen}
                disabled={pending}
                onClick={() => onChoose(team)}
                className={cn(
                  'flex min-h-24 w-full items-center gap-4 rounded-2xl px-6 text-left text-[30px] font-bold text-white focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-slate-950 disabled:opacity-70',
                  style.bg,
                  chosen && 'ring-8 ring-slate-950 ring-offset-2',
                )}
              >
                <Shape shape={style.shape} className="size-12 fill-white" />
                <span className="flex-1">{t(`teams.${team}`)}</span>
                {chosen ? <Check aria-hidden className="size-10" strokeWidth={3} /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
