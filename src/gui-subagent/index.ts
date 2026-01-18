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

// Export VLMCaller type供外部使用
export type { VLMCaller } from './agent/gui-agent.js';

import { ComputerOperator, type ComputerOperatorOptions } from './operator/computer-operator.js';
import { GUIAgent, type GUIAgentConfig, type GUIAgentData, type Conversation, GUIAgentStatus } from './agent/gui-agent.js';
import type { Operator } from './operator/base-operator.js';

import type { VLMCaller } from './agent/gui-agent.js';

/**
 * GUI Subagent configuration
 */
export interface GUISubAgentConfig {
  model?: string;
  modelBaseUrl?: string;
  modelApiKey?: string;
  /**
   * Externally injected VLM caller function
   * If this function is provided，GUI Agent will use it来调用 VLM
   * 这使得 GUI Agent 可以与远程服务配合使用
   * Parameters: image - image, prompt-提示词, systemPrompt-系统提示词
   */
  vlmCaller?: (image: string, prompt: string, systemPrompt: string) => Promise<string>;
  headless?: boolean;
  loopIntervalInMs?: number;
  maxLoopCount?: number;
  showAIDebugInfo?: boolean;
}

/**
 * Default configuration values (aligned with UI-TARS)
 * Note: vlmCaller is optional - if not provided, GUIAgent will use direct model API calls
 */
export const DEFAULT_GUI_CONFIG = {
  model: 'gpt-4o',
  modelBaseUrl: '',
  modelApiKey: '',
  vlmCaller: undefined as VLMCaller | undefined,
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

  // Default to ComputerOperator for initial screenshot
  // The actual operator type will be determined by LLM in run()
  const agentOperator = operator ?? new ComputerOperator({
    config: {
      headless: mergedConfig.headless,
    },
  }) as unknown as T;

  const agentConfig: GUIAgentConfig<T> = {
    operator: agentOperator,
    model: mergedConfig.model,
    modelBaseUrl: mergedConfig.modelBaseUrl,
    modelApiKey: mergedConfig.modelApiKey,
    vlmCaller: mergedConfig.vlmCaller,
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