/**
 * Operator Types for gui-subagent
 * Based on UI-TARS architecture for cross-platform computer control
 */

import type { SupportedActionType } from './actions.js';

export type { SupportedActionType };

/**
 * Status Enum from @ui-tars/sdk/core
 * Aligned with UI-TARS SDK StatusEnum
 */
export enum StatusEnum {
  SUCCESS = 'success',
  FAILED = 'failed',
  END = 'end',
  CONTINUE = 'continue',
}

export interface ScreenContext {
  /** Screenshot width */
  width: number;
  /** Screenshot height */
  height: number;
  /** Device DPR */
  scaleFactor: number;
}

export interface ScreenshotOutput {
  status: 'success' | 'failed';
  base64?: string;
  url?: string;
  errorMessage?: string;
  scaleFactor?: number;
}

export interface ExecuteParams {
  prediction: string;
  parsedPrediction: PredictionParsed;
  /** Device Physical Resolution */
  screenWidth: number;
  /** Device Physical Resolution */
  screenHeight: number;
  /** Device DPR */
  scaleFactor: number;
  /** Model coordinates scaling factor [widthFactor, heightFactor] */
  factors: [number, number];
}

export interface ExecuteOutput {
  status: 'success' | 'failed' | 'end' | 'needs_input';
  errorMessage?: string;
}

export interface PredictionParsed {
  reflection: string | null;
  thought: string;
  action_type: string;
  action_inputs: Record<string, any>;
}

export interface OperatorConfig {
  headless?: boolean;
  browserPath?: string;
  viewport?: {
    width: number;
    height: number;
  };
  deviceScaleFactor?: number;
}

export interface OperatorInterface {
  doInitialize(): Promise<void>;
  doScreenshot(): Promise<ScreenshotOutput>;
  doExecute(params: ExecuteParams): Promise<ExecuteOutput>;
  getSupportedActions(): SupportedActionType[];
  getScreenContext(): Promise<ScreenContext>;
  cleanup(): Promise<void>;
  destroyInstance(): Promise<void>;
}

/**
 * Computer Operator specific types
 */
export interface ComputerOperatorConfig {
  /** Screenshot quality (0-100) */
  screenshotQuality?: number;
  /** Maximum screenshot retry attempts */
  maxScreenshotRetries?: number;
  /** Delay between retries (ms) */
  screenshotRetryDelay?: number;
}

/**
 * Operator Manual - describes supported actions and parameters
 */
export interface OperatorManual {
  ACTION_SPACES: string[];
  KEY_SPACE?: {
    [key: string]: string;
  };
  KEY_DESCRIPTION?: {
    [key: string]: string;
  };
}
