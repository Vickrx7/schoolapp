'use client';

import { MessageSquarePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useFeedback } from './feedback-provider';

/** « Commentaires » at the right of the top bar, on every page (DECISIONS D-116). */
export function FeedbackButton() {
  const t = useTranslations('feedback');
  const feedback = useFeedback();
  if (!feedback) return null;
  return (
    <Button variant="ghost" className="px-3" onClick={() => feedback.open()}>
      <MessageSquarePlus aria-hidden />
      {/* Named on phones too: « Bienvenue » and « Nouveautés » send people to « Commentaires ». */}
      <span>{t('button')}</span>
    </Button>
  );
}
