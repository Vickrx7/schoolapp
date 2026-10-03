'use client';

import type { LocalDate } from '@lynx/domain';
import { useEffect } from 'react';
import { forgetNewsletterDrafts, forgetReportDrafts } from '@/hooks/draft-storage';

/**
 * The report-comment janitor (DECISIONS D-130), in the signed-in app's shell: whenever someone
 * opens the app, the « Bulletins » drafts of any other account on this browser, and every expired
 * or unreadable one, are removed from the device. So a teacher who forgot to sign out on a shared
 * computer leaves no comments to the next person, and none outlive their 60 days. Another
 * account's « Info-parents » drafts go too (D-138): a message can name the class's students.
 */
export function ReportDraftJanitor({ userId, today }: { userId: string; today: LocalDate }) {
  useEffect(() => {
    forgetReportDrafts({ userId, today });
    forgetNewsletterDrafts({ userId });
  }, [userId, today]);
  return null;
}
