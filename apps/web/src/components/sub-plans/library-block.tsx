import type { SubPlanLibrary } from '@lynx/domain';
import { BookOpen, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DocView } from '@/components/library/doc-view';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';

/** A folded part's toggle: the whole row, 44 px high (D-034). */
const SUMMARY = 'min-h-11 cursor-pointer px-3 py-3 font-medium text-slate-800';

/** The owner's link to the resource: the teacher tab holds the key (never in the plan). */
export function libraryItemHref(itemId: string): string {
  return `/library/items/${itemId}?tab=teacher`;
}

/**
 * A lesson's library resource in a substitute plan (DECISIONS D-077): its guide for the adult,
 * then « Matériel pour les élèves », one version per set of groups with the group's level and
 * first names (for the adult: students' own pages never name a level, D-042). Documents are
 * French whatever the interface language (`DocView` marks them). The answer key is never in a
 * plan: the owner opens the resource for it (« Voir le corrigé »), everyone else is told it stays
 * with the teacher. Long documents are folded, so a phone shows the period at a glance.
 *
 * No hooks beyond translations: used by the server-rendered plan, the editor and the portal.
 */
export function LibraryBlock({
  library,
  showItemLink,
  groupLabels,
  groupNames = {},
  actions,
}: {
  library: SubPlanLibrary;
  /** The owner only: « Voir le corrigé » (or « Voir la ressource ») opens the resource. */
  showItemLink: boolean;
  /** « G1 · Débutant » */
  groupLabels: Readonly<Record<string, string>>;
  /** The first names of each group, joined from the roster the database derived. */
  groupNames?: Readonly<Record<string, readonly string[]>>;
  /** The editor's « Ne pas utiliser cette ressource ». */
  actions?: ReactNode;
}) {
  const t = useTranslations('subPlanLibrary');
  const tCommon = useTranslations('libraryCommon');

  return (
    <section
      aria-label={t('heading', { title: library.title })}
      className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3"
      data-testid="plan-library"
    >
      <p className="flex items-start gap-1.5 font-medium text-slate-900">
        <BookOpen className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
        <span>{t('heading', { title: library.title })}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Badge>{tCommon(`types.${library.type}`)}</Badge>
        {library.boardApproved ? (
          <Badge tone="success">{tCommon('badges.approved')}</Badge>
        ) : (
          <Badge>{t('reviewed')}</Badge>
        )}
        {library.durationMinutes ? (
          <Badge>{tCommon('duration.minutes', { count: library.durationMinutes })}</Badge>
        ) : null}
      </div>

      <details className="rounded-lg border border-slate-200 bg-white text-sm">
        <summary className={SUMMARY}>{t('guide')}</summary>
        <div className="px-3 pb-3">
          <p className="text-slate-600">{t('guideHint')}</p>
          <DocView doc={library.teacherDoc} titleLevel={4} className="mt-3" />
        </div>
      </details>

      {library.studentDocs.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-800">{t('studentMaterial')}</h4>
          <p className="text-sm text-slate-700">
            {library.hasAnswerKey ? t('keyStays') : t('collectSheets')}
          </p>
          <ul className="space-y-2">
            {library.studentDocs.map((sheet, i) => {
              const names = sheet.groupKeys.flatMap((key) => groupNames[key] ?? []);
              return (
                <li key={i} data-testid="plan-library-group">
                  <details className="rounded-lg border border-slate-200 bg-white text-sm">
                    <summary className={SUMMARY}>
                      {sheet.groupKeys.length > 0
                        ? t('forGroups', {
                            groups: sheet.groupKeys.map((k) => groupLabels[k] ?? k).join(', '),
                          })
                        : t('wholeClass')}
                    </summary>
                    <div className="px-3 pb-3">
                      {names.length > 0 ? (
                        <p className="text-slate-600">{names.join(', ')}</p>
                      ) : null}
                      <DocView doc={sheet.doc} titleLevel={4} className="mt-3" />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-slate-500">{t('printHint')}</p>
        </div>
      ) : null}

      {showItemLink || actions ? (
        <div className="flex flex-wrap gap-2">
          {showItemLink ? (
            <Button asChild variant="secondary">
              <Link href={libraryItemHref(library.itemId)}>
                {library.hasAnswerKey ? t('seeKey') : t('seeResource')}
              </Link>
            </Button>
          ) : null}
          {actions}
        </div>
      ) : null}
    </section>
  );
}

/** The owner's view of a resource she took out of the plan, with the way to bring it back. */
export function HiddenLibraryNotice({ title, actions }: { title: string; actions?: ReactNode }) {
  const t = useTranslations('subPlanLibrary');
  return (
    <div
      className="space-y-2 rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-700"
      data-testid="plan-library-hidden"
    >
      <p className="flex items-start gap-1.5">
        <EyeOff className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden />
        <span>{t('hidden', { title })}</span>
      </p>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
