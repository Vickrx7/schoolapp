'use client';

import type { ClassTeamKey } from '@lynx/content';
import { useTranslations } from 'next-intl';
import { rankTeams } from '../class-mode/ranking';
import { TeamLabel, teamStyle } from '../class-mode/team-mark';
import { cn } from '../../lib/utils';
import type { TeamScore } from '../../server/class-portal/schemas';

/**
 * « Classement des équipes » on a class device, as on the projector: rank, team (name, shape
 * and colour) and points; a team without devices shows « — » and comes last. The device's own
 * team is marked « Ton équipe ». Never a device number.
 */
export function DeviceLeaderboard({
  scores,
  myTeam,
}: {
  scores: readonly TeamScore[];
  myTeam: ClassTeamKey | null;
}) {
  const t = useTranslations('classPortal');
  const ranks = rankTeams(scores);
  return (
    <section aria-labelledby="leaderboard-title" className="space-y-3">
      <h3 id="leaderboard-title" className="text-[26px] font-bold text-slate-950">
        {t('leaderboard')}
      </h3>
      <ol className="space-y-2">
        {scores.map((row, i) => {
          const mine = row.team === myTeam;
          const rank = ranks[i];
          return (
            <li
              key={row.team}
              className={cn(
                'flex items-center gap-4 rounded-2xl border-2 bg-white px-4 py-3',
                mine ? cn('border-4', teamStyle(row.team).border) : 'border-slate-300',
              )}
            >
              <span className="w-14 shrink-0 text-[26px] font-bold text-slate-700 tabular-nums">
                {rank == null ? '' : t('rank', { rank })}
              </span>
              <span className="min-w-0 flex-1 text-[24px]">
                <TeamLabel team={row.team} name={t(`teams.${row.team}`)} />
                {mine ? (
                  <span className="ml-3 text-[22px] font-semibold text-slate-700">
                    {t('yourTeam')}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[26px] font-bold text-slate-950 tabular-nums">
                {row.score === null ? t('noScore') : t('teamPoints', { points: row.score })}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
