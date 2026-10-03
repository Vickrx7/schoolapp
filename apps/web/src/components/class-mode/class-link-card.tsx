'use client';

import { Copy, Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { useAction } from '@/hooks/use-action';
import { replaceClassLink } from '@/server/actions/class-mode';

/**
 * « Lien de la classe » on the class tab (DECISIONS D-084): the link and its QR code, « Copier le
 * lien », how to bookmark it on each class device, and « Remplacer le lien » (the old one stops
 * working on every device; audited). The link lets a device into this class's lobby only while
 * joining is open.
 */
export function ClassLinkCard({
  classId,
  url,
  qrSvg,
}: {
  classId: string;
  url: string;
  qrSvg: string;
}) {
  const t = useTranslations('classMode.link');
  const id = useId();
  const router = useRouter();
  const replace = useAction(replaceClassLink, {
    onSuccess: () => {
      toast.success(t('replaced'));
      router.refresh();
    },
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 aria-hidden className="size-5 text-slate-600" />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-slate-700">{t('help')}</p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div
            role="img"
            aria-label={t('qr')}
            className="size-40 shrink-0 rounded-lg border border-slate-200 bg-white p-1 [&>svg]:size-full"
            // Markup from the `qrcode` library, built on the server from the class link only.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <div className="min-w-0 flex-1 space-y-3">
            <label htmlFor={`${id}-url`} className="sr-only">
              {t('title')}
            </label>
            <input
              id={`${id}-url`}
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="block min-h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 font-mono text-sm text-slate-900"
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void copy()}>
                <Copy aria-hidden />
                {t('copy')}
              </Button>
              <ConfirmButton
                label={t('replace')}
                message={t('replaceConfirm')}
                confirmLabel={t('replace')}
                size="md"
                disabled={replace.pending}
                onConfirm={() => replace.run(classId)}
              />
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
