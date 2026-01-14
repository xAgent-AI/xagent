/**
 * Computer Operator using @computer-use/nut-js
 * Provides desktop automation capabilities for gui-subagent
 * Based on UI-TARS NutJSOperator implementation
 *
 * This implementation is aligned with packages/ui-tars/operators/nut-js/src/index.ts
 */

import {
  screen,
  Button,
  Key,
  Point,
  centerOf,
  keyboard,
  mouse,
  sleep,
  straightTo,
  clipboard,
} from '@computer-use/nut-js';
import { Jimp } from 'jimp';
import type { OperatorConfig, ScreenContext, ScreenshotOutput, ExecuteParams, ExecuteOutput } from '../types/operator.js';
import { Operator, type OperatorManual, parseBoxToScreenCoords } from './base-operator.js';

export interface ComputerOperatorOptions {
  config?: OperatorConfig;
  computerConfig?: Record<string, any>;
  logger?: Console;
}

export class ComputerOperator extends Operator {
  private config: OperatorConfig;
  private logger: Console;
  private screenCtx: ScreenContext | null = null;

  constructor(options: ComputerOperatorOptions = {}) {
    super();
    this.config = options.config || {};
    this.logger = options.logger || console;
  }

  protected async initialize(): Promise<void> {
    this.logger.info('Initializing computer operator...');

    try {
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
    try {
      const grabImage = await screen.grab();
      const screenWithScale = await grabImage.toRGB();
      const scaleFactor = screenWithScale.pixelDensity.scaleX;
      const width = screenWithScale.width / scaleFactor;
      const height = screenWithScale.height / scaleFactor;
      return { width, height, scaleFactor };
    } catch {
      return {
        width: this.config.viewport?.width || 1920,
        height: this.config.viewport?.height || 1080,
        scaleFactor: this.config.deviceScaleFactor || 1,
      };
    }
  }

  getSupportedActions(): string[] {
    return [
      'click',
      'left_click',
      'left_single',
      'left_double',
      'double_click',
      'right_click',
      'right_single',
      'middle_click',
      'mouse_move',
      'hover',
      'drag',
      'left_click_drag',
      'select',
      'scroll',
      'type',
      'hotkey',
      'press',
      'release',
      'open_url',
      'wait',
      'finished',
      'user_stop',
      'error_env',
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
      const grabImage = await screen.grab();
      const screenWithScale = await grabImage.toRGB();
      const scaleFactor = screenWithScale.pixelDensity.scaleX;

      const screenWithScaleImage = await Jimp.fromBitmap({
        width: screenWithScale.width,
        height: screenWithScale.height,
        data: Buffer.from(screenWithScale.data),
      });

      const width = screenWithScale.width / scaleFactor;
      const height = screenWithScale.height / scaleFactor;

      const physicalScreenImage = await screenWithScaleImage
        .resize({
          w: width,
          h: height,
        })
        .getBuffer('image/png');

      this.logger.info(`[ComputerOperator] screenshot: ${width}x${height}, scaleFactor: ${scaleFactor}`);

      return {
        status: 'success',
        base64: physicalScreenImage.toString('base64'),
        scaleFactor,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`[ComputerOperator] Screenshot failed: ${errorMsg}`);
      return {
        status: 'failed',
        errorMessage: errorMsg,
      };
    }
  }

  protected async execute(params: ExecuteParams): Promise<ExecuteOutput> {
    const { parsedPrediction, screenWidth, screenHeight, scaleFactor } = params;
    const { action_type, action_inputs } = parsedPrediction;

    // Empty or invalid action should return failed to avoid infinite loop
    if (!action_type || action_type.trim() === '') {
      this.logger.warn(`[ComputerOperator] Empty action, skipping step`);
      return {
        status: 'failed',
        errorMessage: 'Empty or invalid action type'
      };
    }

    const startBoxStr = action_inputs?.start_box || '';
    const { x: startX, y: startY } = parseBoxToScreenCoords({
      boxStr: startBoxStr,
      screenWidth,
      screenHeight,
    });

    mouse.config.mouseSpeed = 3600;

    // this.logger.info('[ComputerOperator] execute', { action_type, startX, startY, scaleFactor });

    try {
      const result = await this.executeAction(action_type, action_inputs, { startX, startY, screenWidth, screenHeight, scaleFactor });
      if (result === 'end') {
        return { status: 'end' };
      }

      return { status: 'success' };
    } catch (error) {
      this.logger.error(`Failed to execute action ${action_type}:`, error);
      return {
        status: 'failed',
        errorMessage: (error as Error).message,
      };
    }
  }

  private async executeAction(
    actionType: string,
    inputs: Record<string, any>,
    context: { startX: number; startY: number; screenWidth: number; screenHeight: number; scaleFactor: number }
  ): Promise<'end' | void> {
    const { startX, startY, screenWidth, screenHeight, scaleFactor } = context;

    const moveStraightTo = async (x: number, y: number) => {
      await mouse.move(straightTo(new Point(x, y)));
    };

    const getHotkeys = (keyStr: string | undefined): Key[] => {
      if (keyStr) {
        const platformCommandKey = process.platform === 'darwin' ? Key.LeftCmd : Key.LeftWin;
        const platformCtrlKey = process.platform === 'darwin' ? Key.LeftCmd : Key.LeftControl;
        const keyMap = {
          return: Key.Enter,
          ctrl: platformCtrlKey,
          shift: Key.LeftShift,
          alt: Key.LeftAlt,
          'page down': Key.PageDown,
          'page up': Key.PageUp,
          meta: platformCommandKey,
          win: platformCommandKey,
          command: platformCommandKey,
          cmd: platformCommandKey,
          ',': Key.Comma,
          arrowup: Key.Up,
          arrowdown: Key.Down,
          arrowleft: Key.Left,
          arrowright: Key.Right,
        } as const;

        const lowercaseKeyMap = Object.fromEntries(
          Object.entries(Key).map(([k, v]) => [k.toLowerCase(), v]),
        ) as {
          [K in keyof typeof Key as Lowercase<K>]: (typeof Key)[K];
        };

        const keys = keyStr
          .split(/[\s+]+/)
          .map((k) => k.toLowerCase())
          .map(
            (k) =>
              keyMap[k as keyof typeof keyMap] ??
              lowercaseKeyMap[k as Lowercase<keyof typeof Key>],
          )
          .filter(Boolean);
        this.logger.info('[ComputerOperator] hotkey:', keys);
        return keys;
      }
      return [];
    };

    switch (actionType) {
      case 'wait':
        this.logger.info('[ComputerOperator] wait', inputs);
        await sleep(5000);
        break;

      case 'mouse_move':
      case 'hover':
        this.logger.info('[ComputerOperator] mouse_move');
        await moveStraightTo(startX, startY);
        break;

      case 'click':
      case 'left_click':
      case 'left_single':
        this.logger.info('[ComputerOperator] left_click');
        await moveStraightTo(startX, startY);
        await sleep(100);
        await mouse.click(Button.LEFT);
        break;

      case 'left_double':
      case 'double_click':
        this.logger.info(`[ComputerOperator] ${actionType}(${startX}, ${startY})`);
        await moveStraightTo(startX, startY);
        await sleep(100);
        await mouse.doubleClick(Button.LEFT);
        break;

      case 'right_click':
      case 'right_single':
        this.logger.info('[ComputerOperator] right_click');
        await moveStraightTo(startX, startY);
        await sleep(100);
        await mouse.click(Button.RIGHT);
        break;

      case 'middle_click':
        this.logger.info('[ComputerOperator] middle_click');
        await moveStraightTo(startX, startY);
        await mouse.click(Button.MIDDLE);
        break;

      case 'drag':
      case 'left_click_drag':
      case 'select': {
        const endBoxStr = inputs?.end_box || '';
        if (endBoxStr) {
          const { x: endX, y: endY } = parseBoxToScreenCoords({
            boxStr: endBoxStr,
            screenWidth,
            screenHeight,
          });

          if (startX && startY && endX && endY) {
            this.logger.info(
              `[ComputerOperator] drag coordinates: startX=${startX}, startY=${startY}, endX=${endX}, endY=${endY}`,
            );
            await moveStraightTo(startX, startY);
            await sleep(100);
            await mouse.drag(straightTo(new Point(endX, endY)));
          }
        }
        break;
      }

      case 'type': {
        const content = inputs.content?.trim();
        this.logger.info('[ComputerOperator] type', content);
        if (content) {
          const stripContent = content.replace(/\\n$/, '').replace(/\n$/, '');
          keyboard.config.autoDelayMs = 0;
          if (process.platform === 'win32') {
            const originalClipboard = await clipboard.getContent();
            await clipboard.setContent(stripContent);
            await keyboard.pressKey(Key.LeftControl, Key.V);
            await sleep(50);
            await keyboard.releaseKey(Key.LeftControl, Key.V);
            await sleep(50);
            await clipboard.setContent(originalClipboard);
          } else {
            await keyboard.type(stripContent);
          }

          if (content.endsWith('\n') || content.endsWith('\\n')) {
            await keyboard.pressKey(Key.Enter);
            await keyboard.releaseKey(Key.Enter);
          }

          keyboard.config.autoDelayMs = 500;
        }
        break;
      }

      case 'hotkey': {
        const keyStr = inputs?.key || inputs?.hotkey;
        const keys = getHotkeys(keyStr);
        if (keys.length > 0) {
          await keyboard.pressKey(...keys);
          await keyboard.releaseKey(...keys);
        }
        break;
      }

      case 'press': {
        const keyStr = inputs?.key || inputs?.hotkey;
        const keys = getHotkeys(keyStr);
        if (keys.length > 0) {
          await keyboard.pressKey(...keys);
        }
        break;
      }

      case 'release': {
        const keyStr = inputs?.key || inputs?.hotkey;
        const keys = getHotkeys(keyStr);
        if (keys.length > 0) {
          await keyboard.releaseKey(...keys);
        }
        break;
      }

      case 'scroll': {
        const { direction } = inputs;
        if (startX !== null && startY !== null) {
          await moveStraightTo(startX, startY);
        }

        switch (direction?.toLowerCase()) {
          case 'up':
            await mouse.scrollUp(5 * 100);
            break;
          case 'down':
            await mouse.scrollDown(5 * 100);
            break;
          default:
            this.logger.warn(`[ComputerOperator] Unsupported scroll direction: ${direction}`);
        }
        break;
      }

      case 'open_url': {
        let url = inputs?.url || inputs?.content;
        if (!url) {
          throw new Error('No URL specified for open_url action');
        }

        // Ensure URL has protocol
        if (!/^https?:\/\//i.test(url)) {
          url = 'https://' + url;
        }

        this.logger.info(`[ComputerOperator] Opening URL: ${url}`);

        // Use system command to open URL in default browser
        const { exec } = await import('child_process');
        const platform = process.platform;

        if (platform === 'win32') {
          // Windows: use start command
          await new Promise<void>((resolve, reject) => {
            exec(`start "" "${url}"`, (error) => {
              if (error) {
                this.logger.warn(`[ComputerOperator] Failed to open URL with start command: ${error.message}`);
                // Fallback: try using PowerShell
                exec(`powershell -Command "Start-Process '${url}'"`, (psError) => {
                  if (psError) {
                    reject(psError);
                  } else {
                    resolve();
                  }
                });
              } else {
                resolve();
              }
            });
          });
        } else if (platform === 'darwin') {
          // macOS: use open command
          await new Promise<void>((resolve, reject) => {
            exec(`open "${url}"`, (error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          });
        } else {
          // Linux: use xdg-open
          await new Promise<void>((resolve, reject) => {
            exec(`xdg-open "${url}"`, (error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          });
        }

        // Wait for browser to open and page to load
        await sleep(2000);
        break;
      }

      case 'error_env':
      case 'call_user':
      case 'finished':
      case 'user_stop':
        this.logger.info(`[ComputerOperator] ${actionType}`);
        return 'end';

      default:
        this.logger.warn(`[ComputerOperator] Unsupported action: ${actionType}`);
    }
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
        `click(start_box='[x1, y1, x2, y2]')`,
        `left_double(start_box='[x1, y1, x2, y2]')`,
        `right_single(start_box='[x1, y1, x2, y2]')`,
        `drag(start_box='[x1, y1, x2, y2]', end_box='[x3, y3, x4, y4]')`,
        `hotkey(key='')`,
        `type(content='') #If you want to submit your input, use "\\n" at the end of \`content\`.`,
        `scroll(start_box='[x1, y1, x2, y2]', direction='down or up or right or left')`,
        `open_url(url='https://xxx') # Open URL in default browser`,
        `wait() #Sleep for 5s and take a screenshot to check for any changes.`,
        `finished()`,
        `call_user() # Submit the task and call the user when the task is unsolvable, or when you need the user's help.`,
      ],
    };
  }
}
