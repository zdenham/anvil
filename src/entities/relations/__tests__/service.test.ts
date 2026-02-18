// @vitest-environment node
/**
 * Relation Service Tests
 *
 * Tests for relationService including:
 * - createOrUpgrade with precedence rules
 * - archiveByThread and archiveByPlan
 * - Hydration from disk
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useRelationStore } from "../store";
import { relationService } from "../service";
import type { PlanThreadRelation } from "@core/types/relations.js";

// Mock the persistence layer
vi.mock("@/lib/persistence", () => ({
  persistence: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    readJson: vi.fn().mockResolvedValue(null),
    listDir: vi.fn().mockResolvedValue([]),
  },
}));

// Mock the event bus
vi.mock("../../events", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

// Mock the logger
vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { appData } from "@/lib/app-data-store";
import { eventBus } from "../../events";
import { EventName } from "@core/types/events.js";

describe("RelationService", () => {
  beforeEach(() => {
    // Reset store to initial state
    useRelationStore.setState({
      relations: {},
      _relationsArray: [],
      _hydrated: false,
    });

    // Clear all mocks
    vi.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // createOrUpgrade Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("createOrUpgrade", () => {
    it("should create new relation when none exists", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      const result = await relationService.createOrUpgrade({
        planId,
        threadId,
        type: "mentioned",
      });

      expect(result.planId).toBe(planId);
      expect(result.threadId).toBe(threadId);
      expect(result.type).toBe("mentioned");
      expect(result.archived).toBe(false);
      expect(useRelationStore.getState().get(planId, threadId)).toBeDefined();
    });

    it("should persist relation to correct file path", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      await relationService.createOrUpgrade({
        planId,
        threadId,
        type: "mentioned",
      });

      expect(appData.ensureDir).toHaveBeenCalledWith("plan-thread-edges");
      expect(appData.writeJson).toHaveBeenCalledWith(
        `plan-thread-edges/${planId}-${threadId}.json`,
        expect.objectContaining({ planId, threadId, type: "mentioned" })
      );
    });

    it("should emit RELATION_CREATED event for new relation", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      await relationService.createOrUpgrade({
        planId,
        threadId,
        type: "mentioned",
      });

      expect(eventBus.emit).toHaveBeenCalledWith(
        EventName.RELATION_CREATED,
        { planId, threadId, type: "mentioned" }
      );
    });

    it("should upgrade mentioned to modified", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      // Create initial relation
      await relationService.createOrUpgrade({ planId, threadId, type: "mentioned" });
      vi.clearAllMocks();

      // Mock readJson to return the existing relation for updateType
      (appData.readJson as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        planId,
        threadId,
        type: "mentioned",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Upgrade
      const result = await relationService.createOrUpgrade({ planId, threadId, type: "modified" });

      expect(result.type).toBe("modified");
      expect(eventBus.emit).toHaveBeenCalledWith(
        EventName.RELATION_UPDATED,
        expect.objectContaining({ planId, threadId, type: "modified", previousType: "mentioned" })
      );
    });

    it("should upgrade mentioned to created", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId, threadId, type: "mentioned" });
      vi.clearAllMocks();

      (appData.readJson as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        planId,
        threadId,
        type: "mentioned",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const result = await relationService.createOrUpgrade({ planId, threadId, type: "created" });

      expect(result.type).toBe("created");
    });

    it("should upgrade modified to created", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId, threadId, type: "modified" });
      vi.clearAllMocks();

      (appData.readJson as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        planId,
        threadId,
        type: "modified",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const result = await relationService.createOrUpgrade({ planId, threadId, type: "created" });

      expect(result.type).toBe("created");
    });

    it("should NOT downgrade created to modified", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId, threadId, type: "created" });
      vi.clearAllMocks();

      const result = await relationService.createOrUpgrade({ planId, threadId, type: "modified" });

      expect(result.type).toBe("created");
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("should NOT downgrade created to mentioned", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId, threadId, type: "created" });
      vi.clearAllMocks();

      const result = await relationService.createOrUpgrade({ planId, threadId, type: "mentioned" });

      expect(result.type).toBe("created");
    });

    it("should NOT downgrade modified to mentioned", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId, threadId, type: "modified" });
      vi.clearAllMocks();

      const result = await relationService.createOrUpgrade({ planId, threadId, type: "mentioned" });

      expect(result.type).toBe("modified");
    });

    it("should return existing relation unchanged on attempted downgrade", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      const original = await relationService.createOrUpgrade({ planId, threadId, type: "created" });
      const result = await relationService.createOrUpgrade({ planId, threadId, type: "mentioned" });

      expect(result).toEqual(original);
    });

    it("should set correct timestamps on create", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();
      const before = Date.now();

      const result = await relationService.createOrUpgrade({ planId, threadId, type: "mentioned" });

      const after = Date.now();
      expect(result.createdAt).toBeGreaterThanOrEqual(before);
      expect(result.createdAt).toBeLessThanOrEqual(after);
      expect(result.updatedAt).toBeGreaterThanOrEqual(before);
      expect(result.updatedAt).toBeLessThanOrEqual(after);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // updateType Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("updateType", () => {
    it("should throw error if relation does not exist", async () => {
      await expect(
        relationService.updateType("nonexistent", "nonexistent", "modified")
      ).rejects.toThrow("Relation not found");
    });

    it("should upgrade relation type", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId, threadId, type: "mentioned" });
      vi.clearAllMocks();

      (appData.readJson as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        planId,
        threadId,
        type: "mentioned",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const result = await relationService.updateType(planId, threadId, "modified");

      expect(result.type).toBe("modified");
    });

    it("should return unchanged relation on attempted downgrade", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId, threadId, type: "created" });

      const result = await relationService.updateType(planId, threadId, "mentioned");

      expect(result.type).toBe("created");
    });

    it("should persist update to file", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId, threadId, type: "mentioned" });
      vi.clearAllMocks();

      (appData.readJson as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        planId,
        threadId,
        type: "mentioned",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await relationService.updateType(planId, threadId, "modified");

      expect(appData.writeJson).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // archiveByThread Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("archiveByThread", () => {
    it("should set archived=true on all relations for thread", async () => {
      const threadId = crypto.randomUUID();
      const planId1 = crypto.randomUUID();
      const planId2 = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId: planId1, threadId, type: "mentioned" });
      await relationService.createOrUpgrade({ planId: planId2, threadId, type: "modified" });

      // Setup mock for readJson calls during archive
      (appData.readJson as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          planId: planId1, threadId, type: "mentioned", archived: false, createdAt: Date.now(), updatedAt: Date.now()
        })
        .mockResolvedValueOnce({
          planId: planId2, threadId, type: "modified", archived: false, createdAt: Date.now(), updatedAt: Date.now()
        });

      await relationService.archiveByThread(threadId);

      const relations = useRelationStore.getState().getByThreadIncludingArchived(threadId);
      expect(relations.every(r => r.archived)).toBe(true);
    });

    it("should NOT delete the relation files", async () => {
      const threadId = crypto.randomUUID();
      const planId = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId, threadId, type: "mentioned" });

      (appData.readJson as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        planId, threadId, type: "mentioned", archived: false, createdAt: Date.now(), updatedAt: Date.now()
      });

      await relationService.archiveByThread(threadId);

      // Should update file, not delete
      expect(appData.writeJson).toHaveBeenCalled();
    });

    it("should handle thread with no relations gracefully", async () => {
      // Should not throw
      await relationService.archiveByThread("nonexistent-thread");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // archiveByPlan Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("archiveByPlan", () => {
    it("should set archived=true on all relations for plan", async () => {
      const planId = crypto.randomUUID();
      const threadId1 = crypto.randomUUID();
      const threadId2 = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId, threadId: threadId1, type: "mentioned" });
      await relationService.createOrUpgrade({ planId, threadId: threadId2, type: "modified" });

      (appData.readJson as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          planId, threadId: threadId1, type: "mentioned", archived: false, createdAt: Date.now(), updatedAt: Date.now()
        })
        .mockResolvedValueOnce({
          planId, threadId: threadId2, type: "modified", archived: false, createdAt: Date.now(), updatedAt: Date.now()
        });

      await relationService.archiveByPlan(planId);

      const relations = useRelationStore.getState().getByPlanIncludingArchived(planId);
      expect(relations.every(r => r.archived)).toBe(true);
    });

    it("should NOT delete the relation files", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId, threadId, type: "mentioned" });

      (appData.readJson as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        planId, threadId, type: "mentioned", archived: false, createdAt: Date.now(), updatedAt: Date.now()
      });

      await relationService.archiveByPlan(planId);

      expect(appData.writeJson).toHaveBeenCalled();
    });

    it("should handle plan with no relations gracefully", async () => {
      // Should not throw
      await relationService.archiveByPlan("nonexistent-plan");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getByPlan Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getByPlan", () => {
    it("should return non-archived relations for plan", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId, threadId, type: "mentioned" });

      const result = relationService.getByPlan(planId);

      expect(result).toHaveLength(1);
      expect(result[0].planId).toBe(planId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getByThread Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getByThread", () => {
    it("should return non-archived relations for thread", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      await relationService.createOrUpgrade({ planId, threadId, type: "mentioned" });

      const result = relationService.getByThread(threadId);

      expect(result).toHaveLength(1);
      expect(result[0].threadId).toBe(threadId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // hydrate Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("hydrate", () => {
    it("should load all relation files from plan-thread-edges directory", async () => {
      const planId = crypto.randomUUID();
      const threadId = crypto.randomUUID();

      (appData.listDir as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        `${planId}-${threadId}.json`,
      ]);

      (appData.readJson as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        planId,
        threadId,
        type: "mentioned",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await relationService.hydrate();

      expect(useRelationStore.getState()._hydrated).toBe(true);
      expect(useRelationStore.getState().get(planId, threadId)).toBeDefined();
    });

    it("should skip non-JSON files", async () => {
      (appData.listDir as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        "not-a-json.txt",
        "some-file.md",
      ]);

      await relationService.hydrate();

      expect(appData.readJson).not.toHaveBeenCalled();
    });

    it("should skip invalid JSON files without crashing", async () => {
      (appData.listDir as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        "invalid.json",
      ]);

      (appData.readJson as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        // Missing required fields
        invalid: true,
      });

      // Should not throw
      await relationService.hydrate();
    });

    it("should skip files missing required fields", async () => {
      (appData.listDir as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        "missing-fields.json",
      ]);

      (appData.readJson as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        planId: "some-plan",
        // Missing threadId and other required fields
      });

      await relationService.hydrate();

      // Should not add to store
      expect(useRelationStore.getState()._relationsArray).toHaveLength(0);
    });

    it("should hydrate store with loaded relations", async () => {
      const planId1 = crypto.randomUUID();
      const threadId1 = crypto.randomUUID();
      const planId2 = crypto.randomUUID();
      const threadId2 = crypto.randomUUID();

      (appData.listDir as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        `${planId1}-${threadId1}.json`,
        `${planId2}-${threadId2}.json`,
      ]);

      (appData.readJson as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          planId: planId1,
          threadId: threadId1,
          type: "mentioned",
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .mockResolvedValueOnce({
          planId: planId2,
          threadId: threadId2,
          type: "created",
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

      await relationService.hydrate();

      expect(useRelationStore.getState()._relationsArray).toHaveLength(2);
    });
  });
});
