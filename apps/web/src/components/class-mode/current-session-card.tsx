'use client';

import { MonitorPlay } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { parseInstant } from '@/components/class-portal/polling';
import type { ClassModeOverview } from '@/server/class-mode/overview';
import { EndSessionDialog } from './end-session-dialog';

/**
 * « Séance en cours » on the class tab (DECISIONS D-089): the open session of the class (possibly
 * a colleague's), « Reprendre la projection » after a closed tab or on another computer, and
 * « Terminer la séance », so a forgotten session can be ended from a phone. The projector opens
 * as a new document.
 */
export function CurrentSessionCard({
  open,
  keep,
  retentionDays,
}: {
  open: NonNullable<ClassModeOverview['open']>;
  keep: boolean;
  retentionDays: number;
}) {
  const t = useTranslations('classMode');
  const format = useFormatter();
  const router = useRouter();
  const time = format.dateTime(new Date(parseInstant(open.startedAt)), {
    hour: 'numeric',
    minute: '2-digit',
  });
  const title = open.itemTitle ?? t('results.untitled');
  return (
    <Card className="border-brand-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorPlay aria-hidden className="size-5 text-brand-700" />
          {t('current')}
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-slate-800">
          {open.mine || !open.startedByName
            ? t('currentBody', { title, time })
            : t('currentBy', { title, name: open.startedByName, time })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href={`/projector/sessions/${open.id}`}>{t('resume')}</a>
          </Button>
          <EndSessionDialog
            sessionId={open.id}
            keep={keep}
            retentionDays={retentionDays}
            onEnded={() => router.refresh()}
          />
        </div>
      </CardBody>
    </Card>
  );
}
