import { CURRENT_TERMS_VERSION, termsChangeKey, termsState } from '@lynx/domain';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { SignOutForm } from '@/components/app/sign-out-form';
import { WelcomeForm } from '@/components/onboarding/welcome-form';
import { Card } from '@/components/ui/card';
import { APP_NAME } from '@/lib/app-name';
import { welcomeNext } from '@/lib/request-path';
import { landingFor, requireSession } from '@/server/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('welcome');
  return { title: t('title') };
}

/**
 * « Bienvenue » (DECISIONS D-109, D-110): the pilot terms, then the profile, at a first sign-in
 * (every page sends there until then, `requireSession`); the newer terms alone from the banner.
 * Once accepted, back to the page asked for (`?next=`), else the person's landing page. Newer
 * terms say what changed in one line, and « Plus tard » goes back there without accepting: they
 * never block (D-109), even in the installed app, which has no Back button.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await requireSession({ beforeTerms: true });
  const { next } = await searchParams;
  const state = termsState(session.termsVersion);
  if (state === 'accepted') redirect(welcomeNext(next) ?? landingFor(session));
  const t = await getTranslations('welcome');
  const back = welcomeNext(next) ?? landingFor(session);
  const change = termsChangeKey();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {state === 'required' ? t('title') : t('updatedTitle')}
        </h1>
        <p className="mt-2 text-slate-700">
          {state === 'required' ? t('intro', { appName: APP_NAME }) : t('updatedIntro')}
        </p>
        {state === 'outdated' && change ? (
          <p className="mt-2 text-slate-700" data-testid="terms-change">
            {t('whatChanged', { change: t(`changes.${change}` as 'changes.pilote1') })}
          </p>
        ) : null}
      </div>
      <Card className="p-4 sm:p-6">
        <WelcomeForm
          mode={state}
          userId={session.userId}
          version={CURRENT_TERMS_VERSION}
          displayName={session.displayName}
          honorific={session.honorific}
          next={welcomeNext(next)}
          laterHref={state === 'outdated' ? back : null}
        />
      </Card>
      <SignOutForm />
    </div>
  );
}
