import crypto from "crypto";
import { relative, isAbsolute } from "path";
import { realpathSync } from "fs";
import type { PhaseInfo } from "@core/types/plans.js";

const PLANS_DIR = "plans";
const RELATIONS_DIR = "plan-thread-edges";

/**
 * Relation type for plan-thread edges.
 * Matches core/types/relations.ts RelationType.
 */
type RelationType = 'created' | 'modified' | 'mentioned';

/**
 * Plan-thread relation stored on disk.
 * Matches core/types/relations.ts PlanThreadRelation.
 */
interface PlanThreadRelation {
  planId: string;
  threadId: string;
  type: RelationType;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Precedence values for relation types.
 * Higher number = higher precedence (created > modified > mentioned).
 */
const RELATION_TYPE_PRECEDENCE: Record<RelationType, number> = {
  mentioned: 1,
  modified: 2,
  created: 3,
};

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
  phaseInfo?: PhaseInfo;
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
    workingDir: string,
    phaseInfo?: PhaseInfo | null
  ): Promise<{ id: string; isNew: boolean }> {
    // Convert absolutePath to relativePath
    const relativePath = isAbsolute(absolutePath)
      ? this.toRelativePath(absolutePath, workingDir)
      : absolutePath;

    // Find existing plan by repoId + relativePath
    const existing = await this.findPlanByPath(repoId, relativePath);
    if (existing) {
      // Mark as unread (content was updated), and update phaseInfo
      await this.updatePlan(existing.id, {
        isRead: false,
        phaseInfo: phaseInfo ?? undefined,
      });
      return { id: existing.id, isNew: false };
    }

    // Create new plan with phaseInfo
    const plan = await this.createPlan({
      repoId,
      worktreeId,
      relativePath,
      phaseInfo: phaseInfo ?? undefined,
    });
    return { id: plan.id, isNew: true };
  }

  /**
   * Create a new plan.
   */
  async createPlan(input: {
    repoId: string;
    worktreeId: string;
    relativePath: string;
    phaseInfo?: PhaseInfo;
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
      ...(input.phaseInfo && { phaseInfo: input.phaseInfo }),
    };

    await this.mkdir(`${PLANS_DIR}/${id}`);
    await this.write(`${PLANS_DIR}/${id}/metadata.json`, plan);
    return plan;
  }

  /**
   * Update plan metadata.
   */
  async updatePlan(id: string, updates: { isRead?: boolean; phaseInfo?: PhaseInfo }): Promise<void> {
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

  // ─────────────────────────────────────────────────────────────────────────
  // Plan-Thread Relation operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create or upgrade a plan-thread relation.
   * Per Decision #13: Relations can only upgrade (mentioned -> modified -> created), never downgrade.
   *
   * @param planId - The plan UUID
   * @param threadId - The thread UUID
   * @param type - The relation type (created, modified, or mentioned)
   * @returns The created or existing relation
   */
  async createOrUpgradeRelation(
    planId: string,
    threadId: string,
    type: RelationType
  ): Promise<PlanThreadRelation> {
    const path = `${RELATIONS_DIR}/${planId}-${threadId}.json`;

    // Ensure directory exists
    try {
      await this.mkdir(RELATIONS_DIR);
    } catch {
      // Directory may already exist
    }

    // Check for existing relation
    const existing = await this.read<PlanThreadRelation>(path);

    if (existing) {
      // Only upgrade, never downgrade
      if (RELATION_TYPE_PRECEDENCE[type] > RELATION_TYPE_PRECEDENCE[existing.type]) {
        const updated: PlanThreadRelation = {
          ...existing,
          type,
          updatedAt: Date.now(),
        };
        await this.write(path, updated);
        return updated;
      }
      // Return existing if no upgrade needed
      return existing;
    }

    // Create new relation
    const now = Date.now();
    const relation: PlanThreadRelation = {
      planId,
      threadId,
      type,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };

    await this.write(path, relation);
    return relation;
  }
}
