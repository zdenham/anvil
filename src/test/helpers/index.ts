/**
 * UI Test Helpers
 *
 * Re-exports all test utilities for convenient importing.
 *
 * @example
 * import { render, screen, VirtualFS, TestEvents, testIds } from "@/test/helpers";
 *
 * @example
 * import { createTask, createThread } from "@/test/helpers";
 * const task = createTask({ status: "in-progress" });
 */

// Virtual filesystem
export { VirtualFS, type SeedTaskOptions, type SeedThreadOptions } from "./virtual-fs";

// Store seeding
export { TestStores } from "./stores";

// Event emitter
export { TestEvents, waitForReact, flushPromises } from "./event-emitter";

// Log capture
export { TestLogs } from "./logs";

// Render utilities
export {
  render,
  renderUI,
  renderWithRouter,
  screen,
  within,
  fireEvent,
  waitFor,
  waitForElementToBeRemoved,
  act,
  userEvent,
} from "./render";

// Query helpers
export {
  testIds,
  getTaskItem,
  queryTaskItem,
  getTaskStatus,
  getMessage,
  getAllMessages,
  getThreadStatus,
  queryThreadStatus,
  withinTestId,
  getLoadingSpinner,
  isLoading,
  getErrorMessage,
  hasError,
  getKanbanCard,
  getKanbanColumn,
  getCardsInColumn,
  expectTaskExists,
  expectTaskNotExists,
  expectTaskHasStatus,
  expectThreadStatus,
  expectMessageWithContent,
} from "./queries";

// Test data factories
export {
  createTask,
  createSubtask,
  createPendingReview,
  resetTaskCounter,
  createThread,
  createThreadTurn,
  resetThreadCounter,
  resetAllCounters,
} from "../factories";
