import { EventEmitter } from 'events';
import { getLogger } from './logger.js';

const logger = getLogger();

export class CancellationManager extends EventEmitter {
  private isCancelled: boolean = false;
  private operationId: string | null = null;

  constructor() {
    super();
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