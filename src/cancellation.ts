import { EventEmitter } from 'events';
import readline from 'readline';
import { getLogger } from './logger.js';

const logger = getLogger();

export class CancellationManager extends EventEmitter {
  private isCancelled: boolean = false;
  private operationId: string | null = null;
  private keyPressHandler: ((str: string, key: readline.Key) => void) | null = null;
  private sigintHandler: (() => void) | null = null;
  private keyHandlerSetup: boolean = false;

  constructor() {
    super();
  }

  /**
   * Set up key handler to listen for ESC key (public for external use)
   */
  async setupKeyHandler(): Promise<void> {
    return new Promise((resolve) => {
      console.log(`[CancellationManager] setupKeyHandler called`);
      console.log(`[CancellationManager] process.stdin.isTTY: ${process.stdin.isTTY}`);
      console.log(`[CancellationManager] process.env.TERM: ${process.env.TERM}`);
      console.log(`[CancellationManager] process.platform: ${process.platform}`);
      console.log(`[CancellationManager] stdin.resumed: ${(process.stdin as any)._readableState?.flowing}`);
      console.log(`[CancellationManager] keyHandlerSetup: ${this.keyHandlerSetup}`);

      if (this.keyHandlerSetup) {
        resolve();
        return;
      }

      if (process.stdin.isTTY) {
        // Use readline's keypress handling
        readline.emitKeypressEvents(process.stdin);

        // 保存 this 引用
        const self = this;

        this.keyPressHandler = function(str: string, key: readline.Key) {
          // ESC 可以通过 str 为空且 name 为 'escape' 或 sequence 为 '\x1b' 来检测
          if (str === '\u001B' || key.name === 'escape' || key.sequence === '\x1b') {
            console.log(`[ESC-DETECT] ESC pressed! operationId=${self.operationId}, isCancelled=${self.isCancelled}`);
            self.cancel();
          }
        };

        process.stdin.on('keypress', this.keyPressHandler);

        process.stdin.on('error', (error) => {
          logger.error(`Error in stdin handler: ${error}`);
        });

        // Also listen for SIGINT (Ctrl+C)
        this.sigintHandler = () => {
          logger.debug('[CancellationManager] SIGINT received!');
          this.cancel();
        };
        process.on('SIGINT', this.sigintHandler);

        this.keyHandlerSetup = true;
        console.log('[CancellationManager] Key handler setup completed');
        resolve();
      } else {
        console.log('[CancellationManager] stdin is not a TTY, ESC cancellation disabled');
        resolve();
      }
    });
  }

  /**
   * Start a new operation
   */
  async startOperation(operationId: string): Promise<void> {
    this.operationId = operationId;
    this.isCancelled = false;
    this.emit('operationStarted', operationId);

    // 延迟设置 key handler
    await this.setupKeyHandler();
  }

  /**
   * Cancel current operation
   */
  cancel(): void {
    logger.debug(`[CancellationManager] cancel() called: isCancelled=${this.isCancelled}, operationId=${this.operationId}`);
    if (!this.isCancelled) {
      this.isCancelled = true;
      this.emit('cancelled', this.operationId);
      logger.debug(`[CancellationManager] 'cancelled' event emitted for operationId=${this.operationId}`);
    }
  }

  /**
   * Check if current operation is cancelled
   */
  isOperationCancelled(): boolean {
    return this.isCancelled;
  }

  /**
   * Complete current operation
   */
  completeOperation(): void {
    logger.debug(`[CancellationManager] completeOperation: operationId=${this.operationId}, isCancelled=${this.isCancelled}`);
    if (this.operationId) {
      this.emit('operationCompleted', this.operationId);
    }
    this.operationId = null;
    this.isCancelled = false;
  }

  /**
   * Get current operation ID
   */
  getCurrentOperationId(): string | null {
    return this.operationId;
  }

  /**
   * Reset cancellation state
   */
  reset(): void {
    this.isCancelled = false;
    this.operationId = null;
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (process.stdin.isTTY && this.keyPressHandler) {
      process.stdin.removeListener('keypress', this.keyPressHandler);
      this.keyPressHandler = null;
    }
    if (this.sigintHandler) {
      process.off('SIGINT', this.sigintHandler);
      this.sigintHandler = null;
    }
    process.stdin.removeAllListeners('error');
    this.removeAllListeners();
  }

  /**
   * Create a cancellable Promise wrapper
   */
  async withCancellation<T>(
    promise: Promise<T>,
    operationId: string,
    abortController?: AbortController
  ): Promise<T> {
    logger.debug(`[CancellationManager] withCancellation started: ${operationId}, current operationId=${this.operationId}, isCancelled=${this.isCancelled}`);

    await this.startOperation(operationId);

    // Create a promise that can be rejected externally
    let rejectCancellation: ((reason?: any) => void) | null = null;
    const cancelPromise = new Promise((_, reject) => {
      rejectCancellation = reject;
    });

    // Listen for cancellation event
    const onCancelled = (opId: string | null) => {
      logger.debug(`[CancellationManager] 'cancelled' event received: opId=${opId}, expected operationId=${operationId}`);
      if (rejectCancellation) {
        logger.debug(`[CancellationManager] Rejecting promise with "Operation cancelled by user"`);
        rejectCancellation(new Error('Operation cancelled by user'));
      }
      // Also abort the controller to cancel the underlying HTTP request
      if (abortController) {
        abortController.abort();
      }
    };

    this.on('cancelled', onCancelled);

    // Race between the original promise and cancellation
    try {
      const result = await Promise.race([
        promise,
        cancelPromise
      ]);

      this.off('cancelled', onCancelled);
      this.completeOperation();
      logger.debug(`[CancellationManager] Operation completed: ${operationId}`);
      return result as T;
    } catch (error: any) {
      this.off('cancelled', onCancelled);
      if (error.message === 'Operation cancelled by user') {
        this.completeOperation();
        logger.debug(`[CancellationManager] Operation cancelled: ${operationId}`);
      } else {
        this.completeOperation();
      }
      throw error;
    }
  }
}

let cancellationManagerInstance: CancellationManager | null = null;
let initializationPromise: Promise<CancellationManager> | null = null;

export function getCancellationManager(): CancellationManager {
  if (!cancellationManagerInstance) {
    // 创建实例
    cancellationManagerInstance = new CancellationManager();

    // 异步初始化 keyHandler
    if (!initializationPromise) {
      initializationPromise = cancellationManagerInstance.setupKeyHandler()
        .then(() => cancellationManagerInstance!)
        .catch((error) => {
          console.error('[CancellationManager] Failed to setup key handler:', error);
          return cancellationManagerInstance!;
        });
    }
  }
  return cancellationManagerInstance;
}
