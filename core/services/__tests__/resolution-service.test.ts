import { describe, it, expect, vi } from "vitest";
import { ResolutionService } from "../resolution-service";
import type { FSAdapter } from "../fs-adapter";
import type { TaskMetadata } from "@core/types/tasks";
import type { ThreadMetadata } from "@core/types/threads.js";

/**
 * Create a complete TaskMetadata object for testing.
 */
function createTaskMetadata(overrides: Partial<TaskMetadata> = {}): TaskMetadata {
  return {
    id: "task-123",
    slug: "my-feature",
    title: "My Feature",
    branchName: "task/my-feature",
    type: "work",
    subtasks: [],
    status: "todo",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    parentId: null,
    tags: [],
    sortOrder: 0,
    pendingReviews: [],
    ...overrides,
  };
}

/**
 * Create a complete ThreadMetadata object for testing.
 */
function createThreadMetadata(overrides: Partial<ThreadMetadata> = {}): ThreadMetadata {
  return {
    id: "thread-456",
    taskId: "task-123",
    agentType: "executor",
    workingDirectory: "/path/to/work",
    status: "idle",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isRead: true,
    turns: [],
    ...overrides,
  };
}

function createMockFS(files: Record<string, string> = {}): FSAdapter {
  return {
    exists: vi.fn(async (path: string) => path in files),
    readFile: vi.fn(async (path: string) => files[path] ?? ""),
    writeFile: vi.fn(async () => {}),
    readDir: vi.fn(async (path: string) => {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const dirs = new Set<string>();
      for (const key of Object.keys(files)) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const firstDir = rest.split("/")[0];
          if (firstDir) dirs.add(firstDir);
        }
      }
      return Array.from(dirs);
    }),
    glob: vi.fn(async () => []),
    mkdir: vi.fn(async () => {}),
  };
}

describe("ResolutionService", () => {
  describe("resolveTask", () => {
    it("should resolve task by ID using hint (O(1) path)", async () => {
      const taskMeta = JSON.stringify(createTaskMetadata({
        id: "task-123",
        slug: "my-feature",
        branchName: "task/my-feature",
      }));
      const fs = createMockFS({
        "tasks/my-feature/metadata.json": taskMeta,
      });
      const service = new ResolutionService(fs, "tasks");

      const result = await service.resolveTask("task-123", "my-feature");

      expect(result).toEqual({
        taskId: "task-123",
        slug: "my-feature",
        taskDir: "tasks/my-feature",
        branchName: "task/my-feature",
      });
      expect(fs.readDir).not.toHaveBeenCalled();
    });

    it("should fall back to directory scan when hint is wrong", async () => {
      const taskMeta = JSON.stringify(createTaskMetadata({
        id: "task-123",
        slug: "renamed-feature",
        branchName: "task/renamed-feature",
      }));
      const fs = createMockFS({
        "tasks/renamed-feature/metadata.json": taskMeta,
      });
      const service = new ResolutionService(fs, "tasks");

      const result = await service.resolveTask("task-123", "old-slug");

      expect(result).toEqual({
        taskId: "task-123",
        slug: "renamed-feature",
        taskDir: "tasks/renamed-feature",
        branchName: "task/renamed-feature",
      });
      expect(fs.readDir).toHaveBeenCalled();
    });

    it("should return null when task not found", async () => {
      const fs = createMockFS({});
      const service = new ResolutionService(fs, "tasks");

      const result = await service.resolveTask("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("task rename during thread execution", () => {
    it("should continue writing to correct location after rename", async () => {
      // 1. Create task with slug "draft-abc123"
      // 2. Start thread execution
      // 3. Rename task to "my-feature" mid-execution
      // 4. Verify state.json written to tasks/my-feature/threads/...
      // 5. Verify metadata.json in correct location
      const taskMeta = JSON.stringify(createTaskMetadata({
        id: "task-123",
        slug: "my-feature",
        branchName: "task/my-feature",
      }));
      const fs = createMockFS({
        "tasks/my-feature/metadata.json": taskMeta,
      });
      const service = new ResolutionService(fs, "tasks");

      // Simulate: hint was "draft-abc123" but task was renamed to "my-feature"
      const result = await service.resolveTask("task-123", "draft-abc123");

      expect(result?.slug).toBe("my-feature");
      expect(result?.taskDir).toBe("tasks/my-feature");
    });
  });

  describe("thread resume after task rename", () => {
    it("should find thread by ID even if task was renamed", async () => {
      // 1. Create task, start thread, write state
      // 2. Stop thread
      // 3. Rename task
      // 4. Resume thread by ID
      // 5. Verify thread found and continues correctly
      const threadMeta = JSON.stringify(createThreadMetadata({
        id: "thread-456",
        taskId: "task-123",
        agentType: "executor",
      }));
      const fs = createMockFS({
        "tasks/renamed-feature/threads/001-thread-456/metadata.json": threadMeta,
      });
      (fs.glob as ReturnType<typeof vi.fn>).mockResolvedValue([
        "renamed-feature/threads/001-thread-456/metadata.json",
      ]);
      const service = new ResolutionService(fs, "tasks");

      // Old hint path is now invalid
      const result = await service.resolveThread(
        "thread-456",
        "tasks/old-feature/threads/001-thread-456"
      );

      expect(result?.threadId).toBe("thread-456");
      expect(result?.taskSlug).toBe("renamed-feature");
    });
  });

  describe("concurrent operations", () => {
    it("should handle rename and write happening simultaneously", async () => {
      // Edge case: write starts, rename happens, write completes
      // Should either succeed at new location or fail gracefully
      const taskMeta = JSON.stringify(createTaskMetadata({
        id: "task-123",
        slug: "new-slug",
        branchName: "task/new-slug",
      }));
      const fs = createMockFS({
        "tasks/new-slug/metadata.json": taskMeta,
      });

      // Simulate exists returning false on first call (old location),
      // then readDir finds the new location
      let existsCallCount = 0;
      (fs.exists as ReturnType<typeof vi.fn>).mockImplementation(
        async (path: string) => {
          existsCallCount++;
          if (path.includes("old-slug")) return false;
          return path in { "tasks/new-slug/metadata.json": true };
        }
      );

      const service = new ResolutionService(fs, "tasks");
      const result = await service.resolveTask("task-123", "old-slug");

      // Should fall back and find at new location
      expect(result?.slug).toBe("new-slug");
    });
  });
});
