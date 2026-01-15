import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NodePathLock } from './path-lock';
import type { LockInfo } from '../types';

describe('NodePathLock', () => {
  let lock: NodePathLock;
  let tempDir: string;
  let lockPath: string;

  beforeEach(() => {
    lock = new NodePathLock();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-lock-test-'));
    lockPath = path.join(tempDir, 'test.lock');
  });

  afterEach(() => {
    // Clean up lock file if it exists
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Ignore errors
    }
    // Clean up temp directory
    try {
      fs.rmdirSync(tempDir);
    } catch {
      // Ignore errors
    }
  });

  describe('acquire', () => {
    it('should acquire lock successfully', () => {
      lock.acquire(lockPath);

      expect(fs.existsSync(lockPath)).toBe(true);
    });

    it('should write valid JSON lock info to file', () => {
      lock.acquire(lockPath);

      const content = fs.readFileSync(lockPath, 'utf-8');
      const info: LockInfo = JSON.parse(content);

      expect(info).toHaveProperty('acquiredAt');
      expect(info).toHaveProperty('pid');
      expect(info).toHaveProperty('hostname');
      expect(typeof info.acquiredAt).toBe('number');
      expect(info.pid).toBe(process.pid);
      expect(info.hostname).toBe(os.hostname());
    });

    it('should fail to acquire already-held lock after retries', () => {
      // Acquire the lock first
      lock.acquire(lockPath);

      // Attempting to acquire again should fail
      expect(() => {
        lock.acquire(lockPath, { maxRetries: 2, retryDelayMs: 10 });
      }).toThrow(/Failed to acquire lock after 2 attempts/);
    });

    it('should use exponential backoff between retries', () => {
      // Acquire the lock first
      lock.acquire(lockPath);

      const startTime = Date.now();

      // Try to acquire with specific retry config
      expect(() => {
        lock.acquire(lockPath, { maxRetries: 3, retryDelayMs: 50 });
      }).toThrow(/Failed to acquire lock after 3 attempts/);

      const elapsed = Date.now() - startTime;

      // Should have waited approximately: 50ms (attempt 0->1) + 100ms (attempt 1->2) = 150ms
      // Allow some tolerance for timing
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });
  });

  describe('release', () => {
    it('should release lock and remove file', () => {
      lock.acquire(lockPath);
      expect(fs.existsSync(lockPath)).toBe(true);

      lock.release(lockPath);
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('should not throw when releasing non-existent lock', () => {
      expect(() => {
        lock.release(lockPath);
      }).not.toThrow();
    });
  });

  describe('isHeld', () => {
    it('should return true for held lock', () => {
      lock.acquire(lockPath);

      expect(lock.isHeld(lockPath)).toBe(true);
    });

    it('should return false for non-existent lock', () => {
      expect(lock.isHeld(lockPath)).toBe(false);
    });

    it('should return false for stale lock (>30s)', () => {
      // Create a stale lock file directly
      const staleInfo: LockInfo = {
        acquiredAt: Date.now() - 31_000, // 31 seconds ago
        pid: 99999,
        hostname: 'old-host',
      };
      fs.writeFileSync(lockPath, JSON.stringify(staleInfo));

      expect(lock.isHeld(lockPath)).toBe(false);
    });

    it('should return true for fresh lock (<30s)', () => {
      // Create a fresh lock file directly
      const freshInfo: LockInfo = {
        acquiredAt: Date.now() - 10_000, // 10 seconds ago
        pid: 99999,
        hostname: 'other-host',
      };
      fs.writeFileSync(lockPath, JSON.stringify(freshInfo));

      expect(lock.isHeld(lockPath)).toBe(true);
    });
  });

  describe('stale lock detection', () => {
    it('should auto-remove stale lock on acquire attempt', () => {
      // Create a stale lock file
      const staleInfo: LockInfo = {
        acquiredAt: Date.now() - 31_000, // 31 seconds ago
        pid: 99999,
        hostname: 'old-host',
      };
      fs.writeFileSync(lockPath, JSON.stringify(staleInfo));

      // Should be able to acquire despite existing file
      lock.acquire(lockPath);

      // Verify new lock info is written
      const content = fs.readFileSync(lockPath, 'utf-8');
      const info: LockInfo = JSON.parse(content);
      expect(info.pid).toBe(process.pid);
      expect(info.hostname).toBe(os.hostname());
    });

    it('should treat corrupted lock file as stale', () => {
      // Write invalid JSON to lock file
      fs.writeFileSync(lockPath, 'not valid json {{{');

      // Should be able to acquire - corrupted file treated as stale
      lock.acquire(lockPath);

      // Verify valid lock info is now written
      const content = fs.readFileSync(lockPath, 'utf-8');
      const info: LockInfo = JSON.parse(content);
      expect(info.pid).toBe(process.pid);
    });
  });

  describe('retry logic', () => {
    it('should succeed when stale lock is cleared during retry', () => {
      // Create a stale lock file (simulating another process that held the lock
      // but the lock became stale during our retry attempts)
      const staleInfo: LockInfo = {
        acquiredAt: Date.now() - 31_000, // 31 seconds ago - stale
        pid: 99999,
        hostname: 'old-host',
      };
      fs.writeFileSync(lockPath, JSON.stringify(staleInfo));

      // Should succeed because stale lock is detected and removed
      const lock2 = new NodePathLock();
      expect(() => {
        lock2.acquire(lockPath, { maxRetries: 3, retryDelayMs: 10 });
      }).not.toThrow();

      // Verify lock2 now holds the lock
      const content = fs.readFileSync(lockPath, 'utf-8');
      const info: LockInfo = JSON.parse(content);
      expect(info.pid).toBe(process.pid);
      expect(info.hostname).toBe(os.hostname());
    });

    it('should respect maxRetries option', () => {
      lock.acquire(lockPath);

      expect(() => {
        lock.acquire(lockPath, { maxRetries: 1, retryDelayMs: 1 });
      }).toThrow(/Failed to acquire lock after 1 attempts/);
    });

    it('should use default maxRetries of 3', () => {
      lock.acquire(lockPath);

      expect(() => {
        lock.acquire(lockPath, { retryDelayMs: 1 });
      }).toThrow(/Failed to acquire lock after 3 attempts/);
    });
  });

  describe('concurrent operations', () => {
    it('should only allow one process to hold lock', () => {
      const lock1 = new NodePathLock();
      const lock2 = new NodePathLock();

      lock1.acquire(lockPath);

      expect(() => {
        lock2.acquire(lockPath, { maxRetries: 1, retryDelayMs: 1 });
      }).toThrow(/Failed to acquire lock/);

      // After release, lock2 should succeed
      lock1.release(lockPath);
      expect(() => {
        lock2.acquire(lockPath);
      }).not.toThrow();
    });

    it('should handle rapid acquire/release cycles', () => {
      for (let i = 0; i < 10; i++) {
        lock.acquire(lockPath);
        expect(fs.existsSync(lockPath)).toBe(true);
        lock.release(lockPath);
        expect(fs.existsSync(lockPath)).toBe(false);
      }
    });
  });

  describe('lock file format', () => {
    it('should match expected JSON structure', () => {
      lock.acquire(lockPath);

      const content = fs.readFileSync(lockPath, 'utf-8');
      const info = JSON.parse(content);

      // Verify exact structure matches expected format
      expect(Object.keys(info).sort()).toEqual(
        ['acquiredAt', 'hostname', 'pid'].sort()
      );

      // Verify types
      expect(typeof info.acquiredAt).toBe('number');
      expect(typeof info.pid).toBe('number');
      expect(typeof info.hostname).toBe('string');

      // Verify acquiredAt is recent (within last 5 seconds)
      expect(info.acquiredAt).toBeGreaterThan(Date.now() - 5000);
      expect(info.acquiredAt).toBeLessThanOrEqual(Date.now());
    });
  });
});
