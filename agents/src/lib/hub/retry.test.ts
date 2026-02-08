import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, DEFAULT_RETRY_OPTIONS } from "./retry.js";

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on first success", async () => {
    const operation = vi.fn().mockResolvedValue("success");
    const result = await withRetry(operation);
    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries on failure with exponential backoff", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const promise = withRetry(operation, { maxRetries: 5, baseDelayMs: 100 });

    // First attempt fails immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(operation).toHaveBeenCalledTimes(1);

    // Wait for first backoff (100ms)
    await vi.advanceTimersByTimeAsync(100);
    expect(operation).toHaveBeenCalledTimes(2);

    // Wait for second backoff (200ms)
    await vi.advanceTimersByTimeAsync(200);
    expect(operation).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect(result).toBe("success");
  });

  it("throws after max retries exhausted", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("always fails"));

    // Start the retry operation and immediately attach the catch handler to prevent unhandled rejection
    const promise = withRetry(operation, { maxRetries: 3, baseDelayMs: 10 });

    // Immediately catch to prevent unhandled rejection warning, then re-throw for expect
    const catchingPromise = promise.catch((e) => e);

    // Advance through all retries
    await vi.runAllTimersAsync();

    const error = await catchingPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Operation failed after 3 attempts: always fails");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("uses default options when none provided", async () => {
    expect(DEFAULT_RETRY_OPTIONS.maxRetries).toBe(10);
    expect(DEFAULT_RETRY_OPTIONS.baseDelayMs).toBe(100);
  });
});
