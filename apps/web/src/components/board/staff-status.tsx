import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/card';

export type StaffBadgeStatus =
  'active' | 'neverSignedIn' | 'removed' | 'pending' | 'failed' | 'ready' | 'cancelled';

const TONES = {
  active: 'success',
  neverSignedIn: 'neutral',
  removed: 'danger',
  pending: 'brand',
  failed: 'warning',
  ready: 'success',
  cancelled: 'neutral',
} as const;

/** A person's or an invitation's state, written out (never a colour alone). */
export function StaffStatusBadge({ status }: { status: StaffBadgeStatus }) {
  const t = useTranslations('board.staff.statuses');
  return <Badge tone={TONES[status]}>{t(status)}</Badge>;
}
