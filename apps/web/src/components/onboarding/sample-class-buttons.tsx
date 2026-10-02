'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-action';
import { createSampleClass } from '@/server/actions/onboarding';

/**
 * « Essayer avec une classe exemple (3e) » / « (5e) » (DECISIONS D-109): makes the sample class
 * at the school, then the page shows it.
 */
export function SampleClassButtons({ schoolId }: { schoolId: string }) {
  const t = useTranslations('onboarding.sample');
  const router = useRouter();
  const create = useAction(createSampleClass, {
    onSuccess: () => {
      toast.success(t('created'));
      router.refresh();
    },
  });
  return (
    <div className="flex flex-wrap gap-2" aria-busy={create.pending || undefined}>
      {(['3', '5'] as const).map((grade) => (
        <Button
          key={grade}
          variant="secondary"
          disabled={create.pending}
          onClick={() => void create.run({ schoolId, grade })}
        >
          {t('create', { grade })}
        </Button>
      ))}
      {create.pending ? (
        <p role="status" className="w-full text-sm text-slate-600">
          {t('creating')}
        </p>
      ) : null}
    </div>
  );
}
