import { persistence } from "@/lib/persistence";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { useRelationStore } from "./store";
import type { PlanThreadRelation, RelationType } from "@core/types/relations.js";
import { RELATION_TYPE_PRECEDENCE, PlanThreadRelationSchema } from "@core/types/relations.js";
import { logger } from "@/lib/logger-client";

const RELATIONS_DIR = "plan-thread-edges";

function getRelationPath(planId: string, threadId: string): string {
  return `${RELATIONS_DIR}/${planId}-${threadId}.json`;
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
      await persistence.ensureDir(RELATIONS_DIR);
      await persistence.writeJson(filePath, relation);
      logger.debug(`[relationService:createOrUpgrade] Created relation: ${planId}-${threadId} (${type})`);
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
      const raw = await persistence.readJson<PlanThreadRelation>(filePath);
      const merged = { ...(raw ?? existing), ...updates };
      await persistence.writeJson(filePath, merged);
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
   * Per Decision #14: Relations are preserved when threads are archived.
   * Sets archived=true but does NOT delete.
   */
  async archiveByThread(threadId: string): Promise<void> {
    const store = useRelationStore.getState();
    const relations = store.getByThread(threadId);

    for (const relation of relations) {
      const filePath = getRelationPath(relation.planId, relation.threadId);
      const updates = { archived: true, updatedAt: Date.now() };

      const rollback = store._applyUpdate(relation.planId, relation.threadId, updates);
      try {
        const raw = await persistence.readJson<PlanThreadRelation>(filePath);
        const merged = { ...(raw ?? relation), ...updates };
        await persistence.writeJson(filePath, merged);
      } catch (error) {
        rollback();
        logger.error(`[relationService:archiveByThread] Failed to archive relation:`, error);
        throw error;
      }
    }
    logger.debug(`[relationService:archiveByThread] Archived ${relations.length} relations for thread ${threadId}`);
  }

  /**
   * Archive relations for a plan.
   * Per Decision #14: Relations are preserved when plans are archived.
   */
  async archiveByPlan(planId: string): Promise<void> {
    const store = useRelationStore.getState();
    const relations = store.getByPlan(planId);

    for (const relation of relations) {
      const filePath = getRelationPath(relation.planId, relation.threadId);
      const updates = { archived: true, updatedAt: Date.now() };

      const rollback = store._applyUpdate(relation.planId, relation.threadId, updates);
      try {
        const raw = await persistence.readJson<PlanThreadRelation>(filePath);
        const merged = { ...(raw ?? relation), ...updates };
        await persistence.writeJson(filePath, merged);
      } catch (error) {
        rollback();
        logger.error(`[relationService:archiveByPlan] Failed to archive relation:`, error);
        throw error;
      }
    }
    logger.debug(`[relationService:archiveByPlan] Archived ${relations.length} relations for plan ${planId}`);
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
   * Hydrate store from disk at app startup.
   */
  async hydrate(): Promise<void> {
    logger.log("[relationService:hydrate] Starting relation hydration...");

    await persistence.ensureDir(RELATIONS_DIR);
    const files = await persistence.listDir(RELATIONS_DIR);
    const relations: Record<string, PlanThreadRelation> = {};

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await persistence.readJson(`${RELATIONS_DIR}/${file}`);
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

    logger.log(`[relationService:hydrate] Complete. Loaded ${Object.keys(relations).length} relations`);
    useRelationStore.getState().hydrate(relations);
  }

  /**
   * Refresh relations for a specific thread from disk.
   * Called when THREAD_UPDATED event is received.
   * Loads any new or updated relations from disk into the store.
   */
  async refreshByThread(threadId: string): Promise<void> {
    logger.debug(`[relationService:refreshByThread] Refreshing relations for thread ${threadId}`);

    await persistence.ensureDir(RELATIONS_DIR);
    const files = await persistence.listDir(RELATIONS_DIR);
    const store = useRelationStore.getState();

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      // Quick filter by threadId in filename (format: {planId}-{threadId}.json)
      if (!file.includes(threadId)) continue;

      try {
        const raw = await persistence.readJson(`${RELATIONS_DIR}/${file}`);
        const result = raw ? PlanThreadRelationSchema.safeParse(raw) : null;

        if (result?.success && result.data.threadId === threadId) {
          const key = makeKey(result.data.planId, result.data.threadId);
          const existing = store.relations[key];

          if (!existing) {
            // New relation from disk - add to store
            store._applyCreate(result.data);
            logger.debug(`[relationService:refreshByThread] Added new relation: ${key}`);
          } else if (result.data.updatedAt > existing.updatedAt) {
            // Disk version is newer - update store
            store._applyUpdate(result.data.planId, result.data.threadId, result.data);
            logger.debug(`[relationService:refreshByThread] Updated relation: ${key}`);
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
    logger.debug(`[relationService:refreshByPlan] Refreshing relations for plan ${planId}`);

    await persistence.ensureDir(RELATIONS_DIR);
    const files = await persistence.listDir(RELATIONS_DIR);
    const store = useRelationStore.getState();

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      // Quick filter by planId in filename (format: {planId}-{threadId}.json)
      if (!file.includes(planId)) continue;

      try {
        const raw = await persistence.readJson(`${RELATIONS_DIR}/${file}`);
        const result = raw ? PlanThreadRelationSchema.safeParse(raw) : null;

        if (result?.success && result.data.planId === planId) {
          const key = makeKey(result.data.planId, result.data.threadId);
          const existing = store.relations[key];

          if (!existing) {
            // New relation from disk - add to store
            store._applyCreate(result.data);
            logger.debug(`[relationService:refreshByPlan] Added new relation: ${key}`);
          } else if (result.data.updatedAt > existing.updatedAt) {
            // Disk version is newer - update store
            store._applyUpdate(result.data.planId, result.data.threadId, result.data);
            logger.debug(`[relationService:refreshByPlan] Updated relation: ${key}`);
          }
        }
      } catch (error) {
        logger.warn(`[relationService:refreshByPlan] Failed to load relation file: ${file}`, error);
      }
    }
  }
}

export const relationService = new RelationService();
