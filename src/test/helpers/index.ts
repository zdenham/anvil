/**
 * UI Test Helpers
 *
 * Re-exports all test utilities for convenient importing.
 *
 * @example
 * import { render, screen, VirtualFS, TestEvents, testIds } from "@/test/helpers";
 *
 * @example
 * import { createThread } from "@/test/helpers";
 * const thread = createThread({ status: "running" });
 */

// Virtual filesystem
export { VirtualFS, type SeedThreadOptions } from "./virtual-fs";

// Event replay
export { ReplayHarness } from "./event-replay";

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
  expectThreadStatus,
  expectMessageWithContent,
} from "./queries";

// Test data factories
export {
  createThread,
  createThreadTurn,
  resetThreadCounter,
  resetAllCounters,
} from "../factories";
