/**
 * Content Pane Types
 *
 * Defines the view discriminated union and props for content pane components.
 * Each pane is identified by a UUID and can display various content types.
 */

/**
 * Discriminated union for content pane views.
 * "empty" represents no content selected.
 *
 * IMPORTANT: This type is defined ONLY here in src/components/content-pane/types.ts.
 * Do NOT duplicate this definition elsewhere. All consumers import from this file.
 */
export type ContentPaneView =
  | { type: "empty" }
  | { type: "thread"; threadId: string; autoFocus?: boolean }
  | { type: "plan"; planId: string }
  | { type: "settings" }
  | { type: "logs" }
  | { type: "archive" }
  | { type: "terminal"; terminalId: string }
  | { type: "file"; filePath: string; repoId?: string; worktreeId?: string; lineNumber?: number }
  | { type: "pull-request"; prId: string }
  | {
      type: "changes";
      repoId: string;
      worktreeId: string;
      /** If true, show only uncommitted changes (HEAD to working tree) */
      uncommittedOnly?: boolean;
      /** If set, show diff for this single commit */
      commitHash?: string;
    };

/**
 * Represents a single content pane instance.
 * Each pane has a unique UUID for identification and state management.
 */
export interface ContentPane {
  /** UUID for this pane instance */
  id: string;
  /** Current view being displayed */
  view: ContentPaneView;
}

/**
 * Props for the ContentPane component.
 */
export interface ContentPaneProps {
  /** UUID of this pane instance */
  paneId: string;
  /** View to render */
  view: ContentPaneView;
  /** Called when user closes the pane (clears content) */
  onClose: () => void;
  /** Called when user clicks pop-out button (opens in NSPanel/window) */
  onPopOut?: () => void;
}

/**
 * Props for content-specific components (thread, plan).
 * These are the embeddable view components.
 */
export interface ThreadContentProps {
  threadId: string;
  /** Called when content should be popped out to separate window */
  onPopOut?: () => void;
  /** Initial prompt for new threads */
  initialPrompt?: string;
  /** Auto-focus the input on mount (for newly created threads) */
  autoFocus?: boolean;
}

export interface PlanContentProps {
  planId: string;
  /** Called when content should be popped out to separate window */
  onPopOut?: () => void;
}

export interface TerminalContentProps {
  terminalId: string;
  /** Called when user closes the pane (hides but keeps terminal alive) */
  onClose?: () => void;
  /** Called when user archives the terminal (kills PTY) */
  onArchive?: () => void;
}

export interface PullRequestContentProps {
  prId: string;
  /** Called when content should be popped out to separate window */
  onPopOut?: () => void;
}

export interface ChangesContentProps {
  repoId: string;
  worktreeId: string;
  uncommittedOnly?: boolean;
  commitHash?: string;
}

/**
 * Props for the ContentPaneHeader component.
 */
/**
 * View categories for category-aware tab placement.
 * Terminals get their own category; everything else is "content".
 */
export type ViewCategory = "terminal" | "content";

export function getViewCategory(type: ContentPaneView["type"]): ViewCategory {
  return type === "terminal" ? "terminal" : "content";
}

/**
 * Props for the ContentPaneHeader component.
 */
export interface ContentPaneHeaderProps {
  view: ContentPaneView;
  /** For thread views: current tab */
  threadTab?: "conversation" | "changes";
  /** For thread views: tab change handler */
  onThreadTabChange?: (tab: "conversation" | "changes") => void;
  /** Whether content is currently streaming */
  isStreaming?: boolean;
  /** Called to close/clear the pane */
  onClose: () => void;
  /** Called to pop out to separate window */
  onPopOut?: () => void;
}
