import { LIBRARY_BUCKETS, type LibraryBucket } from '@lynx/content';
import {
  ClipboardCheck,
  FlaskConical,
  GraduationCap,
  HeartHandshake,
  PencilLine,
  Puzzle,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { libraryHref } from '@/server/library/search-params';

const BUCKET_ICONS: Record<LibraryBucket, LucideIcon> = {
  enseigner: GraduationCap,
  pratiquer: PencilLine,
  explorer: FlaskConical,
  evaluer: ClipboardCheck,
  jouer: Puzzle,
  relier: HeartHandshake,
};

/**
 * The six categories on the hub (« Enseigner », « Pratiquer », « Explorer », « Évaluer »,
 * « Jouer », « Relier »), each opening its resources, with how many the user can use.
 */
export function BucketTiles({ counts }: { counts: Partial<Record<LibraryBucket, number>> }) {
  const t = useTranslations('library');
  const tc = useTranslations('libraryCommon');
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {LIBRARY_BUCKETS.map((bucket) => {
        const Icon = BUCKET_ICONS[bucket];
        return (
          <li key={bucket}>
            <Link
              href={libraryHref({ buckets: [bucket] })}
              className="flex h-full min-h-20 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:bg-brand-50"
            >
              <span className="flex items-center gap-2 font-medium text-slate-900">
                <Icon className="size-5 shrink-0 text-brand-700" aria-hidden />
                {tc(`buckets.${bucket}`)}
              </span>
              <span className="hidden text-sm text-slate-600 sm:block">
                {tc(`bucketHints.${bucket}`)}
              </span>
              <span className="mt-auto text-xs text-slate-600 tabular-nums">
                {t('bucketCount', { count: counts[bucket] ?? 0 })}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
