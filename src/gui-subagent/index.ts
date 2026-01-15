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
import { getCancellationManager } from '../cancellation.js';

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

  // Default to ComputerOperator for initial screenshot
  // The actual operator type will be determined by LLM in run()
  const agentOperator = operator ?? new ComputerOperator({
    config: {
      headless: mergedConfig.headless,
    },
  }) as unknown as T;

  // Create AbortController for cancellation support
  const abortController = new AbortController();

  // Listen to cancellationManager for ESC key
  const cancellationManager = getCancellationManager();
  const cancelHandler = () => {
    abortController.abort();
  };
  cancellationManager.on('cancelled', cancelHandler);

  const agentConfig: GUIAgentConfig<T> = {
    operator: agentOperator,
    model: mergedConfig.model,
    modelBaseUrl: mergedConfig.modelBaseUrl,
    modelApiKey: mergedConfig.modelApiKey,
    loopIntervalInMs: mergedConfig.loopIntervalInMs,
    maxLoopCount: mergedConfig.maxLoopCount,
    showAIDebugInfo: mergedConfig.showAIDebugInfo,
    signal: abortController.signal,
  };

  const agent = new GUIAgent<T>(agentConfig);

  // Store cancel handler for cleanup
  (agent as any)._cancelHandler = cancelHandler;
  (agent as any)._cancellationManager = cancellationManager;

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
  // Create AbortController for cancellation support if not provided
  const abortController = config?.signal ? undefined : new AbortController();

  // Listen to cancellationManager for ESC key if no signal provided
  let cancelHandler: (() => void) | undefined;
  if (!config?.signal) {
    const cancellationManager = getCancellationManager();
    cancelHandler = () => {
      abortController?.abort();
    };
    cancellationManager.on('cancelled', cancelHandler);
  }

  const agent = new GUIAgent<T>({
    operator,
    ...config,
    signal: config?.signal ?? abortController?.signal,
  });

  // Store cancel handler for cleanup
  if (cancelHandler) {
    const cancellationManager = getCancellationManager();
    (agent as any)._cancelHandler = cancelHandler;
    (agent as any)._cancellationManager = cancellationManager;
  }

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
