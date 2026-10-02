'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { useAction } from '@/hooks/use-action';
import { setFeedbackStatus } from '@/server/actions/board';

export interface FeedbackItem {
  id: string;
  kind: 'problem' | 'idea' | 'question';
  message: string;
  route: string | null;
  errorRef: string | null;
  release: string | null;
  device: 'phone' | 'tablet' | 'desktop' | null;
  status: 'new' | 'read' | 'done';
  createdAt: string;
  schoolName: string | null;
  sender: { name: string; email: string } | null;
  mayContact: boolean;
}

const STATUS_TONE = { new: 'brand', read: 'neutral', done: 'success' } as const;

/** What can follow each state, and the button that does it. */
const NEXT = { new: ['read', 'done'], read: ['done', 'new'], done: ['new'] } as const;
const ACTION = { new: 'markNew', read: 'markRead', done: 'markDone' } as const;

function FeedbackCard({ item, timeZone }: { item: FeedbackItem; timeZone: string }) {
  const t = useTranslations('board.feedback');
  const locale = useLocale();
  const save = useAction(setFeedbackStatus, { successMessage: t('saved') });
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(item.createdAt));
  const details = [
    item.schoolName ? t('school', { name: item.schoolName }) : null,
    item.route ? t('route', { route: item.route }) : null,
    item.errorRef ? t('reference', { ref: item.errorRef }) : null,
    item.device ? t(`devices.${item.device}`) : null,
    item.release ? t('release', { release: item.release }) : null,
  ].filter((d): d is string => d !== null);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={item.kind === 'problem' ? 'warning' : 'neutral'}>
          {t(`kinds.${item.kind}`)}
        </Badge>
        <Badge tone={STATUS_TONE[item.status]}>{t(`statuses.${item.status}`)}</Badge>
        <span className="text-sm text-slate-600">{when}</span>
      </div>
      {/* What staff typed, shown as typed (never translated). */}
      <p className="whitespace-pre-wrap break-words text-slate-900">{item.message}</p>
      <p className="text-sm text-slate-600">
        {item.sender
          ? t('from', { name: item.sender.name, email: item.sender.email })
          : item.mayContact
            ? t('unknownSender')
            : t('noContact')}
      </p>
      {details.length ? <p className="text-sm text-slate-500">{details.join(' · ')}</p> : null}
      <div className="flex flex-wrap gap-2">
        {NEXT[item.status].map((next) => (
          <Button
            key={next}
            variant="secondary"
            disabled={save.pending}
            onClick={() => void save.run(item.id, next)}
          >
            {t(ACTION[next])}
          </Button>
        ))}
      </div>
    </Card>
  );
}

/** « Commentaires reçus » (DECISIONS D-116): « Nouveau », « Lu », « Traité ». */
export function FeedbackList({ items, timeZone }: { items: FeedbackItem[]; timeZone: string }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.id}>
          <FeedbackCard item={item} timeZone={timeZone} />
        </li>
      ))}
    </ul>
  );
}
