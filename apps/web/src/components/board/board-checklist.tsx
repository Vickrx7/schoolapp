import { CircleCheck, Circle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import type { ChecklistItem } from '@/server/queries/board';

/**
 * « Pour bien démarrer le conseil »: what a new board sets up, computed from its data (never
 * ticked by hand). Each step links to where it is done; its state is written, not only drawn.
 */
export async function BoardChecklist({ items }: { items: ChecklistItem[] }) {
  const t = await getTranslations('board.checklist');
  const done = items.filter((i) => i.done).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <Badge tone={done === items.length ? 'success' : 'neutral'}>
          {t('progress', { done, total: items.length })}
        </Badge>
      </CardHeader>
      <CardBody>
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex min-h-11 items-center gap-3 rounded-lg py-2 hover:bg-slate-50"
              >
                {item.done ? (
                  <CircleCheck className="size-5 shrink-0 text-emerald-700" aria-hidden />
                ) : (
                  <Circle className="size-5 shrink-0 text-slate-400" aria-hidden />
                )}
                <span className="min-w-0 flex-1 text-slate-900">{t(item.key)}</span>
                <span className={item.done ? 'text-sm text-emerald-700' : 'text-sm text-slate-600'}>
                  {item.done ? t('done') : t('todo')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
