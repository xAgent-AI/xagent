/**
 * Base Operator for gui-subagent
 * Abstract base class for browser/desktop automation operators
 */

import type { 
  ScreenContext, 
  ScreenshotOutput, 
  ExecuteParams, 
  ExecuteOutput, 
  SupportedActionType 
} from '../types/operator.js';
import type { GUIAction } from '../types/actions.js';

export abstract class BaseOperator {
  abstract doScreenshot(params?: unknown): Promise<unknown>;
  abstract doExecute(params: unknown): Promise<unknown>;
}

export abstract class Operator extends BaseOperator {
  private _initialized = false;
  private _initializing = false;
  private _initPromise: Promise<void> | null = null;

  constructor() {
    super();
  }

  async doInitialize(): Promise<void> {
    if (this._initialized) {
      return;
    }

    if (this._initializing && this._initPromise) {
      return this._initPromise;
    }

    this._initializing = true;
    this._initPromise = (async () => {
      try {
        await this.initialize();
        this._initialized = true;
      } finally {
        this._initializing = false;
      }
    })();

    return this._initPromise;
  }

  protected abstract initialize(): Promise<void>;

  private async ensureInitialized(): Promise<void> {
    if (!this._initialized && !this._initializing) {
      await this.doInitialize();
    } else if (this._initializing && this._initPromise) {
      await this._initPromise;
    }
  }

  getSupportedActions(): SupportedActionType[] {
    return this.supportedActions();
  }

  protected abstract supportedActions(): SupportedActionType[];

  async getScreenContext(): Promise<ScreenContext> {
    await this.ensureInitialized();
    return this.screenContext();
  }

  protected abstract screenContext(): ScreenContext;

  async doScreenshot(): Promise<ScreenshotOutput> {
    try {
      await this.ensureInitialized();
      return await this.screenshot();
    } catch (error) {
      return {
        base64: '',
        status: 'failed',
        errorMessage: (error as Error).message,
      };
    }
  }

  protected abstract screenshot(): Promise<ScreenshotOutput>;

  async doExecute(params: ExecuteParams): Promise<ExecuteOutput> {
    try {
      await this.ensureInitialized();
      return await this.execute(params);
    } catch (error) {
      return {
        status: 'failed',
        errorMessage: (error as Error).message,
      };
    }
  }

  protected abstract execute(params: ExecuteParams): Promise<ExecuteOutput>;

  abstract cleanup(): Promise<void>;
  abstract destroyInstance(): Promise<void>;
}
