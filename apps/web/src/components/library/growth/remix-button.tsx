'use client';

import { GitFork } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAction } from '@/hooks/use-action';
import { remixItem } from '@/server/actions/library-growth';
import { newUuid } from '@/server/library/growth';

/**
 * « Adapter cette ressource » (DECISIONS D-092): a dialog (a bottom sheet on phones) that says
 * what happens — a private copy, opened in the editor, the original credited — and, for a
 * resource shared with one school, that the adaptation stays within that school. The copy's id is
 * chosen once, when the dialog first opens: a second tap or a request sent again after a lost
 * answer returns the same copy instead of making another.
 */
export function RemixButton({ itemId, capped }: { itemId: string; capped: boolean }) {
  const t = useTranslations('libraryGrowth');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const newId = useRef<string | null>(null);
  const remix = useAction(remixItem, {
    onSuccess: (data) => {
      toast.success(t('adapted'));
      router.push(`/library/items/${data.itemId}/edit`);
    },
  });

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          newId.current ??= newUuid();
          setOpen(true);
        }}
      >
        <GitFork aria-hidden />
        {t('adapt')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t('adapt')}
          description={t('adaptHint')}
          closeLabel={tCommon('close')}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              newId.current ??= newUuid();
              void remix.run(itemId, newId.current);
            }}
          >
            {capped ? <Notice>{t('shareCap', { scope: 'school' })}</Notice> : null}
            {remix.error ? (
              <p className="text-sm text-red-600" role="alert">
                {remix.errorText}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={remix.pending}>
                {t('adaptSubmit')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
