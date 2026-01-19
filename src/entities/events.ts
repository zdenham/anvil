import mitt from "mitt";
import {
  EventName,
  EventPayloads,
  type EventNameType,
  type ThreadState,
} from "@core/types/events.js";

// Re-export for convenience
export { EventName, type EventPayloads, type EventNameType };
export type { ThreadState };

// ============================================================================
// Core Events (from @core/types/events.ts)
// ============================================================================

/**
 * Core events from the agent/backend system.
 * These are defined in @core/types/events.ts
 */
type CoreEvents = {
  [K in EventNameType]: EventPayloads[K] & {
    _source?: "agent" | "local";
  };
};

// ============================================================================
// Local Events (frontend-only)
// ============================================================================

/**
 * Payload for open-task event from Rust
 */
export interface OpenTaskPayload {
  threadId: string;
  taskId: string;
  prompt?: string;
  repoName?: string;
}

/**
 * Payload for open-simple-task event from Rust
 */
export interface OpenSimpleTaskPayload {
  threadId: string;
  taskId: string;
  prompt?: string;
}

/**
 * Payload for show-error event from Rust
 */
export interface ShowErrorPayload {
  message: string;
  stack?: string;
}

/**
 * Payload for task-panel-ready coordination event
 */
export interface TaskPanelReadyPayload {
  threadId: string;
}

/**
 * Payload for window:focus-changed synthetic event
 */
export interface WindowFocusChangedPayload {
  focused: boolean;
}

// ============================================================================
// Navigation Mode Events (from Rust CGEventTap)
// ============================================================================

/**
 * Navigation mode start event - panel should show and highlight first item
 */
export interface NavigationStartEvent {
  type: "nav-start";
}

/**
 * Navigate down event
 */
export interface NavigationDownEvent {
  type: "nav-down";
}

/**
 * Navigate up event
 */
export interface NavigationUpEvent {
  type: "nav-up";
}

/**
 * Navigation open event - modifier released, open selected task
 */
export interface NavigationOpenEvent {
  type: "nav-open";
  selectedIndex: number;
}

/**
 * Navigation cancel event - panel blur, escape pressed, etc.
 */
export interface NavigationCancelEvent {
  type: "nav-cancel";
}

/**
 * Union of all navigation mode events
 */
export type NavigationModeEvent =
  | NavigationStartEvent
  | NavigationDownEvent
  | NavigationUpEvent
  | NavigationOpenEvent
  | NavigationCancelEvent;

/**
 * Local window events (frontend-only).
 * These are NOT in @core/types/events.ts - they're specific to the Tauri frontend.
 */
type LocalEvents = {
  // Rust panel events
  "panel-hidden": void;
  "panel-shown": void;
  "spotlight-shown": void;
  "open-simple-task": OpenSimpleTaskPayload;
  "clipboard-entry-added": void;
  "show-error": ShowErrorPayload;
  "open-task": OpenTaskPayload;

  // Navigation mode events (from Rust CGEventTap)
  "navigation-mode": NavigationModeEvent;

  // Window coordination events
  "task-panel-ready": TaskPanelReadyPayload;

  // Window API events (synthetic, from bridge)
  "window:focus-changed": WindowFocusChangedPayload;
};

// ============================================================================
// Combined Event Types
// ============================================================================

/**
 * Combined event types for the frontend event bus.
 * This union maintains proper type layering - core doesn't know about local events.
 */
export type AppEvents = CoreEvents & LocalEvents;

/** Global event bus - single instance per window */
export const eventBus = mitt<AppEvents>();
