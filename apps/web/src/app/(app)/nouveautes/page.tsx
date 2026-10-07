import { appReleaseFrom } from '@lynx/config';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { requireSession } from '@/server/session';
import messages from '../../../../messages/fr-CA.json';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('releaseNotes');
  return { title: t('title') };
}

/** The versions and their items, newest first: the same keys in both languages (messages.test). */
const VERSIONS = Object.entries(messages.releaseNotes.versions).map(([key, version]) => ({
  key: key as keyof typeof messages.releaseNotes.versions,
  items: Object.keys(version.items),
}));

/**
 * « Nouveautés » (DECISIONS D-117): the release notes, newest first, from the message files
 * (`releaseNotes.versions`, the same keys in French and English). Static: no unread state.
 */
export default async function ReleaseNotesPage() {
  await requireSession();
  const t = await getTranslations('releaseNotes');
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('title')}
        subtitle={t('current', { version: appReleaseFrom(process.env) })}
      />
      <p className="mb-4 text-slate-700">{t('intro')}</p>
      <ol className="space-y-4">
        {VERSIONS.map(({ key, items }) => (
          <li key={key}>
            <Card>
              <CardHeader className="flex-wrap">
                <CardTitle>{t(`versions.${key}.title`)}</CardTitle>
                <span className="text-sm text-slate-600">{t(`versions.${key}.date`)}</span>
              </CardHeader>
              <CardBody>
                <ul className="list-disc space-y-1 pl-5 text-slate-800">
                  {items.map((item) => (
                    <li key={item}>
                      {t(`versions.${key}.items.${item}` as `versions.v010.items.today`)}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
