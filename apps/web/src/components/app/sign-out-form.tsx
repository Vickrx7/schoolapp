'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { clearAllDrafts } from '@/hooks/use-draft';
import { signOut } from '@/server/actions/auth';

/**
 * The sign-out button. Every draft on this device is removed first: drafts can name students
 * and must not stay behind on a shared computer (D-035).
 */
export function SignOutForm() {
  const t = useTranslations('nav');
  return (
    <form action={signOut} onSubmit={() => clearAllDrafts()}>
      <Button type="submit" variant="secondary">
        {t('signOut')}
      </Button>
    </form>
  );
}
