/**
 * Thread Integration Tests
 *
 * Tests for full lifecycle scenarios including:
 * - Create, archive, and list archived workflow
 * - Hydrate behavior with archived threads
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ThreadMetadata } from "../types";

// Mock dependencies - must be declared before vi.mock calls due to hoisting
vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/entities/events", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock("@/lib/persistence", () => ({
  persistence: {
    exists: vi.fn(),
    glob: vi.fn(),
    readJson: vi.fn(),
    writeJson: vi.fn(),
    ensureDir: vi.fn(),
    removeDir: vi.fn(),
  },
}));

// Import after mocks are set up
import { threadService } from "../service";
import { useThreadStore } from "../store";
import { appData } from "@/lib/app-data-store";
import { eventBus } from "@/entities/events";

const mockPersistence = vi.mocked(persistence);
const mockEventBus = vi.mocked(eventBus);

// Helper to create valid ThreadMetadata
function createThreadMetadata(overrides: Partial<ThreadMetadata> = {}): ThreadMetadata {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    repoId: crypto.randomUUID(),
    worktreeId: crypto.randomUUID(),
    status: "idle",
    createdAt: now,
    updatedAt: now,
    isRead: true,
    turns: [
      {
        index: 0,
        prompt: "Test prompt",
        startedAt: now,
        completedAt: null,
      },
    ],
    ...overrides,
  };
}

// Helper to setup default mock responses
function setupDefaultMocks() {
  mockPersistence.exists.mockResolvedValue(false);
  mockPersistence.glob.mockResolvedValue([]);
  mockPersistence.readJson.mockResolvedValue(null);
  mockPersistence.writeJson.mockResolvedValue(undefined);
  mockPersistence.ensureDir.mockResolvedValue(undefined);
  mockPersistence.removeDir.mockResolvedValue(undefined);
}

describe("threadService integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store to initial state
    useThreadStore.setState({
      threads: {},
      _threadsArray: [],
      activeThreadId: null,
      threadStates: {},
      activeThreadLoading: false,
      threadErrors: {},
      _hydrated: false,
    });
  });

  describe("full lifecycle: create, archive, listArchived", () => {
    it("creates a thread, archives it, then lists it in archived", async () => {
      setupDefaultMocks();

      // Track what gets written to "disk"
      const storedFiles: Record<string, unknown> = {};
      mockPersistence.writeJson.mockImplementation(async (path: string, data: unknown) => {
        storedFiles[path] = data;
      });

      mockPersistence.readJson.mockImplementation(async (path: string) => {
        return storedFiles[path] ?? null;
      });

      mockPersistence.exists.mockImplementation(async (path: string) => {
        return path in storedFiles;
      });

      // 1. Create a thread
      const input = {
        repoId: crypto.randomUUID(),
        worktreeId: crypto.randomUUID(),
        prompt: "Test integration prompt",
      };

      const created = await threadService.create(input);
      const threadId = created.id;

      // Verify thread exists in store
      expect(useThreadStore.getState().threads[threadId]).toBeDefined();
      expect(useThreadStore.getState().threads[threadId].status).toBe("idle");

      // 2. Archive the thread
      // Set up mocks for archive operation
      mockPersistence.glob.mockImplementation(async (pattern: string) => {
        if (pattern === "archive/threads/*/metadata.json") {
          if (storedFiles[`archive/threads/${threadId}/metadata.json`]) {
            return [`archive/threads/${threadId}/metadata.json`];
          }
        }
        return [];
      });

      await threadService.archive(threadId);

      // Verify thread NOT in main store after archive
      expect(useThreadStore.getState().threads[threadId]).toBeUndefined();

      // Verify THREAD_ARCHIVED event was emitted
      expect(mockEventBus.emit).toHaveBeenCalledWith("thread:archived", { threadId });

      // 3. List archived threads
      const archived = await threadService.listArchived();

      // Verify thread IS in archived list
      expect(archived).toHaveLength(1);
      expect(archived[0].id).toBe(threadId);
    });
  });

  describe("hydrate after archive does not load archived threads into main store", () => {
    it("only loads active threads, not archived ones", async () => {
      setupDefaultMocks();

      // Use valid UUIDs
      const activeThreadId = "b1111111-1111-4111-a111-111111111111";
      const archivedThreadId = "b2222222-2222-4222-a222-222222222222";

      const activeThread = createThreadMetadata({ id: activeThreadId });
      const archivedThread = createThreadMetadata({ id: archivedThreadId });

      // Set up glob to return active thread in threads/ and archived in archive/
      mockPersistence.glob.mockImplementation(async (pattern: string) => {
        if (pattern === "threads/*/metadata.json") {
          return [`threads/${activeThreadId}/metadata.json`];
        }
        if (pattern === "tasks/*/threads/*/metadata.json") {
          return [];
        }
        if (pattern === "archive/threads/*/metadata.json") {
          return [`archive/threads/${archivedThreadId}/metadata.json`];
        }
        return [];
      });

      mockPersistence.readJson.mockImplementation(async (path: string) => {
        if (path === `threads/${activeThreadId}/metadata.json`) return activeThread;
        if (path === `archive/threads/${archivedThreadId}/metadata.json`) return archivedThread;
        return null;
      });

      // Hydrate the store
      await threadService.hydrate();

      // Verify only active thread is in main store
      expect(useThreadStore.getState().threads[activeThreadId]).toBeDefined();
      expect(useThreadStore.getState().threads[archivedThreadId]).toBeUndefined();

      // Verify archived thread IS returned by listArchived
      const archived = await threadService.listArchived();
      expect(archived).toHaveLength(1);
      expect(archived[0].id).toBe(archivedThreadId);
    });
  });
});
