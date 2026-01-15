import * as fs from 'fs';
import * as os from 'os';
import type { PathLock, LockInfo, AcquireOptions } from '../types';

const STALE_TTL_MS = 30_000; // 30 seconds
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 100;

/**
 * File-based path locking using O_EXCL for atomic lock acquisition.
 * Includes 30-second stale detection and retry logic with exponential backoff.
 */
export class NodePathLock implements PathLock {
  /**
   * Acquire a lock with retry logic and exponential backoff.
   *
   * Concurrency behavior:
   * - Uses O_EXCL for atomic lock creation
   * - Retries with exponential backoff on contention (EEXIST)
   * - Automatically removes stale locks (>30s old)
   * - Throws after maxRetries if lock cannot be acquired
   *
   * @throws Error if lock cannot be acquired after retries
   * @throws Error on permission errors (EACCES, EPERM) - no retry
   */
  acquire(lockPath: string, options?: AcquireOptions): void {
    const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    const baseDelay = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        this.tryAcquire(lockPath);
        return;
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;

        // Permission errors should not be retried
        if (error.code === 'EACCES' || error.code === 'EPERM') {
          throw new Error(`Permission denied acquiring lock: ${lockPath}`);
        }

        // Lock exists - check if stale and retry
        if (error.code === 'EEXIST') {
          if (this.isStale(lockPath)) {
            this.forceRelease(lockPath);
            // Continue to retry immediately after clearing stale lock
            continue;
          }

          // Lock is held legitimately - wait and retry
          if (attempt < maxRetries - 1) {
            const delay = baseDelay * Math.pow(2, attempt);
            this.syncSleep(delay);
            continue;
          }
        }

        // Final attempt failed or unknown error
        if (attempt === maxRetries - 1) {
          throw new Error(
            `Failed to acquire lock after ${maxRetries} attempts: ${lockPath}`
          );
        }

        throw err;
      }
    }
  }

  /**
   * Attempt to acquire lock once without retry.
   * @throws Error with code 'EEXIST' if lock is held
   */
  private tryAcquire(lockPath: string): void {
    const lockInfo: LockInfo = {
      acquiredAt: Date.now(),
      pid: process.pid,
      hostname: os.hostname(),
    };

    // O_EXCL ensures atomic creation - fails if file exists
    const fd = fs.openSync(
      lockPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
    );
    fs.writeSync(fd, JSON.stringify(lockInfo));
    fs.closeSync(fd);
  }

  release(lockPath: string): void {
    try {
      fs.unlinkSync(lockPath);
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      // Ignore if file doesn't exist (already released)
      if (error.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  isHeld(lockPath: string): boolean {
    if (!fs.existsSync(lockPath)) {
      return false;
    }
    // Check if lock is stale
    return !this.isStale(lockPath);
  }

  /**
   * Check if a lock file is stale (older than STALE_TTL_MS).
   *
   * Error handling:
   * - ENOENT: Lock doesn't exist, return false (not stale, just gone)
   * - EACCES/EPERM: Permission error, throw - don't assume stale
   * - Parse error: Lock file corrupted, treat as stale
   */
  private isStale(lockPath: string): boolean {
    try {
      const content = fs.readFileSync(lockPath, 'utf-8');
      const info: LockInfo = JSON.parse(content);
      const age = Date.now() - info.acquiredAt;
      return age > STALE_TTL_MS;
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      // File doesn't exist - not stale, just gone
      if (error.code === 'ENOENT') {
        return false;
      }
      // Permission errors should propagate - don't assume stale
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        throw new Error(`Permission denied reading lock: ${lockPath}`);
      }
      // JSON parse error or other read error - treat as corrupted/stale
      return true;
    }
  }

  private forceRelease(lockPath: string): void {
    try {
      fs.unlinkSync(lockPath);
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      // Ignore ENOENT - already gone
      // But propagate permission errors
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        throw new Error(`Permission denied releasing lock: ${lockPath}`);
      }
    }
  }

  /**
   * Synchronous sleep using SharedArrayBuffer and Atomics.wait.
   * This blocks the thread without spinning, suitable for retry delays.
   */
  private syncSleep(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
}
