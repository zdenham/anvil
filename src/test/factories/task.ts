/**
 * Test factory for TaskMetadata
 *
 * Creates TaskMetadata objects with sensible defaults for UI testing.
 * All required fields have default values that can be overridden.
 */

import type { TaskMetadata, Subtask, PendingReview } from "@/entities/tasks/types";

let taskCounter = 0;

/**
 * Create a TaskMetadata object with sensible defaults.
 *
 * @example
 * // Create a task with default values
 * const task = createTask();
 *
 * @example
 * // Create a task with specific overrides
 * const task = createTask({
 *   title: "My Custom Task",
 *   status: "in-progress",
 * });
 *
 * @example
 * // Create a task with subtasks
 * const task = createTask({
 *   subtasks: [
 *     createSubtask({ title: "Step 1", completed: true }),
 *     createSubtask({ title: "Step 2" }),
 *   ],
 * });
 */
export function createTask(overrides: Partial<TaskMetadata> = {}): TaskMetadata {
  const counter = ++taskCounter;
  const now = Date.now();
  const slug = overrides.slug ?? `test-task-${counter}`;

  return {
    id: `task-${counter}`,
    slug,
    title: `Test Task ${counter}`,
    description: undefined,
    branchName: `task/${slug}`,
    type: "work",
    subtasks: [],
    status: "todo",
    createdAt: now,
    updatedAt: now,
    parentId: null,
    tags: [],
    sortOrder: counter,
    pendingReviews: [],
    ...overrides,
  };
}

/**
 * Create a Subtask object with sensible defaults.
 *
 * @example
 * const subtask = createSubtask({ title: "Implement feature" });
 */
export function createSubtask(overrides: Partial<Subtask> = {}): Subtask {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    title: "Test Subtask",
    completed: false,
    ...overrides,
  };
}

/**
 * Create a PendingReview object with sensible defaults.
 *
 * @example
 * const review = createPendingReview({
 *   threadId: "thread-123",
 *   markdown: "Please review this implementation",
 * });
 */
export function createPendingReview(overrides: Partial<PendingReview> = {}): PendingReview {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    threadId: "thread-default",
    markdown: "Please review this change",
    defaultResponse: "Looks good, proceed",
    requestedAt: Date.now(),
    onApprove: "execution",
    onFeedback: "execution",
    isAddressed: false,
    ...overrides,
  };
}

/**
 * Reset the task counter. Useful for test isolation.
 * Call this in beforeEach to ensure consistent IDs across test runs.
 */
export function resetTaskCounter(): void {
  taskCounter = 0;
}
