'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useOptimistic, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useErrorText } from '@/hooks/use-action';
import { markLessonTaught, unmarkLesson } from '@/server/actions/progress';

/** One-tap "lesson taught" with an undo in the confirmation toast. */
export function CheckOffButton({
  lessonId,
  lessonTitle,
  date,
  taught,
  size = 'md',
}: {
  lessonId: string;
  lessonTitle: string;
  date: string;
  taught: boolean;
  size?: 'sm' | 'md';
}) {
  const t = useTranslations('today');
  const tCommon = useTranslations('common');
  const errorText = useErrorText();
  const [pending, startTransition] = useTransition();
  const [optimisticTaught, setOptimisticTaught] = useOptimistic(taught);

  const undo = () =>
    startTransition(async () => {
      setOptimisticTaught(false);
      try {
        const result = await unmarkLesson(lessonId);
        if (result.ok) toast.info(t('lessonUnmarked'));
        else toast.error(errorText(result.error));
      } catch {
        toast.error(errorText('network'));
      }
    });

  const toggle = () =>
    startTransition(async () => {
      const next = !optimisticTaught;
      setOptimisticTaught(next);
      try {
        const result = next ? await markLessonTaught(lessonId, date) : await unmarkLesson(lessonId);
        if (!result.ok) {
          toast.error(errorText(result.error));
        } else if (next) {
          toast.success(t('lessonMarked', { title: lessonTitle }), {
            action: { label: tCommon('undo'), onClick: undo },
            duration: 6000,
          });
        } else {
          toast.info(t('lessonUnmarked'));
        }
      } catch {
        toast.error(errorText('network'));
      }
    });

  return (
    <Button
      variant={optimisticTaught ? 'success' : 'secondary'}
      size={size}
      onClick={toggle}
      disabled={pending}
      aria-pressed={optimisticTaught}
      className="shrink-0"
    >
      <Check aria-hidden />
      {optimisticTaught ? t('taught') : t('markTaught')}
    </Button>
  );
}
