'use client';

import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { useAction } from '@/hooks/use-action';
import { getAbsenceStatus, refreshAbsencePlans } from '@/server/actions/absences';

const POLL_MS = 3000;
/** After this, the owner is offered to rebuild now (the worker may be down). */
const LIMIT_MS = 120_000;

/**
 * « Mise à jour du plan… » while the worker rebuilds the plans after one of their sources
 * changed (D-047). Checks every 3 seconds (not while the tab is hidden), reloads the page when
 * done, and after 2 minutes offers « Mettre à jour maintenant ».
 */
export function AbsenceStatusPoller({ absenceId }: { absenceId: string }) {
  const t = useTranslations('absences');
  const router = useRouter();
  const [slow, setSlow] = useState(false);
  const refresh = useAction(refreshAbsencePlans, { successMessage: t('refreshed') });

  useEffect(() => {
    const started = Date.now();
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      if (stopped) return;
      if (Date.now() - started > LIMIT_MS) {
        setSlow(true);
        return;
      }
      if (!document.hidden) {
        try {
          const result = await getAbsenceStatus(absenceId);
          if (stopped) return;
          if (result.ok && !result.data.refreshing) {
            router.refresh();
            return;
          }
        } catch {
          // Offline for a moment: keep checking.
        }
      }
      timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [absenceId, router]);

  return (
    <Notice aria-live="polite" className="space-y-2">
      <p className="flex items-center gap-2 font-medium">
        <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden />
        {t('refreshing')}
      </p>
      <p>{slow ? t('refreshSlow') : t('refreshingHint')}</p>
      {slow ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={refresh.pending}
          onClick={() => void refresh.run(absenceId)}
        >
          {t('refreshNow')}
        </Button>
      ) : null}
    </Notice>
  );
}
