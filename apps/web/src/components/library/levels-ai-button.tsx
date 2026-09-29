'use client';

import { ShieldCheck, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useAction } from '@/hooks/use-action';
import {
  previewLibraryLevels,
  requestLibraryLevels,
  type LevelsPreview,
} from '@/server/actions/library-ai';
import { BlockedDetails, SentText } from './generate-preview';

/**
 * « Créer les versions manquantes avec l’IA » (SPEC 9.2, DECISIONS D-073): the levels the resource
 * has no version for (all ticked), then « Vérifier avant d’envoyer » (exactly what is sent, names
 * replaced), then « Envoyer ». The job page follows the request and comes back to the resource.
 * A reviewed resource becomes a private draft again when the versions arrive (the author reads
 * them before anyone else uses them, SPEC 9.3): the dialog says so before anything is sent.
 */
export function LevelsAiButton({
  itemId,
  schoolId,
  missing,
  reviewed,
}: {
  itemId: string;
  schoolId: string;
  /** Board levels without a version, in their order. */
  missing: { id: string; label: string }[];
  /** « Révisée » (and perhaps shared): it goes back to a private draft with the new versions. */
  reviewed: boolean;
}) {
  const t = useTranslations('libraryAi.levels');
  const tAi = useTranslations('libraryAi');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [levelIds, setLevelIds] = useState(() => missing.map((l) => l.id));
  const [preview, setPreview] = useState<LevelsPreview | null>(null);

  const check = useAction(previewLibraryLevels, { onSuccess: setPreview });
  const send = useAction(requestLibraryLevels, {
    onSuccess: ({ jobId }) => router.push(`/library/generate/${jobId}`),
  });

  const toggle = (id: string, on: boolean) => {
    setPreview(null);
    setLevelIds((prev) =>
      on
        ? missing.map((l) => l.id).filter((l) => l === id || prev.includes(l))
        : prev.filter((l) => l !== id),
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPreview(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Sparkles aria-hidden />
          {t('button')}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={t('title')}
        description={t('intro')}
        closeLabel={tCommon('close')}
        className="sm:max-w-2xl"
      >
        <div className="space-y-4">
          {reviewed ? <Notice tone="warning">{t('backToDraft')}</Notice> : null}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">{t('levels')}</legend>
            <div className="flex flex-wrap gap-2">
              {missing.map((l) => (
                <label
                  key={l.id}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-600"
                    checked={levelIds.includes(l.id)}
                    onChange={(e) => toggle(l.id, e.target.checked)}
                  />
                  <span>{l.label}</span>
                </label>
              ))}
            </div>
            <p className="text-sm text-slate-500">{t('hint')}</p>
          </fieldset>

          {!preview ? (
            <Button
              onClick={() => void check.run(itemId, schoolId, levelIds)}
              disabled={check.pending || levelIds.length === 0}
            >
              <ShieldCheck aria-hidden />
              {check.pending ? tCommon('loading') : tAi('preview')}
            </Button>
          ) : (
            <div className="space-y-3" aria-live="polite">
              <p className="text-sm text-slate-600">{t('previewIntro')}</p>
              <BlockedDetails blocked={preview.blocked} />
              <SentText segments={preview.message} />
              <p className="text-sm font-medium text-slate-700">
                {tAi('replacedCount', { count: preview.replaced })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void send.run(itemId, schoolId, levelIds)}
                  disabled={send.pending || preview.blocked.length > 0}
                >
                  {send.pending ? tAi('sending') : tAi('send')}
                </Button>
                <Button variant="secondary" onClick={() => setPreview(null)}>
                  {tAi('edit')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
