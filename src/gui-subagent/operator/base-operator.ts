/**
 * Base Operator for gui-subagent
 * Abstract base class for browser/desktop automation operators
 * Based on UI-TARS architecture
 */

import type {
  ScreenContext,
  ScreenshotOutput,
  ExecuteParams,
  ExecuteOutput,
  SupportedActionType,
  PredictionParsed,
} from '../types/operator.js';

export abstract class BaseOperator {
  abstract doScreenshot(params?: unknown): Promise<unknown>;
  abstract doExecute(params: unknown): Promise<unknown>;
}

/**
 * Operator manual configuration for AI agents
 */
export interface OperatorManual {
  ACTION_SPACES: string[];
  EXAMPLES?: string[];
}

export abstract class Operator extends BaseOperator {
  protected _initialized = false;
  protected _initializing = false;
  protected _initPromise: Promise<void> | null = null;

  constructor() {
    super();
  }

  /**
   * Static manual configuration for AI agents
   */
  static get MANUAL(): OperatorManual {
    return {
      ACTION_SPACES: [
        `click(start_box='[x1, y1, x2, y2]')`,
        `left_double(start_box='[x1, y1, x2, y2]')`,
        `right_single(start_box='[x1, y1, x2, y2]')`,
        `drag(start_box='[x1, y1, x2, y2]', end_box='[x3, y3, x4, y4]')`,
        `hotkey(key='')`,
        `type(content='') # Use "\\n" at the end to submit`,
        `scroll(start_box='[x1, y1, x2, y2]', direction='down or up or right or left')`,
        `wait() # Sleep for 5s and take a screenshot`,
        `finished()`,
        `call_user() # Request user help for unsolvable tasks`,
      ],
    };
  }

  async doInitialize(): Promise<void> {
    if (this._initialized) {
      return;
    }

    if (this._initializing && this._initPromise) {
      return this._initPromise;
    }

    this._initializing = true;
    const initPromise = (async () => {
      try {
        await this.initialize();
        this._initialized = true;
      } finally {
        this._initializing = false;
      }
    })();

    this._initPromise = initPromise;
    return initPromise;
  }

  protected abstract initialize(): Promise<void>;

  protected async ensureInitialized(): Promise<void> {
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

  /**
   * Execute a single parsed prediction (UI-TARS style)
   */
  async executePrediction(prediction: PredictionParsed): Promise<ExecuteOutput> {
    return this.doExecute({
      prediction: '',
      parsedPrediction: prediction,
      screenWidth: 0,
      screenHeight: 0,
      scaleFactor: 1,
      factors: [1, 1],
    });
  }
}
