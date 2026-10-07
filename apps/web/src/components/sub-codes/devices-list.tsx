'use client';

import { Smartphone } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { ConfirmButton } from '@/components/app/confirm-button';
import { useAction } from '@/hooks/use-action';
import { formatInstantTime } from '@/lib/format';
import { revokeSubSession } from '@/server/actions/sub-codes';
import type { SubDevice } from './access-view';

/**
 * The devices a plan's codes were used on: « Appareil 1 · connecté à 8 h 02 · actif à 9 h 15 »,
 * each with « Couper » (that device cannot use the same code again).
 */
export function DevicesList({ devices, timeZone }: { devices: SubDevice[]; timeZone: string }) {
  const t = useTranslations('subCodes');
  const locale = useLocale();
  const cut = useAction(revokeSubSession, { successMessage: t('cut') });
  if (devices.length === 0) return <p className="text-sm text-slate-600">{t('noDevice')}</p>;

  return (
    <ul className="space-y-2" aria-label={t('devicesTitle')}>
      {devices.map((d) => (
        <li
          key={d.deviceNumber}
          className="flex flex-wrap items-center justify-between gap-2 text-sm"
          data-testid="sub-device"
        >
          <span className="inline-flex min-w-0 items-center gap-2 text-slate-800">
            <Smartphone className="size-4 shrink-0 text-slate-500" aria-hidden />
            <span>
              {[
                t('device', { n: d.deviceNumber }),
                t('deviceSignedIn', { time: formatInstantTime(d.firstSeenAt, timeZone, locale) }),
                d.lastSeenAt
                  ? t('deviceSeen', { time: formatInstantTime(d.lastSeenAt, timeZone, locale) })
                  : null,
                d.cut ? t('deviceCut') : !d.active ? t('deviceEnded') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          {!d.cut ? (
            <ConfirmButton
              label={t('cutDeviceLabel', { n: d.deviceNumber })}
              message={t('cutDeviceConfirm', { n: d.deviceNumber })}
              confirmLabel={t('cutDevice')}
              size="md"
              disabled={cut.pending}
              onConfirm={() => cut.run(d.sessionId)}
            >
              {t('cutDevice')}
            </ConfirmButton>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
