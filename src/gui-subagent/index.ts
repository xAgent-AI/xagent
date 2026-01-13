/**
 * GUI Subagent - Computer Automation for xagent
 *
 * A powerful automation subagent that can:
 * - Control the entire desktop via computer actions (ComputerOperator)
 * - Perform clicks, typing, scrolling, drag operations
 * - Execute complex automation workflows
 *
 * Based on UI-TARS architecture
 */

export * from './types/index.js';
export * from './operator/index.js';
export * from './agent/index.js';

import { ComputerOperator, type ComputerOperatorOptions } from './operator/computer-operator.js';
import { BrowserOperator, type BrowserOperatorOptions } from './operator/browser-operator.js';
import { GUIAgent, type GUIAgentConfig, type GUIAgentData, type Conversation, GUIAgentStatus } from './agent/gui-agent.js';
import type { Operator } from './operator/base-operator.js';

/**
 * GUI Subagent configuration
 */
export interface GUISubAgentConfig {
  model?: string;
  modelBaseUrl?: string;
  modelApiKey?: string;
  headless?: boolean;
  loopIntervalInMs?: number;
  maxLoopCount?: number;
  showAIDebugInfo?: boolean;
  operatorType?: 'browser' | 'computer';
  browserPath?: string;
  viewport?: { width: number; height: number };
}

/**
 * Default configuration values (aligned with UI-TARS)
 */
export const DEFAULT_GUI_CONFIG: Required<GUISubAgentConfig> = {
  model: 'gpt-4o',
  modelBaseUrl: '',
  modelApiKey: '',
  headless: false,
  loopIntervalInMs: 0,
  maxLoopCount: 100,
  showAIDebugInfo: false,
  operatorType: 'browser',
  browserPath: '',
  viewport: { width: 1280, height: 800 },
};

/**
 * Create a GUI subagent with the specified configuration
 */
export async function createGUISubAgent<T extends Operator>(
  config: GUISubAgentConfig = {},
  operator?: T
): Promise<GUIAgent<T>> {
  const mergedConfig = { ...DEFAULT_GUI_CONFIG, ...config };

  let agentOperator: T;

  if (operator) {
    agentOperator = operator;
  } else if (mergedConfig.operatorType === 'computer') {
    const computerOptions: ComputerOperatorOptions = {
      config: {
        headless: mergedConfig.headless,
      },
    };
    agentOperator = new ComputerOperator(computerOptions) as unknown as T;
  } else {
    const browserOptions: BrowserOperatorOptions = {
      config: {
        headless: mergedConfig.headless,
        browserPath: mergedConfig.browserPath,
        viewport: mergedConfig.viewport,
      },
    };
    agentOperator = new BrowserOperator(browserOptions) as unknown as T;
  }

  const agentConfig: GUIAgentConfig<T> = {
    operator: agentOperator,
    model: mergedConfig.model,
    modelBaseUrl: mergedConfig.modelBaseUrl,
    modelApiKey: mergedConfig.modelApiKey,
    loopIntervalInMs: mergedConfig.loopIntervalInMs,
    maxLoopCount: mergedConfig.maxLoopCount,
    showAIDebugInfo: mergedConfig.showAIDebugInfo,
  };

  const agent = new GUIAgent<T>(agentConfig);
  // NOTE: Initialize is called lazily in GUIAgent.run() to delay browser launch
  return agent;
}

/**
 * Create a GUI Agent with a specific operator
 */
export async function createGUIAgent<T extends Operator>(
  operator: T,
  config?: Partial<GUIAgentConfig<T>>
): Promise<GUIAgent<T>> {
  const agent = new GUIAgent<T>({
    operator,
    ...config,
  });
  // NOTE: Initialize is called in GUIAgent.run() to delay browser launch
  return agent;
}

export { ComputerOperator, BrowserOperator, GUIAgent, GUIAgentStatus };
export type {
  ComputerOperatorOptions,
  BrowserOperatorOptions,
  GUIAgentConfig,
  GUIAgentData,
  Conversation,
};
