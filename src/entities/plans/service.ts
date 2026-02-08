import { appData } from "@/lib/app-data-store";
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

    await appData.ensureDir(PLANS_DIRECTORY);
    const pattern = `${PLANS_DIRECTORY}/*/metadata.json`;
    const metadataFiles = await appData.glob(pattern);

    logger.log(`[planService:hydrate] Found ${metadataFiles.length} plan files`);

    const plans: Record<string, PlanMetadata> = {};

    for (const filePath of metadataFiles) {
      try {
        const data = await appData.readJson(filePath);
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
   * Find a plan by relative path with case-insensitive filename matching.
   * Used for readme.md detection to handle README.md, Readme.md, etc.
   */
  findByRelativePathCaseInsensitive(repoId: string, relativePath: string): PlanMetadata | undefined {
    const dir = relativePath.substring(0, relativePath.lastIndexOf('/'));
    const filename = relativePath.substring(relativePath.lastIndexOf('/') + 1).toLowerCase();

    return this.getByRepository(repoId).find(plan => {
      const planDir = plan.relativePath.substring(0, plan.relativePath.lastIndexOf('/'));
      const planFilename = plan.relativePath.substring(plan.relativePath.lastIndexOf('/') + 1).toLowerCase();
      return planDir === dir && planFilename === filename;
    });
  }

  /**
   * Detect parent plan from file structure.
   * Supports arbitrary nesting depth.
   *
   * Examples:
   * - plans/auth/login.md -> parent: plans/auth/readme.md (if exists, case-insensitive)
   *                       -> fallback: plans/auth.md (sibling file pattern)
   * - plans/auth/oauth/google.md -> parent: plans/auth/oauth/readme.md (if exists, case-insensitive)
   *                              -> fallback: plans/auth/oauth.md (if exists)
   */
  detectParentPlan(relativePath: string, repoId: string): string | undefined {
    const parts = relativePath.split('/');
    const filename = parts[parts.length - 1];

    // readme.md files have no parent within their own directory
    // Their parent would be at the next level up
    if (filename.toLowerCase() === 'readme.md') {
      if (parts.length <= 2) return undefined; // Just "plans/readme.md"
      // Look for parent at directory level above
      const parentDir = parts.slice(0, -2).join('/');
      const readmeParent = this.findByRelativePathCaseInsensitive(repoId, `${parentDir}/readme.md`);
      if (readmeParent) return readmeParent.id;
      const siblingParent = this.findByRelativePath(repoId, parts.slice(0, -2).join('/') + '.md');
      if (siblingParent) return siblingParent.id;
      return undefined;
    }

    if (parts.length <= 1) return undefined; // Just "file.md" with no directory

    // Walk up the tree looking for nearest ancestor
    for (let i = parts.length - 2; i >= 0; i--) {
      const ancestorDir = parts.slice(0, i + 1).join('/');

      // Pattern 1: Look for readme.md in this directory (case-insensitive)
      const readmeParent = this.findByRelativePathCaseInsensitive(repoId, `${ancestorDir}/readme.md`);
      if (readmeParent && readmeParent.relativePath !== relativePath) return readmeParent.id;

      // Pattern 2: Look for sibling .md file (e.g., plans/auth.md for plans/auth/*)
      const siblingPath = ancestorDir + '.md';
      const siblingParent = this.findByRelativePath(repoId, siblingPath);
      if (siblingParent) return siblingParent.id;
    }

    return undefined;
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
      await appData.ensureDir(`${PLANS_DIRECTORY}/${plan.id}`);
      await appData.writeJson(
        `${PLANS_DIRECTORY}/${plan.id}/metadata.json`,
        plan
      );
      logger.debug(`[planService:create] Successfully persisted plan: ${plan.id}`);

      // Emit event for listeners (triggers parent folder status updates)
      eventBus.emit(EventName.PLAN_CREATED, { planId: plan.id, repoId: plan.repoId });
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
        await appData.writeJson(
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
      await appData.removeDir(`${PLANS_DIRECTORY}/${id}`);
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
      await appData.writeJson(
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
      await appData.writeJson(
        `${PLANS_DIRECTORY}/${id}/metadata.json`,
        plan
      );
    }
  }

  /**
   * Mark plan as stale (file not found).
   * Called when getPlanContent() fails to read the file.
   */
  async markAsStale(id: string): Promise<void> {
    const plan = usePlanStore.getState().getPlan(id);
    if (!plan || plan.stale) return; // Already stale or doesn't exist

    logger.debug(`[planService:markAsStale] Marking plan as stale: ${id}`);

    const updates = { stale: true };
    usePlanStore.getState()._applyUpdate(id, updates);

    const updatedPlan = usePlanStore.getState().getPlan(id);
    if (updatedPlan) {
      await appData.writeJson(
        `${PLANS_DIRECTORY}/${id}/metadata.json`,
        updatedPlan
      );
    }
  }

  /**
   * Mark plan as valid (file exists).
   * Called when getPlanContent() successfully reads the file.
   * Clears stale flag and updates lastVerified timestamp.
   */
  async markAsValid(id: string): Promise<void> {
    const plan = usePlanStore.getState().getPlan(id);
    if (!plan) return;

    // Only update if stale flag needs clearing or lastVerified needs refreshing
    // Skip if not stale and was verified recently (within 5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (!plan.stale && plan.lastVerified && plan.lastVerified > fiveMinutesAgo) {
      return;
    }

    logger.debug(`[planService:markAsValid] Marking plan as valid: ${id}`);

    const updates = { stale: false, lastVerified: Date.now() };
    usePlanStore.getState()._applyUpdate(id, updates);

    const updatedPlan = usePlanStore.getState().getPlan(id);
    if (updatedPlan) {
      await appData.writeJson(
        `${PLANS_DIRECTORY}/${id}/metadata.json`,
        updatedPlan
      );
    }
  }

  /**
   * Get plan content from the actual file.
   * Resolves the path using repoId + worktreeId + relativePath.
   * Marks plan as stale if file not found, or clears stale flag if found.
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
      const content = await fs.readFile(absolutePath);

      // File exists - clear stale flag if it was set
      await this.markAsValid(planId);

      return content;
    } catch (err) {
      logger.warn(`[planService:getPlanContent] Failed to read plan content for ${planId}:`, err);
      // File not found - mark as stale
      await this.markAsStale(planId);
      return null;
    }
  }

  /**
   * Refresh a single plan from disk by ID.
   * Used when the plan file may have been modified externally.
   * Handles both new plans (create) and existing plans (update).
   */
  async refreshById(planId: string): Promise<void> {
    const metadataPath = `${PLANS_DIRECTORY}/${planId}/metadata.json`;
    const exists = await appData.exists(metadataPath);

    if (!exists) {
      // Plan was deleted - remove from store
      const existing = usePlanStore.getState().getPlan(planId);
      if (existing) {
        usePlanStore.getState()._applyDelete(planId);
      }
      return;
    }

    const raw = await appData.readJson(metadataPath);
    const result = raw ? PlanMetadataSchema.safeParse(raw) : null;
    if (result?.success) {
      const existingPlan = usePlanStore.getState().getPlan(planId);
      if (existingPlan) {
        // Plan exists - update it
        usePlanStore.getState()._applyUpdate(planId, result.data);
      } else {
        // Plan doesn't exist in store - create it
        usePlanStore.getState()._applyCreate(result.data);
      }
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
   * Archives a plan and its descendants (if it has children).
   *
   * For folder plans (plans with children), this automatically archives
   * all descendant plans first in reverse order (deepest children first).
   *
   * Two-step process for each plan:
   * 1. Moves the markdown file from repo `plans/` to `plans/completed/`
   * 2. Moves the metadata from `~/.mort/plans/{id}` to `~/.mort/archive/plans/{id}`
   *    and updates relativePath to reflect the new location.
   *
   * Emits PLAN_ARCHIVED event so relation service can archive associated relations.
   * Uses optimistic update - removes from store immediately, rolls back on failure.
   *
   * @param planId - The plan ID to archive
   * @param originInstanceId - Optional instance ID of the window that initiated the archive
   */
  async archive(planId: string, originInstanceId?: string | null): Promise<void> {
    const plan = this.get(planId);
    if (!plan) return;

    // If this plan has children, use cascading archive
    const children = usePlanStore.getState().getChildren(planId);
    if (children.length > 0) {
      logger.debug(`[planService:archive] Plan ${planId} has ${children.length} children, using cascading archive`);
      await this.archiveWithDescendants(planId, originInstanceId);
      return;
    }

    // Archive single plan
    await this._archiveSingle(planId, originInstanceId);
  }

  /**
   * Internal method to archive a single plan without checking for children.
   * Used by archiveWithDescendants to avoid infinite recursion.
   */
  private async _archiveSingle(planId: string, originInstanceId?: string | null): Promise<void> {
    const plan = this.get(planId);
    if (!plan) return;

    logger.debug(`[planService:_archiveSingle] Archiving plan: ${planId}`);

    // Optimistically remove from store
    const rollback = usePlanStore.getState()._applyDelete(planId);

    try {
      // Step 1: Move markdown file to completed directory (if it exists)
      const { resolvePlanPath, resolveCompletedPlanPath } = await import("./utils");
      const sourcePath = await resolvePlanPath(plan);
      const destPath = await resolveCompletedPlanPath(plan);

      try {
        await this.moveMarkdownFile(sourcePath, destPath);
        logger.debug(`[planService:_archiveSingle] Moved markdown file from ${sourcePath} to ${destPath}`);
      } catch (moveError) {
        // If file doesn't exist, that's okay - just archive the metadata
        logger.warn(`[planService:_archiveSingle] Could not move markdown file (may have been deleted): ${moveError}`);
      }

      // Step 2: Move metadata to archive with updated relativePath
      const metadataSourcePath = `${PLANS_DIRECTORY}/${planId}`;
      const metadataDestPath = `${ARCHIVE_PLANS_DIR}/${planId}`;

      // Update relativePath to reflect new location under completed/
      const updatedPlan: PlanMetadata = {
        ...plan,
        relativePath: plan.relativePath, // Path stays the same relative to completed/ dir
        updatedAt: Date.now(),
      };

      await appData.ensureDir(ARCHIVE_PLANS_DIR);
      await appData.ensureDir(metadataDestPath);
      await appData.writeJson(`${metadataDestPath}/metadata.json`, updatedPlan);
      await appData.removeDir(metadataSourcePath);

      // Emit event so relation service can archive associated relations
      // Include originInstanceId so standalone windows can close themselves
      eventBus.emit(EventName.PLAN_ARCHIVED, { planId, originInstanceId });

      logger.info(`[planService:_archiveSingle] Archived plan ${planId}`);
    } catch (error) {
      rollback();
      logger.error(`[planService:_archiveSingle] Failed to archive plan ${planId}:`, error);
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
    const files = await appData.glob(pattern);
    const plans: PlanMetadata[] = [];

    for (const filePath of files) {
      const raw = await appData.readJson(filePath);
      const result = raw ? PlanMetadataSchema.safeParse(raw) : null;
      if (result?.success) {
        plans.push(result.data);
      }
    }

    return plans;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Folder Status Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if a plan acts as a folder (has children).
   */
  isFolder(planId: string): boolean {
    return usePlanStore.getState().getChildren(planId).length > 0;
  }

  /**
   * Recalculate and persist isFolder status for a plan.
   */
  async updateFolderStatus(planId: string): Promise<void> {
    const hasChildren = this.isFolder(planId);
    const plan = this.get(planId);
    if (plan && plan.isFolder !== hasChildren) {
      await this.update(planId, { isFolder: hasChildren, isRead: plan.isRead });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Parent Relationship Refresh Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Refresh parent relationships for all plans in a repo.
   * Called on startup, file changes, and worktree switch.
   */
  async refreshParentRelationships(repoId: string): Promise<void> {
    logger.debug(`[planService:refreshParentRelationships] Refreshing parent relationships for repo: ${repoId}`);
    const plans = this.getByRepository(repoId);

    for (const plan of plans) {
      const detectedParentId = this.detectParentPlan(plan.relativePath, repoId);
      if (plan.parentId !== detectedParentId) {
        await this.update(plan.id, { parentId: detectedParentId, isRead: plan.isRead });
      }
    }

    // Update folder status for all plans that might have children
    for (const plan of plans) {
      await this.updateFolderStatus(plan.id);
    }

    logger.debug(`[planService:refreshParentRelationships] Completed for repo: ${repoId}`);
  }

  /**
   * Refresh parent for a single plan (after file change).
   */
  async refreshSinglePlanParent(planId: string): Promise<void> {
    const plan = this.get(planId);
    if (!plan) return;

    const oldParentId = plan.parentId;
    const detectedParentId = this.detectParentPlan(plan.relativePath, plan.repoId);

    if (plan.parentId !== detectedParentId) {
      await this.update(planId, { parentId: detectedParentId, isRead: plan.isRead });
    }

    // Also update the old and new parent's folder status
    if (oldParentId) await this.updateFolderStatus(oldParentId);
    if (detectedParentId) await this.updateFolderStatus(detectedParentId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Cascading Archive Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all descendant plans (children, grandchildren, etc.)
   */
  getDescendants(planId: string): PlanMetadata[] {
    const children = usePlanStore.getState().getChildren(planId);
    const descendants: PlanMetadata[] = [];

    for (const child of children) {
      descendants.push(child);
      descendants.push(...this.getDescendants(child.id));
    }

    return descendants;
  }

  /**
   * Archive a plan and all its descendants.
   * Uses _archiveSingle internally to avoid infinite recursion.
   */
  async archiveWithDescendants(planId: string, originInstanceId?: string | null): Promise<void> {
    const descendants = this.getDescendants(planId);

    // Archive in reverse order (deepest children first)
    for (const descendant of descendants.reverse()) {
      await this._archiveSingle(descendant.id, originInstanceId);
    }

    // Archive the parent last
    await this._archiveSingle(planId, originInstanceId);
  }

}

export const planService = new PlanService();
