'use client';

import { useTranslations } from 'next-intl';
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FeedbackForm } from './feedback-form';

interface FeedbackContextValue {
  /** Opens « Envoyer un commentaire », with an error page's reference when there is one. */
  open: (errorRef?: string) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

/**
 * One « Commentaires » dialog per signed-in shell (the app and the projector, DECISIONS D-116):
 * the header's button and the error pages' « Signaler ce problème » (D-111) open it. Outside a
 * shell (the substitute portal, class devices) there is none: those people have no account.
 */
export function FeedbackProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const t = useTranslations('feedback');
  const tCommon = useTranslations('common');
  const [state, setState] = useState({ open: false, errorRef: null as string | null, key: 0 });
  const open = useCallback(
    (errorRef?: string) =>
      setState((s) => ({ open: true, errorRef: errorRef ?? null, key: s.key + 1 })),
    [],
  );
  const value = useMemo(() => ({ open }), [open]);

  return (
    <FeedbackContext value={value}>
      {children}
      <Dialog open={state.open} onOpenChange={(o) => setState((s) => ({ ...s, open: o }))}>
        {state.open ? (
          <DialogContent title={t('title')} description={t('intro')} closeLabel={tCommon('close')}>
            <FeedbackForm
              key={state.key}
              userId={userId}
              initialRef={state.errorRef}
              onSent={() => setState((s) => ({ ...s, open: false }))}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </FeedbackContext>
  );
}

/** The shell's feedback dialog, or null where there is none (no account). */
export function useFeedback(): FeedbackContextValue | null {
  return use(FeedbackContext);
}
