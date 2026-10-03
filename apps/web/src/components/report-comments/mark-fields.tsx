'use client';

import {
  LEARNING_SKILL_RATINGS,
  LEARNING_SKILLS,
  PROGRESS_MARKS,
  type LearningSkill,
  type LearningSkillRating,
  type ProgressMark,
} from '@lynx/content';
import type { ComposerReport, ReportDraftComment } from '@lynx/domain';
import { useTranslations } from 'next-intl';
import { Segmented } from './segmented';

const LEVELS = [1, 2, 3, 4] as const;
/** E, T, S, N in French; E, G, S, N in English (the labels' first letter). */
const firstLetter = (label: string) => label.trim().charAt(0);

/**
 * The student's mark, which chooses the entries proposed (DECISIONS D-130; device only, never a
 * grade sent anywhere): « Niveau de rendement » 1 to 4 for a report card term, « Progrès » for
 * the progress report, and for the learning skills a rating for each of the six skills (« E —
 * Excellent », « T — Très bien », « S — Satisfaisant », « N — Amélioration nécessaire »).
 */
export function MarkFields({
  scope,
  report,
  comment,
  onLevel,
  onProgress,
  onRating,
}: {
  scope: 'subject' | 'learning_skills';
  report: ComposerReport;
  comment: ReportDraftComment;
  onLevel: (level: number) => void;
  onProgress: (mark: ProgressMark) => void;
  onRating: (skill: LearningSkill, rating: LearningSkillRating) => void;
}) {
  const t = useTranslations('reportComments.editor');
  const tc = useTranslations('libraryCommon');
  if (scope === 'learning_skills') {
    const ratings = LEARNING_SKILL_RATINGS.map((r) => ({
      value: r,
      label: firstLetter(tc(`learningSkillRatings.${r}`)),
      srLabel: tc(`learningSkillRatings.${r}`),
    }));
    return (
      <div className="space-y-3">
        <div>
          <h4 className="text-base font-semibold text-slate-900">{t('ratings')}</h4>
          <p className="text-sm text-slate-600">
            {t('ratingsHint', {
              key: LEARNING_SKILL_RATINGS.map((r) => tc(`learningSkillRatings.${r}`)).join(' · '),
            })}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {LEARNING_SKILLS.map((skill) => (
            <Segmented
              key={skill}
              legend={tc(`learningSkills.${skill}`)}
              options={ratings}
              value={comment.ratings[skill] ?? null}
              onChange={(r) => onRating(skill, r)}
              columns="grid-cols-4"
            />
          ))}
        </div>
      </div>
    );
  }
  if (report === 'progress') {
    return (
      <Segmented
        legend={t('progress')}
        legendClassName="text-base font-semibold text-slate-900"
        options={PROGRESS_MARKS.map((m) => ({ value: m, label: tc(`progressMarks.${m}`) }))}
        value={comment.progress}
        onChange={onProgress}
        columns="grid-cols-1 sm:grid-cols-3"
      />
    );
  }
  return (
    <Segmented
      legend={t('level')}
      legendClassName="text-base font-semibold text-slate-900"
      options={LEVELS.map((n) => ({ value: n, label: n, srLabel: t('levelOption', { n }) }))}
      value={comment.level}
      onChange={onLevel}
      columns="grid-cols-4"
    />
  );
}
