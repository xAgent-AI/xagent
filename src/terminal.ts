/**
 * Terminal stdin handling utilities
 * Ensures proper raw mode handling after external library interactions
 */

import readline from 'readline';
import { getLogger } from './logger.js';

const logger = getLogger();

/**
 * Ensure stdin is in raw mode for proper input handling
 * This should be called before any readline.question() call
 * or after any external library (like @clack/prompts) interacts with stdin
 */
export function ensureStdinRawMode(): void {
  if (process.stdin.isTTY) {
    // Disable raw mode first to ensure clean state (handles case after @clack/prompts usage)
    process.stdin.setRawMode(false);
    // Then enable raw mode for proper input handling
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }
}

/**
 * Ensure TTY is in a sane state for input
 * This should be called before each interactive prompt cycle
 */
export function ensureTtySane(): void {
  if (!process.stdin.isTTY) {
    return;
  }

  // Ensure readline events are emitted for keypress handling
  try {
    readline.emitKeypressEvents(process.stdin);
  } catch {
    // Already emitted, ignore
  }

  // Ensure stdin is in raw mode
  ensureStdinRawMode();
}

/**
 * Restore stdin to normal (canonical) mode
 * Use this before launching external processes or tools that need normal terminal behavior
 */
export function disableStdinRawMode(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
}

/**
 * Setup ESC key handling for cancellation
 * Should be called once at the start of interactive session
 */
export function setupEscKeyHandler(
  onEsc: () => void,
  options?: { allowCtrlC?: boolean }
): () => void {
  if (!process.stdin.isTTY) {
    logger.debug('[terminal] stdin is not a TTY, ESC cancellation disabled');
    return () => {};
  }

  const keyPressHandler = (str: string, key: readline.Key) => {
    logger.debug(`[terminal] Key pressed: str='${str}', name='${key.name}'`);
    if (str === '\u001B' || key.name === 'escape') {
      logger.debug('[terminal] ESC key detected!');
      onEsc();
    }
  };

  process.stdin.on('keypress', keyPressHandler);

  // Setup SIGINT handler if allowed
  const sigintHandler = () => {
    logger.debug('[terminal] SIGINT received!');
    onEsc();
  };

  if (options?.allowCtrlC !== false) {
    process.on('SIGINT', sigintHandler);
  }

  // Return cleanup function
  return () => {
    process.stdin.removeListener('keypress', keyPressHandler);
    if (options?.allowCtrlC !== false) {
      process.off('SIGINT', sigintHandler);
    }
  };
}
