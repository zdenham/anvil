// @vitest-environment node
/**
 * Thread Schema Tests
 *
 * Tests for ThreadMetadata Zod schema including:
 * - Required fields (repoId, worktreeId)
 * - Rejection of legacy fields (planId, agentType, workingDirectory)
 *   Note: taskId is explicitly excluded from the schema - threads are the primary entity
 * - Field validation
 */

import { describe, it, expect } from "vitest";
import { ThreadMetadataSchema, ThreadMetadataBaseSchema } from "@core/types/threads";

describe("ThreadMetadataSchema", () => {
  // Helper to create a valid base object
  function createValidMetadata() {
    const now = Date.now();
    return {
      id: "550e8400-e29b-41d4-a716-446655440000",
      repoId: "550e8400-e29b-41d4-a716-446655440001",
      worktreeId: "550e8400-e29b-41d4-a716-446655440002",
      status: "idle",
      createdAt: now,
      updatedAt: now,
      turns: [
        {
          index: 0,
          prompt: "Test prompt",
          startedAt: now,
          completedAt: null,
        },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Required Field Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("required fields", () => {
    it("accepts valid metadata with all required fields", () => {
      const valid = createValidMetadata();

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
    });

    it("requires repoId field", () => {
      const { repoId, ...missingRepoId } = createValidMetadata();

      const result = ThreadMetadataSchema.safeParse(missingRepoId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("repoId");
      }
    });

    it("requires worktreeId field", () => {
      const { worktreeId, ...missingWorktreeId } = createValidMetadata();

      const result = ThreadMetadataSchema.safeParse(missingWorktreeId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("worktreeId");
      }
    });

    it("requires id to be a valid UUID", () => {
      const invalid = {
        ...createValidMetadata(),
        id: "not-a-uuid",
      };

      const result = ThreadMetadataSchema.safeParse(invalid);

      expect(result.success).toBe(false);
    });

    it("requires repoId to be a valid UUID", () => {
      const invalid = {
        ...createValidMetadata(),
        repoId: "not-a-uuid",
      };

      const result = ThreadMetadataSchema.safeParse(invalid);

      expect(result.success).toBe(false);
    });

    it("requires worktreeId to be a valid UUID", () => {
      const invalid = {
        ...createValidMetadata(),
        worktreeId: "not-a-uuid",
      };

      const result = ThreadMetadataSchema.safeParse(invalid);

      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Legacy Field Rejection Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("legacy field handling", () => {
    it("does NOT include planId in the schema", () => {
      // Check that planId is not a known key in the base schema
      const baseSchemaKeys = Object.keys(ThreadMetadataBaseSchema.shape);
      expect(baseSchemaKeys).not.toContain("planId");
    });

    it("does NOT include taskId in the schema", () => {
      const baseSchemaKeys = Object.keys(ThreadMetadataBaseSchema.shape);
      expect(baseSchemaKeys).not.toContain("taskId");
    });

    it("does NOT include workingDirectory in the schema", () => {
      const baseSchemaKeys = Object.keys(ThreadMetadataBaseSchema.shape);
      expect(baseSchemaKeys).not.toContain("workingDirectory");
    });

    it("strips unknown fields when parsing (passthrough not enabled)", () => {
      const withLegacyFields = {
        ...createValidMetadata(),
        taskId: "legacy-task-id",
        workingDirectory: "/some/path",
        planId: "some-plan-id",
      };

      const result = ThreadMetadataSchema.safeParse(withLegacyFields);

      // Schema should still parse successfully, but strip unknown fields
      expect(result.success).toBe(true);
      if (result.success) {
        // TypeScript type should not have these fields
        const data = result.data as any;
        expect(data.taskId).toBeUndefined();
        expect(data.workingDirectory).toBeUndefined();
        expect(data.planId).toBeUndefined();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Sub-agent Field Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("sub-agent fields", () => {
    it("accepts parentThreadId as a valid UUID", () => {
      const valid = {
        ...createValidMetadata(),
        parentThreadId: "550e8400-e29b-41d4-a716-446655440003",
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.parentThreadId).toBe("550e8400-e29b-41d4-a716-446655440003");
      }
    });

    it("rejects parentThreadId if not a valid UUID", () => {
      const invalid = {
        ...createValidMetadata(),
        parentThreadId: "not-a-uuid",
      };

      const result = ThreadMetadataSchema.safeParse(invalid);

      expect(result.success).toBe(false);
    });

    it("accepts parentToolUseId string", () => {
      const valid = {
        ...createValidMetadata(),
        parentToolUseId: "toolu_01ABC123",
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.parentToolUseId).toBe("toolu_01ABC123");
      }
    });

    it("accepts agentType string", () => {
      const valid = {
        ...createValidMetadata(),
        agentType: "Explore",
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentType).toBe("Explore");
      }
    });

    it("accepts all sub-agent fields together", () => {
      const valid = {
        ...createValidMetadata(),
        parentThreadId: "550e8400-e29b-41d4-a716-446655440003",
        parentToolUseId: "toolu_01ABC123",
        agentType: "Plan",
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.parentThreadId).toBe("550e8400-e29b-41d4-a716-446655440003");
        expect(result.data.parentToolUseId).toBe("toolu_01ABC123");
        expect(result.data.agentType).toBe("Plan");
      }
    });

    it("treats thread as sub-agent when parentThreadId is present", () => {
      const valid = {
        ...createValidMetadata(),
        parentThreadId: "550e8400-e29b-41d4-a716-446655440003",
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
      if (result.success) {
        // Sub-agent detection: presence of parentThreadId
        const isSubAgent = result.data.parentThreadId !== undefined;
        expect(isSubAgent).toBe(true);
      }
    });

    it("treats thread as regular thread when parentThreadId is absent", () => {
      const valid = createValidMetadata();

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
      if (result.success) {
        // Regular thread: no parentThreadId
        const isSubAgent = result.data.parentThreadId !== undefined;
        expect(isSubAgent).toBe(false);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Status Field Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("status field", () => {
    const validStatuses = ["idle", "running", "completed", "error", "paused", "cancelled"] as const;

    it.each(validStatuses)("accepts status: %s", (status) => {
      const valid = {
        ...createValidMetadata(),
        status,
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
    });

    it("rejects invalid status", () => {
      const invalid = {
        ...createValidMetadata(),
        status: "invalid-status",
      };

      const result = ThreadMetadataSchema.safeParse(invalid);

      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Optional Field Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("optional fields", () => {
    it("accepts git field with branch", () => {
      const valid = {
        ...createValidMetadata(),
        git: {
          branch: "feature/test",
        },
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
    });

    it("accepts git field with optional commitHash", () => {
      const valid = {
        ...createValidMetadata(),
        git: {
          branch: "feature/test",
          initialCommitHash: "abc123",
          commitHash: "def456",
        },
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
    });

    it("accepts changedFilePaths array", () => {
      const valid = {
        ...createValidMetadata(),
        changedFilePaths: ["src/file1.ts", "src/file2.ts"],
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
    });

    it("accepts isRead boolean", () => {
      const valid = {
        ...createValidMetadata(),
        isRead: false,
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
    });

    it("defaults isRead to true when not provided", () => {
      const valid = createValidMetadata();
      // Ensure isRead is not in the input
      delete (valid as any).isRead;

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isRead).toBe(true);
      }
    });

    it("accepts pid field", () => {
      const valid = {
        ...createValidMetadata(),
        pid: 12345,
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
    });

    it("accepts pid as null", () => {
      const valid = {
        ...createValidMetadata(),
        pid: null,
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Turn Schema Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("turns field", () => {
    it("requires turns array", () => {
      const { turns, ...missingTurns } = createValidMetadata();

      const result = ThreadMetadataSchema.safeParse(missingTurns);

      expect(result.success).toBe(false);
    });

    it("accepts empty turns array", () => {
      const valid = {
        ...createValidMetadata(),
        turns: [],
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
    });

    it("validates turn structure", () => {
      const now = Date.now();
      const valid = {
        ...createValidMetadata(),
        turns: [
          {
            index: 0,
            prompt: "First prompt",
            startedAt: now,
            completedAt: now + 1000,
            exitCode: 0,
            costUsd: 0.01,
          },
          {
            index: 1,
            prompt: "Second prompt",
            startedAt: now + 2000,
            completedAt: null,
          },
        ],
      };

      const result = ThreadMetadataSchema.safeParse(valid);

      expect(result.success).toBe(true);
    });

    it("rejects turn with missing required fields", () => {
      const invalid = {
        ...createValidMetadata(),
        turns: [
          {
            index: 0,
            // missing prompt
            startedAt: Date.now(),
            completedAt: null,
          },
        ],
      };

      const result = ThreadMetadataSchema.safeParse(invalid);

      expect(result.success).toBe(false);
    });
  });
});
