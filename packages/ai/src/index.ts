export * from './types';
export * from './privacy';
export * from './pricing';
export * from './providers';
export * from './run';
export * from './batch';
export * from './prompts';
export * from './features/differentiate';
export * from './features/sub-plan';
export * from './features/library-item';
export * from './features/library-levels';
export * from './features/report-comment-bank';

import type { FeatureDefinition } from './types';
import { differentiateFeature } from './features/differentiate';
import { subPlanFeature } from './features/sub-plan';
import { libraryItemFeature } from './features/library-item';
import { libraryLevelsFeature } from './features/library-levels';
import { reportCommentBankFeature } from './features/report-comment-bank';

/** Every AI feature, by the name stored in ai_jobs.feature. */
export const features: Record<string, FeatureDefinition<unknown, unknown>> = {
  differentiate: differentiateFeature as FeatureDefinition<unknown, unknown>,
  sub_plan: subPlanFeature as FeatureDefinition<unknown, unknown>,
  library_item: libraryItemFeature as FeatureDefinition<unknown, unknown>,
  library_levels: libraryLevelsFeature as FeatureDefinition<unknown, unknown>,
  report_comment_bank: reportCommentBankFeature as FeatureDefinition<unknown, unknown>,
};
