import { persistence } from "@/lib/persistence";
import { usePlanStore } from "./store";
import { PlanMetadataSchema } from "./types";
import type { PlanMetadata, CreatePlanInput, UpdatePlanInput } from "./types";
import { logger } from "@/lib/logger-client";
import type { ThreadMetadata } from "../threads/types";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { FilesystemClient } from "@/lib/filesystem-client";

const PLANS_DIRECTORY = "plans";
const ARCHIVE_PLANS_DIR = "archive/plans";

/**
 * Generate a valid UUID v4.
 */
function generateId(): string {
  return crypto.randomUUID();
}

class PlanService {
  /**
   * Hydrate store from plans/{id}/metadata.json files.
   */
  async hydrate(): Promise<void> {
    logger.log("[planService:hydrate] Starting plan hydration...");

    await persistence.ensureDir(PLANS_DIRECTORY);
    const pattern = `${PLANS_DIRECTORY}/*/metadata.json`;
    const metadataFiles = await persistence.glob(pattern);

    logger.log(`[planService:hydrate] Found ${metadataFiles.length} plan files`);

    const plans: Record<string, PlanMetadata> = {};

    for (const filePath of metadataFiles) {
      try {
        const data = await persistence.readJson(filePath);
        const result = PlanMetadataSchema.safeParse(data);

        if (result.success) {
          plans[result.data.id] = result.data;
          logger.debug(`[planService:hydrate] Loaded plan: ${result.data.id}`);
        } else {
          logger.warn(`[planService:hydrate] Invalid plan metadata at ${filePath}:`, result.error.message);
        }
      } catch (err) {
        logger.warn(`[planService:hydrate] Failed to read plan metadata at ${filePath}:`, err);
      }
    }

    logger.log(`[planService:hydrate] Complete. Loaded ${Object.keys(plans).length} plans`);
    usePlanStore.getState().hydrate(plans);
  }

  /**
   * Gets a plan by ID from the store.
   */
  get(id: string): PlanMetadata | undefined {
    return usePlanStore.getState().getPlan(id);
  }

  /**
   * Gets all plans from the store.
   */
  getAll(): PlanMetadata[] {
    return usePlanStore.getState().getAll();
  }

  /**
   * Gets plans for a specific repository.
   */
  getByRepository(repoId: string): PlanMetadata[] {
    return usePlanStore.getState().getByRepository(repoId);
  }

  /**
   * Gets plans for a specific worktree.
   */
  getByWorktree(worktreeId: string): PlanMetadata[] {
    return usePlanStore.getState().getByWorktree(worktreeId);
  }

  /**
   * Gets all unread plans.
   */
  getUnreadPlans(): PlanMetadata[] {
    return usePlanStore.getState().getUnreadPlans();
  }

  /**
   * Find a plan by repository and relative path.
   * Used by the relation detection system to look up plans without absolutePath.
   */
  findByRelativePath(repoId: string, relativePath: string): PlanMetadata | undefined {
    return usePlanStore.getState()
      .getByRepository(repoId)
      .find((p) => p.relativePath === relativePath);
  }

  /**
   * Detect parent plan from file structure.
   * A plan's parent is the plan file in the immediate parent directory.
   *
   * Example: plans/auth/login.md -> parent is plans/auth.md (if it exists)
   */
  detectParentPlan(relativePath: string, repoId: string): string | undefined {
    const parts = relativePath.split('/');
    if (parts.length <= 1) return undefined;

    // Check for parent directory plan (e.g., "auth.md" for "auth/login.md")
    const parentDir = parts.slice(0, -1).join('/');
    const parentPlanPath = parentDir + '.md';

    const parentPlan = usePlanStore.getState()
      .getByRepository(repoId)
      .find((p) => p.relativePath === parentPlanPath);

    return parentPlan?.id;
  }

  /**
   * Ensure a plan exists for the given file path.
   * Creates the plan if it doesn't exist, returns existing plan if it does.
   * If the plan already exists, marks it as unread (content was updated).
   */
  async ensurePlanExists(
    repoId: string,
    worktreeId: string,
    relativePath: string
  ): Promise<PlanMetadata> {
    // Check if plan already exists
    const existing = usePlanStore.getState()
      .getByRepository(repoId)
      .find((p) => p.relativePath === relativePath);

    if (existing) {
      // Plan file was updated, mark as unread
      logger.debug(`[planService:ensurePlanExists] Plan already exists, marking as unread: ${existing.id}`);
      await this.markAsUnread(existing.id);
      return usePlanStore.getState().getPlan(existing.id)!;
    }

    // Create new plan
    return this.create({ repoId, worktreeId, relativePath });
  }

  /**
   * Create a new plan.
   * Uses optimistic updates - UI updates immediately, rolls back on failure.
   */
  async create(input: CreatePlanInput): Promise<PlanMetadata> {
    const id = generateId();
    const now = Date.now();

    const plan: PlanMetadata = {
      id,
      repoId: input.repoId,
      worktreeId: input.worktreeId,
      relativePath: input.relativePath,
      parentId: input.parentId ?? this.detectParentPlan(input.relativePath, input.repoId),
      isRead: false, // Always start unread
      createdAt: now,
      updatedAt: now,
    };

    logger.debug(`[planService:create] Creating plan: ${plan.id}`);

    // Optimistic update with rollback
    const rollback = usePlanStore.getState()._applyCreate(plan);

    try {
      // Persist to disk
      await persistence.ensureDir(`${PLANS_DIRECTORY}/${plan.id}`);
      await persistence.writeJson(
        `${PLANS_DIRECTORY}/${plan.id}/metadata.json`,
        plan
      );
      logger.debug(`[planService:create] Successfully persisted plan: ${plan.id}`);
    } catch (err) {
      logger.error(`[planService:create] Failed to persist plan, rolling back:`, err);
      rollback();
      throw err;
    }

    return plan;
  }

  /**
   * Update plan metadata.
   * Any update marks the plan as unread unless explicitly setting isRead.
   */
  async update(id: string, input: UpdatePlanInput): Promise<void> {
    const existing = usePlanStore.getState().getPlan(id);
    if (!existing) {
      throw new Error(`Plan not found: ${id}`);
    }

    const updates: Partial<PlanMetadata> = {
      ...input,
      updatedAt: Date.now(),
      // Any update marks as unread unless explicitly setting isRead
      isRead: input.isRead ?? false,
    };

    logger.debug(`[planService:update] Updating plan: ${id}`, updates);

    // Optimistic update with rollback
    const rollback = usePlanStore.getState()._applyUpdate(id, updates);

    try {
      const plan = usePlanStore.getState().getPlan(id);
      if (plan) {
        await persistence.writeJson(
          `${PLANS_DIRECTORY}/${id}/metadata.json`,
          plan
        );
      }
      logger.debug(`[planService:update] Successfully updated plan: ${id}`);
    } catch (err) {
      logger.error(`[planService:update] Failed to update plan, rolling back:`, err);
      rollback();
      throw err;
    }
  }

  /**
   * Delete a plan.
   * Removes the entire plan folder (metadata.json).
   */
  async delete(id: string): Promise<void> {
    const plan = usePlanStore.getState().getPlan(id);
    if (!plan) return;

    logger.debug(`[planService:delete] Deleting plan: ${id}`);

    // Optimistic update with rollback
    const rollback = usePlanStore.getState()._applyDelete(id);

    try {
      await persistence.removeDir(`${PLANS_DIRECTORY}/${id}`);
      logger.debug(`[planService:delete] Successfully deleted plan: ${id}`);
    } catch (err) {
      logger.error(`[planService:delete] Failed to delete plan, rolling back:`, err);
      rollback();
      throw err;
    }
  }

  /**
   * Mark plan as read.
   */
  async markAsRead(id: string): Promise<void> {
    const existing = usePlanStore.getState().getPlan(id);
    if (!existing || existing.isRead) return; // Skip if not found or already read

    logger.debug(`[planService:markAsRead] Marking plan as read: ${id}`);
    usePlanStore.getState().markPlanAsRead(id);

    const plan = usePlanStore.getState().getPlan(id);
    if (plan) {
      await persistence.writeJson(
        `${PLANS_DIRECTORY}/${id}/metadata.json`,
        plan
      );
    }
  }

  /**
   * Mark plan as unread.
   */
  async markAsUnread(id: string): Promise<void> {
    logger.debug(`[planService:markAsUnread] Marking plan as unread: ${id}`);
    usePlanStore.getState().markPlanAsUnread(id);

    const plan = usePlanStore.getState().getPlan(id);
    if (plan) {
      await persistence.writeJson(
        `${PLANS_DIRECTORY}/${id}/metadata.json`,
        plan
      );
    }
  }

  /**
   * Get plan content from the actual file.
   * Resolves the path using repoId + worktreeId + relativePath.
   */
  async getPlanContent(planId: string): Promise<string | null> {
    const plan = usePlanStore.getState().getPlan(planId);
    if (!plan) return null;

    try {
      // Import the path resolution utility
      const { resolvePlanPath } = await import("./utils");
      const absolutePath = await resolvePlanPath(plan);

      // Use filesystem-client directly for absolute paths
      const { FilesystemClient } = await import("@/lib/filesystem-client");
      const fs = new FilesystemClient();
      return await fs.readFile(absolutePath);
    } catch (err) {
      logger.warn(`[planService:getPlanContent] Failed to read plan content for ${planId}:`, err);
      return null;
    }
  }

  /**
   * Refresh a single plan from disk by ID.
   * Used when the plan file may have been modified externally.
   */
  async refreshById(planId: string): Promise<void> {
    const metadataPath = `${PLANS_DIRECTORY}/${planId}/metadata.json`;
    const exists = await persistence.exists(metadataPath);

    if (!exists) {
      // Plan was deleted - remove from store
      const existing = usePlanStore.getState().getPlan(planId);
      if (existing) {
        usePlanStore.getState()._applyDelete(planId);
      }
      return;
    }

    const raw = await persistence.readJson(metadataPath);
    const result = raw ? PlanMetadataSchema.safeParse(raw) : null;
    if (result?.success) {
      usePlanStore.getState()._applyUpdate(planId, result.data);
    }
  }

  /**
   * Get threads related to a plan.
   * Uses the relation service to find associated threads.
   */
  getRelatedThreads(planId: string): ThreadMetadata[] {
    // Lazy import to avoid circular dependency
    const { relationService } = require("../relations/service");
    const { useThreadStore } = require("../threads/store");
    const relations = relationService.getByPlan(planId);
    const threadStore = useThreadStore.getState();
    return relations
      .map((r: { threadId: string }) => threadStore.getThread(r.threadId))
      .filter((t: ThreadMetadata | undefined): t is ThreadMetadata => t !== undefined);
  }

  /**
   * Get threads related to a plan, including those with archived relations.
   * Useful for showing "threads that touched this plan" history.
   */
  getRelatedThreadsIncludingArchived(planId: string): ThreadMetadata[] {
    // Lazy import to avoid circular dependency
    const { relationService } = require("../relations/service");
    const { useThreadStore } = require("../threads/store");
    const relations = relationService.getByPlanIncludingArchived(planId);
    const threadStore = useThreadStore.getState();
    return relations
      .map((r: { threadId: string }) => threadStore.getThread(r.threadId))
      .filter((t: ThreadMetadata | undefined): t is ThreadMetadata => t !== undefined);
  }

  /**
   * Archives a plan.
   *
   * Two-step process:
   * 1. Moves the markdown file from repo `plans/` to `plans/completed/`
   * 2. Moves the metadata from `~/.mort/plans/{id}` to `~/.mort/archive/plans/{id}`
   *    and updates relativePath to reflect the new location.
   *
   * Emits PLAN_ARCHIVED event so relation service can archive associated relations.
   * Uses optimistic update - removes from store immediately, rolls back on failure.
   */
  async archive(planId: string): Promise<void> {
    const plan = this.get(planId);
    if (!plan) return;

    logger.debug(`[planService:archive] Archiving plan: ${planId}`);

    // Optimistically remove from store
    const rollback = usePlanStore.getState()._applyDelete(planId);

    try {
      // Step 1: Move markdown file to completed directory
      const { resolvePlanPath, resolveCompletedPlanPath } = await import("./utils");
      const sourcePath = await resolvePlanPath(plan);
      const destPath = await resolveCompletedPlanPath(plan);

      await this.moveMarkdownFile(sourcePath, destPath);
      logger.debug(`[planService:archive] Moved markdown file from ${sourcePath} to ${destPath}`);

      // Step 2: Move metadata to archive with updated relativePath
      const metadataSourcePath = `${PLANS_DIRECTORY}/${planId}`;
      const metadataDestPath = `${ARCHIVE_PLANS_DIR}/${planId}`;

      // Update relativePath to reflect new location under completed/
      const updatedPlan: PlanMetadata = {
        ...plan,
        relativePath: plan.relativePath, // Path stays the same relative to completed/ dir
        updatedAt: Date.now(),
      };

      await persistence.ensureDir(ARCHIVE_PLANS_DIR);
      await persistence.ensureDir(metadataDestPath);
      await persistence.writeJson(`${metadataDestPath}/metadata.json`, updatedPlan);
      await persistence.removeDir(metadataSourcePath);

      // Emit event so relation service can archive associated relations
      eventBus.emit(EventName.PLAN_ARCHIVED, { planId });

      logger.info(`[planService:archive] Archived plan ${planId}`);
    } catch (error) {
      rollback();
      logger.error(`[planService:archive] Failed to archive plan ${planId}:`, error);
      throw error;
    }
  }

  /**
   * Moves a markdown file (or directory for nested plans) to a new location.
   * Used during plan archival.
   */
  private async moveMarkdownFile(sourcePath: string, destPath: string): Promise<void> {
    const fs = new FilesystemClient();

    // Ensure destination directory exists
    const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
    await fs.mkdir(destDir);

    // Use the move command (handles both files and directories)
    await fs.move(sourcePath, destPath);
  }

  /**
   * Lists all archived plans.
   * Returns PlanMetadata for plans in archive/plans/ directory.
   */
  async listArchived(): Promise<PlanMetadata[]> {
    const pattern = `${ARCHIVE_PLANS_DIR}/*/metadata.json`;
    const files = await persistence.glob(pattern);
    const plans: PlanMetadata[] = [];

    for (const filePath of files) {
      const raw = await persistence.readJson(filePath);
      const result = raw ? PlanMetadataSchema.safeParse(raw) : null;
      if (result?.success) {
        plans.push(result.data);
      }
    }

    return plans;
  }

}

export const planService = new PlanService();
