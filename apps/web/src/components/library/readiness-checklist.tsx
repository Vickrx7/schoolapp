import {
  TYPE_INFO,
  type LibraryItemType,
  type Readiness,
  type ReadinessBlockingCode,
} from '@lynx/content';
import { Check, CircleAlert, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** The checks that apply to a type, in the order the checklist lists them (D-067). */
export function readinessChecks(
  type: LibraryItemType,
  forApproval: boolean,
): ReadinessBlockingCode[] {
  const info = TYPE_INFO[type];
  return [
    'grades',
    'subject',
    // A comment bank (D-129): no duration or materials, and a subject that fits its scope.
    ...(type === 'report_comments' ? (['scope'] as const) : []),
    ...(info.teachingMaterial ? (['duration', 'materials'] as const) : []),
    'tags',
    ...(info.expectationsOptional ? [] : (['expectations'] as const)),
    'base',
    'content',
    ...(info.mayHaveQuestions ? (['key'] as const) : []),
    ...(info.needsSafety ? (['safety'] as const) : []),
    ...(forApproval && info.levelsForApproval ? (['levels'] as const) : []),
  ];
}

/**
 * « Avant de marquer comme révisée » and « Avant de proposer au conseil » (D-067): each
 * requirement with whether it is met, in words and not by colour alone (D-034), then what is only
 * worth a look (a short answer without a sample answer, « Version de base seulement »…).
 * `highlight` names checks a refused action pointed at (`readiness.<code>` field errors).
 */
export function ReadinessChecklist({
  type,
  readiness,
  forApproval,
  highlight = [],
}: {
  type: LibraryItemType;
  readiness: Pick<Readiness, 'blocking' | 'warnings'>;
  forApproval: boolean;
  highlight?: readonly string[];
}) {
  const t = useTranslations('libraryEdit.readiness');
  const missing = new Set(readiness.blocking.map((b) => b.code));
  const warnings = [...new Set(readiness.warnings.map((w) => w.code))];
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">
        {forApproval ? t('titleApproval') : t('title')}
      </h3>
      <ul className="space-y-1">
        {readinessChecks(type, forApproval).map((code) => {
          const ok = !missing.has(code);
          return (
            <li
              key={code}
              className={cn(
                'flex items-start gap-2 text-sm',
                ok ? 'text-slate-700' : 'text-red-700',
                !ok && highlight.includes(`readiness.${code}`) && 'font-semibold',
              )}
              data-readiness={code}
              data-ready={ok}
            >
              {ok ? (
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <span>
                <span className="sr-only">{ok ? t('done') : t('missing')} : </span>
                {t(`checks.${code}`)}
                {ok ? null : <span className="ml-1 text-xs font-medium">({t('missing')})</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {warnings.length ? (
        <ul className="space-y-1">
          {warnings.map((code) => (
            <li key={code} className="flex items-start gap-2 text-sm text-amber-900">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t(`warnings.${code}`)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
