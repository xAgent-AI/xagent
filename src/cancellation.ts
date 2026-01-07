import { EventEmitter } from 'events';
import readline from 'readline';
import { getLogger } from './logger.js';

const logger = getLogger();

export class CancellationManager extends EventEmitter {
  private isCancelled: boolean = false;
  private operationId: string | null = null;
  private keyPressHandler: ((str: string, key: readline.Key) => void) | null = null;
  private sigintHandler: (() => void) | null = null;

  constructor() {
    super();
    this.setupKeyHandler();
  }

  /**
   * Set up key handler to listen for ESC key
   */
  private setupKeyHandler(): void {
    if (process.stdin.isTTY) {
      // Use readline's keypress handling
      readline.emitKeypressEvents(process.stdin);

      this.keyPressHandler = (str: string, key: readline.Key) => {
        logger.debug(`[CancellationManager] Key pressed: str='${str}', name='${key.name}'`);
        if (str === '\u001B' || key.name === 'escape') {
          logger.debug(`[CancellationManager] ESC key detected!`);
          this.cancel();
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
    } else {
      logger.debug('[CancellationManager] stdin is not a TTY, ESC cancellation disabled');
    }
  }

  /**
   * Start a new operation
   */
  startOperation(operationId: string): void {
    this.operationId = operationId;
    this.isCancelled = false;
    this.emit('operationStarted', operationId);
  }

  /**
   * Cancel current operation
   */
  cancel(): void {
    if (!this.isCancelled) {
      this.isCancelled = true;
      this.emit('cancelled', this.operationId);
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
    operationId: string
  ): Promise<T> {
    logger.debug(`[CancellationManager] withCancellation started: ${operationId}`);
    this.startOperation(operationId);

    // Create a promise that can be rejected externally
    let rejectCancellation: ((reason?: any) => void) | null = null;
    const cancelPromise = new Promise((_, reject) => {
      rejectCancellation = reject;
    });

    // Listen for cancellation event
    const onCancelled = () => {
      logger.debug(`[CancellationManager] 'cancelled' event received: ${operationId}`);
      if (rejectCancellation) {
        rejectCancellation(new Error('Operation cancelled by user'));
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

export function getCancellationManager(): CancellationManager {
  if (!cancellationManagerInstance) {
    cancellationManagerInstance = new CancellationManager();
  }
  return cancellationManagerInstance;
}