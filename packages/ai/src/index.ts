export * from './types';
export * from './privacy';
export * from './pricing';
export * from './providers';
export * from './run';
export * from './prompts';
export * from './features/differentiate';
export * from './features/sub-plan';
export * from './features/library-item';
export * from './features/library-levels';

import type { FeatureDefinition } from './types';
import { differentiateFeature } from './features/differentiate';
import { subPlanFeature } from './features/sub-plan';
import { libraryItemFeature } from './features/library-item';
import { libraryLevelsFeature } from './features/library-levels';

/** Every AI feature, by the name stored in ai_jobs.feature. */
export const features: Record<string, FeatureDefinition<unknown, unknown>> = {
  differentiate: differentiateFeature as FeatureDefinition<unknown, unknown>,
  sub_plan: subPlanFeature as FeatureDefinition<unknown, unknown>,
  library_item: libraryItemFeature as FeatureDefinition<unknown, unknown>,
  library_levels: libraryLevelsFeature as FeatureDefinition<unknown, unknown>,
};
