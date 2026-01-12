/**
 * Utility functions for gui-subagent
 */

/**
 * Sleep for a specified duration
 * @param ms - Duration in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simple async retry utility with bail support
 * @param fn - Async function to retry (receives a bail function as first argument)
 * @param options - Retry options
 */
export async function asyncRetry<T>(
  fn: (bail: (error: Error) => void) => Promise<T>,
  options: {
    retries?: number;
    minTimeout?: number;
    onRetry?: (e: Error) => void;
  } = {}
): Promise<T> {
  const { retries = 3, minTimeout = 1000, onRetry } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let bailCalled = false;
      const bail = (error: Error) => {
        bailCalled = true;
        throw error;
      };
      const result = await fn(bail);
      if (bailCalled) {
        throw lastError;
      }
      return result;
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        onRetry?.(lastError);
        await sleep(minTimeout * Math.pow(2, attempt));
      }
    }
  }

  throw lastError;
}
