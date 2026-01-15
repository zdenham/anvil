# Phase 2c: Node Path Lock

## Goal

Implement file-based locking using `O_EXCL` for atomic lock acquisition with 30-second stale detection and retry logic for handling race conditions.

## Prerequisites

- [01-adapter-interfaces.md](./01-adapter-interfaces.md) complete

## Parallel With

- [02a-fs-adapter.md](./02a-fs-adapter.md)
- [02b-git-adapter.md](./02b-git-adapter.md)

## Files to Create

- `core/adapters/node/path-lock.ts`
- `core/adapters/node/path-lock.test.ts`

## Implementation

```typescript
// core/adapters/node/path-lock.ts
import * as fs from 'fs';
import * as os from 'os';
import type { PathLock, LockInfo } from '../types';

const STALE_TTL_MS = 30_000; // 30 seconds
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 100;

export interface AcquireOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

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
      } catch (err: any) {
        // Permission errors should not be retried
        if (err.code === 'EACCES' || err.code === 'EPERM') {
          throw new Error(`Permission denied acquiring lock: ${lockPath}`);
        }

        // Lock exists - check if stale and retry
        if (err.code === 'EEXIST') {
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
          throw new Error(`Failed to acquire lock after ${maxRetries} attempts: ${lockPath}`);
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
    } catch (err: any) {
      // Ignore if file doesn't exist (already released)
      if (err.code !== 'ENOENT') {
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
    } catch (err: any) {
      // File doesn't exist - not stale, just gone
      if (err.code === 'ENOENT') {
        return false;
      }
      // Permission errors should propagate - don't assume stale
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new Error(`Permission denied reading lock: ${lockPath}`);
      }
      // JSON parse error or other read error - treat as corrupted/stale
      return true;
    }
  }

  private forceRelease(lockPath: string): void {
    try {
      fs.unlinkSync(lockPath);
    } catch (err: any) {
      // Ignore ENOENT - already gone
      // But propagate permission errors
      if (err.code === 'EACCES' || err.code === 'EPERM') {
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
```

## Tasks

1. Implement `NodePathLock` class
2. Use `O_EXCL` flag for atomic lock creation
3. Store `{ acquiredAt, pid, hostname }` JSON in lock file
4. Implement 30-second stale detection
5. Implement retry logic with exponential backoff
6. Properly handle permission errors (don't treat as stale)
7. Write comprehensive tests including race conditions

## Lock File Format

```json
{
  "acquiredAt": 1704067200000,
  "pid": 12345,
  "hostname": "my-machine"
}
```

## Concurrency Behavior

### TOCTOU Race Condition Fix

The original implementation had a Time-Of-Check-Time-Of-Use (TOCTOU) race condition:

```
Process A                    Process B
---------                    ---------
Check if stale -> yes
                             Acquire lock (legitimately)
Force release (wrong!)
Acquire lock
```

The fix uses retry logic with exponential backoff:

1. **Attempt to acquire** using `O_EXCL` (atomic)
2. **On EEXIST**, check if stale:
   - If stale: force release and retry immediately
   - If not stale: wait with exponential backoff, then retry
3. **On permission errors** (EACCES, EPERM): fail immediately, don't retry
4. **After max retries**: throw descriptive error

### Exponential Backoff

Default timing (configurable via options):
- Attempt 1: immediate
- Attempt 2: 100ms delay
- Attempt 3: 200ms delay
- (If more retries configured: 400ms, 800ms, etc.)

### Error Handling

| Error Code | Behavior |
|------------|----------|
| EEXIST | Retry with backoff (up to maxRetries) |
| EACCES | Fail immediately (permission denied) |
| EPERM | Fail immediately (permission denied) |
| ENOENT | Treat as success for isStale check |
| Other | Propagate error |

## Test Cases

- Acquire lock successfully
- Fail to acquire already-held lock after retries
- Release lock removes file
- Release non-existent lock (no error)
- isHeld returns true for held lock
- isHeld returns false for stale lock (>30s)
- Stale lock auto-removed on acquire attempt
- Lock file contains valid JSON
- **Retry succeeds when lock released during backoff**
- **Permission errors fail immediately without retry**
- **Exponential backoff timing is correct**
- **Corrupted lock file treated as stale**

## Stale Lock Rationale

30 seconds is chosen because:
- Long enough for slow git operations on large repos
- Short enough to recover from crashed processes quickly
- Balances availability vs. correctness

## Verification

- [ ] All tests pass
- [ ] Class implements PathLock interface
- [ ] O_EXCL provides atomicity
- [ ] Stale locks are correctly detected and removed
- [ ] Retry logic handles TOCTOU race condition
- [ ] Permission errors are not treated as stale locks
- [ ] Exponential backoff prevents thundering herd
