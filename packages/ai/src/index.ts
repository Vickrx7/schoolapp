export * from './types';
export * from './privacy';
export * from './pricing';
export * from './providers';
export * from './run';
export * from './prompts';
export * from './features/differentiate';
export * from './features/sub-plan';

import type { FeatureDefinition } from './types';
import { differentiateFeature } from './features/differentiate';
import { subPlanFeature } from './features/sub-plan';

/** Every AI feature, by the name stored in ai_jobs.feature. */
export const features: Record<string, FeatureDefinition<unknown, unknown>> = {
  differentiate: differentiateFeature as FeatureDefinition<unknown, unknown>,
  sub_plan: subPlanFeature as FeatureDefinition<unknown, unknown>,
};
