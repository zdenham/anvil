import crypto from "crypto";

const PLANS_DIR = "plans";

/**
 * Minimal plan metadata stored on disk.
 * Agent only needs to create/update the metadata.json - frontend refreshes from disk.
 * Uses absolute paths to simplify detection and avoid repositoryName dependencies.
 */
interface PlanMetadata {
  id: string;
  absolutePath: string;
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
   * Create or update a plan.
   * Idempotent - looks up by absolute path first.
   */
  async ensurePlanExists(
    absolutePath: string
  ): Promise<{ id: string; isNew: boolean }> {
    // Find existing plan by absolute path
    const existing = await this.findPlanByPath(absolutePath);
    if (existing) {
      // Mark as unread (content was updated)
      await this.updatePlan(existing.id, { isRead: false });
      return { id: existing.id, isNew: false };
    }

    // Create new plan
    const plan = await this.createPlan({ absolutePath });
    return { id: plan.id, isNew: true };
  }

  /**
   * Create a new plan.
   */
  async createPlan(input: { absolutePath: string }): Promise<PlanMetadata> {
    const now = Date.now();
    const id = crypto.randomUUID();

    const plan: PlanMetadata = {
      id,
      absolutePath: input.absolutePath,
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
   * Find plan by absolute path.
   */
  async findPlanByPath(absolutePath: string): Promise<PlanMetadata | null> {
    const dirs = await this.listDirs(PLANS_DIR);
    for (const dir of dirs) {
      const plan = await this.read<PlanMetadata>(`${PLANS_DIR}/${dir}/metadata.json`);
      if (plan && plan.absolutePath === absolutePath) {
        return plan;
      }
    }
    return null;
  }
}
