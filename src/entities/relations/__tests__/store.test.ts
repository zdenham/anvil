/**
 * Relation Store Tests
 *
 * Tests for useRelationStore including:
 * - Hydration
 * - Optimistic apply methods with rollback
 * - Selectors (getByPlan, getByThread, archived filtering)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useRelationStore } from "../store";
import type { PlanThreadRelation } from "@core/types/relations.js";

// Helper to create valid PlanThreadRelation
function createRelation(overrides: Partial<PlanThreadRelation> = {}): PlanThreadRelation {
  const now = Date.now();
  return {
    planId: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    type: "mentioned",
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("useRelationStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    useRelationStore.setState({
      relations: {},
      _relationsArray: [],
      _hydrated: false,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("hydrate", () => {
    it("should set _hydrated flag to true", () => {
      useRelationStore.getState().hydrate({});

      expect(useRelationStore.getState()._hydrated).toBe(true);
    });

    it("should populate relations record from input", () => {
      const relation1 = createRelation({ planId: "plan1", threadId: "thread1" });
      const relation2 = createRelation({ planId: "plan2", threadId: "thread2" });
      const key1 = `${relation1.planId}-${relation1.threadId}`;
      const key2 = `${relation2.planId}-${relation2.threadId}`;

      useRelationStore.getState().hydrate({
        [key1]: relation1,
        [key2]: relation2,
      });

      expect(useRelationStore.getState().relations[key1]).toEqual(relation1);
      expect(useRelationStore.getState().relations[key2]).toEqual(relation2);
    });

    it("should populate _relationsArray cache", () => {
      const relation1 = createRelation({ planId: "plan1", threadId: "thread1" });
      const relation2 = createRelation({ planId: "plan2", threadId: "thread2" });
      const key1 = `${relation1.planId}-${relation1.threadId}`;
      const key2 = `${relation2.planId}-${relation2.threadId}`;

      useRelationStore.getState().hydrate({
        [key1]: relation1,
        [key2]: relation2,
      });

      const relationsArray = useRelationStore.getState()._relationsArray;
      expect(relationsArray).toHaveLength(2);
      expect(relationsArray).toContainEqual(relation1);
      expect(relationsArray).toContainEqual(relation2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getAll Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getAll", () => {
    it("should return only non-archived relations", () => {
      const active = createRelation({ planId: "plan1", threadId: "thread1", archived: false });
      const archived = createRelation({ planId: "plan2", threadId: "thread2", archived: true });

      useRelationStore.getState()._applyCreate(active);
      useRelationStore.getState()._applyCreate(archived);

      const result = useRelationStore.getState().getAll();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(active);
    });

    it("should return empty array when no relations exist", () => {
      const result = useRelationStore.getState().getAll();

      expect(result).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // get Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("get", () => {
    it("should return relation by planId and threadId", () => {
      const relation = createRelation({ planId: "plan1", threadId: "thread1" });
      useRelationStore.getState()._applyCreate(relation);

      const result = useRelationStore.getState().get("plan1", "thread1");

      expect(result).toEqual(relation);
    });

    it("should return undefined for non-existent relation", () => {
      const result = useRelationStore.getState().get("nonexistent-plan", "nonexistent-thread");

      expect(result).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getByPlan Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getByPlan", () => {
    it("should return all non-archived relations for a plan", () => {
      const planId = "plan1";
      const relation1 = createRelation({ planId, threadId: "thread1", archived: false });
      const relation2 = createRelation({ planId, threadId: "thread2", archived: false });
      const otherPlanRelation = createRelation({ planId: "plan2", threadId: "thread3" });

      useRelationStore.getState()._applyCreate(relation1);
      useRelationStore.getState()._applyCreate(relation2);
      useRelationStore.getState()._applyCreate(otherPlanRelation);

      const result = useRelationStore.getState().getByPlan(planId);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(relation1);
      expect(result).toContainEqual(relation2);
    });

    it("should not include archived relations", () => {
      const planId = "plan1";
      const active = createRelation({ planId, threadId: "thread1", archived: false });
      const archived = createRelation({ planId, threadId: "thread2", archived: true });

      useRelationStore.getState()._applyCreate(active);
      useRelationStore.getState()._applyCreate(archived);

      const result = useRelationStore.getState().getByPlan(planId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(active);
    });

    it("should return empty array for plan with no relations", () => {
      const result = useRelationStore.getState().getByPlan("nonexistent-plan");

      expect(result).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getByThread Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getByThread", () => {
    it("should return all non-archived relations for a thread", () => {
      const threadId = "thread1";
      const relation1 = createRelation({ planId: "plan1", threadId, archived: false });
      const relation2 = createRelation({ planId: "plan2", threadId, archived: false });
      const otherThreadRelation = createRelation({ planId: "plan3", threadId: "thread2" });

      useRelationStore.getState()._applyCreate(relation1);
      useRelationStore.getState()._applyCreate(relation2);
      useRelationStore.getState()._applyCreate(otherThreadRelation);

      const result = useRelationStore.getState().getByThread(threadId);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(relation1);
      expect(result).toContainEqual(relation2);
    });

    it("should not include archived relations", () => {
      const threadId = "thread1";
      const active = createRelation({ planId: "plan1", threadId, archived: false });
      const archived = createRelation({ planId: "plan2", threadId, archived: true });

      useRelationStore.getState()._applyCreate(active);
      useRelationStore.getState()._applyCreate(archived);

      const result = useRelationStore.getState().getByThread(threadId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(active);
    });

    it("should return empty array for thread with no relations", () => {
      const result = useRelationStore.getState().getByThread("nonexistent-thread");

      expect(result).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getByPlanIncludingArchived Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getByPlanIncludingArchived", () => {
    it("should return all relations including archived", () => {
      const planId = "plan1";
      const active = createRelation({ planId, threadId: "thread1", archived: false });
      const archived = createRelation({ planId, threadId: "thread2", archived: true });

      useRelationStore.getState()._applyCreate(active);
      useRelationStore.getState()._applyCreate(archived);

      const result = useRelationStore.getState().getByPlanIncludingArchived(planId);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(active);
      expect(result).toContainEqual(archived);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getByThreadIncludingArchived Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getByThreadIncludingArchived", () => {
    it("should return all relations including archived", () => {
      const threadId = "thread1";
      const active = createRelation({ planId: "plan1", threadId, archived: false });
      const archived = createRelation({ planId: "plan2", threadId, archived: true });

      useRelationStore.getState()._applyCreate(active);
      useRelationStore.getState()._applyCreate(archived);

      const result = useRelationStore.getState().getByThreadIncludingArchived(threadId);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(active);
      expect(result).toContainEqual(archived);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _applyCreate Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("_applyCreate", () => {
    it("should add relation to store", () => {
      const relation = createRelation({ planId: "plan1", threadId: "thread1" });

      useRelationStore.getState()._applyCreate(relation);

      const key = `${relation.planId}-${relation.threadId}`;
      expect(useRelationStore.getState().relations[key]).toEqual(relation);
    });

    it("should update _relationsArray cache", () => {
      const relation = createRelation({ planId: "plan1", threadId: "thread1" });

      useRelationStore.getState()._applyCreate(relation);

      expect(useRelationStore.getState()._relationsArray).toContainEqual(relation);
    });

    it("should return rollback function that removes the relation", () => {
      const relation = createRelation({ planId: "plan1", threadId: "thread1" });

      const rollback = useRelationStore.getState()._applyCreate(relation);

      const key = `${relation.planId}-${relation.threadId}`;
      expect(useRelationStore.getState().relations[key]).toBeDefined();

      rollback();

      expect(useRelationStore.getState().relations[key]).toBeUndefined();
      expect(useRelationStore.getState()._relationsArray).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _applyUpdate Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("_applyUpdate", () => {
    it("should update existing relation", () => {
      const relation = createRelation({ planId: "plan1", threadId: "thread1", type: "mentioned" });
      useRelationStore.getState()._applyCreate(relation);

      useRelationStore.getState()._applyUpdate("plan1", "thread1", { type: "modified" });

      const result = useRelationStore.getState().get("plan1", "thread1");
      expect(result?.type).toBe("modified");
    });

    it("should update _relationsArray cache", () => {
      const relation = createRelation({ planId: "plan1", threadId: "thread1", type: "mentioned" });
      useRelationStore.getState()._applyCreate(relation);

      useRelationStore.getState()._applyUpdate("plan1", "thread1", { type: "modified" });

      const found = useRelationStore.getState()._relationsArray.find(
        r => r.planId === "plan1" && r.threadId === "thread1"
      );
      expect(found?.type).toBe("modified");
    });

    it("should return rollback function that restores previous state", () => {
      const relation = createRelation({ planId: "plan1", threadId: "thread1", type: "mentioned" });
      useRelationStore.getState()._applyCreate(relation);

      const rollback = useRelationStore.getState()._applyUpdate("plan1", "thread1", { type: "modified" });

      expect(useRelationStore.getState().get("plan1", "thread1")?.type).toBe("modified");

      rollback();

      expect(useRelationStore.getState().get("plan1", "thread1")?.type).toBe("mentioned");
    });

    it("should return no-op rollback if relation does not exist", () => {
      const rollback = useRelationStore.getState()._applyUpdate("nonexistent", "nonexistent", { type: "modified" });

      // Should not throw
      rollback();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _applyDelete Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("_applyDelete", () => {
    it("should remove relation from store", () => {
      const relation = createRelation({ planId: "plan1", threadId: "thread1" });
      useRelationStore.getState()._applyCreate(relation);

      useRelationStore.getState()._applyDelete("plan1", "thread1");

      expect(useRelationStore.getState().get("plan1", "thread1")).toBeUndefined();
    });

    it("should update _relationsArray cache", () => {
      const relation = createRelation({ planId: "plan1", threadId: "thread1" });
      useRelationStore.getState()._applyCreate(relation);
      expect(useRelationStore.getState()._relationsArray).toHaveLength(1);

      useRelationStore.getState()._applyDelete("plan1", "thread1");

      expect(useRelationStore.getState()._relationsArray).toHaveLength(0);
    });

    it("should return rollback function that restores the relation", () => {
      const relation = createRelation({ planId: "plan1", threadId: "thread1" });
      useRelationStore.getState()._applyCreate(relation);

      const rollback = useRelationStore.getState()._applyDelete("plan1", "thread1");

      expect(useRelationStore.getState().get("plan1", "thread1")).toBeUndefined();

      rollback();

      expect(useRelationStore.getState().get("plan1", "thread1")).toEqual(relation);
    });

    it("should return no-op rollback if relation does not exist", () => {
      const rollback = useRelationStore.getState()._applyDelete("nonexistent", "nonexistent");

      // Should not throw
      rollback();
    });
  });
});
