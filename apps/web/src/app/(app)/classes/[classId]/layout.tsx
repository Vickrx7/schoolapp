import { ChevronLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ClassTabs } from '@/components/classes/class-tabs';
import { ClassNoticesBlock } from '@/components/onboarding/class-notices';
import { SampleBadge } from '@/components/onboarding/sample-badge';
import { PageHeader } from '@/components/ui/page';
import { loadClass } from '@/server/queries/classes';
import { loadClassNotices } from '@/server/queries/onboarding';
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
  const [cls, notices] = await Promise.all([
    loadClass(session, classId),
    loadClassNotices(session, classId),
  ]);
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
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {t(`classes.role.${cls.myRole}`)}
            {/* A sample class (D-109). */}
            {notices.sample ? <SampleBadge /> : null}
          </span>
        }
      />
      {/* A sample class, or students' first names erased soon (D-105, D-109). */}
      <ClassNoticesBlock classId={classId} className={cls.name} notices={notices} />
      {/* « Mode classe »: the class team with a teacher role, with the Library module (D-090). */}
      <ClassTabs
        classId={classId}
        classMode={hasModule(school, 'library') && hasRole(school, 'teacher')}
      />
      <div className="mt-5">{children}</div>
    </div>
  );
}
