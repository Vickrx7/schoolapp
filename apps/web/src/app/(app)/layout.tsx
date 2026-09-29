import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AppNav } from '@/components/app/app-nav';
import { SignOutForm } from '@/components/app/sign-out-form';
import { Notice } from '@/components/ui/card';
import { APP_NAME } from '@/lib/app-name';
import {
  aiSchools,
  hasRole,
  requireSession,
  showLibrary as libraryShown,
  substituteBoardSchools,
  teachingSchools,
} from '@/server/session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const t = await getTranslations();

  if (session.schools.length === 0 && session.boards.length === 0) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-16">
        <Notice tone="warning">{t('auth.noAccess')}</Notice>
        <SignOutForm />
      </main>
    );
  }

  const showTeaching = teachingSchools(session).length > 0;
  const showSubstitutes = substituteBoardSchools(session).length > 0;
  const showLibrary = libraryShown(session);
  // « Texte différencié » lives inside the library when it is shown (D-078).
  const showDifferentiate = aiSchools(session).length > 0 && !showLibrary;
  const showSchool = session.schools.some((s) =>
    hasRole(s, 'principal', 'vice_principal', 'office_admin'),
  );

  return (
    <>
      <AppNav
        appName={APP_NAME}
        showTeaching={showTeaching}
        showSubstitutes={showSubstitutes}
        showLibrary={showLibrary}
        showDifferentiate={showDifferentiate}
        showSchool={showSchool}
      />
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-28 md:pb-12 print:max-w-none print:p-0">
        {children}
      </main>
    </>
  );
}
