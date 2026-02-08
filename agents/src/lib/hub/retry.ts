export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 10,
  baseDelayMs: 100,
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < options.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err as Error;
      if (attempt < options.maxRetries - 1) {
        const delay = options.baseDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `Operation failed after ${options.maxRetries} attempts: ${lastError?.message}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
