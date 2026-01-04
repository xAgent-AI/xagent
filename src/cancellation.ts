import { EventEmitter } from 'events';
import { getLogger } from './logger.js';

const logger = getLogger();

export class CancellationManager extends EventEmitter {
  private isCancelled: boolean = false;
  private operationId: string | null = null;
  private rawModeEnabled: boolean = false;

  constructor() {
    super();
    this.setupKeyHandler();
  }

  /**
   * Set up key handler to listen for ESC key
   */
  private setupKeyHandler(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      this.rawModeEnabled = true;

      process.stdin.on('data', (chunk: Buffer) => {
        // ESC key ASCII code is 27 (0x1B)
        // In some terminals, ESC key may be encoded as multi-byte sequence
        const key = chunk.toString('utf8');

        if (key === '\u001B' || key.charCodeAt(0) === 27) {
          this.cancel();
        }
      });

      process.stdin.on('error', (error) => {
        logger.error(`Error in stdin handler: ${error}`);
      });
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
      logger.info(`Operation ${this.operationId} cancelled by user`);
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
    if (this.rawModeEnabled && process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      this.rawModeEnabled = false;
    }
    process.stdin.removeAllListeners('data');
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
    this.startOperation(operationId);

    return new Promise((resolve, reject) => {
      const checkCancellation = () => {
        if (this.isOperationCancelled()) {
          this.completeOperation();
          reject(new Error('Operation cancelled by user'));
        }
      };

      // Check immediately if already cancelled
      checkCancellation();

      // Listen for cancellation event
      const onCancelled = () => {
        this.completeOperation();
        reject(new Error('Operation cancelled by user'));
      };

      this.once('cancelled', onCancelled);

      promise
        .then((result) => {
          this.off('cancelled', onCancelled);
          this.completeOperation();
          resolve(result);
        })
        .catch((error) => {
          this.off('cancelled', onCancelled);
          this.completeOperation();
          reject(error);
        });
    });
  }
}

let cancellationManagerInstance: CancellationManager | null = null;

export function getCancellationManager(): CancellationManager {
  if (!cancellationManagerInstance) {
    cancellationManagerInstance = new CancellationManager();
  }
  return cancellationManagerInstance;
}