import { CheckCircle2, Circle, FlaskConical } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { formatLocalDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TeacherOnboarding } from '@/server/queries/onboarding';
import { HideChecklistButton } from './hide-checklist-button';
import { SampleClassButtons } from './sample-class-buttons';

const stepLink =
  'flex min-h-11 flex-1 items-center font-medium text-slate-900 underline-offset-2 hover:text-brand-700 hover:underline';

/**
 * « Pour bien commencer » (DECISIONS D-109): four steps computed from the teacher's real classes
 * (never the sample class), the optional « Fiche de suppléance », and the sample class to try
 * the app with. On « Aujourd'hui » (`variant="card"`) it has « Masquer »; the page `/demarrage`
 * always shows it.
 */
export async function TeacherChecklist({
  data,
  variant,
}: {
  data: TeacherOnboarding;
  variant: 'card' | 'page';
}) {
  const t = await getTranslations('onboarding');
  const locale = await getLocale();
  const sampleSchool = data.sampleSchools[0] ?? null;
  const allDone = data.done === data.total;

  return (
    <Card className={cn(variant === 'card' && 'mb-4')} data-testid="onboarding-checklist">
      <CardHeader className="flex-wrap items-center">
        <div className="min-w-0">
          {/* On its own page, the page's heading names it. */}
          {variant === 'card' ? <CardTitle>{t('title')}</CardTitle> : null}
          <p className="text-sm text-slate-600">
            <span className="sr-only">
              {t('progressLabel', { done: data.done, total: data.total })}
            </span>
            <span aria-hidden>{t('progress', { done: data.done, total: data.total })}</span>
          </p>
        </div>
        {variant === 'card' ? <HideChecklistButton hidden={false} /> : null}
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-slate-700">{allDone ? t('allDone') : t('intro')}</p>
        <ol className="space-y-1">
          {data.steps.map((step) => (
            <li key={step.key} className="flex items-center gap-3">
              {step.done ? (
                <CheckCircle2 className="size-5 shrink-0 text-emerald-700" aria-hidden />
              ) : (
                <Circle className="size-5 shrink-0 text-slate-400" aria-hidden />
              )}
              <Link href={step.href} className={stepLink}>
                {t(`steps.${step.key}`)}
              </Link>
              <Badge tone={step.done ? 'success' : 'neutral'}>
                {step.done ? t('done') : t('todo')}
              </Badge>
            </li>
          ))}
        </ol>

        {data.subProfile ? (
          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              {t('optional')}
            </p>
            <div className="flex items-center gap-3">
              {data.subProfile.done ? (
                <CheckCircle2 className="size-5 shrink-0 text-emerald-700" aria-hidden />
              ) : (
                <Circle className="size-5 shrink-0 text-slate-400" aria-hidden />
              )}
              <Link href={data.subProfile.href} className={stepLink}>
                {t('steps.subProfile')}
              </Link>
              <Badge tone={data.subProfile.done ? 'success' : 'neutral'}>
                {data.subProfile.done ? t('done') : t('todo')}
              </Badge>
            </div>
          </div>
        ) : null}

        {data.samples.length || sampleSchool ? (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            {data.samples.map((sample) => (
              <p key={sample.id} className="flex flex-wrap items-center gap-2 text-sm">
                <FlaskConical className="size-4 shrink-0 text-amber-700" aria-hidden />
                <Link
                  href={`/classes/${sample.id}/planning`}
                  className="inline-flex min-h-11 items-center font-medium text-brand-700 underline underline-offset-2"
                >
                  {t('sample.yours', { name: sample.name })}
                </Link>
                <span className="text-slate-600">
                  {t('sample.notice', {
                    date: formatLocalDate(sample.purgeOn, locale, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    }),
                  })}
                </span>
              </p>
            ))}
            {sampleSchool && !allDone ? (
              <>
                <p className="text-sm text-slate-700">{t('sample.intro')}</p>
                <SampleClassButtons schoolId={sampleSchool.id} />
              </>
            ) : null}
          </div>
        ) : null}

        {variant === 'page' && data.dismissed ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <p className="text-sm text-slate-600">{t('hidden')}</p>
            <HideChecklistButton hidden />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
