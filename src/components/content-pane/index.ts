/**
 * Content Pane Components
 *
 * Reusable components for rendering content in panes (threads, plans, etc.)
 * These components work independently of their container (NSPanel, main window, etc.)
 */

// Types
export type {
  ContentPaneView,
  ContentPane as ContentPaneType,
  ContentPaneProps,
  ContentPaneHeaderProps,
  ThreadContentProps,
  PlanContentProps,
} from "./types";

// Components
export { ContentPane } from "./content-pane";
export { ContentPaneContainer } from "./content-pane-container";
export { ContentPaneHeader } from "./content-pane-header";
export { ThreadContent } from "./thread-content";
export { PlanContent } from "./plan-content";
export { EmptyPaneContent } from "./empty-pane-content";

// Sub-components (re-exported for convenience)
export { QueuedMessagesBanner } from "./queued-messages-banner";
