/**
 * Constants for Action Parser
 * Based on UI-TARS architecture (@ui-tars/sdk/core)
 *
 * Image processing and resize parameters
 */

export const IMAGE_FACTOR = 28;
export const DEFAULT_FACTOR = 1000;
export const MIN_PIXELS = 100 * IMAGE_FACTOR * IMAGE_FACTOR;
export const MAX_PIXELS_V1_0 = 2700 * IMAGE_FACTOR * IMAGE_FACTOR;
export const MAX_PIXELS_DOUBAO = 5120 * IMAGE_FACTOR * IMAGE_FACTOR;
export const MAX_PIXELS_V1_5 = 16384 * IMAGE_FACTOR * IMAGE_FACTOR;
export const MAX_RATIO = 200;
