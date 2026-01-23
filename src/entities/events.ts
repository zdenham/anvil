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
 * View type for control panel - discriminated union for type safety.
 *
 * Thread view: Shows thread conversation, plan relations, and file changes
 * Plan view: Shows plan content (markdown) and related threads
 *
 * Note: Inbox view has been moved to a dedicated inbox-list-panel (see plans/inbox-navigation-fix.md)
 */
export type ControlPanelViewType =
  | { type: "thread"; threadId: string }
  | { type: "plan"; planId: string };

/**
 * Payload for open-control-panel event from Rust
 */
export interface OpenControlPanelPayload {
  /** Thread ID - required for thread view, optional for plan view */
  threadId?: string;
  /** Initial prompt to show */
  prompt?: string;
  /** View to display - discriminated union format */
  view?: ControlPanelViewType;
}

/**
 * Payload for show-error event from Rust
 */
export interface ShowErrorPayload {
  message: string;
  stack?: string;
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
 * Navigation release event - modifier released, frontend should open its currently selected item
 */
export interface NavigationReleaseEvent {
  type: "nav-release";
  // No payload - frontend owns the index
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
  | NavigationReleaseEvent
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
  "open-control-panel": OpenControlPanelPayload;
  "clipboard-entry-added": void;
  "show-error": ShowErrorPayload;

  // Navigation mode events (from Rust CGEventTap)
  "navigation-mode": NavigationModeEvent;

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
