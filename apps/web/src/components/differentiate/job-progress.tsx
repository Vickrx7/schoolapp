'use client';

import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Card, CardBody } from '@/components/ui/card';
import { getAiJobStatus } from '@/server/actions/differentiate';

/** Waits for the worker to finish a request, then shows the result. */
export function JobProgress({ jobId, status }: { jobId: string; status: 'queued' | 'running' }) {
  const t = useTranslations('differentiate');
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const result = await getAiJobStatus(jobId);
        if (stopped) return;
        if (!result.ok || (result.data.status !== 'queued' && result.data.status !== 'running')) {
          router.refresh();
          return;
        }
      } catch {
        // Offline for a moment: keep waiting.
      }
      if (!stopped) timer = window.setTimeout(tick, 1500);
    };
    let timer = window.setTimeout(tick, 1000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [jobId, router]);

  return (
    <Card>
      <CardBody className="flex items-start gap-3 pt-4" role="status" aria-live="polite">
        <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-brand-600" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium text-slate-900">{t(`status.${status}`)}</p>
          <p className="text-slate-700">{t('working')}</p>
          <p className="text-sm text-slate-500">{t('workingHint')}</p>
        </div>
      </CardBody>
    </Card>
  );
}
