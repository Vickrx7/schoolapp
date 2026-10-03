import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { JoinForm } from '@/components/class-portal/join-form';
import { classPortalConfigured } from '@/server/class-portal/db';
import { loadDeviceState } from '@/server/class-portal/portal';
import { readDeviceToken } from '@/server/class-portal/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('classPortal');
  return { title: t('title') };
}

/** Whether this device's token is still in a game (one portal call; false on any failure). */
async function inGame(): Promise<boolean> {
  const token = await readDeviceToken();
  if (!token) return false;
  try {
    const result = await loadDeviceState(token, null);
    return result.status === 'ok' && result.value.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * « Rejoindre la partie » (DECISIONS D-084): the class link (`#k=…`, read in the browser) or the
 * 6-character code. A device still in a game goes back to it.
 */
export default async function JoinPage() {
  const t = await getTranslations('classPortal');
  const configured = classPortalConfigured();
  if (configured && (await inGame())) redirect('/jouer/partie');

  return (
    <div className="mx-auto max-w-xl space-y-8 py-4">
      <h1 className="text-[36px] leading-tight font-bold text-slate-950">{t('title')}</h1>
      {configured ? (
        <JoinForm />
      ) : (
        <p className="rounded-2xl border-2 border-slate-400 bg-slate-50 px-4 py-3 text-[22px]">
          {t('notConfigured')}
        </p>
      )}
    </div>
  );
}
