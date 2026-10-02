import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AppNav } from '@/components/app/app-nav';
import { FooterSlot } from '@/components/app/footer-slot';
import { HeaderActionsSlot } from '@/components/app/header-actions-slot';
import { SignOutForm } from '@/components/app/sign-out-form';
import { Notice } from '@/components/ui/card';
import { APP_NAME } from '@/lib/app-name';
import {
  adminBoards,
  aiSchools,
  directionSchools,
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
  // « Direction » and « Conseil » (DECISIONS D-118).
  const showDirection = directionSchools(session).length > 0;
  const showBoard = adminBoards(session).length > 0;

  return (
    <>
      <AppNav
        appName={APP_NAME}
        showTeaching={showTeaching}
        showDirection={showDirection}
        showSubstitutes={showSubstitutes}
        showLibrary={showLibrary}
        showDifferentiate={showDifferentiate}
        showSchool={showSchool}
        showBoard={showBoard}
        headerActions={<HeaderActionsSlot session={session} />}
      />
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-28 md:pb-12 print:max-w-none print:p-0">
        {children}
      </main>
      <FooterSlot session={session} />
    </>
  );
}
