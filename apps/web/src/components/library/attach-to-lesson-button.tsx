'use client';

import { Paperclip } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAction } from '@/hooks/use-action';
import { attachItemToLesson } from '@/server/actions/library-planning';
import { unitPlanningHref } from '@/server/library/planning-targets';
import type { AttachTarget } from '@/server/library/view-model';

/**
 * « Joindre à cette leçon » on a result card while a resource is chosen for a lesson (D-076).
 * A lesson that already has another resource is only changed once the teacher confirms
 * « Remplacer « … » ? ». Then back to the unit's planning.
 */
export function AttachToLessonButton({
  itemId,
  itemTitle,
  target,
}: {
  itemId: string;
  itemTitle: string;
  target: AttachTarget;
}) {
  const t = useTranslations('libraryPlanning');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [replacing, setReplacing] = useState<string | null>(null);
  const attach = useAction(attachItemToLesson);

  const run = async (replace: boolean) => {
    const result = await attach.run(itemId, target.lessonId, replace);
    if (!result?.ok) return;
    if (result.data.status === 'confirm') {
      setReplacing(result.data.currentTitle ?? t('hiddenResource'));
      return;
    }
    setReplacing(null);
    toast.success(t('attached', { n: result.data.sequenceNumber }));
    router.push(unitPlanningHref(result.data.classId, result.data.unitId));
  };

  return (
    <>
      <Button
        className="mt-1 w-full sm:w-auto"
        disabled={attach.pending}
        aria-label={t('attachThisNamed', { title: itemTitle })}
        onClick={() => void run(false)}
      >
        <Paperclip aria-hidden />
        {t('attachThis')}
      </Button>
      <Dialog open={replacing !== null} onOpenChange={(open) => !open && setReplacing(null)}>
        <DialogContent title={t('replaceTitle')} closeLabel={tCommon('close')}>
          <p className="text-slate-700">{t('replaceConfirm', { title: replacing ?? '' })}</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReplacing(null)}>
              {tCommon('cancel')}
            </Button>
            <Button disabled={attach.pending} onClick={() => void run(true)}>
              {t('submitReplace')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
