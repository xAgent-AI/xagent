/**
 * GUI Agent for xagent
 * Orchestrates browser/desktop automation with AI-powered action execution
 * Based on UI-TARS architecture with support for both browser and computer control
 */

import type {
  ScreenContext,
  ScreenshotOutput,
  ExecuteParams,
  ExecuteOutput,
  PredictionParsed,
} from '../types/operator.js';
import type {
  SupportedActionType,
} from '../types/actions.js';
import type { Operator } from '../operator/base-operator.js';

const GUI_TOOL_NAME = 'gui_operate';

export interface GUIAgentConfig<T extends Operator> {
  operator: T;
  model?: string;
  modelBaseUrl?: string;
  modelApiKey?: string;
  systemPrompt?: string;
  loopIntervalInMs?: number;
  maxLoopCount?: number;
  logger?: Console;
  signal?: AbortSignal;
  onData?: (data: GUIAgentData) => void;
  onError?: (error: Error) => void;
  debug?: boolean;  // Enable debug mode to log model inputs/outputs
}

export interface GUIAgentData {
  status: GUIAgentStatus;
  conversations: Conversation[];
  error?: string;
}

export interface Conversation {
  from: 'human' | 'assistant';
  value: string;
  screenshotBase64?: string;
  screenshotContext?: {
    size: { width: number; height: number };
    scaleFactor: number;
  };
  actionType?: string;
  actionInputs?: Record<string, any>;
  timing?: {
    start: number;
    end: number;
    cost: number;
  };
}

export type GUIAgentStatus =
  | 'init'
  | 'running'
  | 'paused'
  | 'end'
  | 'error'
  | 'user_stopped'
  | 'call_user';

// UI-TARS format action parser result
export interface UIActionParseResult {
  thought: string;
  action: string;
  actionType?: string;
  actionInputs?: Record<string, any>;
}

const DEFAULT_MAX_LOOP_COUNT = 25;
const DEFAULT_LOOP_INTERVAL_MS = 500;
const SCREENSHOT_MAX_RETRIES = 3;

export class GUIAgent<T extends Operator> {
  name: string = 'GUI Agent';
  private operator: T;
  private model?: string;
  private modelBaseUrl?: string;
  private modelApiKey?: string;
  private systemPrompt: string;
  private loopIntervalInMs: number;
  private maxLoopCount: number;
  private logger: Console;
  private signal?: AbortSignal;
  private onData?: (data: GUIAgentData) => void;
  private onError?: (error: Error) => void;
  private debug: boolean;  // Debug mode flag

  private initialized: boolean = false;
  private paused: boolean = false;
  private stopped: boolean = false;
  private resumePromise?: Promise<void>;
  private resolveResume?: () => void;

  constructor(config: GUIAgentConfig<T>) {
    this.operator = config.operator;
    this.model = config.model || 'gpt-4o';
    this.modelBaseUrl = config.modelBaseUrl;
    this.modelApiKey = config.modelApiKey;
    this.loopIntervalInMs = config.loopIntervalInMs || DEFAULT_LOOP_INTERVAL_MS;
    this.maxLoopCount = config.maxLoopCount || DEFAULT_MAX_LOOP_COUNT;
    this.logger = config.logger || console;
    this.signal = config.signal;
    this.onData = config.onData;
    this.onError = config.onError;
    this.debug = config.debug || false;

    this.systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt();
  }

  private getDefaultSystemPrompt(): string {
    const manual = (this.operator.constructor as typeof Operator).MANUAL;
    const actionSpaces = manual?.ACTION_SPACES?.join('\n') || this.getDefaultActionSpaces();

    return `You are a GUI Agent that can control a computer/browser to complete user tasks.

## Your Task
You are given a task and you need to take actions to complete it. You will see screenshots of the screen after each action.

## Action Spaces
${actionSpaces}

## Workflow
1. Take a screenshot to see the current state
2. Think about what action to take
3. Execute the action
4. Repeat until the task is complete

## Important Guidelines
- Always take a screenshot before making decisions
- Use coordinates relative to the screen
- After clicking, wait for the page/desktop to respond
- If an action fails, try a different approach
- When the task is complete, use "finished" action

## Output Format
When you want to perform an action, respond with:
Thought: <your thought about what to do>
Action: <action to perform>

Example:
Thought: I need to click on the search button which is at the top right of the screen.
Action: click(start_box='[800, 50, 850, 100]')`;
  }

  private getDefaultActionSpaces(): string {
    return [
      `click(start_box='[x1, y1, x2, y2]') # Click on an element`,
      `left_double(start_box='[x1, y1, x2, y2]') # Double click`,
      `right_single(start_box='[x1, y1, x2, y2]') # Right click`,
      `type(content='text to type') # Type text, use "\\n" at end to submit`,
      `hotkey(key='ctrl c') # Press hotkey combination`,
      `scroll(start_box='[x1, y1, x2, y2]', direction='down') # Scroll`,
      `wait() # Wait 5 seconds`,
      `finished() # Task completed`,
      `call_user() # Request user help`,
    ].join('\n');
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing GUI Agent...');
    await this.operator.doInitialize();
    this.initialized = true;
    this.logger.info('GUI Agent initialized');
  }

  /**
   * Run the GUI agent with a single instruction (UI-TARS style)
   */
  async run(instruction: string): Promise<GUIAgentData> {
    if (!this.initialized) {
      await this.initialize();
    }

    const data: GUIAgentData = {
      status: 'init',
      conversations: [
        {
          from: 'human',
          value: instruction,
          timing: { start: Date.now(), end: Date.now(), cost: 0 },
        },
      ],
    };

    // Debug: Log initial instruction
    if (this.debug) {
      this.logger.info('========== GUI Agent Debug Info ==========');
      this.logger.info(`[INIT] Instruction: ${instruction}`);
      this.logger.info(`[INIT] Model: ${this.model}`);
      this.logger.info(`[INIT] Base URL: ${this.modelBaseUrl || process.env.MODEL_BASE_URL || 'default'}`);
      this.logger.info(`[INIT] Max Loop Count: ${this.maxLoopCount}`);
      this.logger.info('==========================================');
    }

    data.status = 'running';
    await this.onData?.(data);

    let loopCount = 0;
    let screenshotErrorCount = 0;

    try {
      while (true) {
        // Check pause status
        if (this.paused && this.resumePromise) {
          data.status = 'paused';
          await this.onData?.(data);
          await this.resumePromise;
          data.status = 'running';
          await this.onData?.(data);
        }

        // Check stop status
        if (this.stopped || this.signal?.aborted) {
          data.status = this.signal?.aborted ? 'user_stopped' : 'end';
          break;
        }

        // Check loop limit
        if (loopCount >= this.maxLoopCount) {
          data.status = 'error';
          data.error = 'Reached maximum loop count';
          break;
        }

        loopCount++;
        const startTime = Date.now();

        // Debug: Log loop start
        if (this.debug) {
          this.logger.info(`========== Loop ${loopCount} ==========`);
        }

        // Take screenshot
        let screenshot: ScreenshotOutput = { status: 'failed', base64: '' };
        let screenshotRetries = 0;

        while (screenshotRetries < SCREENSHOT_MAX_RETRIES) {
          try {
            const currentScreenshot = await this.operator.doScreenshot();
            if (currentScreenshot.status === 'success' && currentScreenshot.base64) {
              screenshot = currentScreenshot;
              break;
            }
          } catch (error) {
            this.logger.warn(`Screenshot attempt ${screenshotRetries + 1} failed:`, error);
          }
          screenshotRetries++;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        if (screenshot.status !== 'success' || !screenshot.base64) {
          screenshotErrorCount++;
          if (screenshotErrorCount >= SCREENSHOT_MAX_RETRIES) {
            data.status = 'error';
            data.error = 'Screenshot failed after multiple attempts';
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        screenshotErrorCount = 0;

        const screenContext = await this.operator.getScreenContext();

        // Add screenshot to conversation
        data.conversations.push({
          from: 'human',
          value: '[screenshot]',
          screenshotBase64: screenshot.base64,
          screenshotContext: {
            size: { width: screenContext.width, height: screenContext.height },
            scaleFactor: screenContext.scaleFactor,
          },
          timing: { start: startTime, end: Date.now(), cost: Date.now() - startTime },
        });
        await this.onData?.(data);

        // Debug: Log screenshot info
        if (this.debug) {
          this.logger.info(`[SCREENSHOT] Size: ${screenContext.width}x${screenContext.height}, Scale: ${screenContext.scaleFactor}`);
          this.logger.info(`[SCREENSHOT] Base64 length: ${screenshot.base64.length}`);
        }

        // Get AI response
        const aiResponse = await this.invokeModel(data.conversations, screenContext);

        // Debug: Log AI response
        if (this.debug) {
          this.logger.info(`[AI RESPONSE] Thought: ${aiResponse.thought || '(empty)'}`);
          this.logger.info(`[AI RESPONSE] Action: ${aiResponse.action || '(empty)'}`);
        }

        if (!aiResponse.thought || !aiResponse.action) {
          this.logger.warn('Invalid AI response:', aiResponse);
          continue;
        }

        const endTime = Date.now();

        // Parse action
        const parsedAction = this.parseUIAction(aiResponse.action);

        // Debug: Log parsed action
        if (this.debug) {
          this.logger.info(`[PARSED] ActionType: ${parsedAction?.actionType || '(null)'}`);
          this.logger.info(`[PARSED] ActionInputs: ${JSON.stringify(parsedAction?.actionInputs || {})}`);
        }

        // Add AI response to conversation
        data.conversations.push({
          from: 'assistant',
          value: `Thought: ${aiResponse.thought}\nAction: ${aiResponse.action}`,
          actionType: parsedAction?.actionType,
          actionInputs: parsedAction?.actionInputs,
          timing: { start: startTime, end: endTime, cost: endTime - startTime },
        });
        await this.onData?.(data);

        // Handle special actions
        if (parsedAction?.actionType === 'finished') {
          data.status = 'end';
          if (this.debug) {
            this.logger.info('[STATUS] Task completed with finished() action');
          }
          break;
        }

        if (parsedAction?.actionType === 'call_user') {
          data.status = 'call_user';
          if (this.debug) {
            this.logger.info('[STATUS] Requesting user help with call_user() action');
          }
          break;
        }

        // Execute action
        if (parsedAction) {
          const prediction: PredictionParsed = {
            reflection: null,
            thought: aiResponse.thought,
            action_type: parsedAction.actionType,
            action_inputs: parsedAction.actionInputs || {},
          };

          // Debug: Log prediction before execution
          if (this.debug) {
            this.logger.info(`[EXECUTE] Prediction: ${JSON.stringify(prediction)}`);
          }

          const execResult = await this.operator.executePrediction(prediction);

          // Debug: Log execution result
          if (this.debug) {
            this.logger.info(`[EXECUTE] Result status: ${execResult.status}`);
            if (execResult.errorMessage) {
              this.logger.info(`[EXECUTE] Error: ${execResult.errorMessage}`);
            }
          }
        }

        // Wait between iterations
        if (this.loopIntervalInMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.loopIntervalInMs));
        }
      }
    } catch (error) {
      data.status = 'error';
      data.error = (error as Error).message;
      this.onError?.(error as Error);
      if (this.debug) {
        this.logger.error(`[ERROR] ${data.error}`);
      }
    }

    // Debug: Log final status
    if (this.debug) {
      this.logger.info('========== GUI Agent Final Status ==========');
      this.logger.info(`[FINAL] Status: ${data.status}`);
      this.logger.info(`[FINAL] Total loops: ${loopCount}`);
      this.logger.info(`[FINAL] Conversations: ${data.conversations.length}`);
      if (data.error) {
        this.logger.info(`[FINAL] Error: ${data.error}`);
      }
      this.logger.info('=============================================');
    }

    await this.onData?.(data);
    return data;
  }

  /**
   * Invoke the AI model with current conversations
   */
  private async invokeModel(
    conversations: Conversation[],
    screenContext: ScreenContext,
  ): Promise<UIActionParseResult> {
    // Build messages for API call
    const messages = this.buildModelMessages(conversations);

    try {
      const response = await this.callModelAPI(messages);
      return this.parseModelResponse(response);
    } catch (error) {
      this.logger.error('Failed to invoke model:', error);
      return { thought: '', action: '' };
    }
  }

  /**
   * Build messages for the model API
   */
  private buildModelMessages(conversations: Conversation[]): any[] {
    const messages: any[] = [];

    // System prompt
    messages.push({
      role: 'system',
      content: this.systemPrompt,
    });

    // Add conversation history
    for (const conv of conversations) {
      if (conv.from === 'human' && conv.screenshotBase64) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: conv.value },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${conv.screenshotBase64}`,
                detail: 'high',
              },
            },
          ],
        });
      } else if (conv.from === 'assistant') {
        messages.push({
          role: 'assistant',
          content: conv.value,
        });
      } else {
        messages.push({
          role: 'user',
          content: conv.value,
        });
      }
    }

    return messages;
  }

  /**
   * Call the model API
   */
  private async callModelAPI(messages: any[]): Promise<string> {
    const baseUrl = this.modelBaseUrl || process.env.MODEL_BASE_URL || 'https://api.openai.com/v1';
    const apiKey = this.modelApiKey || process.env.MODEL_API_KEY || '';

    // Debug: Log complete model input
    if (this.debug) {
      this.logger.info('========== Model API Input ==========');
      this.logger.info(`[API] URL: ${baseUrl}/chat/completions`);
      this.logger.info(`[API] Model: ${this.model}`);
      this.logger.info(`[API] Messages count: ${messages.length}`);
      
      // Log system prompt (truncated)
      if (messages[0]?.role === 'system') {
        const systemContent = messages[0].content;
        if (typeof systemContent === 'string') {
          this.logger.info(`[API] System prompt (${systemContent.length} chars): ${systemContent.substring(0, 200)}...`);
        } else {
          this.logger.info(`[API] System prompt type: ${typeof systemContent}`);
        }
      }
      
      // Log message structure (without full screenshot base64)
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.content) {
          if (Array.isArray(msg.content)) {
            // Check for image content
            const hasImage = msg.content.some((c: any) => c.type === 'image_url');
            if (hasImage) {
              const imageMsg = msg.content.find((c: any) => c.type === 'image_url');
              const imageUrl = imageMsg?.image_url?.url || '';
              const base64Match = imageUrl.match(/data:image\/png;base64,(.+)/);
              if (base64Match) {
                this.logger.info(`[API] Message ${i}: ${msg.role}, has image (${base64Match[1].length} chars base64)`);
              } else {
                this.logger.info(`[API] Message ${i}: ${msg.role}, has image (external URL)`);
              }
            } else {
              const textContent = msg.content.map((c: any) => c.text).join('');
              this.logger.info(`[API] Message ${i}: ${msg.role}, text: ${textContent.substring(0, 100)}...`);
            }
          } else {
            this.logger.info(`[API] Message ${i}: ${msg.role}, text: ${msg.content.substring(0, 100)}...`);
          }
        }
      }
      
      this.logger.info('[API] Request body:');
      const requestBody = {
        model: this.model,
        messages: messages.map((m, i) => {
          if (m.content && Array.isArray(m.content)) {
            return {
              role: m.role,
              content: m.content.map((c: any) => {
                if (c.type === 'image_url') {
                  return { type: 'image_url', image_url: { detail: 'high', url: '[base64 data]' } };
                }
                return { type: c.type, text: c.text?.substring(0, 50) + '...' || '' };
              })
            };
          }
          return { role: m.role, content: typeof m.content === 'string' ? m.content.substring(0, 50) + '...' : m.content };
        }),
        max_tokens: 1024,
        temperature: 0.1,
      };
      this.logger.info(JSON.stringify(requestBody, null, 2));
      this.logger.info('========================================');
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: 1024,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Model API error: ${error}`);
    }

    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = result.choices?.[0]?.message?.content || '';

    // Debug: Log model response
    if (this.debug) {
      this.logger.info('========== Model API Output ==========');
      this.logger.info(`[API] Response length: ${content.length} chars`);
      this.logger.info(`[API] Response content:\n${content}`);
      this.logger.info('======================================');
    }

    return content;
  }

  /**
   * Parse the model response
   */
  private parseModelResponse(response: string): UIActionParseResult {
    let thought = '';
    let action = '';

    // Parse Thought and Action from response
    const thoughtMatch = response.match(/Thought:?\s*([\s\S]*?)(?=\s*Action:|$)/i);
    const actionMatch = response.match(/Action:?\s*([\s\S]*?)$/i);

    if (thoughtMatch) {
      thought = thoughtMatch[1].trim();
    }

    if (actionMatch) {
      action = actionMatch[1].trim();
    }

    // If no clear separation, try to parse the whole response
    if (!thought && !action) {
      action = response.trim();
    }

    // Parse action type and inputs
    const parsedAction = this.parseUIAction(action);

    return {
      thought,
      action,
      actionType: parsedAction?.actionType,
      actionInputs: parsedAction?.actionInputs,
    };
  }

  /**
   * Parse UI-TARS action format: click(start_box='[x1, y1, x2, y2]')
   */
  parseUIAction(actionStr: string): { actionType: string; actionInputs: Record<string, any> } | null {
    try {
      // Trim whitespace and newlines
      actionStr = actionStr.trim();

      // Match format: action_name() or action_name(arg1='value1', arg2='value2')
      const match = actionStr.match(/^(\w+)\((.*)\)$/);
      if (!match) {
        this.logger.warn(`Failed to match action format: ${actionStr}`);
        return null;
      }

      const actionType = match[1];
      const argsStr = match[2].trim();
      const actionInputs: Record<string, any> = {};

      // Handle actions without parameters (e.g., wait(), finished())
      if (!argsStr) {
        return { actionType, actionInputs };
      }

      // Parse arguments: key='value', key2='value2'
      // Support values that may contain escaped newlines (\n) or other escaped characters
      const argMatches = argsStr.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)=\s*'((?:[^'\\]|\\.)*)'/g);
      for (const argMatch of argMatches) {
        const key = argMatch[1];
        let value = argMatch[2];

        // Handle special formats
        if (value.startsWith('[') && value.endsWith(']')) {
          // Parse array format: [x1, y1, x2, y2]
          value = value.slice(1, -1);
          const numbers = value.split(',').map((n) => parseFloat(n.trim()));
          if (numbers.length > 1 && !numbers.some((n) => isNaN(n))) {
            actionInputs[key] = `[${numbers.join(', ')}]`;
            continue;
          }
        }

        // Unescape common escape sequences
        value = value.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\');

        actionInputs[key] = value;
      }

      return { actionType, actionInputs };
    } catch (error) {
      this.logger.error(`Error parsing action: ${error}`);
      return null;
    }
  }

  getToolDefinition(): {
    name: string;
    description: string;
    parameters: object;
  } {
    return {
      name: GUI_TOOL_NAME,
      description: 'Perform GUI operations on computer/browser including clicks, typing, navigation, etc.',
      parameters: {
        type: 'object',
        properties: {
          thought: {
            type: 'string',
            description: 'Thought process and plan for the next action (in Chinese)',
          },
          action: {
            type: 'string',
            description: 'Action to perform: click(start_box="[x1, y1, x2, y2]"), type(content="text"), scroll(direction="down"), hotkey(key="ctrl c"), finished(), etc.',
          },
        },
        required: ['thought', 'action'],
      },
    };
  }

  /**
   * Execute a single action (for direct tool calls)
   */
  async executeSingleAction(input: { thought: string; action: string }): Promise<{ success: boolean; error?: string }> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.logger.info(`Executing: ${input.action}`);

    const parsedAction = this.parseUIAction(input.action);
    if (!parsedAction) {
      return { success: false, error: 'Failed to parse action format' };
    }

    const prediction: PredictionParsed = {
      reflection: null,
      thought: input.thought,
      action_type: parsedAction.actionType,
      action_inputs: parsedAction.actionInputs,
    };

    const result = await this.operator.executePrediction(prediction);

    if (result.status === 'failed') {
      return { success: false, error: result.errorMessage || 'Action execution failed' };
    }

    return { success: true };
  }

  async takeScreenshot(): Promise<ScreenshotOutput> {
    if (!this.initialized) {
      await this.initialize();
    }
    return await this.operator.doScreenshot();
  }

  async getScreenContext(): Promise<ScreenContext> {
    if (!this.initialized) {
      await this.initialize();
    }
    return await this.operator.getScreenContext();
  }

  getSupportedActions(): SupportedActionType[] {
    return this.operator.getSupportedActions();
  }

  pause(): void {
    this.paused = true;
    this.resumePromise = new Promise((resolve) => {
      this.resolveResume = resolve;
    });
  }

  resume(): void {
    if (this.resolveResume) {
      this.resolveResume();
      this.resumePromise = undefined;
      this.resolveResume = undefined;
    }
    this.paused = false;
  }

  stop(): void {
    this.stopped = true;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up GUI Agent...');
    await this.operator.cleanup();
    this.initialized = false;
    this.paused = false;
    this.stopped = false;
  }

  async destroyInstance(): Promise<void> {
    this.logger.info('Destroying GUI Agent...');
    await this.operator.destroyInstance();
    this.initialized = false;
    this.paused = false;
    this.stopped = false;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getModel(): string | undefined {
    return this.model;
  }

  getLoopInterval(): number {
    return this.loopIntervalInMs;
  }

  getMaxLoopCount(): number | undefined {
    return this.maxLoopCount;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isPaused(): boolean {
    return this.paused;
  }

  isStopped(): boolean {
    return this.stopped;
  }
}