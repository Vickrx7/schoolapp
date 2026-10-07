import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/card';
import { itemBadges, type BadgeInput } from '@/server/library/view-model';

/**
 * An item's badges as text (« Approuvée par le conseil », « Suppléance », « 4 niveaux », « IA »,
 * « Foi »…), never colour alone (D-034). Used by the item page and by result cards.
 */
export function ItemBadges({
  input,
  withStatus = false,
  className,
}: {
  input: BadgeInput;
  /** The workflow status too (the item page, the author's own cards). */
  withStatus?: boolean;
  className?: string;
}) {
  const t = useTranslations('libraryCommon');
  const badges = itemBadges(input, { withStatus });
  if (!badges.length) return null;
  const label = (key: (typeof badges)[number]['key'], count = 0) => {
    switch (key) {
      case 'approved':
        return t('badges.approved');
      case 'requested':
        return t('requested');
      case 'draft':
      case 'teacher_reviewed':
      case 'rejected':
      case 'archived':
        return t(`status.${key}`);
      case 'levels':
        return t('badges.levels', { count });
      default:
        return t(`badges.${key}`);
    }
  };
  return (
    <ul aria-label={t('badgesLabel')} className={className ?? 'flex flex-wrap gap-1.5'}>
      {badges.map((b) => (
        <li key={b.key}>
          <Badge tone={b.tone}>{label(b.key, b.count)}</Badge>
        </li>
      ))}
    </ul>
  );
}
