import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/card';

/** « Exemple » on a sample class (DECISIONS D-109): class lists, Aujourd'hui, the class pages. */
export async function SampleBadge() {
  const t = await getTranslations('onboarding.sample');
  return (
    <Badge tone="warning" data-testid="sample-badge">
      {t('badge')}
    </Badge>
  );
}
