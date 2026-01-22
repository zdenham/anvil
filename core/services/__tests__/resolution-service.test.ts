import { describe, it, expect, vi } from "vitest";
import { ResolutionService } from "../resolution-service";
import type { FSAdapter } from "../fs-adapter";
import type { ThreadMetadata } from "@core/types/threads.js";

/**
 * Create a complete ThreadMetadata object for testing.
 */
function createThreadMetadata(overrides: Partial<ThreadMetadata> = {}): ThreadMetadata {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    repoId: "550e8400-e29b-41d4-a716-446655440002",
    worktreeId: "550e8400-e29b-41d4-a716-446655440003",
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
  const threadId = "550e8400-e29b-41d4-a716-446655440001";

  describe("resolveThread", () => {
    it("should resolve thread by ID using hint (O(1) path)", async () => {
      const threadMeta = JSON.stringify(createThreadMetadata({ id: threadId }));
      const fs = createMockFS({
        [`threads/${threadId}/metadata.json`]: threadMeta,
      });
      const service = new ResolutionService(fs, "threads");

      const result = await service.resolveThread(threadId, `threads/${threadId}`);

      expect(result).toEqual({
        threadId,
        threadDir: `threads/${threadId}`,
      });
      expect(fs.glob).not.toHaveBeenCalled();
    });

    it("should fall back to glob scan when hint is wrong", async () => {
      const threadMeta = JSON.stringify(createThreadMetadata({ id: threadId }));
      const fs = createMockFS({
        [`threads/${threadId}/metadata.json`]: threadMeta,
      });
      // Glob returns path relative to threadsDir, service will join with threadsDir
      (fs.glob as ReturnType<typeof vi.fn>).mockResolvedValue([
        `${threadId}/metadata.json`,
      ]);
      const service = new ResolutionService(fs, "threads");

      const result = await service.resolveThread(threadId, "threads/wrong-hint");

      // Falls back to glob
      expect(fs.glob).toHaveBeenCalled();
      expect(result?.threadId).toBe(threadId);
    });

    it("should return null when thread not found", async () => {
      const fs = createMockFS({});
      const service = new ResolutionService(fs, "threads");

      const result = await service.resolveThread("nonexistent");

      expect(result).toBeNull();
    });

    it("should return null when hint path does not match thread ID", async () => {
      const wrongThreadId = "550e8400-e29b-41d4-a716-446655440099";
      const threadMeta = JSON.stringify(createThreadMetadata({ id: wrongThreadId }));
      const fs = createMockFS({
        [`threads/${wrongThreadId}/metadata.json`]: threadMeta,
      });
      const service = new ResolutionService(fs, "threads");

      // Hint path has wrong thread ID
      const result = await service.resolveThread(threadId, `threads/${wrongThreadId}`);

      // Should fall back to glob (which returns empty) and return null
      expect(result).toBeNull();
    });
  });

  describe("thread resolution with glob fallback", () => {
    it("should find thread via glob when hint is missing", async () => {
      const threadMeta = JSON.stringify(createThreadMetadata({ id: threadId }));
      const fs = createMockFS({
        [`threads/${threadId}/metadata.json`]: threadMeta,
      });
      (fs.glob as ReturnType<typeof vi.fn>).mockResolvedValue([
        `${threadId}/metadata.json`,
      ]);
      const service = new ResolutionService(fs, "threads");

      // No hint provided
      const result = await service.resolveThread(threadId);

      expect(fs.glob).toHaveBeenCalled();
      expect(result?.threadId).toBe(threadId);
    });
  });
});
