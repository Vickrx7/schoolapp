'use client';

import { useTranslations } from 'next-intl';
import { SLIDE_TYPE } from '../presenter/slide-view';
import { rankTeams } from '../ranking';
import { TeamLabel, teamStyle } from '../team-mark';
import { cn } from '../../../lib/utils';
import type { LiveState } from '../../../server/class-portal/schemas';

/**
 * « Classement des équipes » on the projector (DECISIONS D-087): rank (ties share one), team and
 * points, best first; a team without devices shows « — » last. In « Chacun pour soi » only the
 * class's figures (« 74 % de bonnes réponses »), never a device.
 */
export function TeamLeaderboard({ state }: { state: LiveState }) {
  const t = useTranslations('classMode');
  if (state.mode === 'teams' && state.leaderboard?.length) {
    const ranks = rankTeams(state.leaderboard);
    return (
      <section aria-labelledby="projector-leaderboard" className="space-y-[2vh]">
        <h3 id="projector-leaderboard" className={cn(SLIDE_TYPE.heading, 'font-bold')}>
          {t('leaderboard.title')}
        </h3>
        <ol className="space-y-[1vh]">
          {state.leaderboard.map((row, i) => {
            const rank = ranks[i];
            return (
              <li
                key={row.team}
                className={cn(
                  SLIDE_TYPE.doc,
                  'flex items-center gap-[1.5vw] rounded-2xl border-[3px] bg-white px-[1.2vw] py-[0.8vh]',
                  teamStyle(row.team).border,
                )}
              >
                <span className="w-[4ch] shrink-0 font-bold text-slate-700 tabular-nums">
                  {rank == null ? '' : t('leaderboard.rank', { rank })}
                </span>
                <TeamLabel team={row.team} name={t(`teams.${row.team}`)} className="flex-1" />
                <span className="shrink-0 font-bold tabular-nums">
                  {row.score === null ? (
                    <>
                      <span aria-hidden>{t('leaderboard.noScore')}</span>
                      <span className="sr-only">{t('leaderboard.noDevice')}</span>
                    </>
                  ) : (
                    t('leaderboard.points', { points: row.score })
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    );
  }
  const percent = state.classStats?.percentCorrect ?? null;
  return (
    <section aria-labelledby="projector-class-stats" className="space-y-[2vh]">
      <h3 id="projector-class-stats" className={cn(SLIDE_TYPE.heading, 'font-bold')}>
        {t('leaderboard.classTitle')}
      </h3>
      <p className={cn(percent === null ? SLIDE_TYPE.doc : SLIDE_TYPE.hero, 'font-bold')}>
        {percent === null
          ? t('leaderboard.noStats')
          : t('leaderboard.classStats', { percent: Math.round(percent) })}
      </p>
    </section>
  );
}
