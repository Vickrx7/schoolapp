'use client';

import { LoaderCircle, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, Notice } from '@/components/ui/card';
import { getAiJobStatus } from '@/server/actions/differentiate';
import { FIRST_POLL_MS, nextPollDelay, pollExpired } from './poll';

type Open = 'queued' | 'running';
type Check = { kind: 'open'; status: Open } | { kind: 'done' } | { kind: 'error' };

/**
 * Waits for the worker to finish a request, then shows the result. Checks less often as time
 * passes, keeps trying after an error, pauses while the tab is hidden and stops after a limit.
 * Every AI feature's job page uses it: its texts are generic (`differentiate` messages), except
 * what is being prepared (`working`, `workingHint`), which a page may give in its own words.
 */
export function JobProgress({
  jobId,
  status: initialStatus,
  createdAt,
  resumeHref,
  working,
  workingHint,
}: {
  jobId: string;
  status: Open;
  createdAt: string;
  resumeHref: string;
  /** « L’IA prépare … » (translated); the differentiated text's by default. */
  working?: string;
  /** What to do meanwhile (translated); the differentiated text's by default. */
  workingHint?: string;
}) {
  const t = useTranslations('differentiate');
  const router = useRouter();
  const [status, setStatus] = useState<Open>(initialStatus);
  const [failures, setFailures] = useState(0);
  // Checked on the first tick (not while rendering: the server's clock is not the browser's).
  const [expired, setExpired] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async (): Promise<Check> => {
    try {
      const result = await getAiJobStatus(jobId);
      if (result.ok) {
        const next = result.data.status;
        if (next === 'queued' || next === 'running') return { kind: 'open', status: next };
        return { kind: 'done' };
      }
      // Gone (removed, or no longer visible): the page will say so.
      return result.error === 'notFound' ? { kind: 'done' } : { kind: 'error' };
    } catch {
      return { kind: 'error' };
    }
  }, [jobId]);

  useEffect(() => {
    if (expired) return;
    let stopped = false;
    let busy = false;
    let timer: number | undefined;
    let delay = FIRST_POLL_MS;

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, delay);
    };
    const tick = async () => {
      timer = undefined;
      // Hidden tab: wait until it is shown again (see below).
      if (stopped || document.hidden) return;
      if (pollExpired(createdAt)) {
        setExpired(true);
        return;
      }
      busy = true;
      const result = await check();
      busy = false;
      if (stopped) return;
      if (result.kind === 'open') {
        setStatus(result.status);
        setFailures(0);
        delay = nextPollDelay(delay, 'waiting');
      } else if (result.kind === 'error') {
        setFailures((n) => n + 1);
        delay = nextPollDelay(delay, 'error');
      } else {
        // Finished: show the result. Checking again later covers a refresh that got lost.
        router.refresh();
        delay = nextPollDelay(delay, 'error');
      }
      schedule();
    };
    const onVisible = () => {
      if (document.hidden || stopped || busy || timer !== undefined) return;
      delay = FIRST_POLL_MS;
      schedule();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [jobId, createdAt, expired, check, router]);

  // After the limit: one check on demand.
  const checkAgain = async () => {
    setChecking(true);
    const result = await check();
    setChecking(false);
    if (result.kind === 'open') setStatus(result.status);
    if (result.kind === 'done') router.refresh();
  };

  if (expired) {
    return (
      <Card>
        <CardBody className="space-y-3 pt-4">
          <Notice tone="warning" className="space-y-1">
            <p className="font-medium">{t('tooLong')}</p>
            <p>{t('tooLongHint')}</p>
          </Notice>
          <p className="text-sm text-slate-600" role="status">
            {t(`status.${status}`)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void checkAgain()} disabled={checking}>
              {checking ? t('checking') : t('checkAgain')}
            </Button>
            <Button asChild variant="secondary">
              <Link href={resumeHref}>
                <RotateCcw aria-hidden />
                {t('resume')}
              </Link>
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="flex items-start gap-3 pt-4" role="status" aria-live="polite">
        <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-brand-600" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium text-slate-900">{t(`status.${status}`)}</p>
          <p className="text-slate-700">{working ?? t('working')}</p>
          <p className="text-sm text-slate-500">{workingHint ?? t('workingHint')}</p>
          {failures >= 2 ? <p className="text-sm text-amber-700">{t('reconnecting')}</p> : null}
        </div>
      </CardBody>
    </Card>
  );
}
