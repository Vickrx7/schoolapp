import type { ComposedSubPlan } from '@lynx/domain';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * What the owner should check before release: the plan's own warnings (an unknown cycle day,
 * a guessed half-day split...) and the blocks that need attention. Owner only.
 */
export function WarningsList({ plan }: { plan: Pick<ComposedSubPlan, 'warnings' | 'blocks'> }) {
  const t = useTranslations('subPlan');
  const planCodes = [...new Set(plan.warnings.map((w) => w.code))];
  const blocks = plan.blocks.filter((b) => b.warnings.length > 0);
  if (planCodes.length === 0 && blocks.length === 0) return null;

  return (
    <section
      aria-labelledby="plan-warnings"
      className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <h2 id="plan-warnings" className="mb-2 flex items-center gap-1.5 font-semibold">
        <TriangleAlert className="size-4" aria-hidden />
        {t('sections.warnings')}
      </h2>
      <ul className="list-disc space-y-1 pl-5">
        {planCodes.map((code) => (
          <li key={code}>{t(`warnings.${code}`)}</li>
        ))}
        {blocks.map((b) => (
          <li key={b.key}>
            {t('blockWarning', {
              block: b.title,
              warning: b.warnings.map((w) => t(`warnings.${w}`)).join(' '),
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
