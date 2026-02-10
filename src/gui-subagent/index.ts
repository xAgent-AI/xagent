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

// Export RemoteVlmCaller type for external use
export type { RemoteVlmCaller } from './agent/gui-agent.js';

import { ComputerOperator, type ComputerOperatorOptions } from './operator/computer-operator.js';
import { GUIAgent, type GUIAgentConfig, type GUIAgentData, type Conversation, GUIAgentStatus } from './agent/gui-agent.js';
import type { Operator } from './operator/base-operator.js';
import type { RemoteVlmCaller } from './agent/gui-agent.js';
import { getCancellationManager } from '../cancellation.js';

/**
 * GUI Subagent configuration
 */
export interface GUISubAgentConfig {
  model?: string;
  modelBaseUrl?: string;
  modelApiKey?: string;
  /**
   * Task identifier for VLM state tracking (begin vs continue)
   */
  taskId?: string;
  /**
   * Shared ref object to track first VLM call across createGUISubAgent calls
   * Must be passed from outside to properly track VLM status across loop iterations
   */
  isFirstVlmCallRef?: { current: boolean };
  /**
   * Externally injected VLM caller function
   * If this function is provided, GUI Agent will use it to call VLM
   * This allows GUI Agent to work with remote services
   * Receives full messages array for consistent behavior with local mode
   */
  remoteVlmCaller?: (messages: any[], systemPrompt: string, taskId: string, isFirstVlmCallRef: { current: boolean }) => Promise<string>;
  /**
   * Whether to use local mode
   * If true, use model/modelBaseUrl/modelApiKey for VLM calls
   * If false, use remoteVlmCaller for remote VLM calls
   */
  isLocalMode: boolean;
  headless?: boolean;
  loopIntervalInMs?: number;
  maxLoopCount?: number;
  showAIDebugInfo?: boolean;
  indentLevel?: number;
}

/**
 * Default configuration values (aligned with UI-TARS)
 * Note: remoteVlmCaller is optional - if not provided, GUIAgent will use direct model API calls
 */
export const DEFAULT_GUI_CONFIG = {
  model: 'gpt-4o',
  modelBaseUrl: '',
  modelApiKey: '',
  remoteVlmCaller: undefined as RemoteVlmCaller | undefined,
  isLocalMode: true,
  headless: false,
  loopIntervalInMs: 0,
  maxLoopCount: 100,
  showAIDebugInfo: false,
  indentLevel: 1,
};

/**
 * Create a GUI subagent with the specified configuration
 */
export async function createGUISubAgent<T extends Operator>(
  config: GUISubAgentConfig = {} as GUISubAgentConfig,
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
    taskId: mergedConfig.taskId,
    isFirstVlmCallRef: mergedConfig.isFirstVlmCallRef,
    remoteVlmCaller: mergedConfig.isLocalMode ? undefined : mergedConfig.remoteVlmCaller,
    isLocalMode: mergedConfig.isLocalMode ?? false,
    loopIntervalInMs: mergedConfig.loopIntervalInMs,
    maxLoopCount: mergedConfig.maxLoopCount,
    showAIDebugInfo: mergedConfig.showAIDebugInfo,
    indentLevel: mergedConfig.indentLevel,
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
    isLocalMode: config?.isLocalMode ?? true,
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
