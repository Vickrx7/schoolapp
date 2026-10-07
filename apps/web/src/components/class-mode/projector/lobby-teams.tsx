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
 *
 * Six teams fit under « Rejoignez la partie » on a 1920 × 1080, 1366 × 768, 1280 × 720 or 4:3
 * (1024 × 768) screen: the tiles' type follows the screen's height as well as its width (40 px
 * and more at 1920 × 1080), three tiles a row, and a long name wraps inside its tile.
 */

/** 42 px at 1920 × 1080; smaller on short screens (the lesser of 2.2vw and 4vh). */
const TILE_TYPE = 'text-[length:clamp(1.25rem,min(2.2vw,4vh),3rem)] leading-tight';
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
    <div>
      {/* Announced as devices join; on screen, each tile gives its team's count (and the
          teacher's « Appareils » button the total). */}
      <p aria-live="polite" className="sr-only">
        {t('lobby.devices', { count: state.devices.count })}
      </p>
      <ul
        className={cn(
          TILE_TYPE,
          'grid grid-cols-[repeat(auto-fit,minmax(min(100%,11em),1fr))] gap-x-[1vw] gap-y-[1.2vh]',
        )}
      >
        {state.devices.byTeam.map((row) => (
          <li
            key={row.team}
            className={cn(
              'min-w-0 space-y-[0.15em] rounded-2xl border-[3px] bg-white px-[0.5em] py-[0.35em]',
              teamStyle(row.team).border,
            )}
          >
            <TeamLabel team={row.team} name={t(`teams.${row.team}`)} className="max-w-full" />
            <p className="text-[0.95em] font-semibold text-slate-800 tabular-nums">
              {t('lobby.teamDevices', { count: row.members })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
