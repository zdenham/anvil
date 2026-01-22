/**
 * Vitest setup file for UI isolation tests.
 *
 * This file runs before all UI tests and sets up:
 * - jest-dom matchers for DOM assertions
 * - Mocks for Tauri APIs (@tauri-apps/api/core and @tauri-apps/api/event)
 * - Automatic mock state reset between tests
 *
 * Tests using this setup can simulate the complete Tauri environment
 * without requiring the actual Tauri runtime.
 */

import "@testing-library/jest-dom/vitest";
import { vi, beforeEach, afterEach } from "vitest";
import {
  mockInvoke,
  mockEmit,
  mockListen,
  resetAllMocks,
} from "./mocks/tauri-api";
import { TestEvents } from "./helpers/event-emitter";
import { TestStores } from "./helpers/stores";
import { setupEntityListeners } from "@/entities";

// ============================================================================
// Mock Tauri Modules
// ============================================================================

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

// Mock @tauri-apps/api/event
vi.mock("@tauri-apps/api/event", () => ({
  emit: mockEmit,
  listen: mockListen,
}));

// Mock @tauri-apps/plugin-dialog (prevents "plugin not found" errors)
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
}));

// Mock @tauri-apps/plugin-global-shortcut
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: vi.fn(),
  unregister: vi.fn(),
  isRegistered: vi.fn(() => false),
}));

// Mock @tauri-apps/plugin-shell
vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: {
    create: vi.fn(),
  },
  open: vi.fn(),
}));

// Mock @tauri-apps/plugin-opener
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  openPath: vi.fn(),
}));

// ============================================================================
// Test Lifecycle Hooks
// ============================================================================

beforeEach(() => {
  // Reset all mock state before each test
  resetAllMocks();
  // Clear Zustand stores to ensure test isolation
  TestStores.clear();
  // Set up entity listeners for full event flow
  // (listeners are cleared in afterEach via TestEvents.clearAllListeners())
  setupEntityListeners();
});

afterEach(() => {
  // Clear event listeners to prevent leaks between tests
  TestEvents.clearAllListeners();
});

// ============================================================================
// Global Test Utilities
// ============================================================================

// Make vi available globally for test files
// (This is already enabled by `globals: true` in vitest config,
// but we include it here for clarity)
declare global {
   
  var vi: typeof import("vitest")["vi"];
}
