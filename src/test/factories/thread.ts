/**
 * Test factory for ThreadMetadata
 *
 * Creates ThreadMetadata objects with sensible defaults for UI testing.
 * All required fields have default values that can be overridden.
 */

import type { ThreadMetadata, ThreadTurn } from "@/entities/threads/types";

let threadCounter = 0;

/**
 * Create a ThreadMetadata object with sensible defaults.
 *
 * @example
 * // Create a thread with default values
 * const thread = createThread();
 *
 * @example
 * // Create a thread with specific overrides
 * const thread = createThread({
 *   taskId: "task-123",
 *   status: "running",
 *   agentType: "execution",
 * });
 *
 * @example
 * // Create a thread with turns
 * const thread = createThread({
 *   turns: [
 *     createThreadTurn({ prompt: "First prompt" }),
 *     createThreadTurn({ index: 1, prompt: "Second prompt" }),
 *   ],
 * });
 */
export function createThread(overrides: Partial<ThreadMetadata> = {}): ThreadMetadata {
  const counter = ++threadCounter;
  const now = Date.now();

  return {
    id: `thread-${counter}`,
    taskId: "task-default",
    agentType: "execution",
    workingDirectory: "/Users/test/worktrees/default",
    status: "idle",
    createdAt: now,
    updatedAt: now,
    isRead: true,
    turns: [],
    ...overrides,
  };
}

/**
 * Create a ThreadTurn object with sensible defaults.
 *
 * @example
 * const turn = createThreadTurn({ prompt: "Implement the feature" });
 *
 * @example
 * // Create a completed turn
 * const turn = createThreadTurn({
 *   prompt: "Run tests",
 *   completedAt: Date.now(),
 *   exitCode: 0,
 * });
 */
export function createThreadTurn(overrides: Partial<ThreadTurn> = {}): ThreadTurn {
  const now = Date.now();
  return {
    index: 0,
    prompt: "Test prompt",
    startedAt: now,
    completedAt: null,
    ...overrides,
  };
}

/**
 * Reset the thread counter. Useful for test isolation.
 * Call this in beforeEach to ensure consistent IDs across test runs.
 */
export function resetThreadCounter(): void {
  threadCounter = 0;
}
