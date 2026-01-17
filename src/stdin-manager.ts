/**
 * StdinManager - 最简化的 CLI 输入管理
 * 
 * 每次输入都创建新的 readline，使用后关闭
 * 避免复杂的生命周期管理带来的问题
 */

import readline from 'readline';

let stdinManagerInstance: StdinManager | null = null;

export class StdinManager {
  private constructor() {}

  static getInstance(): StdinManager {
    if (!stdinManagerInstance) {
      stdinManagerInstance = new StdinManager();
    }
    return stdinManagerInstance;
  }

  /**
   * 简单阻塞式输入
   * 每次调用都创建新的 readline，使用后关闭
   */
  async question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
      });

      rl.question(prompt, (answer: string) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  /**
   * 在 inquirer 使用后恢复
   * 实际上不需要做任何事，因为每次 question() 都是新的 rl
   */
  restoreAfterInquirer(): void {
    // 无需操作
  }

  /**
   * 关闭（保留接口兼容性）
   */
  close(): void {
    // 无需操作
  }
}

export function getStdinManager(): StdinManager {
  return StdinManager.getInstance();
}