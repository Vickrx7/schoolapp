import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * « Télécharger (CSV) » (DECISIONS D-103): a plain link, so the browser downloads the file; the
 * export holds the period's entries (at most 10,000) and is itself recorded in the log.
 */
export function ExportLink({ href }: { href: string }) {
  const t = useTranslations('audit.export');
  return (
    <Button asChild variant="secondary">
      <a href={href} download>
        <Download aria-hidden />
        {t('download')}
      </a>
    </Button>
  );
}

export function ExportNote() {
  const t = useTranslations('audit.export');
  return <p className="text-sm text-slate-600">{t('note')}</p>;
}
