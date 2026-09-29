'use client';

import type { ClassTeamKey } from '@lynx/content';
import { Lock, LockOpen, MonitorSmartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ConfirmButton } from '@/components/app/confirm-button';
import { TeamShapeMark } from '@/components/class-mode/team-mark';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Select } from '@/components/ui/field';
import { formatJoinCode } from '@/server/class-portal/code';
import type { LiveState } from '@/server/class-portal/schemas';

/**
 * « Appareils » (DECISIONS D-084, D-087): the devices that joined, by number (never a name),
 * with their team. The teacher moves a device to another team (« Changer d’équipe ») or takes it
 * out of the game (« Retirer »: its answers are deleted; a stranger who guessed the code, a
 * device in the wrong class). « Rouvrir les inscriptions » lets a latecomer in during the game
 * (for 20 minutes), with the code to type. Opened from the projector's toolbar, so the list is not
 * projected unless the teacher opens it.
 */
export function DevicesPanel({
  state,
  pending,
  onMove,
  onRemove,
  onJoining,
}: {
  state: LiveState;
  pending: boolean;
  onMove: (participantId: string, team: ClassTeamKey) => void;
  onRemove: (participantId: string) => Promise<unknown>;
  /** « Fermer / Rouvrir les inscriptions ». */
  onJoining: (open: boolean) => void;
}) {
  const t = useTranslations('classMode');
  const tCommon = useTranslations('common');
  const id = useId();
  const [open, setOpen] = useState(false);
  const { devices } = state;
  const teams = state.teams ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <MonitorSmartphone aria-hidden />
        {t('devices.open', { count: devices.count })}
      </Button>
      <DialogContent
        title={t('devices.title')}
        description={t('devices.connected', {
          connected: devices.connected,
          count: devices.count,
        })}
        closeLabel={tCommon('close')}
      >
        {state.phase !== 'finished' ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
            <p className="min-w-0 flex-1 text-sm text-slate-800">
              {state.joiningOpen
                ? t('join.codeSpoken', { code: formatJoinCode(state.joinCode) })
                : t('lobby.closed')}
            </p>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => onJoining(!state.joiningOpen)}
            >
              {state.joiningOpen ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
              {state.joiningOpen ? t('lobby.lock') : t('lobby.unlock')}
            </Button>
          </div>
        ) : null}
        {devices.list.length === 0 ? (
          <p className="text-slate-700">{t('devices.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {devices.list.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-28 font-semibold text-slate-900 tabular-nums">
                  {t('devices.device', { n: device.device })}
                </span>
                {device.left ? (
                  <span className="text-sm text-slate-600">{t('devices.left')}</span>
                ) : null}
                {state.mode === 'teams' ? (
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {device.team ? <TeamShapeMark team={device.team} className="size-5" /> : null}
                    <label htmlFor={`${id}-${device.id}`} className="sr-only">
                      {t('devices.moveLabel', { n: device.device })}
                    </label>
                    <Select
                      id={`${id}-${device.id}`}
                      value={device.team ?? ''}
                      disabled={pending || device.left || state.status === 'closed'}
                      onChange={(e) => {
                        const team = e.target.value as ClassTeamKey;
                        if (team) onMove(device.id, team);
                      }}
                      className="max-w-56"
                    >
                      {device.team === null ? (
                        <option value="">{t('devices.noTeam')}</option>
                      ) : null}
                      {teams.map((team) => (
                        <option key={team} value={team}>
                          {t(`teams.${team}`)}
                        </option>
                      ))}
                    </Select>
                  </span>
                ) : (
                  <span className="flex-1" />
                )}
                <ConfirmButton
                  label={t('devices.removeLabel', { n: device.device })}
                  message={t('devices.removeConfirm', { n: device.device })}
                  confirmLabel={t('devices.remove')}
                  size="md"
                  disabled={pending || state.status === 'closed'}
                  onConfirm={() => onRemove(device.id)}
                >
                  {t('devices.remove')}
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('devices.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
