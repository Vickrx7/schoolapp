'use client';

import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { invitationStatus } from '@/server/actions/board';

const POLL_MS = 1500;
/** After this, say it is slow and stop asking until « Vérifier de nouveau ». */
const GIVE_UP_MS = 90_000;

/**
 * « Préparation du compte… » while the worker creates the account (DECISIONS D-107): asks every
 * 1.5 s (not while the tab is hidden), then shows the result by refreshing the page. Announced
 * politely to screen readers.
 */
export function InvitationStatus({ invitationId }: { invitationId: string }) {
  const t = useTranslations('board.invite');
  const router = useRouter();
  const [slow, setSlow] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        try {
          const result = await invitationStatus(invitationId);
          if (stopped) return;
          // Anything but « pending » (including gone): the page says what happened.
          if (!result.ok || result.data.status !== 'pending') {
            if (result.ok || result.error === 'notFound') {
              router.refresh();
              return;
            }
          }
        } catch {
          // Offline for a moment: ask again.
        }
      }
      if (Date.now() - started > GIVE_UP_MS) {
        setSlow(true);
        return;
      }
      timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [invitationId, router, round]);

  return (
    <Card>
      <CardBody className="space-y-3 pt-4" role="status" aria-live="polite">
        <p className="flex items-center gap-2 font-medium text-slate-900">
          {slow ? null : (
            <LoaderCircle className="size-5 animate-spin text-brand-600" aria-hidden />
          )}
          {t('preparing')}
        </p>
        <p className="text-sm text-slate-600">{slow ? t('slow') : t('preparingHint')}</p>
        {slow ? (
          <Button
            variant="secondary"
            onClick={() => {
              setSlow(false);
              setRound((r) => r + 1);
            }}
          >
            {t('checkAgain')}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}
