'use client';

import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * « Connexion perdue… on réessaie. » while the device's polls fail (school Wi-Fi drops often). The
 * game stays on screen; nothing the student chose is lost: an answer on its way is sent again.
 */
export function OfflineBanner({ offline }: { offline: boolean }) {
  const t = useTranslations('classPortal');
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {offline ? (
        <p className="flex items-center gap-3 rounded-2xl border-2 border-amber-600 bg-amber-50 px-4 py-3 text-[22px] font-semibold text-amber-950">
          <WifiOff aria-hidden className="size-7 shrink-0" />
          {t('offline')}
        </p>
      ) : null}
    </div>
  );
}
