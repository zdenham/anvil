/**
 * Relation Listeners Tests
 *
 * Tests for event listeners that manage relations automatically.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventName } from "@core/types/events.js";

// Store the event handlers
const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};

// Mock the event bus
vi.mock("../../events", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!eventHandlers[event]) {
        eventHandlers[event] = [];
      }
      eventHandlers[event].push(handler);
    }),
  },
}));

// Mock the relation detector
vi.mock("../detection", () => ({
  relationDetector: {
    onFileChange: vi.fn().mockResolvedValue(undefined),
    onUserMessage: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock the relation service
vi.mock("../service", () => ({
  relationService: {
    archiveByThread: vi.fn().mockResolvedValue(undefined),
    archiveByPlan: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock the plan service
vi.mock("../../plans/service", () => ({
  planService: {
    markAsUnread: vi.fn().mockResolvedValue(undefined),
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

import { setupRelationListeners } from "../listeners";
import { relationDetector } from "../detection";
import { relationService } from "../service";
import { planService } from "../../plans/service";

describe("RelationListeners", () => {
  beforeEach(() => {
    // Clear event handlers
    Object.keys(eventHandlers).forEach(key => {
      eventHandlers[key] = [];
    });

    // Clear all mocks
    vi.clearAllMocks();

    // Setup listeners
    setupRelationListeners();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // THREAD_FILE_CREATED event Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("THREAD_FILE_CREATED event", () => {
    it("should call relationDetector.onFileChange with 'created' type", async () => {
      const handlers = eventHandlers[EventName.THREAD_FILE_CREATED];
      expect(handlers).toBeDefined();
      expect(handlers.length).toBeGreaterThan(0);

      await handlers[0]({ threadId: "thread1", filePath: "/path/to/file.md" });

      expect(relationDetector.onFileChange).toHaveBeenCalledWith(
        "thread1",
        "/path/to/file.md",
        "created"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // THREAD_FILE_MODIFIED event Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("THREAD_FILE_MODIFIED event", () => {
    it("should call relationDetector.onFileChange with 'modified' type", async () => {
      const handlers = eventHandlers[EventName.THREAD_FILE_MODIFIED];
      expect(handlers).toBeDefined();
      expect(handlers.length).toBeGreaterThan(0);

      await handlers[0]({ threadId: "thread1", filePath: "/path/to/file.md" });

      expect(relationDetector.onFileChange).toHaveBeenCalledWith(
        "thread1",
        "/path/to/file.md",
        "modified"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // USER_MESSAGE_SENT event Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("USER_MESSAGE_SENT event", () => {
    it("should call relationDetector.onUserMessage", async () => {
      const handlers = eventHandlers[EventName.USER_MESSAGE_SENT];
      expect(handlers).toBeDefined();
      expect(handlers.length).toBeGreaterThan(0);

      await handlers[0]({ threadId: "thread1", message: "Check out plans/feature.md" });

      expect(relationDetector.onUserMessage).toHaveBeenCalledWith(
        "thread1",
        "Check out plans/feature.md"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // THREAD_ARCHIVED event Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("THREAD_ARCHIVED event", () => {
    it("should call relationService.archiveByThread", async () => {
      const handlers = eventHandlers[EventName.THREAD_ARCHIVED];
      expect(handlers).toBeDefined();
      expect(handlers.length).toBeGreaterThan(0);

      await handlers[0]({ threadId: "thread1" });

      expect(relationService.archiveByThread).toHaveBeenCalledWith("thread1");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAN_ARCHIVED event Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("PLAN_ARCHIVED event", () => {
    it("should call relationService.archiveByPlan", async () => {
      const handlers = eventHandlers[EventName.PLAN_ARCHIVED];
      expect(handlers).toBeDefined();
      expect(handlers.length).toBeGreaterThan(0);

      await handlers[0]({ planId: "plan1" });

      expect(relationService.archiveByPlan).toHaveBeenCalledWith("plan1");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATION_CREATED event (plan unread behavior) Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("RELATION_CREATED event (plan unread behavior)", () => {
    it("should call planService.markAsUnread when type is 'modified'", async () => {
      const handlers = eventHandlers[EventName.RELATION_CREATED];
      expect(handlers).toBeDefined();
      expect(handlers.length).toBeGreaterThan(0);

      await handlers[0]({ planId: "plan1", threadId: "thread1", type: "modified" });

      expect(planService.markAsUnread).toHaveBeenCalledWith("plan1");
    });

    it("should NOT call planService.markAsUnread when type is 'mentioned'", async () => {
      const handlers = eventHandlers[EventName.RELATION_CREATED];

      await handlers[0]({ planId: "plan1", threadId: "thread1", type: "mentioned" });

      expect(planService.markAsUnread).not.toHaveBeenCalled();
    });

    it("should NOT call planService.markAsUnread when type is 'created'", async () => {
      const handlers = eventHandlers[EventName.RELATION_CREATED];

      await handlers[0]({ planId: "plan1", threadId: "thread1", type: "created" });

      expect(planService.markAsUnread).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATION_UPDATED event (plan unread behavior) Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("RELATION_UPDATED event (plan unread behavior)", () => {
    it("should call planService.markAsUnread when upgrading to 'modified'", async () => {
      const handlers = eventHandlers[EventName.RELATION_UPDATED];
      expect(handlers).toBeDefined();
      expect(handlers.length).toBeGreaterThan(0);

      await handlers[0]({
        planId: "plan1",
        threadId: "thread1",
        type: "modified",
        previousType: "mentioned"
      });

      expect(planService.markAsUnread).toHaveBeenCalledWith("plan1");
    });

    it("should NOT call planService.markAsUnread when upgrading to 'created' (already higher)", async () => {
      const handlers = eventHandlers[EventName.RELATION_UPDATED];

      await handlers[0]({
        planId: "plan1",
        threadId: "thread1",
        type: "created",
        previousType: "modified"
      });

      expect(planService.markAsUnread).not.toHaveBeenCalled();
    });

    it("should NOT call planService.markAsUnread when previousType was already 'modified'", async () => {
      const handlers = eventHandlers[EventName.RELATION_UPDATED];

      // This scenario shouldn't happen in practice (same-type update), but test anyway
      await handlers[0]({
        planId: "plan1",
        threadId: "thread1",
        type: "modified",
        previousType: "modified"
      });

      expect(planService.markAsUnread).not.toHaveBeenCalled();
    });
  });
});
