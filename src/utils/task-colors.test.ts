import { describe, it, expect } from "vitest";
import { getTaskDotColor } from "./task-colors";
import type { TaskMetadata } from "@/entities/tasks/types";
import type { ThreadMetadata } from "@/entities/threads/types";

describe("getTaskDotColor", () => {
  const mockTask: TaskMetadata = {
    id: "task-1",
    title: "Test Task",
    description: "Test Description",
    status: "done",
    type: "simple",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    slug: "test-task",
    branchName: null,
    subtasks: [],
    parentId: null,
    tags: [],
    sortOrder: 1,
    pendingReviews: [],
    cwd: "/test",
  };

  describe("priority order", () => {
    it("should return green with pulse animation when any thread is running", () => {
      const threads: ThreadMetadata[] = [
        {
          id: "thread-1",
          taskId: "task-1",
          agentType: "simple",
          workingDirectory: "/test",
          status: "running",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          turns: [],
          isRead: true,
        },
        {
          id: "thread-2",
          taskId: "task-1",
          agentType: "simple",
          workingDirectory: "/test",
          status: "completed",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          turns: [],
          isRead: false, // Even though this is unread, running takes priority
        },
      ];

      const result = getTaskDotColor(mockTask, threads);

      expect(result).toEqual({
        color: "bg-green-400",
        animation: "animate-pulse",
      });
    });

    it("should return blue when threads are unread but none are running", () => {
      const threads: ThreadMetadata[] = [
        {
          id: "thread-1",
          taskId: "task-1",
          agentType: "simple",
          workingDirectory: "/test",
          status: "completed",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          turns: [],
          isRead: false, // Unread
        },
        {
          id: "thread-2",
          taskId: "task-1",
          agentType: "simple",
          workingDirectory: "/test",
          status: "completed",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          turns: [],
          isRead: true,
        },
      ];

      const result = getTaskDotColor(mockTask, threads);

      expect(result).toEqual({
        color: "bg-blue-500",
      });
    });

    it("should return grey when all threads are read and none are running", () => {
      const threads: ThreadMetadata[] = [
        {
          id: "thread-1",
          taskId: "task-1",
          agentType: "simple",
          workingDirectory: "/test",
          status: "completed",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          turns: [],
          isRead: true,
        },
        {
          id: "thread-2",
          taskId: "task-1",
          agentType: "simple",
          workingDirectory: "/test",
          status: "completed",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          turns: [],
          isRead: true,
        },
      ];

      const result = getTaskDotColor(mockTask, threads);

      expect(result).toEqual({
        color: "bg-zinc-400",
      });
    });
  });

  describe("edge cases", () => {
    it("should return grey when task has no threads", () => {
      const threads: ThreadMetadata[] = [];

      const result = getTaskDotColor(mockTask, threads);

      expect(result).toEqual({
        color: "bg-zinc-400",
      });
    });

    it("should ignore threads from other tasks", () => {
      const threads: ThreadMetadata[] = [
        {
          id: "thread-other",
          taskId: "other-task",
          agentType: "simple",
          workingDirectory: "/test",
          status: "running", // This is running but belongs to different task
          createdAt: Date.now(),
          updatedAt: Date.now(),
          turns: [],
          isRead: false,
        },
      ];

      const result = getTaskDotColor(mockTask, threads);

      // Should return grey since no threads belong to this task
      expect(result).toEqual({
        color: "bg-zinc-400",
      });
    });

    it("should handle your specific log scenario", () => {
      // Based on the log data you provided
      const taskFromLog: TaskMetadata = {
        id: "c98c8189-d980-4142-89cc-4532c9ee73d4",
        title: "sup",
        description: "sup",
        status: "done",
        type: "simple",
        createdAt: 1768192244855,
        updatedAt: 1768192249258,
        slug: "c98c8189-d980-4142-89cc-4532c9ee73d4",
        branchName: null,
        subtasks: [],
        parentId: null,
        tags: [],
        sortOrder: 1768192244855,
        pendingReviews: [],
        cwd: "/Users/zac/Documents/juice/mort/mortician",
      };

      const threadsFromLog: ThreadMetadata[] = [
        {
          id: "268efb20-8c71-4b7d-8981-0d983c220abb",
          taskId: "8bc1d6fd-a563-4f1c-a5f9-104f5029b4e8", // Different task
          agentType: "simple",
          workingDirectory: "/Users/zac/Documents/juice/mort/mortician",
          status: "completed",
          createdAt: 1768189996137,
          updatedAt: 1768190001076,
          turns: [
            {
              index: 0,
              prompt: "hey",
              startedAt: 1768189996137,
              completedAt: 1768190000957,
            },
          ],
          isRead: true,
        },
        {
          id: "5c4b3737-2dde-400a-a193-5d4a045967fe",
          taskId: "c98c8189-d980-4142-89cc-4532c9ee73d4", // This task
          agentType: "simple",
          workingDirectory: "/Users/zac/Documents/juice/mort/mortician",
          status: "completed", // Not running
          createdAt: 1768192244855,
          updatedAt: 1768192249286,
          turns: [
            {
              index: 0,
              prompt: "sup",
              startedAt: 1768192244855,
              completedAt: 1768192249258,
            },
          ],
          isRead: false, // Unread!
        },
      ];

      const result = getTaskDotColor(taskFromLog, threadsFromLog);

      // Should return blue because the thread for this task is unread
      expect(result).toEqual({
        color: "bg-blue-500",
      });
    });
  });
});