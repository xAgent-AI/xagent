/**
 * Base Operator for gui-subagent
 * Abstract base class for browser/desktop automation operators
 * Based on UI-TARS architecture (@ui-tars/sdk/core)
 *
 * This implementation is aligned with @ui-tars/sdk/core.ts Operator class
 */

import type {
  ScreenContext,
  ScreenshotOutput,
  ExecuteParams,
  ExecuteOutput,
} from '../types/operator.js';

/**
 * Operator manual configuration for AI agents
 * Aligned with @ui-tars/sdk/core.ts Operator.MANUAL
 */
export interface OperatorManual {
  ACTION_SPACES: string[];
  KEY_SPACE?: {
    [key: string]: string;
  };
  KEY_DESCRIPTION?: {
    [key: string]: string;
  };
}

/**
 * Abstract base Operator class
 * Provides common functionality for all operators (browser, computer, etc.)
 */
export abstract class Operator {
  protected _initialized = false;
  protected _initializing = false;
  protected _initPromise: Promise<void> | null = null;

  constructor() {}

  /**
   * Static manual configuration for AI agents
   * Override this in subclasses to provide custom action spaces
   */
  static get MANUAL(): OperatorManual {
    return {
      ACTION_SPACES: [
        `click(start_box='[x1, y1, x2, y2]')`,
        `left_double(start_box='[x1, y1, x2, y2]')`,
        `right_single(start_box='[x1, y1, x2, y2]')`,
        `drag(start_box='[x1, y1, x2, y2]', end_box='[x3, y3, x4, y4]')`,
        `hotkey(key='')`,
        `type(content='')`,
        `scroll(start_box='[x1, y1, x2, y2]', direction='down or up or right or left')`,
        `wait()`,
        `finished()`,
        `call_user()`,
      ],
    };
  }

  /**
   * Get manual configuration from instance
   */
  protected get manual(): OperatorManual {
    return (this.constructor as typeof Operator).MANUAL;
  }

  /**
   * Initialize the operator
   * Must be called before any other operations
   */
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

  /**
   * Internal initialize method - implement in subclass
   */
  protected abstract initialize(): Promise<void>;

  /**
   * Ensure operator is initialized
   */
  protected async ensureInitialized(): Promise<void> {
    if (!this._initialized && !this._initializing) {
      await this.doInitialize();
    } else if (this._initializing && this._initPromise) {
      await this._initPromise;
    }
  }

  /**
   * Get supported action types
   */
  abstract getSupportedActions(): string[];

  /**
   * Get screen context (width, height, scaleFactor)
   */
  async getScreenContext(): Promise<ScreenContext> {
    await this.ensureInitialized();
    return this.screenContext();
  }

  /**
   * Internal screen context - implement in subclass
   */
  protected abstract screenContext(): ScreenContext;

  /**
   * Take a screenshot
   * Returns base64 encoded image
   */
  async doScreenshot(): Promise<ScreenshotOutput> {
    try {
      await this.ensureInitialized();
      return await this.screenshot();
    } catch (error) {
      return {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Internal screenshot method - implement in subclass
   */
  protected abstract screenshot(): Promise<ScreenshotOutput>;

  /**
   * Execute an action based on parsed prediction
   * Aligned with @ui-tars/sdk/core.ts Operator.execute()
   */
  async doExecute(params: ExecuteParams): Promise<ExecuteOutput> {
    try {
      await this.ensureInitialized();
      return await this.execute(params);
    } catch (error) {
      return {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Internal execute method - implement in subclass
   */
  protected abstract execute(params: ExecuteParams): Promise<ExecuteOutput>;

  /**
   * Cleanup resources
   */
  abstract cleanup(): Promise<void>;

  /**
   * Destroy operator instance
   */
  abstract destroyInstance(): Promise<void>;

  /**
   * Check if operator is initialized
   */
  isInitialized(): boolean {
    return this._initialized;
  }
}

/**
 * Parse box string to screen coordinates
 * Aligned with @ui-tars/sdk/core.ts parseBoxToScreenCoords()
 */
export function parseBoxToScreenCoords(params: {
  boxStr: string;
  screenWidth: number;
  screenHeight: number;
}): { x: number; y: number } {
  const { boxStr, screenWidth, screenHeight } = params;

  if (!boxStr) {
    return { x: 0, y: 0 };
  }

  // Support multiple formats:
  // [x1, y1, x2, y2], (x1,y1,x2,y2), "[x1, y1, x2, y2]", etc.
  const numbers = boxStr
    .replace(/[()[\]]/g, '')
    .split(',')
    .filter((n) => n.trim())
    .map((n) => parseFloat(n.trim()));

  if (numbers.length < 2) {
    return { x: 0, y: 0 };
  }

  // Calculate center of the box
  const x1 = numbers[0];
  const y1 = numbers[1];
  const x2 = numbers.length > 2 ? numbers[2] : x1;
  const y2 = numbers.length > 3 ? numbers[3] : y1;

  // Normalize to screen coordinates (0-1 range then multiply by screen size)
  let normalizedX: number;
  let normalizedY: number;

  if (x1 >= 0 && x1 <= 1 && y1 >= 0 && y1 <= 1) {
    // Already normalized coordinates
    normalizedX = (x1 + x2) / 2;
    normalizedY = (y1 + y2) / 2;
  } else if (x1 > 1 || y1 > 1) {
    // Absolute pixel coordinates
    normalizedX = x1 / screenWidth;
    normalizedY = y1 / screenHeight;
  } else {
    // Normalized 0-1 with single value
    normalizedX = x1;
    normalizedY = y1;
  }

  return {
    x: Math.round(normalizedX * screenWidth),
    y: Math.round(normalizedY * screenHeight),
  };
}