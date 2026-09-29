'use client';

import { KeyRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { ConfirmButton } from '@/components/app/confirm-button';
import { useAction } from '@/hooks/use-action';
import { formatInstantTime, formatLocalDate, instantInZone } from '@/lib/format';
import { revokeAllSubAccess, revokeSubCode } from '@/server/actions/sub-codes';
import { summarizeAccess, type SubAccess } from './access-view';
import { CodeRevealDialog } from './code-reveal-dialog';
import { DevicesList } from './devices-list';
import type { SubCodeContext } from './types';

/**
 * A plan's substitute access, for the absent teacher, direction and office (D-050, D-056): its
 * active codes (never the codes themselves), the devices that used them, « Générer un code »,
 * « Couper » a code or a device, and « Couper tout l'accès ».
 */
export function CodePanel({
  context,
  access,
  generateLabel,
  canIssue,
  configured,
  now,
}: {
  context: SubCodeContext;
  access: SubAccess;
  generateLabel: string;
  /** False once the plan's day is over. */
  canIssue: boolean;
  /** False when this server has no portal connection or code keys. */
  configured: boolean;
  /** The server's clock when the page was made, so server and browser agree. */
  now: string;
}) {
  const t = useTranslations('subCodes');
  const locale = useLocale();
  const revokeCode = useAction(revokeSubCode, { successMessage: t('cut') });
  const revokeAll = useAction(revokeAllSubAccess, { successMessage: t('cut') });
  const view = summarizeAccess(access, new Date(now));
  const anythingToCut = view.activeCodes.length > 0 || view.devices.some((d) => d.active);

  const codeLine = (createdAt: string, by: string | null) => {
    const at = instantInZone(createdAt, context.timezone);
    const time = formatInstantTime(createdAt, context.timezone, locale);
    const byName = by ?? 'none';
    return at.date === instantInZone(now, context.timezone).date
      ? t('codeLine', { time, by: byName })
      : t('codeLineOn', {
          date: formatLocalDate(at.date, locale, { day: 'numeric', month: 'short' }),
          time,
          by: byName,
        });
  };

  return (
    <div className="space-y-3" data-testid="sub-code-panel">
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
          <KeyRound className="size-4 text-slate-500" aria-hidden />
          {t('activeCodes', { count: view.activeCodes.length })}
        </p>
        {view.activeCodes.length > 0 ? (
          <ul className="space-y-1">
            {view.activeCodes.map((c) => (
              <li
                key={c.codeId}
                className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700"
              >
                <span>
                  {codeLine(c.createdAt, c.createdByName)} ·{' '}
                  {t('codeDevices', { count: c.deviceCount })}
                </span>
                <ConfirmButton
                  label={t('cutCode')}
                  message={t('cutCodeConfirm')}
                  confirmLabel={t('cutDevice')}
                  size="md"
                  disabled={revokeCode.pending}
                  onConfirm={() => revokeCode.run(c.codeId)}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {view.devices.length > 0 ? (
        <DevicesList devices={view.devices} timeZone={context.timezone} />
      ) : null}

      {!configured ? <p className="text-sm text-amber-800">{t('notConfigured')}</p> : null}
      <div className="flex flex-wrap gap-2">
        {canIssue ? (
          <CodeRevealDialog context={context} label={generateLabel} disabled={!configured} />
        ) : null}
        {anythingToCut ? (
          <ConfirmButton
            label={t('revokeAll')}
            message={t('revokeAllConfirm')}
            confirmLabel={t('revokeAll')}
            size="md"
            disabled={revokeAll.pending}
            onConfirm={() => revokeAll.run(context.planId)}
          />
        ) : null}
      </div>
    </div>
  );
}
