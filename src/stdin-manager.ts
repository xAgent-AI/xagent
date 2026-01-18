/**
 * StdinManager - Minimalist CLI input management
 * 
 * Create new readline for each input，使用后关闭
 * Avoid complex lifecycle management带来的问题
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
   * Simple blocking input
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
   * Restore after inquirer usage
   * Actually no need to do anything，因为每次 question() 都是新的 rl
   */
  restoreAfterInquirer(): void {
    // No operation needed
  }

  /**
   * Close (keep interface compatibility)
   */
  close(): void {
    // No operation needed
  }
}

export function getStdinManager(): StdinManager {
  return StdinManager.getInstance();
}