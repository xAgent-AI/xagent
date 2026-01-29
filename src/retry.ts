/**
 * Retry utility with exponential backoff and jitter
 */

export interface RetryConfig {
  maxRetries: number;           // Maximum number of retry attempts (default: 3)
  baseDelay: number;            // Base delay in ms (default: 1000)
  maxDelay: number;             // Maximum delay in ms (default: 10000)
  maxTotalTime: number;         // Maximum total time in ms (default: 600000 = 10min)
  jitter: boolean;              // Add random jitter to delay (default: true)
  retryOnTimeout: boolean;      // Retry on timeout errors (default: true)
  retryOn5xx: boolean;          // Retry on 5xx server errors (default: true)
  retryOn429: boolean;          // Retry on 429 rate limit (default: true)
  backoffMultiplier: number;    // Delay multiplier for each retry (default: 2)
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalTime: number;
  lastError?: Error;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  maxTotalTime: 600000,
  jitter: true,
  retryOnTimeout: true,
  retryOn5xx: true,
  retryOn429: true,
  backoffMultiplier: 2
};

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown, config: RetryConfig): boolean {
  // Extract status code from different error formats
  let statusCode: number | undefined;

  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;

    // axios error format
    if (err.response && typeof err.response === 'object') {
      const response = err.response as Record<string, unknown>;
      statusCode = response.status as number | undefined;
    }
    // Direct status code
    else if (err.statusCode) {
      statusCode = err.statusCode as number;
    }
    else if (err.status) {
      statusCode = err.status as number;
    }
  }

  // Check error message for timeout
  const errorMessage = error instanceof Error ? error.message : String(error);
  const isTimeout = errorMessage.includes('timeout') || 
                    errorMessage.includes('Timeout') ||
                    errorMessage.includes('No response received');

  // Check if should retry based on status code
  if (statusCode !== undefined) {
    // Retry on 429 (rate limit) and 5xx (server errors)
    if (statusCode === 429 && config.retryOn429) return true;
    if (statusCode >= 500 && statusCode < 600 && config.retryOn5xx) return true;
    return false;
  }

  // Retry on timeout
  if (isTimeout && config.retryOnTimeout) return true;

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt);
  const delay = Math.min(exponentialDelay, config.maxDelay);

  // Add jitter (0.5 to 1.5 of the delay)
  if (config.jitter) {
    const jitterFactor = 0.5 + Math.random();
    return Math.floor(delay * jitterFactor);
  }

  return delay;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if total time exceeds maximum allowed
 */
function wouldExceedTotalTime(
  startTime: number,
  attempt: number,
  delay: number,
  config: RetryConfig
): boolean {
  const elapsed = Date.now() - startTime;
  const remaining = config.maxTotalTime - elapsed;
  return remaining <= delay;
}

/**
 * Execute a function with retry logic
 * 
 * @param fn - The async function to execute
 * @param config - Retry configuration (optional)
 * @returns RetryResult containing success status and data/error
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>
): Promise<RetryResult<T>> {
  const mergedConfig: RetryConfig = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= mergedConfig.maxRetries; attempt++) {
    const attemptStartTime = Date.now();

    try {
      const data = await fn();
      
      return {
        success: true,
        data,
        attempts: attempt + 1,
        totalTime: Date.now() - startTime
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this error is retryable
      if (!isRetryableError(error, mergedConfig)) {
        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
          totalTime: Date.now() - startTime,
          lastError
        };
      }

      // Check if we've exceeded maximum total time
      if (Date.now() - startTime >= mergedConfig.maxTotalTime) {
        return {
          success: false,
          error: new Error(`Max total time exceeded after ${attempt + 1} attempts`),
          attempts: attempt + 1,
          totalTime: Date.now() - startTime,
          lastError
        };
      }

      // Calculate delay for next retry
      const delay = calculateDelay(attempt, mergedConfig);

      // Check if next retry would exceed max total time
      if (wouldExceedTotalTime(startTime, attempt, delay, mergedConfig)) {
        return {
          success: false,
          error: new Error(`Would exceed max total time`),
          attempts: attempt + 1,
          totalTime: Date.now() - startTime,
          lastError
        };
      }

      // Wait before next retry (don't wait after last attempt)
      if (attempt < mergedConfig.maxRetries) {
        await sleep(delay);
      }
    }
  }

  // Should not reach here, but just in case
  return {
    success: false,
    error: lastError || new Error('Unknown error'),
    attempts: mergedConfig.maxRetries + 1,
    totalTime: Date.now() - startTime,
    lastError
  };
}

/**
 * Create a retryable version of a function
 */
export function createRetryable<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  config?: Partial<RetryConfig>
): T {
  return ((...args: Parameters<T>) => {
    return withRetry(() => fn(...args), config).then(result => {
      if (result.success) {
        return result.data;
      }
      throw result.error;
    });
  }) as T;
}
