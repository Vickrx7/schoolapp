import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { signOut } from '@/server/actions/auth';

/** Signed in, but the account is deactivated or not set up: explain and offer to sign out. */
export default async function NoAccessPage() {
  const t = await getTranslations();
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-16">
      <Notice tone="warning">{t('auth.noAccess')}</Notice>
      <form action={signOut}>
        <Button type="submit" variant="secondary">
          {t('nav.signOut')}
        </Button>
      </form>
    </main>
  );
}
