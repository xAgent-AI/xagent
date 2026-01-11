/**
 * GUI Subagent - Browser/Computer Automation for xagent
 *
 * A powerful automation subagent that can:
 * - Control browsers via GUI actions (BrowserOperator)
 * - Control the entire desktop via computer actions (ComputerOperator)
 * - Perform clicks, typing, scrolling
 * - Navigate websites
 * - Execute complex automation workflows
 */

export * from './types/index.js';
export * from './operator/index.js';
export * from './agent/index.js';

import { BrowserOperator, type BrowserOperatorOptions } from './operator/browser-operator.js';
import { ComputerOperator, type ComputerOperatorOptions } from './operator/computer-operator.js';
import { GUIAgent, type GUIAgentConfig, type GUIAgentData, type Conversation } from './agent/gui-agent.js';
import type { Operator } from './operator/base-operator.js';

/**
 * Operator type for gui-subagent
 */
export type GUIOperatorType = 'browser' | 'computer';

/**
 * GUI Subagent configuration
 */
export interface GUISubAgentConfig {
  operatorType?: GUIOperatorType;
  model?: string;
  modelBaseUrl?: string;
  modelApiKey?: string;
  headless?: boolean;
  browserPath?: string;
  viewport?: { width: number; height: number };
  loopIntervalInMs?: number;
  maxLoopCount?: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_GUI_CONFIG: Required<GUISubAgentConfig> = {
  operatorType: 'browser',
  model: 'gpt-4o',
  modelBaseUrl: '',
  modelApiKey: '',
  headless: false,
  browserPath: '',
  viewport: { width: 1280, height: 800 },
  loopIntervalInMs: 500,
  maxLoopCount: 25,
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
    agentOperator = new ComputerOperator({
      config: {
        headless: mergedConfig.headless,
        viewport: mergedConfig.viewport,
      },
    }) as unknown as T;
  } else {
    const operatorOptions: BrowserOperatorOptions = {
      config: {
        headless: mergedConfig.headless,
        browserPath: mergedConfig.browserPath,
        viewport: mergedConfig.viewport,
      },
    };
    agentOperator = new BrowserOperator(operatorOptions) as unknown as T;
  }

  const agentConfig: GUIAgentConfig<T> = {
    operator: agentOperator,
    model: mergedConfig.model,
    modelBaseUrl: mergedConfig.modelBaseUrl,
    modelApiKey: mergedConfig.modelApiKey,
    loopIntervalInMs: mergedConfig.loopIntervalInMs,
    maxLoopCount: mergedConfig.maxLoopCount,
  };

  const agent = new GUIAgent<T>(agentConfig);
  await agent.initialize();

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
  await agent.initialize();
  return agent;
}

export { BrowserOperator, ComputerOperator, GUIAgent };
export type {
  BrowserOperatorOptions,
  ComputerOperatorOptions,
  GUIAgentConfig,
  GUIAgentData,
  Conversation,
};
