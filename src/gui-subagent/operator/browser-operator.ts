/**
 * Browser Operator using Puppeteer
 * Provides browser automation capabilities for gui-subagent
 * Based on UI-TARS architecture (@ui-tars/operators/browser-operator)
 *
 * This implementation is aligned with packages/ui-tars/operators/browser-operator/src/browser-operator.ts
 */

import puppeteer, { type Browser, type Page, type LaunchOptions } from 'puppeteer';
import {
  type OperatorConfig,
  type ScreenContext,
  type ScreenshotOutput,
  type ExecuteParams,
  type ExecuteOutput,
} from '../types/operator.js';
import { Operator, type OperatorManual, parseBoxToScreenCoords } from './base-operator.js';
import { sleep } from '../utils.js';

export interface BrowserOperatorOptions {
  config?: OperatorConfig;
  logger?: Console;
}

export class BrowserOperator extends Operator {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private config: OperatorConfig;
  private logger: Console;
  private screenCtx: ScreenContext | null = null;

  constructor(options: BrowserOperatorOptions = {}) {
    super();
    this.config = options.config || {
      headless: false,
      viewport: { width: 1280, height: 800 },
    };
    this.logger = options.logger || console;
  }

  protected async initialize(): Promise<void> {
    this.logger.info('Initializing browser...');

    try {
      const launchOptions: LaunchOptions = {
        headless: this.config.headless ?? false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      };

      if (this.config.browserPath) {
        launchOptions.executablePath = this.config.browserPath;
      }

      this.browser = await puppeteer.launch(launchOptions);

      const pages = await this.browser.pages();
      this.page = pages[0] || await this.browser.newPage();

      await this.page.setViewport({
        width: this.config.viewport?.width || 1280,
        height: this.config.viewport?.height || 800,
        deviceScaleFactor: this.config.deviceScaleFactor || 1,
      });

      this.screenCtx = {
        width: this.config.viewport?.width || 1280,
        height: this.config.viewport?.height || 800,
        scaleFactor: this.config.deviceScaleFactor || 1,
      };

      this.logger.info('Browser initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize browser:', error);
      throw error;
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
      'scroll',
      'type',
      'hotkey',
      'navigate',
      'navigate_back',
      'wait',
      'finished',
      'user_stop',
      'error_env',
    ];
  }

  protected screenContext(): ScreenContext {
    // Return default context if not initialized yet
    // This allows the first action (e.g., navigate) to trigger lazy initialization
    if (!this.screenCtx) {
      return {
        width: 1280,
        height: 800,
        scaleFactor: 1,
      };
    }
    return this.screenCtx;
  }

  protected async screenshot(): Promise<ScreenshotOutput> {
    if (!this.page) {
      this.logger.error('Screenshot failed: Page not initialized');
      return {
        status: 'failed',
        errorMessage: 'Browser page not initialized',
      };
    }

    try {
      const url = this.page.url();
      const base64 = await this.page.screenshot({
        encoding: 'base64',
        type: 'png',
        fullPage: false,
      });

      return {
        status: 'success',
        base64: base64 as string,
        url,
        scaleFactor: this.screenCtx?.scaleFactor || 1,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`[BrowserOperator] Screenshot failed: ${errorMsg}`);
      return {
        status: 'failed',
        errorMessage: errorMsg,
      };
    }
  }

  protected async execute(params: ExecuteParams): Promise<ExecuteOutput> {
    const { parsedPrediction, screenWidth, screenHeight, scaleFactor } = params;
    const { action_type, action_inputs } = parsedPrediction;

    const startBoxStr = action_inputs?.start_box || '';
    const { x: startX, y: startY } = parseBoxToScreenCoords({
      boxStr: startBoxStr,
      screenWidth,
      screenHeight,
    });

    try {
      await this.executeAction(action_type, action_inputs, { startX, startY, screenWidth, screenHeight, scaleFactor });
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
  ): Promise<void> {
    const { startX, startY, screenWidth, screenHeight, scaleFactor } = context;
    const page = await this.getActivePage();

    switch (actionType) {
      case 'wait':
        await sleep(5000);
        break;

      case 'mouse_move':
      case 'hover':
        await page.mouse.move(startX, startY);
        break;

      case 'click':
      case 'left_click':
      case 'left_single':
        await page.mouse.move(startX, startY);
        await sleep(100);
        await page.mouse.click(startX, startY);
        break;

      case 'left_double':
      case 'double_click':
        await page.mouse.move(startX, startY);
        await sleep(100);
        await page.mouse.click(startX, startY, { clickCount: 2 });
        break;

      case 'right_click':
      case 'right_single':
        await page.mouse.move(startX, startY);
        await sleep(100);
        await page.mouse.click(startX, startY, { button: 'right' });
        break;

      case 'middle_click':
        await page.mouse.move(startX, startY);
        await page.mouse.click(startX, startY, { button: 'middle' });
        break;

      case 'type': {
        const content = inputs.content?.trim();
        if (content) {
          const stripContent = content.replace(/\\n$/, '').replace(/\n$/, '');
          await page.keyboard.type(stripContent, { delay: 50 });

          if (content.endsWith('\n') || content.endsWith('\\n')) {
            await page.keyboard.press('Enter');
          }
        }
        break;
      }

      case 'hotkey': {
        const keyStr = inputs?.key || inputs?.hotkey;
        if (keyStr) {
          const keys = this.parseHotkeys(keyStr);
          for (const key of keys) {
            await page.keyboard.down(key as any);
          }
          for (let i = keys.length - 1; i >= 0; i--) {
            await page.keyboard.up(keys[i] as any);
          }
        }
        break;
      }

      case 'scroll': {
        const { direction } = inputs;
        if (startX !== null && startY !== null) {
          await page.mouse.move(startX, startY);
        }

        switch (direction?.toLowerCase()) {
          case 'up':
            await page.mouse.wheel({ deltaY: -500 });
            break;
          case 'down':
            await page.mouse.wheel({ deltaY: 500 });
            break;
          default:
            this.logger.warn(`Unsupported scroll direction: ${direction}`);
        }
        break;
      }

      case 'navigate': {
        // Lazy initialization: initialize browser only when navigating
        if (!this.browser) {
          await this.initialize();
        }
        let url = inputs?.url;
        if (!url) {
          throw new Error('No URL specified for navigation');
        }
        if (!/^https?:\/\//i.test(url)) {
          url = 'https://' + url;
        }
        await this.page!.goto(url, { waitUntil: 'networkidle2' });
        break;
      }

      case 'navigate_back':
        await page.goBack();
        break;

      case 'error_env':
      case 'finished':
      case 'user_stop':
        break;

      default:
        this.logger.warn(`Unsupported action: ${actionType}`);
    }
  }

  private parseHotkeys(keyStr: string): string[] {
    const keyMap: Record<string, string> = {
      return: 'Enter',
      ctrl: process.platform === 'darwin' ? 'Meta' : 'Control',
      shift: 'Shift',
      alt: 'Alt',
      meta: 'Meta',
      win: 'Meta',
      cmd: 'Meta',
      ',': ',',
      arrowup: 'ArrowUp',
      arrowdown: 'ArrowDown',
      arrowleft: 'ArrowLeft',
      arrowright: 'ArrowRight',
    };

    return keyStr
      .split(/[\s+]+/)
      .map((k) => k.toLowerCase())
      .map((k) => keyMap[k] || k);
  }

  private async getActivePage(): Promise<Page> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }
    return this.page;
  }

  async cleanup(): Promise<void> {
    // Don't close browser/page - let user continue using it
    this.logger.info('GUI Agent cleanup - browser kept open for user');
  }

  async destroyInstance(): Promise<void> {
    this.logger.info('Destroying instance...');
    await this.cleanup();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  getBrowser(): Browser | null {
    return this.browser;
  }

  getPage(): Page | null {
    return this.page;
  }

  static override get MANUAL(): OperatorManual {
    return {
      ACTION_SPACES: [
        `click(point='<point>x1 y1</point>')`,
        `left_double(point='<point>x1 y1</point>')`,
        `right_single(point='<point>x1 y1</point>')`,
        `drag(start_point='<point>x1 y1</point>', end_point='<point>x2 y2</point>')`,
        `hotkey(key='ctrl c') # Split keys with a space and use lowercase.`,
        `type(content='xxx') # Use escape characters \\', \\", and \\n. Use \\n at the end to submit.`,
        `scroll(point='<point>x1 y1</point>', direction='down or up or right or left')`,
        `wait() #Sleep for 5s and take a screenshot.`,
        `finished(content='xxx') # Use escape characters \\', \\", and \\n.`,
        `navigate(url='https://example.com')`,
        `navigate_back()`,
      ],
    };
  }
}
