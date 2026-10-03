import { getLocale, getTranslations } from 'next-intl/server';
import { Notice } from '@/components/ui/card';
import { formatLocalDate } from '@/lib/format';
import type { ClassNotices } from '@/server/queries/onboarding';
import { DeleteSampleButton } from './delete-sample-button';

const DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };

/**
 * What a class page says first (DECISIONS D-105, D-109): a sample class is never in a substitute
 * plan and is deleted on a given day; a real class's students' first names are erased soon after
 * the school year (its units and lessons stay).
 */
export async function ClassNoticesBlock({
  classId,
  className,
  notices,
}: {
  classId: string;
  className: string;
  notices: ClassNotices;
}) {
  if (!notices.sample && !notices.purge) return null;
  const t = await getTranslations('onboarding');
  const locale = await getLocale();
  return (
    <div className="mb-4 space-y-2">
      {notices.sample ? (
        <Notice
          tone="warning"
          className="flex flex-wrap items-center justify-between gap-2"
          data-testid="sample-notice"
        >
          <span>
            {t('sample.notice', { date: formatLocalDate(notices.sample.purgeOn, locale, DATE) })}
          </span>
          <DeleteSampleButton classId={classId} />
        </Notice>
      ) : null}
      {notices.purge ? <PurgeNotice className={className} purgeOn={notices.purge.purgeOn} /> : null}
    </div>
  );
}

/** « Les prénoms des élèves de … seront effacés le … » (D-105), on the class page and Aujourd'hui. */
export async function PurgeNotice({ className, purgeOn }: { className: string; purgeOn: string }) {
  const t = await getTranslations('onboarding.purge');
  const locale = await getLocale();
  return (
    <Notice tone="info" data-testid="purge-notice">
      {t('notice', { className, date: formatLocalDate(purgeOn, locale, DATE) })}
    </Notice>
  );
}
