import { ChevronLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ClassTabs } from '@/components/classes/class-tabs';
import { PageHeader } from '@/components/ui/page';
import { loadClass } from '@/server/queries/classes';
import { findSchool, hasModule, hasRole, requireSession } from '@/server/session';

export default async function ClassLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const session = await requireSession();
  const cls = await loadClass(session, classId);
  const school = cls ? findSchool(session, cls.schoolId) : null;
  // Class pages are for the class's teaching team. (Principal oversight views are Phase 6.)
  if (!cls || !cls.myRole || !school || !hasModule(school, 'teaching')) notFound();
  const t = await getTranslations();

  return (
    <div>
      <PageHeader
        back={
          <Link
            href="/classes"
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {t('classes.title')}
          </Link>
        }
        title={cls.name}
        subtitle={cls.myRole ? t(`classes.role.${cls.myRole}`) : undefined}
      />
      {/* « Mode classe »: the class team with a teacher role, with the Library module (D-090). */}
      <ClassTabs
        classId={classId}
        classMode={hasModule(school, 'library') && hasRole(school, 'teacher')}
      />
      <div className="mt-5">{children}</div>
    </div>
  );
}
