import { Newspaper } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Notice } from '@/components/ui/card';
import type { NewsletterReminderRow } from '@/server/queries/newsletters';

/**
 * « Info-parents : préparez le message de la semaine pour {classe}. » on « Aujourd'hui » (DECISIONS
 * D-142): on the week's last two school days, for each class where the teacher is homeroom that
 * already uses « Info-parents », until the week's message is marked sent. « Préparer le message »
 * opens the week (its message, or « Préparer le message » when there is none yet).
 */
export async function NewsletterReminders({ reminders }: { reminders: NewsletterReminderRow[] }) {
  if (reminders.length === 0) return null;
  const t = await getTranslations('today.newsletter');
  return (
    <div className="mb-4 space-y-2">
      {reminders.map((r) => (
        <Notice
          key={r.classId}
          tone="info"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
          data-testid="newsletter-reminder"
        >
          <span className="flex items-center gap-2">
            <Newspaper className="size-4 shrink-0" aria-hidden />
            {t('due', { className: r.className })}
          </span>
          <Link
            href={`/classes/${r.classId}/info-parents/${r.weekOf}`}
            className="inline-flex min-h-11 items-center font-medium underline underline-offset-2"
          >
            {t('action')}
          </Link>
        </Notice>
      ))}
    </div>
  );
}
