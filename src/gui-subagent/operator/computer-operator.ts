/**
 * Computer Operator using @nut-tree/nut-js
 * Provides desktop automation capabilities for gui-subagent
 * Based on UI-TARS NutJSOperator implementation
 */

import {
  keyboard,
  mouse,
  Button,
  straightTo,
  Point,
  Key,
} from '@nut-tree-fork/nut-js';
import { type OperatorConfig, type ScreenContext, type ScreenshotOutput, type ExecuteParams, type ExecuteOutput, type OperatorManual, type ComputerOperatorConfig } from '../types/operator.js';
import { type Coordinates, type SupportedActionType } from '../types/actions.js';
import { Operator } from './base-operator.js';

export interface ComputerOperatorOptions {
  config?: OperatorConfig;
  computerConfig?: ComputerOperatorConfig;
  logger?: Console;
}

interface PointLike {
  x: number;
  y: number;
}

export class ComputerOperator extends Operator {
  private config: OperatorConfig;
  private computerConfig: ComputerOperatorConfig;
  private logger: Console;
  private screenCtx: ScreenContext | null = null;

  constructor(options: ComputerOperatorOptions = {}) {
    super();
    this.config = options.config || {};
    this.computerConfig = options.computerConfig || {};
    this.logger = options.logger || console;
  }

  protected async initialize(): Promise<void> {
    this.logger.info('Initializing computer operator...');

    try {
      // Configure keyboard config for better typing
      keyboard.config.autoDelayMs = 50;

      // Get screen size (OS-specific)
      const { width, height, scaleFactor } = await this.getScreenSize();
      this.screenCtx = {
        width,
        height,
        scaleFactor,
      };

      this.logger.info(`Computer operator initialized: ${width}x${height} @ ${scaleFactor}x`);
    } catch (error) {
      this.logger.error('Failed to initialize computer operator:', error);
      throw error;
    }
  }

  private async getScreenSize(): Promise<{ width: number; height: number; scaleFactor: number }> {
    // Default to a common resolution if detection fails
    // In a real implementation, use native OS APIs
    return {
      width: this.config.viewport?.width || 1920,
      height: this.config.viewport?.height || 1080,
      scaleFactor: this.config.deviceScaleFactor || 1,
    };
  }

  protected supportedActions(): SupportedActionType[] {
    return [
      'click',
      'double_click',
      'right_click',
      'middle_click',
      'mouse_down',
      'mouse_up',
      'mouse_move',
      'drag',
      'scroll',
      'type',
      'hotkey',
      'press',
      'release',
      'wait',
      'finished',
      'call_user',
    ];
  }

  protected screenContext(): ScreenContext {
    if (!this.screenCtx) {
      throw new Error('Screen context not initialized');
    }
    return this.screenCtx;
  }

  protected async screenshot(): Promise<ScreenshotOutput> {
    try {
      // In a real implementation, use native screenshot APIs
      // For Windows: use electron.desktopCapturer or Windows.Graphics.Capture
      // For macOS: use CGDisplayCreateBitmapFromPixels
      // For Linux: use scrot or similar

      // Placeholder - actual implementation depends on platform
      this.logger.warn('Screenshot not yet implemented for computer operator');

      return {
        status: 'success',
        base64: '',
        scaleFactor: this.screenCtx?.scaleFactor || 1,
      };
    } catch (error) {
      this.logger.error('Screenshot failed:', error);
      return {
        status: 'failed',
        errorMessage: (error as Error).message,
      };
    }
  }

  protected async execute(params: ExecuteParams): Promise<ExecuteOutput> {
    const { parsedPrediction } = params;
    const { action_type, action_inputs } = parsedPrediction;

    try {
      await this.executeAction(action_type, action_inputs);
      return { status: 'success' };
    } catch (error) {
      this.logger.error(`Failed to execute action ${action_type}:`, error);
      return {
        status: 'failed',
        errorMessage: (error as Error).message,
      };
    }
  }

  private async executeAction(actionType: string, inputs: Record<string, any>): Promise<void> {
    switch (actionType) {
      case 'click':
      case 'left_single':
        await this.handleClick(inputs);
        break;
      case 'left_double':
        await this.handleDoubleClick(inputs);
        break;
      case 'right_single':
        await this.handleRightClick(inputs);
        break;
      case 'middle_click':
        await this.handleMiddleClick(inputs);
        break;
      case 'mouse_down':
        await this.handleMouseDown(inputs);
        break;
      case 'mouse_up':
        await this.handleMouseUp(inputs);
        break;
      case 'mouse_move':
        await this.handleMouseMove(inputs);
        break;
      case 'drag':
        await this.handleDrag(inputs);
        break;
      case 'scroll':
        await this.handleScroll(inputs);
        break;
      case 'type':
        await this.handleType(inputs);
        break;
      case 'hotkey':
        await this.handleHotkey(inputs);
        break;
      case 'press':
        await this.handlePress(inputs);
        break;
      case 'release':
        await this.handleRelease(inputs);
        break;
      case 'wait':
        await this.handleWait(inputs);
        break;
      case 'finished':
        this.logger.info('Task finished');
        break;
      case 'call_user':
        this.logger.info('User interaction requested');
        break;
      default:
        this.logger.warn(`Unsupported action: ${actionType}`);
    }
  }

  private async getCoordinates(point: Coordinates): Promise<PointLike> {
    const ctx = this.screenCtx;
    if (!ctx) throw new Error('Screen context not initialized');

    let x: number, y: number;

    if (point.normalized) {
      x = point.normalized.x * ctx.width;
      y = point.normalized.y * ctx.height;
    } else if (point.raw) {
      x = point.raw.x;
      y = point.raw.y;
    } else if (point.referenceBox) {
      // Use center of reference box
      x = (point.referenceBox.x1 + point.referenceBox.x2) / 2;
      y = (point.referenceBox.y1 + point.referenceBox.y2) / 2;
    } else {
      throw new Error('Invalid coordinates');
    }

    return { x, y };
  }

  private parseBox(boxStr: string): { x1: number; y1: number; x2: number; y2: number } | null {
    // Support multiple formats:
    // [x1, y1, x2, y2]
    // (x1, y1, x2, y2)
    // x1, y1, x2, y2
    const match = boxStr.match(/[\[\(]?\s*([\d.]+)\s*,\s*([\d.]+)\s*[,]?\s*([\d.]+)?\s*[,]?\s*([\d.]+)?\s*[\]\)]?/);
    if (!match) return null;

    const x1 = parseFloat(match[1]);
    const y1 = parseFloat(match[2]);
    const x2 = match[3] ? parseFloat(match[3]) : x1;
    const y2 = match[4] ? parseFloat(match[4]) : y1;

    return { x1, y1, x2, y2 };
  }

  private async handleClick(inputs: Record<string, any>): Promise<void> {
    const point = await this.parsePointFromInput(inputs);
    if (!point) throw new Error('Missing point for click');

    const targetPoint = new Point(point.x, point.y);
    await mouse.move(straightTo(targetPoint));
    await mouse.click(Button.LEFT);
  }

  private async handleDoubleClick(inputs: Record<string, any>): Promise<void> {
    const point = await this.parsePointFromInput(inputs);
    if (!point) throw new Error('Missing point for double click');

    const targetPoint = new Point(point.x, point.y);
    await mouse.move(straightTo(targetPoint));
    await mouse.click(Button.LEFT);
    await mouse.click(Button.LEFT);
  }

  private async handleRightClick(inputs: Record<string, any>): Promise<void> {
    const point = await this.parsePointFromInput(inputs);
    if (!point) throw new Error('Missing point for right click');

    const targetPoint = new Point(point.x, point.y);
    await mouse.move(straightTo(targetPoint));
    await mouse.click(Button.RIGHT);
  }

  private async handleMiddleClick(inputs: Record<string, any>): Promise<void> {
    const point = await this.parsePointFromInput(inputs);
    if (!point) throw new Error('Missing point for middle click');

    const targetPoint = new Point(point.x, point.y);
    await mouse.move(straightTo(targetPoint));
    await mouse.click(Button.MIDDLE);
  }

  private async handleMouseDown(inputs: Record<string, any>): Promise<void> {
    const point = inputs.point ? await this.getCoordinates(inputs.point) : null;
    if (point) {
      const targetPoint = new Point(point.x, point.y);
      await mouse.move(straightTo(targetPoint));
    }
    await mouse.pressButton(Button.LEFT);
  }

  private async handleMouseUp(inputs: Record<string, any>): Promise<void> {
    const point = inputs.point ? await this.getCoordinates(inputs.point) : null;
    if (point) {
      const targetPoint = new Point(point.x, point.y);
      await mouse.move(straightTo(targetPoint));
    }
    await mouse.releaseButton(Button.LEFT);
  }

  private async handleMouseMove(inputs: Record<string, any>): Promise<void> {
    const point = await this.parsePointFromInput(inputs);
    if (!point) throw new Error('Missing point for mouse move');

    const targetPoint = new Point(point.x, point.y);
    await mouse.move(straightTo(targetPoint));
  }

  private async handleDrag(inputs: Record<string, any>): Promise<void> {
    const startPoint = await this.parsePointFromInput(inputs, 'start_box');
    const endPoint = await this.parsePointFromInput(inputs, 'end_box');
    if (!startPoint || !endPoint) throw new Error('Missing points for drag');

    const start = new Point(startPoint.x, startPoint.y);
    const end = new Point(endPoint.x, endPoint.y);
    await mouse.move(straightTo(start));
    await mouse.pressButton(Button.LEFT);
    await mouse.move(straightTo(end));
    await mouse.releaseButton(Button.LEFT);
  }

  private async handleScroll(inputs: Record<string, any>): Promise<void> {
    const direction = inputs.direction?.toLowerCase();
    if (!direction) throw new Error('No scroll direction specified');

    const scrollAmount = 100;
    switch (direction) {
      case 'up':
        await mouse.scrollUp(scrollAmount);
        break;
      case 'down':
        await mouse.scrollDown(scrollAmount);
        break;
      case 'left':
        await mouse.scrollLeft(scrollAmount);
        break;
      case 'right':
        await mouse.scrollRight(scrollAmount);
        break;
      default:
        throw new Error(`Unsupported scroll direction: ${direction}`);
    }
  }

  private async handleType(inputs: Record<string, any>): Promise<void> {
    const content = inputs.content;
    if (!content) {
      this.logger.warn('No content to type');
      return;
    }

    // Handle special characters
    const processedContent = content
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r');

    await keyboard.type(processedContent);
  }

  private async handleHotkey(inputs: Record<string, any>): Promise<void> {
    const key = inputs.key;
    if (!key) throw new Error('No hotkey specified');

    const keys = key.toLowerCase().split('+').map((k: string) => k.trim());
    await this.pressKeys(keys);
  }

  private async handlePress(inputs: Record<string, any>): Promise<void> {
    const key = inputs.key;
    if (!key) throw new Error('No key specified');

    await keyboard.pressKey(this.getKeyEnum(key));
  }

  private async handleRelease(inputs: Record<string, any>): Promise<void> {
    const key = inputs.key;
    if (!key) throw new Error('No key specified');

    await keyboard.releaseKey(this.getKeyEnum(key));
  }

  private getKeyEnum(keyName: string): Key {
    const keyMap: Record<string, Key> = {
      'ctrl': Key.LeftControl,
      'control': Key.LeftControl,
      'alt': Key.LeftAlt,
      'shift': Key.LeftShift,
      'win': Key.LeftWin,
      'cmd': Key.LeftWin,
      'enter': Key.Enter,
      'return': Key.Enter,
      'escape': Key.Escape,
      'esc': Key.Escape,
      'tab': Key.Tab,
      'space': Key.Space,
      'backspace': Key.Backspace,
      'delete': Key.Delete,
      'del': Key.Delete,
      'home': Key.Home,
      'end': Key.End,
      'pageup': Key.PageUp,
      'pagedown': Key.PageDown,
      'up': Key.Up,
      'down': Key.Down,
      'left': Key.Left,
      'right': Key.Right,
      'f1': Key.F1,
      'f2': Key.F2,
      'f3': Key.F3,
      'f4': Key.F4,
      'f5': Key.F5,
      'f6': Key.F6,
      'f7': Key.F7,
      'f8': Key.F8,
      'f9': Key.F9,
      'f10': Key.F10,
      'f11': Key.F11,
      'f12': Key.F12,
    };
    const lowerKey = keyName.toLowerCase();
    return keyMap[lowerKey] || Key.A;
  }

  private async pressKeys(keys: string[]): Promise<void> {
    // Convert key names to nut-js Key enum
    const keyEnums = keys.map((k) => this.getKeyEnum(k));

    for (const key of keyEnums) {
      await keyboard.pressKey(key);
    }
    for (let i = keyEnums.length - 1; i >= 0; i--) {
      await keyboard.releaseKey(keyEnums[i]);
    }
  }

  private async handleWait(inputs: Record<string, any>): Promise<void> {
    const time = inputs.time || 5;
    await new Promise((resolve) => setTimeout(resolve, time * 1000));
  }

  private async parsePointFromInput(inputs: Record<string, any>, boxKey: string = 'start_box'): Promise<PointLike | null> {
    // Check for point format
    if (inputs.point) {
      return this.getCoordinates(inputs.point);
    }

    // Check for box format
    const boxStr = inputs[boxKey] || inputs.start_box || inputs.end_box;
    if (boxStr) {
      const box = this.parseBox(boxStr);
      if (box) {
        return { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 };
      }
    }

    return null;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up computer operator...');
  }

  async destroyInstance(): Promise<void> {
    this.logger.info('Destroying computer operator instance...');
    await this.cleanup();
  }

  static override get MANUAL(): OperatorManual {
    return {
      ACTION_SPACES: [
        `click(start_box='[x1, y1, x2, y2]') # Click on an element`,
        `left_double(start_box='[x1, y1, x2, y2]') # Double click`,
        `right_single(start_box='[x1, y1, x2, y2]') # Right click`,
        `drag(start_box='[x1, y1, x2, y2]', end_box='[x3, y3, x4, y4]') # Drag from start to end`,
        `hotkey(key='ctrl c') # Press hotkey combination`,
        `type(content='text to type') # Type text, use "\\n" at end to submit`,
        `scroll(start_box='[x1, y1, x2, y2]', direction='down') # Scroll direction: up/down/left/right`,
        `wait() # Wait 5 seconds`,
        `finished() # Task completed`,
        `call_user() # Request user help`,
      ],
    };
  }
}