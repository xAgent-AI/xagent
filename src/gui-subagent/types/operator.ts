/**
 * Operator Types for gui-subagent
 */

import type { GUIAction, SupportedActionType } from './actions.js';

export type { SupportedActionType };

export interface ScreenContext {
  screenWidth: number;
  screenHeight: number;
  scaleX: number;
  scaleY: number;
}

export interface ScreenshotOutput {
  status: 'success' | 'failed';
  base64?: string;
  url?: string;
  errorMessage?: string;
}

export interface ExecuteParams {
  actions: GUIAction[];
  reasoningContent?: string;
}

export interface ExecuteOutput {
  status: 'success' | 'failed';
  errorMessage?: string;
  result?: any;
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
