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
  } else {
    const operatorOptions: ComputerOperatorOptions = {
      config: {
        headless: mergedConfig.headless,
      },
    };
    agentOperator = new ComputerOperator(operatorOptions) as unknown as T;
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

export { ComputerOperator, GUIAgent, GUIAgentStatus };
export type {
  ComputerOperatorOptions,
  GUIAgentConfig,
  GUIAgentData,
  Conversation,
};
