import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { confirmLoginLink } from '@/server/actions/auth';

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; error?: string; next?: string }>;
}) {
  const { token_hash: tokenHash, error, next } = await searchParams;
  const t = await getTranslations('auth');

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-5">
        <h1 className="text-2xl font-bold">{t('confirmTitle')}</h1>
        {error || !tokenHash ? (
          <>
            <Notice tone="danger">{t('confirmFailed')}</Notice>
            <Button asChild variant="secondary">
              <Link href="/login">{t('backToLogin')}</Link>
            </Button>
          </>
        ) : (
          <form action={confirmLoginLink} className="space-y-4">
            <p className="text-slate-600">{t('confirmIntro')}</p>
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="next" value={next ?? ''} />
            <Button type="submit" size="lg" className="w-full">
              {t('confirmButton')}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
