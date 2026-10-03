import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NewsletterEditor } from '@/components/info-parents/newsletter-editor';
import { PrepareForm } from '@/components/info-parents/prepare-form';
import { Notice } from '@/components/ui/card';
import { longDate } from '@/components/year-plan/year-format';
import { DeleteNewsletterButton } from '@/components/info-parents/delete-button';
import { newsletterCatalogs } from '@/server/newsletter/catalogs';
import { newsletterHeader, newsletterHeadings } from '@/server/newsletter/phrases';
import { isWeekOf, weekInYear } from '@/server/newsletter/view-model';
import { loadClass } from '@/server/queries/classes';
import { loadNewsletter, loadPrepareContext } from '@/server/queries/newsletters';
import { findSchool, hasModule, hasRole, requireSession } from '@/server/session';

type Params = Promise<{ classId: string; weekOf: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { classId, weekOf } = await params;
  const session = await requireSession();
  const [cls, t, locale] = await Promise.all([
    loadClass(session, classId),
    getTranslations('newsletter'),
    getLocale(),
  ]);
  if (!cls || !isWeekOf(weekOf)) return { title: t('title') };
  return { title: t('metaWeek', { className: cls.name, date: longDate(weekOf, locale) }) };
}

/**
 * A week's message (`/classes/[id]/info-parents/[weekOf]`, `weekOf` a Monday; DECISIONS D-136 to
 * D-138): « Préparer le message » when the week has none yet, else the editor. For the class team
 * with a teacher role; the header (school, class, week) is rendered here, never stored.
 */
export default async function NewsletterWeekPage({ params }: { params: Params }) {
  const { classId, weekOf } = await params;
  const session = await requireSession();
  if (!isWeekOf(weekOf)) notFound();
  const cls = await loadClass(session, classId);
  if (!cls) notFound();
  const school = findSchool(session, cls.schoolId);
  if (!school || !cls.myRole || !hasRole(school, 'teacher')) notFound();
  const [t, locale, newsletter] = await Promise.all([
    getTranslations('newsletter'),
    getLocale(),
    loadNewsletter(session, cls, weekOf),
  ]);
  const week = longDate(weekOf, locale);
  const back = (
    <Link
      href={`/classes/${classId}/info-parents`}
      className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {t('back')}
    </Link>
  );

  if (!newsletter) {
    const context = await loadPrepareContext(session, cls);
    return (
      <div className="space-y-4">
        {back}
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900">{t('prepare.title', { date: week })}</h2>
          <p className="max-w-prose text-slate-600">{t('intro')}</p>
        </div>
        {context.year && weekInYear(weekOf, context.year) ? (
          <PrepareForm
            classId={classId}
            weekOf={weekOf}
            colleagues={context.colleagues}
            guides={hasModule(school, 'library')}
          />
        ) : (
          <Notice tone="warning">{t('prepare.outside')}</Notice>
        )}
      </div>
    );
  }

  const [catalogs, context] = await Promise.all([
    newsletterCatalogs(),
    loadPrepareContext(session, cls),
  ]);
  const headerValues = { school: school.name, className: cls.name, weekOf };
  const content = newsletter.content;

  return (
    <div className="space-y-4">
      {back}
      <h2 className="text-xl font-bold text-slate-900">{t('weekOf', { date: week })}</h2>
      {content ? (
        <NewsletterEditor
          userId={session.userId}
          classId={classId}
          id={newsletter.id}
          weekLabel={week}
          status={newsletter.status}
          sentLabel={newsletter.sentOn ? longDate(newsletter.sentOn, locale) : null}
          revision={newsletter.revision}
          content={content}
          names={newsletter.names}
          header={{
            fr: newsletterHeader('fr-CA', catalogs.fr, headerValues),
            en: newsletterHeader('en-CA', catalogs.en, headerValues),
          }}
          headings={{
            fr: newsletterHeadings('fr-CA', catalogs.fr),
            en: newsletterHeadings('en-CA', catalogs.en),
          }}
          options={{ colleagues: context.colleagues, guides: hasModule(school, 'library') }}
        />
      ) : (
        <div className="space-y-3">
          <Notice tone="warning">{t('editor.unreadable')}</Notice>
          <DeleteNewsletterButton classId={classId} id={newsletter.id} weekLabel={week} />
        </div>
      )}
    </div>
  );
}
