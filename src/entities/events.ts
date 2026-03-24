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
  "navigate": { targetWindow?: string; tab: string };
  "set-content-pane-view": { targetWindow?: string; type: string; [key: string]: unknown };

  // Window API events (synthetic, from bridge)
  "window:focus-changed": WindowFocusChangedPayload;

  // Quick Actions events (registry/manifest changes)
  "quick-actions:registry-changed": void;
  "quick-actions:manifest-changed": void;

  // SDK write operation events (DD #24, #33)
  // The SDK emits events through stdout, Anvil handles the actual disk write
  "sdk:thread:archive": { threadId: string };
  "sdk:thread:unarchive": { threadId: string };
  "sdk:thread:markRead": { threadId: string };
  "sdk:thread:markUnread": { threadId: string };
  "sdk:thread:delete": { threadId: string };
  "sdk:plan:archive": { planId: string };
  "sdk:plan:unarchive": { planId: string };
  "sdk:plan:markRead": { planId: string };
  "sdk:plan:markUnread": { planId: string };
  "sdk:plan:delete": { planId: string };

  // SDK navigation events
  "sdk:navigate": { route: string };
  "sdk:navigateToNextUnread": void;
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
