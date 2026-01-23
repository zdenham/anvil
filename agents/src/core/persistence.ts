import crypto from "crypto";
import { relative, isAbsolute } from "path";
import { realpathSync } from "fs";

const PLANS_DIR = "plans";

/**
 * Plan metadata stored on disk.
 * Schema matches frontend's PlanMetadataSchema in core/types/plans.ts.
 * Uses structured paths (repoId + worktreeId + relativePath) for portability.
 */
interface PlanMetadata {
  id: string;
  repoId: string;
  worktreeId: string;
  relativePath: string;
  isRead: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Abstract persistence class for .mort/ directory operations.
 * Implementations provide platform-specific I/O (Node.js fs, Tauri IPC, etc.)
 * while sharing all plan operation logic.
 */
export abstract class MortPersistence {
  // ─────────────────────────────────────────────────────────────────────────
  // Abstract I/O methods - implemented by platform-specific adapters
  // ─────────────────────────────────────────────────────────────────────────

  abstract read<T>(path: string): Promise<T | null>;
  abstract write(path: string, data: unknown): Promise<void>;
  abstract delete(path: string): Promise<void>;
  abstract list(dir: string): Promise<string[]>;
  abstract listDirs(dir: string): Promise<string[]>;
  abstract exists(path: string): Promise<boolean>;
  abstract mkdir(path: string): Promise<void>;
  abstract rmdir(path: string): Promise<void>;
  abstract writeText(path: string, content: string): Promise<void>;
  abstract readText(path: string): Promise<string | null>;
  abstract rename(oldPath: string, newPath: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // Plan operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Convert an absolute path to a relative path from the working directory.
   * Handles symlink resolution (e.g., macOS /var -> /private/var).
   */
  private toRelativePath(absolutePath: string, workingDir: string): string {
    try {
      const realAbsolute = realpathSync(absolutePath);
      const realWorkDir = realpathSync(workingDir);
      return relative(realWorkDir, realAbsolute);
    } catch {
      // Fall back to direct relative if realpath fails (file may not exist yet)
      return relative(workingDir, absolutePath);
    }
  }

  /**
   * Create or update a plan.
   * Idempotent - looks up by repoId + relativePath first.
   */
  async ensurePlanExists(
    repoId: string,
    worktreeId: string,
    absolutePath: string,
    workingDir: string
  ): Promise<{ id: string; isNew: boolean }> {
    // Convert absolutePath to relativePath
    const relativePath = isAbsolute(absolutePath)
      ? this.toRelativePath(absolutePath, workingDir)
      : absolutePath;

    // Find existing plan by repoId + relativePath
    const existing = await this.findPlanByPath(repoId, relativePath);
    if (existing) {
      // Mark as unread (content was updated)
      await this.updatePlan(existing.id, { isRead: false });
      return { id: existing.id, isNew: false };
    }

    // Create new plan
    const plan = await this.createPlan({ repoId, worktreeId, relativePath });
    return { id: plan.id, isNew: true };
  }

  /**
   * Create a new plan.
   */
  async createPlan(input: {
    repoId: string;
    worktreeId: string;
    relativePath: string;
  }): Promise<PlanMetadata> {
    const now = Date.now();
    const id = crypto.randomUUID();

    const plan: PlanMetadata = {
      id,
      repoId: input.repoId,
      worktreeId: input.worktreeId,
      relativePath: input.relativePath,
      isRead: false,
      createdAt: now,
      updatedAt: now,
    };

    await this.mkdir(`${PLANS_DIR}/${id}`);
    await this.write(`${PLANS_DIR}/${id}/metadata.json`, plan);
    return plan;
  }

  /**
   * Update plan metadata.
   */
  async updatePlan(id: string, updates: { isRead?: boolean }): Promise<void> {
    const plan = await this.getPlan(id);
    if (!plan) return;

    const updated = {
      ...plan,
      ...updates,
      updatedAt: Date.now(),
    };
    await this.write(`${PLANS_DIR}/${id}/metadata.json`, updated);
  }

  /**
   * Get plan by ID.
   */
  async getPlan(id: string): Promise<PlanMetadata | null> {
    return this.read<PlanMetadata>(`${PLANS_DIR}/${id}/metadata.json`);
  }

  /**
   * Find plan by repoId and relativePath.
   */
  async findPlanByPath(repoId: string, relativePath: string): Promise<PlanMetadata | null> {
    const dirs = await this.listDirs(PLANS_DIR);
    for (const dir of dirs) {
      const plan = await this.read<PlanMetadata>(`${PLANS_DIR}/${dir}/metadata.json`);
      if (plan && plan.repoId === repoId && plan.relativePath === relativePath) {
        return plan;
      }
    }
    return null;
  }
}
