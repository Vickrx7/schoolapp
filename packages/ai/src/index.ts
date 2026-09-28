export * from './types';
export * from './privacy';
export * from './pricing';
export * from './providers';
export * from './run';
export * from './prompts';
export * from './features/differentiate';

import type { FeatureDefinition } from './types';
import { differentiateFeature } from './features/differentiate';

/** Every AI feature, by the name stored in ai_jobs.feature. */
export const features: Record<string, FeatureDefinition<unknown, unknown>> = {
  differentiate: differentiateFeature as FeatureDefinition<unknown, unknown>,
};
