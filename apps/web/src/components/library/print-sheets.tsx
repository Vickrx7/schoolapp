import type { RenderedDoc } from '@lynx/content';
import { useTranslations } from 'next-intl';
import { Notice } from '@/components/ui/card';
import { DocView } from './doc-view';

/**
 * The pages to print (DECISIONS D-042, D-075): one document per page, each with its small
 * version number and never a level name. On screen they look like sheets of paper (the preview);
 * printed, only the pages remain (the app's bar and the options are `print:hidden`).
 */
export function PrintSheets({
  sheets,
  partial = false,
}: {
  sheets: readonly { key: string; doc: RenderedDoc }[];
  /** Something stored could not be read: said on screen, never printed. */
  partial?: boolean;
}) {
  const t = useTranslations('libraryItem');
  return (
    <section
      aria-label={t('print.preview')}
      className="space-y-6 print:space-y-0"
      data-testid="print-sheets"
    >
      {partial ? (
        <Notice tone="warning" className="print:hidden">
          {t('partial')}
        </Notice>
      ) : null}
      {sheets.map(({ key, doc }) => (
        <div
          key={key}
          className="break-after-page rounded-xl border border-slate-200 bg-white p-6 shadow-sm last:break-after-auto md:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none"
        >
          <DocView doc={doc} variant="sheet" showNumber />
        </div>
      ))}
    </section>
  );
}
