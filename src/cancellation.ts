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
   * 设置按键处理器，监听 ESC 键
   */
  private setupKeyHandler(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      this.rawModeEnabled = true;

      process.stdin.on('data', (chunk: Buffer) => {
        // ESC 键的 ASCII 码是 27 (0x1B)
        // 在某些终端中，ESC 键可能被编码为多字节序列
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
   * 开始一个新的操作
   */
  startOperation(operationId: string): void {
    this.operationId = operationId;
    this.isCancelled = false;
    this.emit('operationStarted', operationId);
  }

  /**
   * 取消当前操作
   */
  cancel(): void {
    if (!this.isCancelled) {
      this.isCancelled = true;
      this.emit('cancelled', this.operationId);
      logger.info(`Operation ${this.operationId} cancelled by user`);
    }
  }

  /**
   * 检查当前操作是否被取消
   */
  isOperationCancelled(): boolean {
    return this.isCancelled;
  }

  /**
   * 完成当前操作
   */
  completeOperation(): void {
    if (this.operationId) {
      this.emit('operationCompleted', this.operationId);
    }
    this.operationId = null;
    this.isCancelled = false;
  }

  /**
   * 获取当前操作 ID
   */
  getCurrentOperationId(): string | null {
    return this.operationId;
  }

  /**
   * 重置取消状态
   */
  reset(): void {
    this.isCancelled = false;
    this.operationId = null;
  }

  /**
   * 清理资源
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
   * 创建一个可取消的 Promise 包装器
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

      // 立即检查是否已取消
      checkCancellation();

      // 监听取消事件
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