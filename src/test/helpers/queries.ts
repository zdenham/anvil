/**
 * Test ID helpers for UI isolation tests.
 *
 * Provides stable selectors based on data-testid attributes.
 * Use these instead of querying by text content for more robust tests.
 */

import { expect } from "vitest";
import { screen, within } from "@testing-library/react";

// ============================================================================
// Test ID Constants
// ============================================================================

/**
 * Centralized test ID definitions.
 * Add new test IDs here and use the corresponding getters below.
 */
export const testIds = {
  // Thread Panel
  threadPanel: "thread-panel",
  threadHeader: "thread-header",
  threadStatus: "thread-status",
  messageList: "message-list",
  messageItem: (index: number) => `message-${index}`,
  messageContent: (index: number) => `message-content-${index}`,

  // Input Areas
  promptInput: "prompt-input",
  submitButton: "submit-button",

  // Modals/Dialogs
  modal: "modal",
  modalTitle: "modal-title",
  modalContent: "modal-content",
  modalClose: "modal-close",
  confirmButton: "confirm-button",
  cancelButton: "cancel-button",

  // Navigation
  sidebar: "sidebar",
  navItem: (id: string) => `nav-item-${id}`,

  // Common States
  loadingSpinner: "loading-spinner",
  errorMessage: "error-message",
  emptyState: "empty-state",

  // File Changes
  fileChangeList: "file-change-list",
  fileChangeItem: (path: string) => `file-change-${path.replace(/\//g, "-")}`,

  // Spotlight
  spotlight: "spotlight",
  spotlightInput: "spotlight-input",
  spotlightResults: "spotlight-results",
  spotlightResultItem: (index: number) => `spotlight-result-${index}`,

  // Kanban
  kanbanBoard: "kanban-board",
  kanbanColumn: (status: string) => `kanban-column-${status}`,
  kanbanCard: (id: string) => `kanban-card-${id}`,

  // Settings
  settingsPanel: "settings-panel",
  settingItem: (key: string) => `setting-${key}`,
} as const;

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Get a message element by index.
 */
export function getMessage(index: number): HTMLElement {
  return screen.getByTestId(testIds.messageItem(index));
}

/**
 * Get all message elements.
 */
export function getAllMessages(): HTMLElement[] {
  return screen.queryAllByTestId(/^message-\d+$/);
}

/**
 * Get the thread status element.
 */
export function getThreadStatus(): HTMLElement {
  return screen.getByTestId(testIds.threadStatus);
}

/**
 * Query the thread status element (returns null if not found).
 */
export function queryThreadStatus(): HTMLElement | null {
  return screen.queryByTestId(testIds.threadStatus);
}

/**
 * Get elements within a specific container by test ID.
 */
export function withinTestId(testId: string) {
  return within(screen.getByTestId(testId));
}

/**
 * Get the loading spinner element.
 */
export function getLoadingSpinner(): HTMLElement {
  return screen.getByTestId(testIds.loadingSpinner);
}

/**
 * Check if loading spinner is present.
 */
export function isLoading(): boolean {
  return screen.queryByTestId(testIds.loadingSpinner) !== null;
}

/**
 * Get the error message element.
 */
export function getErrorMessage(): HTMLElement {
  return screen.getByTestId(testIds.errorMessage);
}

/**
 * Check if an error is displayed.
 */
export function hasError(): boolean {
  return screen.queryByTestId(testIds.errorMessage) !== null;
}

/**
 * Get a kanban card by task ID.
 */
export function getKanbanCard(taskId: string): HTMLElement {
  return screen.getByTestId(testIds.kanbanCard(taskId));
}

/**
 * Get a kanban column by status.
 */
export function getKanbanColumn(status: string): HTMLElement {
  return screen.getByTestId(testIds.kanbanColumn(status));
}

/**
 * Get cards within a specific kanban column.
 */
export function getCardsInColumn(status: string): HTMLElement[] {
  const column = getKanbanColumn(status);
  return within(column).queryAllByTestId(/^kanban-card-/);
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert the thread panel shows a specific status.
 */
export function expectThreadStatus(status: string): void {
  const statusElement = screen.getByTestId(testIds.threadStatus);
  expect(statusElement).toHaveTextContent(status);
}

/**
 * Assert that a message with specific content exists.
 */
export function expectMessageWithContent(content: string): void {
  const messageList = screen.getByTestId(testIds.messageList);
  expect(within(messageList).getByText(content)).toBeInTheDocument();
}
