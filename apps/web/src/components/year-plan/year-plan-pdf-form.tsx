import { Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * « Plan à long terme (PDF) » (DECISIONS D-127): a plain GET form to the PDF route, so nothing
 * is prefetched and it works without JavaScript (D-053). Coverage is left out unless the teacher
 * ticks « Inclure la couverture des attentes » (`?coverage=1`): the plan is not a scorecard. The
 * note says the document is the teacher's to give.
 */
export function YearPlanPdfForm({ classId }: { classId: string }) {
  const t = useTranslations('yearPlan.pdf');
  return (
    <form
      method="get"
      action={`/classes/${classId}/planning/year/pdf`}
      className="flex flex-wrap items-center gap-x-4 gap-y-1"
    >
      <Button type="submit" variant="secondary" aria-describedby="year-plan-pdf-note">
        <Printer aria-hidden />
        {t('link')}
      </Button>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="coverage" value="1" className="size-5 shrink-0" />
        {t('withCoverage')}
      </label>
      <p id="year-plan-pdf-note" className="basis-full text-sm text-slate-600 lg:basis-auto">
        {t('note')}
      </p>
    </form>
  );
}
