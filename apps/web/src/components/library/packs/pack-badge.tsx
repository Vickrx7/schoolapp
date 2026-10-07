import { Package } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/card';
import type { PackLabel } from '@/server/library/pack-provenance';

/**
 * « Ensemble : Ressources IP Lynx 2026.2 » in « Approbation des ressources » (DECISIONS D-100):
 * the resource came from a content pack the operator imported, so the reviewer knows who
 * published it before opening it. Nothing for other resources.
 */
export function PackBadge({ pack }: { pack: PackLabel | undefined }) {
  const t = useTranslations('libraryPacks');
  if (!pack) return null;
  return (
    <Badge>
      <Package className="size-3.5 shrink-0" aria-hidden />
      {t('badge', { title: pack.title, version: pack.version })}
    </Badge>
  );
}
