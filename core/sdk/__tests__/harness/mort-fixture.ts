import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import type { ThreadInfo, PlanInfo } from '../../types.js';

/**
 * Thread metadata for fixture creation.
 * Partial version of ThreadInfo allowing defaults.
 */
export interface ThreadMetaFixture {
  repoId?: string;
  worktreeId?: string;
  status?: 'idle' | 'running' | 'completed' | 'error' | 'cancelled';
  createdAt?: number;
  updatedAt?: number;
  isRead?: boolean;
  turnCount?: number;
}

/**
 * Plan index entry for fixture creation.
 * Partial version of PlanInfo allowing defaults.
 */
export interface PlanEntryFixture {
  repoId?: string;
  worktreeId?: string;
  relativePath?: string;
  isRead?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * AnvilFixture manages temporary .anvil directories for testing.
 * Creates isolated test environments with thread/plan fixtures.
 */
export class AnvilFixture {
  private _anvilDir: string | null = null;
  private readonly threadMetas: Map<string, ThreadMetaFixture> = new Map();
  private readonly planEntries: Map<string, PlanEntryFixture> = new Map();

  /**
   * Path to the temporary .anvil directory.
   * Throws if not yet initialized.
   */
  get anvilDir(): string {
    if (!this._anvilDir) {
      throw new Error('AnvilFixture not initialized. Call init() first.');
    }
    return this._anvilDir;
  }

  /**
   * Initialize the fixture by creating a temp directory.
   * Must be called before any other operations.
   */
  async init(): Promise<void> {
    const tmpBase = os.tmpdir();
    const uniqueId = randomUUID().slice(0, 8);
    this._anvilDir = path.join(tmpBase, `anvil-test-${uniqueId}`);

    // Create standard .anvil structure
    await fs.mkdir(this._anvilDir, { recursive: true });
    await fs.mkdir(path.join(this._anvilDir, 'threads'), { recursive: true });

    // Initialize empty plans index
    await fs.writeFile(
      path.join(this._anvilDir, 'plans-index.json'),
      JSON.stringify({ plans: [] }, null, 2)
    );
  }

  /**
   * Add a thread fixture with the given metadata.
   * Creates the thread directory and meta.json file.
   */
  async addThread(threadId: string, meta: ThreadMetaFixture = {}): Promise<void> {
    const anvilDir = this.anvilDir;
    const threadDir = path.join(anvilDir, 'threads', threadId);
    await fs.mkdir(threadDir, { recursive: true });

    const now = Date.now();
    const fullMeta = {
      repoId: meta.repoId ?? 'test-repo',
      worktreeId: meta.worktreeId ?? 'test-worktree',
      status: meta.status ?? 'idle',
      createdAt: meta.createdAt ?? now,
      updatedAt: meta.updatedAt ?? now,
      isRead: meta.isRead ?? true,
      turnCount: meta.turnCount ?? 0,
    };

    await fs.writeFile(
      path.join(threadDir, 'meta.json'),
      JSON.stringify(fullMeta, null, 2)
    );

    this.threadMetas.set(threadId, fullMeta);
  }

  /**
   * Add a plan fixture with the given entry data.
   * Updates the plans-index.json file.
   */
  async addPlan(planId: string, entry: PlanEntryFixture = {}): Promise<void> {
    const anvilDir = this.anvilDir;
    const now = Date.now();

    const fullEntry = {
      id: planId,
      repoId: entry.repoId ?? 'test-repo',
      worktreeId: entry.worktreeId ?? 'test-worktree',
      relativePath: entry.relativePath ?? `plans/${planId}.md`,
      isRead: entry.isRead ?? true,
      createdAt: entry.createdAt ?? now,
      updatedAt: entry.updatedAt ?? now,
    };

    this.planEntries.set(planId, fullEntry);

    // Rebuild plans-index.json
    const indexPath = path.join(anvilDir, 'plans-index.json');
    const index = {
      plans: Array.from(this.planEntries.values()),
    };
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  }

  /**
   * Get thread metadata from the fixture.
   * Reads directly from disk to verify file system state.
   */
  async getThread(threadId: string): Promise<ThreadInfo | null> {
    const anvilDir = this.anvilDir;
    const metaPath = path.join(anvilDir, 'threads', threadId, 'meta.json');

    try {
      const content = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(content);
      return {
        id: threadId,
        repoId: meta.repoId,
        worktreeId: meta.worktreeId,
        status: meta.status,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        isRead: meta.isRead ?? true,
        turnCount: meta.turnCount ?? 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get plan metadata from the fixture.
   * Reads directly from disk to verify file system state.
   */
  async getPlan(planId: string): Promise<PlanInfo | null> {
    const anvilDir = this.anvilDir;
    const indexPath = path.join(anvilDir, 'plans-index.json');

    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content);
      const entry = index.plans?.find((p: { id: string }) => p.id === planId);
      return entry || null;
    } catch {
      return null;
    }
  }

  /**
   * Check if a file exists at the given relative path within .anvil.
   */
  async fileExists(relativePath: string): Promise<boolean> {
    const anvilDir = this.anvilDir;
    const fullPath = path.join(anvilDir, relativePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read file content at the given relative path within .anvil.
   */
  async readFile(relativePath: string): Promise<string> {
    const anvilDir = this.anvilDir;
    const fullPath = path.join(anvilDir, relativePath);
    return fs.readFile(fullPath, 'utf-8');
  }

  /**
   * Write file content at the given relative path within .anvil.
   */
  async writeFile(relativePath: string, content: string): Promise<void> {
    const anvilDir = this.anvilDir;
    const fullPath = path.join(anvilDir, relativePath);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content);
  }

  /**
   * Cleanup the temporary directory.
   * Should be called after each test.
   */
  async cleanup(): Promise<void> {
    if (this._anvilDir) {
      try {
        await fs.rm(this._anvilDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      this._anvilDir = null;
      this.threadMetas.clear();
      this.planEntries.clear();
    }
  }
}

/**
 * Create and initialize a new AnvilFixture.
 * Convenience function for tests.
 */
export async function createAnvilFixture(): Promise<AnvilFixture> {
  const fixture = new AnvilFixture();
  await fixture.init();
  return fixture;
}
