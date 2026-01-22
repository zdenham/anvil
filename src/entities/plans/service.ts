import { persistence } from "@/lib/persistence";
import { usePlanStore } from "./store";
import { PlanMetadataSchema } from "./types";
import type { PlanMetadata, CreatePlanInput, UpdatePlanInput } from "./types";
import { logger } from "@/lib/logger-client";

const PLANS_DIRECTORY = "plans";

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
   * Gets plans that have paths starting with the given prefix.
   * Useful for filtering plans by repository/directory.
   */
  getByPathPrefix(pathPrefix: string): PlanMetadata[] {
    return usePlanStore.getState().getByPathPrefix(pathPrefix);
  }

  /**
   * Gets all unread plans.
   */
  getUnreadPlans(): PlanMetadata[] {
    return usePlanStore.getState().getUnreadPlans();
  }

  /**
   * Find existing plan by absolute path
   */
  findByPath(absolutePath: string): PlanMetadata | undefined {
    return usePlanStore.getState().findByPath(absolutePath);
  }

  /**
   * Idempotent plan creation - looks up by absolute path first.
   * If plan exists, marks it as unread (content was updated).
   */
  async ensurePlanExists(absolutePath: string): Promise<PlanMetadata> {
    const existing = this.findByPath(absolutePath);
    if (existing) {
      // Plan file was updated, mark as unread
      logger.debug(`[planService:ensurePlanExists] Plan already exists, marking as unread: ${existing.id}`);
      await this.markAsUnread(existing.id);
      return usePlanStore.getState().getPlan(existing.id)!;
    }
    return this.create({ absolutePath });
  }

  /**
   * Create a new plan.
   * Uses optimistic updates - UI updates immediately, rolls back on failure.
   */
  async create(input: CreatePlanInput): Promise<PlanMetadata> {
    const now = Date.now();

    const plan: PlanMetadata = {
      id: crypto.randomUUID(),
      absolutePath: input.absolutePath,
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
   * Uses the absolute path stored in plan metadata.
   */
  async getPlanContent(planId: string): Promise<string | null> {
    const plan = usePlanStore.getState().getPlan(planId);
    if (!plan) return null;

    try {
      // Use filesystem-client directly for absolute paths
      const { FilesystemClient } = await import("@/lib/filesystem-client");
      const fs = new FilesystemClient();
      return await fs.readFile(plan.absolutePath);
    } catch {
      logger.warn(`[planService:getPlanContent] Failed to read plan content at ${plan.absolutePath}`);
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

}

export const planService = new PlanService();
