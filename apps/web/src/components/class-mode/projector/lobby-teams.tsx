'use client';

import { useTranslations } from 'next-intl';
import { SLIDE_TYPE } from '../presenter/slide-view';
import { TeamLabel, teamStyle } from '../team-mark';
import { cn } from '../../../lib/utils';
import type { LiveState } from '../../../server/class-portal/schemas';

/**
 * The lobby's teams on the projector (« Les Huards · 5 appareils »): name, shape and colour, and
 * how many devices joined each; in « Chacun pour soi », only how many devices joined. Never a
 * device's number: the « Appareils » panel is for the teacher.
 */
export function LobbyTeams({ state }: { state: LiveState }) {
  const t = useTranslations('classMode');
  if (state.mode === 'solo') {
    return (
      <div className="space-y-[2vh]">
        <p className={cn(SLIDE_TYPE.heading, 'font-semibold text-slate-700')}>{t('lobby.solo')}</p>
        <p aria-live="polite" className={cn(SLIDE_TYPE.hero, 'font-bold tabular-nums')}>
          {t('lobby.devices', { count: state.devices.count })}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-[2vh]">
      <p aria-live="polite" className={cn(SLIDE_TYPE.heading, 'font-semibold tabular-nums')}>
        {t('lobby.devices', { count: state.devices.count })}
      </p>
      <ul className="grid grid-cols-2 gap-[1.2vw]">
        {state.devices.byTeam.map((row) => (
          <li
            key={row.team}
            className={cn(
              'space-y-[0.5vh] rounded-2xl border-[3px] bg-white px-[1vw] py-[1.2vh]',
              teamStyle(row.team).border,
            )}
          >
            <TeamLabel team={row.team} name={t(`teams.${row.team}`)} className={SLIDE_TYPE.doc} />
            <p className={cn(SLIDE_TYPE.small, 'font-semibold text-slate-800 tabular-nums')}>
              {t('lobby.teamDevices', { count: row.members })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
