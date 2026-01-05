import { EventEmitter } from 'events';
import readline from 'readline';
import { getLogger } from './logger.js';

const logger = getLogger();

export class CancellationManager extends EventEmitter {
  private isCancelled: boolean = false;
  private operationId: string | null = null;
  private keyPressHandler: ((str: string, key: readline.Key) => void) | null = null;

  constructor() {
    super();
    this.setupKeyHandler();
  }

  /**
   * Set up key handler to listen for ESC key
   * Using readline's emitKeypressEvents instead of rawMode to avoid conflicts with readline.question()
   */
  private setupKeyHandler(): void {
    if (process.stdin.isTTY) {
      // Use readline's built-in keypress handling which is compatible with line mode
      readline.emitKeypressEvents(process.stdin);

      this.keyPressHandler = (str: string, key: readline.Key) => {
        // ESC key detection - only handle ESC, let SIGINT handle Ctrl+C
        if (str === '\u001B' || key.name === 'escape') {
          this.cancel();
        }
      };

      process.stdin.on('keypress', this.keyPressHandler);

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