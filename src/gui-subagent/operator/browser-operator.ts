/**
 * Browser Operator using Puppeteer
 * Provides browser automation capabilities for gui-subagent
 */

import puppeteer, { type Browser, type Page, type LaunchOptions } from 'puppeteer';
import { 
  type OperatorConfig, 
  type ScreenContext, 
  type ScreenshotOutput, 
  type ExecuteParams, 
  type ExecuteOutput 
} from '../types/operator.js';
import { 
  type Coordinates, 
  type GUIAction, 
  type SupportedActionType 
} from '../types/actions.js';
import { Operator } from './base-operator.js';

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
        screenWidth: this.config.viewport?.width || 1280,
        screenHeight: this.config.viewport?.height || 800,
        scaleX: this.config.deviceScaleFactor || 1,
        scaleY: this.config.deviceScaleFactor || 1,
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
    const { actions } = params;

    for (const action of actions) {
      await this.executeAction(action);
    }

    return { status: 'success' };
  }

  private async executeAction(action: GUIAction): Promise<void> {
    const { type, inputs } = action;

    switch (type) {
      case 'click':
        await this.handleClick(inputs);
        break;
      case 'double_click':
        await this.handleDoubleClick(inputs);
        break;
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
        this.logger.warn(`Unsupported action: ${type}`);
    }
  }

  private async getActivePage(): Promise<Page> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }
    return this.page;
  }

  private async calculateRealCoords(coords: Coordinates): Promise<{ realX: number; realY: number }> {
    if (!coords.normalized) {
      if (!coords.raw) {
        throw new Error('Invalid coordinates');
      }
      return { realX: coords.raw.x, realY: coords.raw.y };
    }

    const ctx = this.screenCtx;
    if (!ctx) {
      throw new Error('Screen context not initialized');
    }

    return {
      realX: coords.normalized.x * ctx.screenWidth,
      realY: coords.normalized.y * ctx.screenHeight,
    };
  }

  private async handleClick(inputs: Record<string, any>): Promise<void> {
    if (!inputs.point) {
      throw new Error('Missing point for click');
    }

    const page = await this.getActivePage();
    const { realX, realY } = await this.calculateRealCoords(inputs.point);

    this.logger.info(`Clicking at (${realX}, ${realY})`);
    await page.mouse.move(realX, realY);
    await page.mouse.click(realX, realY);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  private async handleDoubleClick(inputs: Record<string, any>): Promise<void> {
    if (!inputs.point) {
      throw new Error('Missing point for double click');
    }

    const page = await this.getActivePage();
    const { realX, realY } = await this.calculateRealCoords(inputs.point);

    this.logger.info(`Double clicking at (${realX}, ${realY})`);
    await page.mouse.move(realX, realY);
    await page.mouse.click(realX, realY, { clickCount: 2 });
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  private async handleRightClick(inputs: Record<string, any>): Promise<void> {
    if (!inputs.point) {
      throw new Error('Missing point for right click');
    }

    const page = await this.getActivePage();
    const { realX, realY } = await this.calculateRealCoords(inputs.point);

    this.logger.info(`Right clicking at (${realX}, ${realY})`);
    await page.mouse.move(realX, realY);
    await page.mouse.click(realX, realY, { button: 'right' });
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  private async handleType(inputs: Record<string, any>): Promise<void> {
    const page = await this.getActivePage();
    const content = inputs.content;

    if (!content) {
      this.logger.warn('No content to type');
      return;
    }

    this.logger.info(`Typing: ${content}`);
    await page.keyboard.type(content, { delay: 50 });
  }

  private async handleHotkey(inputs: Record<string, any>): Promise<void> {
    const page = await this.getActivePage();
    const key = inputs.key;

    if (!key) {
      throw new Error('No hotkey specified');
    }

    this.logger.info(`Pressing hotkey: ${key}`);
    const keys = key.toLowerCase().split('+');
    
    for (const k of keys) {
      await page.keyboard.down(k);
    }
    
    for (let i = keys.length - 1; i >= 0; i--) {
      await page.keyboard.up(keys[i]);
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
      ? (direction === 'up' || direction === 'down' ? ctx.screenHeight * 0.8 : ctx.screenWidth * 0.8)
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
    await new Promise(resolve => setTimeout(resolve, time * 1000));
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
}
