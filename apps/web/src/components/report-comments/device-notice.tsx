'use client';

import type { LocalDate } from '@lynx/domain';
import { HardDrive, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Notice } from '@/components/ui/card';
import { formatLocalDate } from '@/lib/format';

/**
 * « Vos commentaires restent sur cet appareil… » (DECISIONS D-130): always shown above the
 * composer, with the last day the device keeps them; then what went wrong with the device's
 * storage, if anything (a full device, another tab, an expired period), in words.
 */
export function DeviceNotice({
  expiresOn,
  expired,
  writeFailed,
  changedElsewhere,
}: {
  expiresOn: LocalDate;
  expired: boolean;
  writeFailed: boolean;
  changedElsewhere: 'changed' | 'erased' | null;
}) {
  const t = useTranslations('reportComments.notice');
  const locale = useLocale();
  const date = formatLocalDate(expiresOn, locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return (
    <div className="space-y-2">
      <Notice tone="info" className="flex gap-3" data-testid="device-notice">
        <HardDrive className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p>{expired ? t('bodyExpired') : t('body', { date })}</p>
          <p className="font-medium">{t('shared')}</p>
        </div>
      </Notice>
      {writeFailed ? (
        <Notice tone="danger" className="flex gap-3" role="alert">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>{t('writeFailed')}</p>
        </Notice>
      ) : null}
      {changedElsewhere ? (
        <Notice tone="warning" className="flex gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>{changedElsewhere === 'erased' ? t('erasedElsewhere') : t('changedElsewhere')}</p>
        </Notice>
      ) : null}
    </div>
  );
}
