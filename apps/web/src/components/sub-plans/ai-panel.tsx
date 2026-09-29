'use client';

import { LoaderCircle, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/app/confirm-button';
import { FIRST_POLL_MS, nextPollDelay, pollExpired } from '@/components/differentiate/poll';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle, Notice } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAction, useErrorText } from '@/hooks/use-action';
import { formatInstantTime, formatLocalDate, formatTimeRange, instantInZone } from '@/lib/format';
import {
  clearSubPlanAi,
  getSubPlanAiStatus,
  previewSubPlanAi,
  requestSubPlanAi,
  type SubPlanAiPreview,
} from '@/server/actions/sub-plan-ai';
import type { SubPlanAiState } from '@/server/queries/sub-plan-ai';
import type { SubPlanAiNotSent } from '@/server/sub-plans/ai-preview';

/** The request's text with the replaced names highlighted. */
function SentPreview({ preview }: { preview: SubPlanAiPreview }) {
  return (
    <div
      className="max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs whitespace-pre-wrap text-slate-800"
      data-testid="sub-plan-ai-preview"
      tabIndex={0}
    >
      {preview.segments.map((s, i) =>
        s.placeholder ? (
          <mark key={i} className="rounded bg-brand-100 px-0.5 font-medium text-brand-800">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </div>
  );
}

function NotSentList({ items }: { items: SubPlanAiNotSent[] }) {
  const t = useTranslations('subPlanAi');
  const locale = useLocale();
  return (
    <Notice tone="warning" className="space-y-2">
      <p className="flex items-center gap-1.5 font-medium">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        {t('notSentTitle')}
      </p>
      <p>{t('notSentIntro')}</p>
      <ul className="list-disc space-y-1 pl-5" data-testid="sub-plan-ai-not-sent">
        {items.map((item, i) => {
          const where = item.block
            ? `${formatTimeRange(item.block.start, item.block.end, locale)} · ${item.block.subject}`
            : item.group
              ? t('group', { key: item.group })
              : t('theDay');
          return (
            <li key={i}>
              {t('notSentItem', {
                where,
                field: t(`fields.${item.field}`),
                kinds: item.kinds.map((k) => t(`kinds.${k}`)).join(', '),
              })}
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}

type Open = 'queued' | 'running';

/**
 * Waits for the worker to finish the plan's request, then shows the plan with it. Checks less
 * often as time passes, pauses while the tab is hidden and stops after a limit, like the
 * « Texte différencié » page.
 */
function Progress({
  planId,
  status: initial,
  createdAt,
}: {
  planId: string;
  status: Open;
  createdAt: string;
}) {
  const t = useTranslations('subPlanAi');
  const router = useRouter();
  const [status, setStatus] = useState<Open>(initial);
  const [expired, setExpired] = useState(false);
  const [failures, setFailures] = useState(0);

  const check = useCallback(async () => {
    try {
      const result = await getSubPlanAiStatus(planId);
      return result.ok ? result.data : null;
    } catch {
      return null;
    }
  }, [planId]);

  useEffect(() => {
    if (expired) return;
    let stopped = false;
    let timer: number | undefined;
    let delay = FIRST_POLL_MS;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, delay);
    };
    const tick = async () => {
      timer = undefined;
      if (stopped || document.hidden) return;
      if (pollExpired(createdAt)) {
        setExpired(true);
        return;
      }
      const result = await check();
      if (stopped) return;
      if (!result) {
        setFailures((n) => n + 1);
        delay = nextPollDelay(delay, 'error');
      } else if (result.status === 'queued' || result.status === 'running') {
        setStatus(result.status);
        setFailures(0);
        delay = nextPollDelay(delay, 'waiting');
      } else {
        if (result.status === 'succeeded' && result.applied) toast.success(t('applied'));
        router.refresh();
        delay = nextPollDelay(delay, 'error');
      }
      schedule();
    };
    const onVisible = () => {
      if (document.hidden || stopped || timer !== undefined) return;
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
  }, [createdAt, expired, check, router, t]);

  if (expired) {
    return (
      <Notice tone="warning" className="space-y-2">
        <p className="font-medium">{t('tooLong')}</p>
        <p>{t('tooLongHint')}</p>
        <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
          {t('checkAgain')}
        </Button>
      </Notice>
    );
  }
  return (
    <div className="flex items-start gap-3" role="status" aria-live="polite">
      <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-brand-600" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium text-slate-900">
          {status === 'queued' ? t('queued') : t('running')}
        </p>
        <p className="text-sm text-slate-600">{t('runningHint')}</p>
        {failures >= 2 ? <p className="text-sm text-amber-700">{t('reconnecting')}</p> : null}
      </div>
    </div>
  );
}

/**
 * « Consignes détaillées (IA) » on the owner's plan page (DECISIONS D-052): never automatic.
 * The teacher opens the preview (« Vérifier avant d'envoyer »), which shows exactly what would
 * be sent and what is left out; nothing goes before she presses « Envoyer à l'IA ». The answer
 * is added under her own edits, and she can remove it.
 */
export function SubPlanAiPanel({
  planId,
  state,
  timeZone,
}: {
  planId: string;
  state: SubPlanAiState;
  timeZone: string;
}) {
  const t = useTranslations('subPlanAi');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  const errorText = useErrorText();
  const locale = useLocale();
  const router = useRouter();
  const [preview, setPreview] = useState<SubPlanAiPreview | null>(null);
  const check = useAction(previewSubPlanAi, { onSuccess: setPreview });
  const send = useAction(requestSubPlanAi, {
    onSuccess: () => {
      setPreview(null);
      router.refresh();
    },
  });

  const job = state.job;
  const running = job && (job.status === 'queued' || job.status === 'running');
  const canAsk = state.aiOn && state.editable && !state.inUse && state.periods > 0 && !running;
  // The worker's error codes (packages/ai AiErrorCode, aiDisabled, aiBudgetReached...).
  const jobError =
    job?.status === 'failed'
      ? tErrors(
          job.errorCode && tErrors.has(job.errorCode as 'aiError')
            ? (job.errorCode as 'aiError')
            : 'aiError',
        )
      : null;
  const appliedAt = state.applied?.appliedAt
    ? instantInZone(state.applied.appliedAt, timeZone)
    : null;

  return (
    <Card data-testid="sub-plan-ai">
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <Sparkles className="size-4 text-brand-600" aria-hidden />
            {t('title')}
          </span>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {running ? (
          <Progress planId={planId} status={job.status as Open} createdAt={job.createdAt} />
        ) : state.applied ? (
          <div className="space-y-1">
            <Badge tone="success">{t('applied')}</Badge>
            <p className="text-sm text-slate-600">
              {appliedAt
                ? t('appliedAt', {
                    date: formatLocalDate(appliedAt.date, locale),
                    time: formatInstantTime(state.applied.appliedAt!, timeZone, locale),
                  })
                : t('appliedHint')}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">{t('intro')}</p>
        )}

        {jobError && !running ? (
          <Notice tone="warning">
            <p className="font-medium">{t('failed')}</p>
            <p>{jobError}</p>
          </Notice>
        ) : null}
        {job?.status === 'succeeded' && !job.applied && !running ? (
          <Notice tone="warning">{t('notApplied')}</Notice>
        ) : null}
        {!state.aiOn ? <Notice>{t('aiOff')}</Notice> : null}
        {state.aiOn && state.editable && state.inUse ? <Notice>{t('inUse')}</Notice> : null}
        {state.aiOn && state.editable && !state.inUse && state.periods === 0 ? (
          <Notice>{t('nothing')}</Notice>
        ) : null}

        {state.applied?.sentText ? (
          <details className="rounded-lg border border-slate-200 p-3 text-sm">
            <summary className="cursor-pointer font-medium text-slate-900">{t('sentText')}</summary>
            <pre className="mt-2 font-mono text-xs whitespace-pre-wrap text-slate-700">
              {state.applied.sentText}
            </pre>
          </details>
        ) : null}

        {canAsk || (state.applied && state.editable) ? (
          <div className="flex flex-wrap gap-2">
            {canAsk ? (
              <Button
                variant={state.applied ? 'secondary' : 'primary'}
                onClick={() => void check.run(planId)}
                disabled={check.pending}
              >
                <Sparkles aria-hidden />
                {check.pending ? tCommon('loading') : state.applied ? t('redo') : t('add')}
              </Button>
            ) : null}
            {state.applied && state.editable ? (
              <ConfirmButton
                label={t('remove')}
                message={t('removeConfirm')}
                confirmLabel={t('removeConfirmButton')}
                size="md"
                onConfirm={async () => {
                  const result = await clearSubPlanAi(planId);
                  if (result.ok) {
                    toast.success(t('removed'));
                    router.refresh();
                  } else {
                    toast.error(errorText(result.error));
                  }
                }}
              />
            ) : null}
          </div>
        ) : null}
      </CardBody>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        {preview ? (
          <DialogContent
            title={t('preview')}
            description={t('previewIntro')}
            closeLabel={tCommon('close')}
            className="sm:max-w-2xl"
          >
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm text-slate-700">
                <ShieldCheck className="size-4 shrink-0 text-emerald-600" aria-hidden />
                {t('periods', { count: preview.periods })}{' '}
                {t('replacedCount', { count: preview.replaced })}
              </p>
              {preview.notSent.length ? <NotSentList items={preview.notSent} /> : null}
              <SentPreview preview={preview} />
              <p className="text-sm text-slate-600">{t('previewCheck')}</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => setPreview(null)}>
                  {tCommon('cancel')}
                </Button>
                <Button
                  onClick={() => void send.run(planId, preview.contentVersion)}
                  disabled={send.pending}
                >
                  {send.pending ? t('sending') : t('send')}
                </Button>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  );
}
