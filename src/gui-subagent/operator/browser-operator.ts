/**
 * Browser Operator using Puppeteer
 * Provides browser automation capabilities for gui-subagent
 * Updated to match UI-TARS ExecuteParams format
 */

import puppeteer, { type Browser, type Page, type LaunchOptions } from 'puppeteer';
import {
  type OperatorConfig,
  type ScreenContext,
  type ScreenshotOutput,
  type ExecuteParams,
  type ExecuteOutput,
  type PredictionParsed,
} from '../types/operator.js';
import {
  type Coordinates,
  type SupportedActionType,
} from '../types/actions.js';
import { Operator, type OperatorManual } from './base-operator.js';

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

  protected supportedActions(): SupportedActionType[] {
    return [
      'click',
      'double_click',
      'right_click',
      'type',
      'hotkey',
      'scroll',
      'navigate',
      'navigate_back',
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
    if (!this.page) {
      throw new Error('Page not initialized');
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
      case 'double_click':
        await this.handleDoubleClick(inputs);
        break;
      case 'right_single':
      case 'right_click':
        await this.handleRightClick(inputs);
        break;
      case 'type':
        await this.handleType(inputs);
        break;
      case 'hotkey':
        await this.handleHotkey(inputs);
        break;
      case 'scroll':
        await this.handleScroll(inputs);
        break;
      case 'navigate':
        await this.handleNavigate(inputs);
        break;
      case 'navigate_back':
        await this.handleNavigateBack();
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

  private async getActivePage(): Promise<Page> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }
    return this.page;
  }

  private async calculateRealCoords(coords: Coordinates): Promise<{ x: number; y: number }> {
    if (!coords.normalized) {
      if (!coords.raw) {
        throw new Error('Invalid coordinates');
      }
      return { x: coords.raw.x, y: coords.raw.y };
    }

    const ctx = this.screenCtx;
    if (!ctx) {
      throw new Error('Screen context not initialized');
    }

    return {
      x: coords.normalized.x * ctx.width,
      y: coords.normalized.y * ctx.height,
    };
  }

  private async handleClick(inputs: Record<string, any>): Promise<void> {
    const point = await this.parsePointFromInput(inputs);
    if (!point) throw new Error('Missing point for click');

    const page = await this.getActivePage();
    this.logger.info(`Clicking at (${point.x}, ${point.y})`);
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  private async handleDoubleClick(inputs: Record<string, any>): Promise<void> {
    const point = await this.parsePointFromInput(inputs);
    if (!point) throw new Error('Missing point for double click');

    const page = await this.getActivePage();
    this.logger.info(`Double clicking at (${point.x}, ${point.y})`);
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y, { clickCount: 2 });
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  private async handleRightClick(inputs: Record<string, any>): Promise<void> {
    const point = await this.parsePointFromInput(inputs);
    if (!point) throw new Error('Missing point for right click');

    const page = await this.getActivePage();
    this.logger.info(`Right clicking at (${point.x}, ${point.y})`);
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  private async handleType(inputs: Record<string, any>): Promise<void> {
    const page = await this.getActivePage();
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

    this.logger.info(`Typing: ${processedContent}`);
    await page.keyboard.type(processedContent, { delay: 50 });
  }

  private async handleHotkey(inputs: Record<string, any>): Promise<void> {
    const page = await this.getActivePage();
    const key = inputs.key;

    if (!key) {
      throw new Error('No hotkey specified');
    }

    this.logger.info(`Pressing hotkey: ${key}`);
    const keys = key.toLowerCase().split('+').map((k: string) => k.trim());

    for (const k of keys) {
      await page.keyboard.down(k);
    }

    for (let i = keys.length - 1; i >= 0; i--) {
      const keyItem = keys[i];
      await page.keyboard.up(keyItem);
    }
  }

  private async handleScroll(inputs: Record<string, any>): Promise<void> {
    const page = await this.getActivePage();
    const direction = inputs.direction?.toLowerCase();

    if (!direction) {
      throw new Error('No scroll direction specified');
    }

    const ctx = this.screenCtx;
    const scrollAmount = ctx
      ? (direction === 'up' || direction === 'down' ? ctx.height * 0.8 : ctx.width * 0.8)
      : 500;

    this.logger.info(`Scrolling ${direction} by ${scrollAmount}px`);

    switch (direction) {
      case 'up':
        await page.mouse.wheel({ deltaY: -scrollAmount });
        break;
      case 'down':
        await page.mouse.wheel({ deltaY: scrollAmount });
        break;
      case 'left':
        await page.mouse.wheel({ deltaX: -scrollAmount });
        break;
      case 'right':
        await page.mouse.wheel({ deltaX: scrollAmount });
        break;
      default:
        this.logger.warn(`Unsupported scroll direction: ${direction}`);
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  private async handleNavigate(inputs: Record<string, any>): Promise<void> {
    const page = await this.getActivePage();
    let url = inputs.url;

    if (!url) {
      throw new Error('No URL specified for navigation');
    }

    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    this.logger.info(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2' });
  }

  private async handleNavigateBack(): Promise<void> {
    const page = await this.getActivePage();
    this.logger.info('Navigating back');
    await page.goBack();
  }

  private async handleWait(inputs: Record<string, any>): Promise<void> {
    const time = inputs.time || 1;
    this.logger.info(`Waiting for ${time} seconds`);
    await new Promise((resolve) => setTimeout(resolve, time * 1000));
  }

  private async parsePointFromInput(inputs: Record<string, any>): Promise<{ x: number; y: number } | null> {
    // Check for point format
    if (inputs.point) {
      return this.calculateRealCoords(inputs.point);
    }

    // Check for box format
    const boxStr = inputs.start_box || inputs.start_coords;
    if (boxStr) {
      const box = this.parseBox(boxStr);
      if (box) {
        return { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 };
      }
    }

    return null;
  }

  private parseBox(boxStr: string): { x1: number; y1: number; x2: number; y2: number } | null {
    const match = boxStr.match(/[\[\(]?\s*([\d.]+)\s*,\s*([\d.]+)\s*[,]?\s*([\d.]+)?\s*[,]?\s*([\d.]+)?\s*[\]\)]?/);
    if (!match) return null;

    const x1 = parseFloat(match[1]);
    const y1 = parseFloat(match[2]);
    const x2 = match[3] ? parseFloat(match[3]) : x1;
    const y2 = match[4] ? parseFloat(match[4]) : y1;

    return { x1, y1, x2, y2 };
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up...');
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
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
        `click(start_box='[x1, y1, x2, y2]') # Click on an element`,
        `left_double(start_box='[x1, y1, x2, y2]') # Double click`,
        `right_single(start_box='[x1, y1, x2, y2]') # Right click`,
        `type(content='text to type') # Type text, use "\\n" at end to submit`,
        `hotkey(key='ctrl c') # Press hotkey combination`,
        `scroll(start_box='[x1, y1, x2, y2]', direction='down') # Scroll direction: up/down/left/right`,
        `navigate(url='https://example.com') # Navigate to URL`,
        `navigate_back() # Go back`,
        `wait() # Wait 5 seconds`,
        `finished() # Task completed`,
        `call_user() # Request user help`,
      ],
      EXAMPLES: [
        `click(start_box='[100, 100, 200, 200]')`,
        `type(content='Hello World\\n')`,
        `navigate(url='https://google.com')`,
      ],
    };
  }
}
