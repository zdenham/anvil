import { appData } from "@/lib/app-data-store";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { useRelationStore } from "./store";
import { usePlanStore } from "../plans/store";
import { useThreadStore } from "../threads/store";
import type { PlanThreadRelation, RelationType } from "@core/types/relations.js";
import { RELATION_TYPE_PRECEDENCE, PlanThreadRelationSchema } from "@core/types/relations.js";
import { logger } from "@/lib/logger-client";

const RELATIONS_DIR = "plan-thread-edges";
const ARCHIVE_RELATIONS_DIR = "archive/plan-thread-edges";

function getRelationPath(planId: string, threadId: string): string {
  return `${RELATIONS_DIR}/${planId}-${threadId}.json`;
}

function getArchiveRelationPath(planId: string, threadId: string): string {
  return `${ARCHIVE_RELATIONS_DIR}/${planId}-${threadId}.json`;
}

function makeKey(planId: string, threadId: string): string {
  return `${planId}-${threadId}`;
}

function canUpgrade(currentType: RelationType, newType: RelationType): boolean {
  return RELATION_TYPE_PRECEDENCE[newType] > RELATION_TYPE_PRECEDENCE[currentType];
}

class RelationService {
  /**
   * Create or upgrade a relation.
   * Per Decision #13: Relations can only upgrade (mentioned -> modified -> created), never downgrade.
   */
  async createOrUpgrade(params: {
    threadId: string;
    planId: string;
    type: RelationType;
  }): Promise<PlanThreadRelation> {
    const { threadId, planId, type } = params;
    const store = useRelationStore.getState();
    const existing = store.get(planId, threadId);

    if (existing) {
      // Only upgrade, never downgrade
      if (canUpgrade(existing.type, type)) {
        return this.updateType(planId, threadId, type);
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

    const filePath = getRelationPath(planId, threadId);

    // Apply optimistically, then persist
    const rollback = store._applyCreate(relation);
    try {
      await appData.ensureDir(RELATIONS_DIR);
      await appData.writeJson(filePath, relation);
    } catch (error) {
      rollback();
      logger.error(`[relationService:createOrUpgrade] Failed to create relation:`, error);
      throw error;
    }

    eventBus.emit(EventName.RELATION_CREATED, { planId, threadId, type });

    return relation;
  }

  /**
   * Update the type of an existing relation.
   * Per Decision #13: Only upgrades are allowed.
   */
  async updateType(
    planId: string,
    threadId: string,
    newType: RelationType
  ): Promise<PlanThreadRelation> {
    const store = useRelationStore.getState();
    const existing = store.get(planId, threadId);

    if (!existing) {
      throw new Error(`Relation not found: ${planId}-${threadId}`);
    }

    if (!canUpgrade(existing.type, newType)) {
      // Cannot downgrade - return existing unchanged
      return existing;
    }

    const previousType = existing.type;
    const updates = { type: newType, updatedAt: Date.now() };
    const filePath = getRelationPath(planId, threadId);

    // Apply optimistically, then persist
    const rollback = store._applyUpdate(planId, threadId, updates);
    try {
      const raw = await appData.readJson<PlanThreadRelation>(filePath);
      const merged = { ...(raw ?? existing), ...updates };
      await appData.writeJson(filePath, merged);
      logger.debug(`[relationService:updateType] Updated relation: ${planId}-${threadId} (${previousType} -> ${newType})`);
    } catch (error) {
      rollback();
      logger.error(`[relationService:updateType] Failed to update relation:`, error);
      throw error;
    }

    eventBus.emit(EventName.RELATION_UPDATED, { planId, threadId, type: newType, previousType });

    return { ...existing, ...updates };
  }

  /**
   * Archive relations for a thread.
   * Moves relation files to archive dir and removes from store.
   */
  async archiveByThread(threadId: string): Promise<void> {
    const store = useRelationStore.getState();
    const relations = store.getByThread(threadId);

    for (const relation of relations) {
      await this.moveToArchive(relation);
    }
    if (relations.length > 0) {
      logger.debug(`[relationService:archiveByThread] Archived ${relations.length} relations for thread ${threadId}`);
    }
  }

  /**
   * Archive relations for a plan.
   * Moves relation files to archive dir and removes from store.
   */
  async archiveByPlan(planId: string): Promise<void> {
    const store = useRelationStore.getState();
    const relations = store.getByPlan(planId);

    for (const relation of relations) {
      await this.moveToArchive(relation);
    }
    if (relations.length > 0) {
      logger.debug(`[relationService:archiveByPlan] Archived ${relations.length} relations for plan ${planId}`);
    }
  }

  /**
   * Query relations by plan (active only).
   */
  getByPlan(planId: string): PlanThreadRelation[] {
    return useRelationStore.getState().getByPlan(planId);
  }

  /**
   * Query relations by thread (active only).
   */
  getByThread(threadId: string): PlanThreadRelation[] {
    return useRelationStore.getState().getByThread(threadId);
  }

  /**
   * Query relations by plan including archived (for history).
   */
  getByPlanIncludingArchived(planId: string): PlanThreadRelation[] {
    return useRelationStore.getState().getByPlanIncludingArchived(planId);
  }

  /**
   * Query relations by thread including archived (for history).
   */
  getByThreadIncludingArchived(threadId: string): PlanThreadRelation[] {
    return useRelationStore.getState().getByThreadIncludingArchived(threadId);
  }

  /**
   * Move a single relation file to the archive directory and remove from store.
   * No-op if the file was already moved (handles double-archive race).
   */
  private async moveToArchive(relation: PlanThreadRelation): Promise<void> {
    const store = useRelationStore.getState();
    const activePath = getRelationPath(relation.planId, relation.threadId);
    const archivePath = getArchiveRelationPath(relation.planId, relation.threadId);

    const archived = { ...relation, archived: true, updatedAt: Date.now() };

    store._applyDelete(relation.planId, relation.threadId);
    try {
      await appData.ensureDir(ARCHIVE_RELATIONS_DIR);
      await appData.writeJson(archivePath, archived);
      await appData.deleteFile(activePath);
    } catch (error) {
      logger.error(`[relationService:moveToArchive] Failed for ${relation.planId}-${relation.threadId}:`, error);
    }
  }

  /**
   * Remove orphaned relations where both plan and thread are missing from active stores.
   * Archive relations where only one side is missing.
   * Called after hydration to clean up stale edges.
   */
  async cleanupOrphaned(): Promise<void> {
    const store = useRelationStore.getState();
    const all = store.getAll();
    let archived = 0;
    let deleted = 0;

    for (const relation of all) {
      const planExists = !!usePlanStore.getState().getPlan(relation.planId);
      const threadExists = !!useThreadStore.getState().getThread(relation.threadId);

      if (!planExists && !threadExists) {
        // Both missing — delete completely
        store._applyDelete(relation.planId, relation.threadId);
        await appData.deleteFile(getRelationPath(relation.planId, relation.threadId));
        deleted++;
      } else if (!planExists || !threadExists) {
        // One side missing — archive
        await this.moveToArchive(relation);
        archived++;
      }
    }

    if (archived > 0 || deleted > 0) {
      logger.info(`[relationService:cleanupOrphaned] Archived ${archived}, deleted ${deleted} orphaned relations`);
    }
  }

  /**
   * Hydrate store from disk at app startup.
   */
  async hydrate(): Promise<void> {
    logger.debug("[relationService:hydrate] Starting relation hydration...");

    await appData.ensureDir(RELATIONS_DIR);
    const files = await appData.listDir(RELATIONS_DIR);
    const relations: Record<string, PlanThreadRelation> = {};

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await appData.readJson(`${RELATIONS_DIR}/${file}`);
        const result = raw ? PlanThreadRelationSchema.safeParse(raw) : null;
        if (result?.success) {
          const key = makeKey(result.data.planId, result.data.threadId);
          relations[key] = result.data;
        } else if (result) {
          logger.warn(`[relationService:hydrate] Invalid relation file ${file}:`, result.error.message);
        }
      } catch (error) {
        // Skip invalid files
        logger.warn(`[relationService:hydrate] Failed to load relation file: ${file}`, error);
      }
    }

    logger.debug(`[relationService:hydrate] Complete. Loaded ${Object.keys(relations).length} relations`);
    useRelationStore.getState().hydrate(relations);
  }

  /**
   * Refresh relations for a specific thread from disk.
   * Called when THREAD_UPDATED event is received.
   * Loads any new or updated relations from disk into the store.
   */
  async refreshByThread(threadId: string): Promise<void> {
    // Per-thread refresh debug logging removed — fires on every THREAD_UPDATED event

    await appData.ensureDir(RELATIONS_DIR);
    const files = await appData.listDir(RELATIONS_DIR);
    const store = useRelationStore.getState();

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      // Quick filter by threadId in filename (format: {planId}-{threadId}.json)
      if (!file.includes(threadId)) continue;

      try {
        const raw = await appData.readJson(`${RELATIONS_DIR}/${file}`);
        const result = raw ? PlanThreadRelationSchema.safeParse(raw) : null;

        if (result?.success && result.data.threadId === threadId) {
          const key = makeKey(result.data.planId, result.data.threadId);
          const existing = store.relations[key];

          if (!existing) {
            // New relation from disk - add to store
            store._applyCreate(result.data);
            // New relation discovered from disk
          } else if (result.data.updatedAt > existing.updatedAt) {
            // Disk version is newer - update store
            store._applyUpdate(result.data.planId, result.data.threadId, result.data);
            // Disk version is newer — updated in store
          }
        }
      } catch (error) {
        logger.warn(`[relationService:refreshByThread] Failed to load relation file: ${file}`, error);
      }
    }
  }

  /**
   * Refresh relations for a specific plan from disk.
   * Called when PLAN_UPDATED event is received.
   * Loads any new or updated relations from disk into the store.
   */
  async refreshByPlan(planId: string): Promise<void> {
    // Per-plan refresh debug logging removed — fires on every PLAN_UPDATED event

    await appData.ensureDir(RELATIONS_DIR);
    const files = await appData.listDir(RELATIONS_DIR);
    const store = useRelationStore.getState();

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      // Quick filter by planId in filename (format: {planId}-{threadId}.json)
      if (!file.includes(planId)) continue;

      try {
        const raw = await appData.readJson(`${RELATIONS_DIR}/${file}`);
        const result = raw ? PlanThreadRelationSchema.safeParse(raw) : null;

        if (result?.success && result.data.planId === planId) {
          const key = makeKey(result.data.planId, result.data.threadId);
          const existing = store.relations[key];

          if (!existing) {
            // New relation from disk - add to store
            store._applyCreate(result.data);
            // New relation discovered from disk
          } else if (result.data.updatedAt > existing.updatedAt) {
            // Disk version is newer - update store
            store._applyUpdate(result.data.planId, result.data.threadId, result.data);
            // Disk version is newer — updated in store
          }
        }
      } catch (error) {
        logger.warn(`[relationService:refreshByPlan] Failed to load relation file: ${file}`, error);
      }
    }
  }
}

export const relationService = new RelationService();
