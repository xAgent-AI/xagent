/**
 * GUI Agent for xagent
 * Orchestrates browser automation with AI-powered action execution
 */

import type { 
  ScreenContext, 
  ScreenshotOutput, 
  ExecuteParams, 
  ExecuteOutput 
} from '../types/operator.js';
import type { 
  GUIAction, 
  SupportedActionType, 
  BaseAction,
  Coordinates 
} from '../types/actions.js';
import type { Operator } from '../operator/base-operator.js';

const GUI_TOOL_NAME = 'gui_operate';

export interface GUIAgentConfig<T extends Operator> {
  operator: T;
  model?: string;
  systemPrompt?: string;
  loopIntervalInMs?: number;
  maxLoopCount?: number;
}

// UI-TARS format input
interface GUIAgentExecuteInput {
  thought: string;
  action: string;
  errorMessage?: string;
}

interface GUIAgentExecuteOutput {
  success: boolean;
  thought: string;
  action: string;
  actionType?: string;
  actionInputs?: Record<string, any>;
  observation?: string;
  errorMessage?: string;
}

// Map UI-TARS action names to internal action types
const ACTION_TYPE_MAP: Record<string, string> = {
  'click': 'click',
  'left_double': 'double_click',
  'right_single': 'right_click',
  'drag': 'drag',
  'hotkey': 'hotkey',
  'type': 'type',
  'scroll': 'scroll',
  'wait': 'wait',
  'finished': 'finished',
  'navigate': 'navigate',
  'navigate_back': 'navigate_back',
};

export class GUIAgent<T extends Operator> {
  name: string = 'GUI Agent';
  private operator: T;
  private model?: string;
  private systemPrompt: string;
  private loopIntervalInMs: number;
  private maxLoopCount?: number;
  private logger: Console;
  private initialized: boolean = false;

  constructor(config: GUIAgentConfig<T>) {
    this.operator = config.operator;
    this.model = config.model;
    this.loopIntervalInMs = config.loopIntervalInMs || 500;
    this.maxLoopCount = config.maxLoopCount;
    this.logger = console;

    this.systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt();
  }

  private getDefaultSystemPrompt(): string {
    return `You are a GUI Agent that can control a web browser to complete user tasks.

## Your Capabilities

You can perform the following actions:
- **click**: Click on an element at specific coordinates
- **double_click**: Double click on an element
- **right_click**: Right click on an element
- **type**: Type text into the current focus
- **hotkey**: Press keyboard shortcuts (e.g., "ctrl+c", "alt+tab")
- **scroll**: Scroll up, down, left, or right
- **navigate**: Go to a specific URL
- **navigate_back**: Go back to the previous page
- **wait**: Wait for a specified time in seconds
- **finished**: Mark the task as completed
- **call_user**: Request user interaction

## Coordinate System

Coordinates can be provided in two formats:
1. **raw**: Pixel coordinates (e.g., {"raw": {"x": 640, "y": 480}})
2. **normalized**: Normalized coordinates between 0-1 (e.g., {"normalized": {"x": 0.5, "y": 0.5}})

Normalized coordinates are relative to the screen size, so x=0.5 means 50% of the screen width.

## Workflow

1. Take a screenshot to see the current state
2. Analyze the image and determine what action to take
3. Execute the action
4. Take another screenshot to verify the result
5. Repeat until the task is complete

## Important Guidelines

- Always take a screenshot before making decisions
- Use normalized coordinates when possible for better cross-resolution compatibility
- After clicking, wait for the page to respond before taking the next action
- If an action fails, try a different approach
- When the task is complete, use "finished" action

## Output Format

When you want to perform an action, use the gui_operate tool with the following format:
- action: A description of what you're doing
- operator_action: The actual action to perform with type and inputs

Example:
{
  "action": "Click the search button",
  "operator_action": {
    "type": "click",
    "inputs": {
      "point": {"normalized": {"x": 0.8, "y": 0.15}}
    }
  }
}`;
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

  getToolDefinition(): {
    name: string;
    description: string;
    parameters: object;
  } {
    return {
      name: GUI_TOOL_NAME,
      description: 'Perform GUI operations on the browser including clicks, typing, navigation, etc.',
      parameters: {
        type: 'object',
        properties: {
          thought: {
            type: 'string',
            description: 'Thought process and plan for the next action (in Chinese)',
          },
          action: {
            type: 'string',
            description: 'Action to perform in format: click(point=\'<point>x y</point>\'), type(content=\'text\'), scroll(point=\'<point>x y</point>\', direction=\'down\'), hotkey(key=\'ctrl c\'), finished(content=\'done\'), etc.',
          },
          errorMessage: {
            type: 'string',
            description: 'Error message if the action failed',
          },
        },
        required: ['thought', 'action'],
      },
    };
  }

  async execute(input: GUIAgentExecuteInput): Promise<GUIAgentExecuteOutput> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.logger.info(`Executing: ${input.action}`);

    if (input.errorMessage) {
      return {
        success: false,
        thought: input.thought,
        action: input.action,
        errorMessage: input.errorMessage,
      };
    }

    // Parse UI-TARS action format: click(point='<point>x1 y1</point>')
    const actionParseResult = this.parseUIAction(input.action);
    
    if (!actionParseResult) {
      return {
        success: false,
        thought: input.thought,
        action: input.action,
        errorMessage: 'Failed to parse action format',
      };
    }

    // Convert to internal GUIAction format
    const internalAction = this.convertToInternalAction(actionParseResult.actionType, actionParseResult.args);
    
    if (!internalAction) {
      return {
        success: false,
        thought: input.thought,
        action: input.action,
        errorMessage: 'Failed to convert action to internal format',
      };
    }

    try {
      const result = await this.operator.doExecute({
        actions: [internalAction],
      });

      if (result.status === 'failed') {
        return {
          success: false,
          thought: input.thought,
          action: input.action,
          actionType: actionParseResult.actionType,
          actionInputs: actionParseResult.args,
          errorMessage: result.errorMessage,
        };
      }

      return {
        success: true,
        thought: input.thought,
        action: input.action,
        actionType: actionParseResult.actionType,
        actionInputs: actionParseResult.args,
      };
    } catch (error) {
      return {
        success: false,
        thought: input.thought,
        action: input.action,
        errorMessage: (error as Error).message,
      };
    }
  }

  /**
   * Parse UI-TARS action format: click(point='<point>x1 y1</point>')
   */
  private parseUIAction(actionStr: string): { actionType: string; args: Record<string, string> } | null {
    try {
      // Match format: action_name(arg1='value1', arg2='value2')
      const match = actionStr.match(/^(\w+)\((.+)\)$/);
      if (!match) {
        this.logger.warn(`Failed to match action format: ${actionStr}`);
        return null;
      }

      const actionType = match[1];
      const argsStr = match[2];
      const args: Record<string, string> = {};

      // Parse arguments: key='value', key2='value2'
      const argMatches = argsStr.matchAll(/(\w+)=\'([^']*)\'/g);
      for (const argMatch of argMatches) {
        args[argMatch[1]] = argMatch[2];
      }

      return { actionType, args };
    } catch (error) {
      this.logger.error(`Error parsing action: ${error}`);
      return null;
    }
  }

  /**
   * Convert UI-TARS action to internal GUIAction format
   */
  private convertToInternalAction(actionType: string, args: Record<string, string>): GUIAction | null {
    try {
      const internalType = ACTION_TYPE_MAP[actionType];
      if (!internalType) {
        this.logger.warn(`Unknown action type: ${actionType}`);
        return null;
      }

      switch (internalType) {
        case 'click':
        case 'double_click':
        case 'right_click': {
          const point = this.parsePoint(args['point']);
          if (!point) return null;
          return {
            type: internalType,
            inputs: { point }
          };
        }
        case 'drag': {
          const startPoint = this.parsePoint(args['start_point']);
          const endPoint = this.parsePoint(args['end_point']);
          if (!startPoint || !endPoint) return null;
          return {
            type: 'drag',
            inputs: { start: startPoint, end: endPoint }
          };
        }
        case 'hotkey': {
          return {
            type: 'hotkey',
            inputs: { key: args['key'] }
          };
        }
        case 'type': {
          return {
            type: 'type',
            inputs: { content: args['content'] }
          };
        }
        case 'scroll': {
          const point = this.parsePoint(args['point']);
          const direction = args['direction'] as 'up' | 'down' | 'left' | 'right';
          return {
            type: 'scroll',
            inputs: { 
              direction: direction || 'down',
              point: point
            }
          };
        }
        case 'wait': {
          return {
            type: 'wait',
            inputs: { time: 5 }
          };
        }
        case 'finished': {
          return {
            type: 'finished',
            inputs: { content: args['content'] }
          };
        }
        case 'navigate': {
          return {
            type: 'navigate',
            inputs: { url: args['url'] }
          };
        }
        case 'navigate_back': {
          return {
            type: 'navigate_back',
            inputs: {}
          };
        }
        default:
          return null;
      }
    } catch (error) {
      this.logger.error(`Error converting action: ${error}`);
      return null;
    }
  }

  /**
   * Parse point format: <point>x y</point>
   */
  private parsePoint(pointStr: string | undefined): Coordinates | undefined {
    if (!pointStr) return undefined;
    
    // Match <point>x y</point>
    const match = pointStr.match(/<point>([\d.]+)\s+([d.]+)<\/point>/);
    if (!match) return undefined;

    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);

    // Check if it's normalized (0-1) or raw pixel
    if (x <= 1 && y <= 1) {
      return { normalized: { x, y } };
    } else {
      return { raw: { x, y } };
    }
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

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up GUI Agent...');
    await this.operator.cleanup();
    this.initialized = false;
  }

  async destroyInstance(): Promise<void> {
    this.logger.info('Destroying GUI Agent...');
    await this.operator.destroyInstance();
    this.initialized = false;
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
}
