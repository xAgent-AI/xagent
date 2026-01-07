/**
 * GUI Subagent - Browser Automation for xagent
 * 
 * A powerful browser automation subagent that can:
 * - Control browsers via GUI actions
 * - Perform clicks, typing, scrolling
 * - Navigate websites
 * - Execute complex automation workflows
 */

export * from './types/index.js';
export * from './operator/index.js';
export * from './agent/index.js';

import { BrowserOperator, type BrowserOperatorOptions } from './operator/browser-operator.js';
import { GUIAgent, type GUIAgentConfig } from './agent/gui-agent.js';
import type { Operator } from './operator/base-operator.js';

/**
 * Create a new GUI Agent with a browser operator
 */
export async function createGUIAgent(options: BrowserOperatorOptions = {}): Promise<GUIAgent<BrowserOperator>> {
  const operator = new BrowserOperator(options);
  const agent = new GUIAgent({ operator });
  await agent.initialize();
  return agent;
}

/**
 * GUI Subagent configuration
 */
export interface GUISubAgentConfig {
  model?: string;
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
  model: 'gpt-4',
  headless: false,
  browserPath: '',
  viewport: { width: 1280, height: 800 },
  loopIntervalInMs: 500,
  maxLoopCount: 100,
};

/**
 * Create a GUI subagent with the specified configuration
 */
export async function createGUISubAgent(config: GUISubAgentConfig = {}): Promise<GUIAgent<BrowserOperator>> {
  const mergedConfig = { ...DEFAULT_GUI_CONFIG, ...config };
  
  const operatorOptions: BrowserOperatorOptions = {
    config: {
      headless: mergedConfig.headless,
      browserPath: mergedConfig.browserPath,
      viewport: mergedConfig.viewport,
    },
  };

  const agentConfig: GUIAgentConfig<BrowserOperator> = {
    operator: new BrowserOperator(operatorOptions),
    model: mergedConfig.model,
    loopIntervalInMs: mergedConfig.loopIntervalInMs,
    maxLoopCount: mergedConfig.maxLoopCount,
  };

  const agent = new GUIAgent(agentConfig);
  await agent.initialize();
  
  return agent;
}

export { BrowserOperator, GUIAgent };
export type { BrowserOperatorOptions, GUIAgentConfig };
