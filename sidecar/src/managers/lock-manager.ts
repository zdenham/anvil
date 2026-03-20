/**
 * File-based lock manager for repository locking.
 *
 * Provides exclusive locks with expiry (30 minutes).
 */

import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

const LOCK_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

interface LockEntry {
  lockId: string;
  lockFile: string;
  metaFile: string;
  acquiredAt: number;
}

export class LockManager {
  private locks = new Map<string, LockEntry>();
  private counter = 0;

  async acquire(repoDir: string): Promise<string> {
    const lockFile = join(repoDir, ".lock");
    const metaFile = join(repoDir, ".lock.meta");

    // Check for existing lock
    try {
      const meta = await readFile(metaFile, "utf-8");
      const acquiredAt = parseInt(meta, 10);
      if (Date.now() - acquiredAt < LOCK_EXPIRY_MS) {
        throw new Error("Repository is already locked");
      }
      // Expired lock — clean up
      await unlink(lockFile).catch(() => {});
      await unlink(metaFile).catch(() => {});
    } catch (err) {
      if (
        err instanceof Error &&
        err.message === "Repository is already locked"
      ) {
        throw err;
      }
      // No existing lock — proceed
    }

    await mkdir(dirname(lockFile), { recursive: true });
    const lockId = `lock-${++this.counter}`;
    await writeFile(lockFile, lockId);
    await writeFile(metaFile, String(Date.now()));

    this.locks.set(lockId, {
      lockId,
      lockFile,
      metaFile,
      acquiredAt: Date.now(),
    });

    return lockId;
  }

  async release(lockId: string): Promise<void> {
    const entry = this.locks.get(lockId);
    if (!entry) {
      throw new Error(`Unknown lock: ${lockId}`);
    }
    await unlink(entry.lockFile).catch(() => {});
    await unlink(entry.metaFile).catch(() => {});
    this.locks.delete(lockId);
  }
}
