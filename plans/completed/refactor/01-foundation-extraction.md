# Phase 1: Foundation & Component Extraction

## Overview

This phase extracts reusable components from the existing control panel and creates foundational primitives for the main window refactor. The goal is to establish components that can render thread/plan content in the main window's content pane, create a resizable panel primitive, and build base tree components.

**Key Principle:** All components created here must work independently of their container (NSPanel, main window, or standalone window). No window-specific assumptions.

---

## Pre-Work: Files to Examine

Before implementing, review these files to understand existing patterns:

| File | Purpose |
|------|---------|
| `src/components/control-panel/control-panel-window.tsx` | Current thread view orchestration |
| `src/components/control-panel/plan-view.tsx` | Current plan view implementation |
| `src/components/thread/thread-view.tsx` | Core thread rendering (already generic) |
| `src/components/control-panel/control-panel-header.tsx` | Header with status, tabs, actions |
| `src/components/workspace/drag-handle.tsx` | Existing drag handle pattern |
| `src/lib/persistence.ts` | Disk persistence patterns |
| `src/components/ui/index.ts` | UI component barrel file |

---

## Task 1: Create Content Pane Types

**File:** `src/components/content-pane/types.ts`

```typescript
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
  | { type: "thread"; threadId: string }
  | { type: "plan"; planId: string }
  | { type: "settings" }
  | { type: "logs" };

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
}

export interface PlanContentProps {
  planId: string;
  /** Called when content should be popped out to separate window */
  onPopOut?: () => void;
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
```

**Acceptance Criteria:**
- [ ] Types compile without errors
- [ ] Types are exported from barrel file

---

## Task 2: Create ContentPaneHeader Component

**File:** `src/components/content-pane/content-pane-header.tsx`

This is an adaptation of `control-panel-header.tsx` without window-specific behavior (drag, hide commands). It provides:
- Status dot + title breadcrumb
- Tab toggle for threads (conversation/changes)
- Pop-out button (calls `onPopOut` prop)
- Close button (calls `onClose` prop)
- Cancel button when streaming

### Implementation Notes

1. Extract status dot logic from `control-panel-header.tsx`
2. Remove all `invoke()` calls - use callbacks instead
3. Remove window drag behavior entirely
4. Keep the visual layout identical

```typescript
/**
 * ContentPaneHeader
 *
 * Header bar for content panes showing:
 * - Status dot + breadcrumb path
 * - Tab toggle (for threads)
 * - Pop-out button
 * - Close button
 *
 * Unlike ControlPanelHeader, this component:
 * - Uses callbacks instead of invoke() commands
 * - Has no window drag behavior
 * - Works identically in any container
 */

import { useCallback } from "react";
import { StopCircle, ChevronRight, X, GitCompare, MessageSquare, PictureInPicture2 } from "lucide-react";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { threadService } from "@/entities/threads/service";
import { StatusDot, type StatusDotVariant } from "@/components/ui/status-dot";
import type { ContentPaneHeaderProps, ContentPaneView } from "./types";

// Note: Cancel agent via threadService.cancelAgent(threadId), NOT a direct import.
// The service encapsulates all agent communication - see Entity Stores pattern.

function getStatusVariant(isStreaming: boolean, isRead?: boolean): StatusDotVariant {
  if (isStreaming) return "running";
  if (isRead === false) return "unread";
  return "read";
}

export function ContentPaneHeader({
  view,
  threadTab = "conversation",
  onThreadTabChange,
  isStreaming = false,
  onClose,
  onPopOut,
}: ContentPaneHeaderProps) {
  if (view.type === "empty") {
    return null; // No header for empty state
  }

  if (view.type === "plan") {
    return (
      <PlanHeader
        planId={view.planId}
        onClose={onClose}
        onPopOut={onPopOut}
      />
    );
  }

  if (view.type === "thread") {
    return (
      <ThreadHeader
        threadId={view.threadId}
        threadTab={threadTab}
        onThreadTabChange={onThreadTabChange}
        isStreaming={isStreaming}
        onClose={onClose}
        onPopOut={onPopOut}
      />
    );
  }

  // Settings, logs - simple headers
  return (
    <SimpleHeader
      title={view.type}
      onClose={onClose}
    />
  );
}

// ... implement PlanHeader, ThreadHeader, SimpleHeader sub-components
// Similar to control-panel-header.tsx but using props callbacks
```

**Acceptance Criteria:**
- [ ] Header renders correctly for each view type
- [ ] Tab toggle works for threads
- [ ] onClose/onPopOut callbacks are invoked correctly
- [ ] Cancel button appears during streaming and calls `threadService.cancelAgent(threadId)`
- [ ] No Tauri invoke() calls in this component
- [ ] No direct store writes - only read via selectors, write via services

---

## Task 3: Create ThreadContent Component

**File:** `src/components/content-pane/thread-content.tsx`

This component wraps the existing `ThreadView` with all the state management and data fetching currently in `control-panel-window.tsx`. It becomes a self-contained thread viewer.

### Key Responsibilities

1. Set thread as active via `threadService.setActiveThread()`
2. Handle thread refresh from disk if not in store
3. Manage `ThreadView` status derivation
4. Handle tool responses
5. Provide message input with queue support
6. Show quick actions panel

### Critical Pattern: Service-Only Store Writes

Per the Entity Stores pattern, **components NEVER write directly to stores**. All mutations go through services:

```typescript
// WRONG - component writing to store
const handleSubmit = () => {
  useThreadStore.getState()._applyUpdate(threadId, newState);
};

// CORRECT - component calls service, service updates store
const handleSubmit = () => {
  threadService.sendMessage(threadId, message);
};
```

This component reads from stores via selectors but delegates ALL writes to `threadService`.

### Listener Infrastructure Dependency

This component relies on the existing `setupThreadListeners()` infrastructure (defined in `src/entities/threads/listeners.ts`) which must be initialized at app startup. The listeners handle:
- `AGENT_STATE` events -> `threadService.loadThreadState()` -> store update
- `THREAD_UPDATED` events -> `threadService.refreshThread()` -> store update

Without this, the Disk as Truth pattern breaks and components show stale data.

### What to Extract from `control-panel-window.tsx`

Extract these elements into `ThreadContent`:
- Thread store subscriptions (`activeState`, `activeMetadata`)
- `useMarkThreadAsRead` hook
- `useWorkingDirectory` hook
- Message derivation (optimistic messages)
- Tool response handling
- Quick actions keyboard navigation
- Input submission (queue vs resume logic)

### Sub-Component Extraction: SuggestedActionsPanel and QueuedMessagesBanner

These components are currently tightly coupled to `control-panel-window.tsx`. For this phase:

1. **`SuggestedActionsPanel`**: Extract to `src/components/content-pane/suggested-actions-panel.tsx`
   - Reads from `useQuickActionsStore` (read-only)
   - Calls `quickActionsService.executeAction()` for mutations
   - Receives keyboard navigation handlers via props

2. **`QueuedMessagesBanner`**: Extract to `src/components/content-pane/queued-messages-banner.tsx`
   - Reads from `useQueuedMessagesStore` (read-only)
   - Displays count of queued messages
   - Calls `queuedMessagesService.clear()` if user cancels queue

### Implementation Pattern

```typescript
/**
 * ThreadContent
 *
 * Self-contained thread viewer for embedding in content panes.
 * Manages its own data fetching, state, and interactions.
 *
 * This is essentially control-panel-window.tsx's thread rendering
 * extracted into a reusable component without window chrome.
 */

interface ThreadContentInternalProps extends ThreadContentProps {
  /** Initial prompt for new threads */
  initialPrompt?: string;
}

export function ThreadContent({
  threadId,
  onPopOut,
  initialPrompt,
}: ThreadContentInternalProps) {
  // All the thread state management from control-panel-window.tsx
  // ...

  return (
    <div className="flex flex-col h-full">
      {/* ThreadView takes remaining space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ThreadView
          threadId={threadId}
          messages={messages}
          isStreaming={isStreaming}
          status={viewStatus}
          toolStates={toolStates}
          onToolResponse={handleToolResponse}
        />
      </div>

      {/* Quick actions and input pinned to bottom */}
      <div className="flex-shrink-0">
        <SuggestedActionsPanel ... />
        <QueuedMessagesBanner ... />
        <ThreadInput ... />
      </div>
    </div>
  );
}
```

**Acceptance Criteria:**
- [ ] ThreadContent renders a complete thread experience
- [ ] Messages stream correctly
- [ ] Tool responses work
- [ ] Message submission works (queue when running, resume when idle)
- [ ] Quick actions keyboard navigation works
- [ ] Component works identically to current control panel thread view
- [ ] No direct store writes - all mutations via `threadService`
- [ ] SuggestedActionsPanel extracted and functional
- [ ] QueuedMessagesBanner extracted and functional

---

## Task 4: Create PlanContent Component

**File:** `src/components/content-pane/plan-content.tsx`

Extract the plan rendering logic from `plan-view.tsx` without the window chrome. This is simpler than ThreadContent since plans are read-only display.

### Key Responsibilities

1. Load plan from store (with disk refresh fallback)
2. Load plan content via `usePlanContent` hook
3. Render markdown content
4. Handle stale plan state
5. Provide quick actions for archive/unread/respond
6. Handle "respond" by creating new thread

### The `usePlanContent` Hook

This hook must be defined (or extracted from existing plan-view.tsx logic):

```typescript
// src/entities/plans/hooks/use-plan-content.ts

/**
 * Hook to load plan markdown content from disk.
 * Returns the content string and loading state.
 */
export function usePlanContent(planId: string): {
  content: string | null;
  isLoading: boolean;
  error: Error | null;
} {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    planService.loadPlanContent(planId)
      .then((data) => {
        if (!cancelled) {
          setContent(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [planId]);

  return { content, isLoading, error };
}
```

The hook calls `planService.loadPlanContent()` which handles disk I/O. The component never reads disk directly.

### What to Extract from `plan-view.tsx`

- Plan store subscription (read-only)
- Working directory resolution
- Content loading via `usePlanContent` hook
- Quick actions panel (reuse `SuggestedActionsPanel` from Task 3)
- Thread creation via `threadService.createFromPlan()`

### Implementation Pattern

```typescript
/**
 * PlanContent
 *
 * Self-contained plan viewer for embedding in content panes.
 * Shows plan markdown with quick actions and thread creation.
 */

export function PlanContent({
  planId,
  onPopOut,
}: PlanContentProps) {
  // Plan state management from plan-view.tsx
  // ...

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[900px] mx-auto p-4">
          {isContentLoading ? null : isStale ? (
            <StalePlanView plan={plan} />
          ) : (
            <MarkdownRenderer content={content} />
          )}
        </div>
      </div>

      {/* Quick actions and input */}
      <div className="flex-shrink-0 max-w-[900px] mx-auto w-full">
        <SuggestedActionsPanel ... />
        <ThreadInput ... />
      </div>
    </div>
  );
}
```

**Acceptance Criteria:**
- [ ] PlanContent renders plan markdown correctly
- [ ] Stale plan state shows correctly
- [ ] Quick actions work (archive, mark unread) via `planService`
- [ ] Creating a thread from plan works via `threadService.createFromPlan()`
- [ ] Component works identically to current plan-view.tsx
- [ ] No direct store writes - all mutations via services
- [ ] `usePlanContent` hook implemented and functional

---

## Task 5: Create ContentPane Wrapper Component

**File:** `src/components/content-pane/content-pane.tsx`

The main orchestration component that combines header + content based on view type.

```typescript
/**
 * ContentPane
 *
 * Main wrapper component for content panes. Renders:
 * - ContentPaneHeader (based on view type)
 * - View-specific content (thread, plan, settings, logs, empty)
 *
 * Each pane has a UUID and manages its own state independently.
 */

import { ContentPaneHeader } from "./content-pane-header";
import { ThreadContent } from "./thread-content";
import { PlanContent } from "./plan-content";
import { EmptyPaneContent } from "./empty-pane-content";
import type { ContentPaneProps } from "./types";

export function ContentPane({
  paneId,
  view,
  onClose,
  onPopOut,
}: ContentPaneProps) {
  // Track thread tab state locally
  const [threadTab, setThreadTab] = useState<"conversation" | "changes">("conversation");

  // Derive streaming state for header
  const isStreaming = useThreadStreamingState(view);

  return (
    <div className="flex flex-col h-full bg-surface-900">
      <ContentPaneHeader
        view={view}
        threadTab={threadTab}
        onThreadTabChange={setThreadTab}
        isStreaming={isStreaming}
        onClose={onClose}
        onPopOut={onPopOut}
      />

      <div className="flex-1 min-h-0">
        {view.type === "empty" && <EmptyPaneContent />}
        {view.type === "thread" && <ThreadContent threadId={view.threadId} onPopOut={onPopOut} />}
        {view.type === "plan" && <PlanContent planId={view.planId} onPopOut={onPopOut} />}
        {view.type === "settings" && <SettingsPage />}
        {view.type === "logs" && <LogsPage />}
      </div>
    </div>
  );
}

function EmptyPaneContent() {
  return (
    <div className="flex items-center justify-center h-full text-surface-500">
      <p>Select a thread or plan from the sidebar</p>
    </div>
  );
}

// Helper hook to get streaming state for thread views
function useThreadStreamingState(view: ContentPaneView): boolean {
  const threadId = view.type === "thread" ? view.threadId : null;
  const status = useThreadStore(
    useCallback((s) => threadId ? s.threads[threadId]?.status : null, [threadId])
  );
  return status === "running";
}
```

**Acceptance Criteria:**
- [ ] ContentPane renders correct content for each view type
- [ ] Header state (streaming, tabs) stays in sync with content
- [ ] Empty state shows helpful message
- [ ] Settings and Logs views work when routed here

---

## Task 6: Create ResizablePanel Primitive

**File:** `src/components/ui/resizable-panel.tsx`

A generic resizable panel with drag handle and persistence.

### Requirements

1. Support horizontal resizing (width)
2. Min/max width constraints
3. Drag handle with visual indicator
4. Persist width to `~/.mort/ui/layout.json` with Zod validation
5. Snap-to-close behavior when dragged below threshold
6. Works with any child content

### Persistence Approach: `persistKey` with Debounced Writes

The panel uses a `persistKey` prop to identify which panel's width is being stored. This is simpler than an `onResize` callback pattern because:
- Parent components don't need to manage persistence logic
- Width restoration happens automatically on mount
- Debounced writes prevent disk thrashing during drag

The internal implementation handles all persistence - consumers just provide a unique `persistKey`.

### Zod Schema for Layout Persistence

Per the Zod at Boundaries pattern, disk reads MUST validate with Zod:

```typescript
// Define at top of file or in src/components/ui/layout-schema.ts
import { z } from "zod";

/**
 * Schema for ~/.mort/ui/layout.json
 * Validates layout state loaded from disk.
 */
export const LayoutStateSchema = z.object({
  panelWidths: z.record(z.string(), z.number()),
});

export type LayoutState = z.infer<typeof LayoutStateSchema>;
```

### Implementation

```typescript
/**
 * ResizablePanel
 *
 * A panel with a draggable edge for resizing.
 * Persists width to disk following ~/.mort/ conventions.
 *
 * Usage:
 * <ResizablePanel
 *   position="left"
 *   minWidth={200}
 *   maxWidth={400}
 *   defaultWidth={280}
 *   persistKey="tree-panel-width"
 *   onClose={handleClose}
 * >
 *   <TreeMenu />
 * </ResizablePanel>
 */

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { z } from "zod";
import { persistence } from "@/lib/persistence";

/**
 * Schema for ~/.mort/ui/layout.json
 * Per Zod at Boundaries pattern - validate all disk reads.
 */
const LayoutStateSchema = z.object({
  panelWidths: z.record(z.string(), z.number()),
});

type LayoutState = z.infer<typeof LayoutStateSchema>;

interface ResizablePanelProps {
  /** Which side the resize handle appears on */
  position: "left" | "right";
  /** Minimum width in pixels */
  minWidth: number;
  /** Maximum width in pixels */
  maxWidth: number;
  /** Default width if no persisted value */
  defaultWidth: number;
  /** Key for persisting width (stored in ~/.mort/ui/layout.json) */
  persistKey: string;
  /** Threshold below which panel snaps closed */
  closeThreshold?: number;
  /** Called when panel is closed via snap */
  onClose?: () => void;
  /** Panel content */
  children: ReactNode;
}

const LAYOUT_PATH = "ui/layout.json";

export function ResizablePanel({
  position,
  minWidth,
  maxWidth,
  defaultWidth,
  persistKey,
  closeThreshold = 100,
  onClose,
  children,
}: ResizablePanelProps) {
  const [width, setWidth] = useState(defaultWidth);
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load persisted width on mount with Zod validation
  useEffect(() => {
    async function loadWidth() {
      const raw = await persistence.readJson(LAYOUT_PATH);
      const result = LayoutStateSchema.safeParse(raw);
      if (result.success && result.data.panelWidths[persistKey]) {
        setWidth(result.data.panelWidths[persistKey]);
      }
      // If validation fails, use defaultWidth (already set in useState)
    }
    loadWidth();
  }, [persistKey]);

  // Persist width changes (debounced in practice via drag end)
  const persistWidth = useCallback(async (newWidth: number) => {
    const raw = await persistence.readJson(LAYOUT_PATH);
    const result = LayoutStateSchema.safeParse(raw);
    const layout: LayoutState = result.success
      ? result.data
      : { panelWidths: {} };
    layout.panelWidths[persistKey] = newWidth;
    await persistence.writeJson(LAYOUT_PATH, layout);
  }, [persistKey]);

  const handleDrag = useCallback((e: MouseEvent) => {
    if (!panelRef.current) return;

    const rect = panelRef.current.getBoundingClientRect();
    let newWidth: number;

    if (position === "left") {
      newWidth = e.clientX - rect.left;
    } else {
      newWidth = rect.right - e.clientX;
    }

    // Snap to close
    if (newWidth < closeThreshold) {
      onClose?.();
      return;
    }

    // Clamp to min/max
    newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
    setWidth(newWidth);
  }, [position, minWidth, maxWidth, closeThreshold, onClose]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    persistWidth(width);
  }, [width, persistWidth]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, []);

  // Global mouse listeners for drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => handleDrag(e);
    const handleMouseUp = () => handleDragEnd();

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, handleDrag, handleDragEnd]);

  return (
    <div
      ref={panelRef}
      className="relative flex-shrink-0"
      style={{ width }}
    >
      {children}

      {/* Drag handle */}
      <div
        className={`
          absolute top-0 bottom-0 w-1 cursor-ew-resize z-10
          hover:bg-accent-500/30 transition-colors
          ${position === "left" ? "right-0" : "left-0"}
          ${isDragging ? "bg-accent-500/50" : ""}
        `}
        onMouseDown={handleDragStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize"
      >
        {/* Visual indicator on hover */}
        <div className={`
          absolute top-1/2 -translate-y-1/2
          ${position === "left" ? "-right-0.5" : "-left-0.5"}
          w-1 h-8 rounded-full bg-surface-500 opacity-0 hover:opacity-100 transition-opacity
        `} />
      </div>
    </div>
  );
}
```

**Acceptance Criteria:**
- [ ] Panel resizes smoothly with drag
- [ ] Width persists to `~/.mort/ui/layout.json` with Zod validation
- [ ] Invalid/corrupted layout.json is handled gracefully (use defaults)
- [ ] Min/max constraints are enforced
- [ ] Snap-to-close works at threshold
- [ ] Works on both left and right positions
- [ ] No visual glitches during drag
- [ ] `LayoutStateSchema` exported for potential reuse

---

## Task 7: Create Tree Primitives

**Directory:** `src/components/tree/`

Base components for the tree menu. These are generic, reusable tree primitives.

### 7.1 TreeNode Component

**File:** `src/components/tree/tree-node.tsx`

```typescript
/**
 * TreeNode
 *
 * A single node in a tree view with:
 * - Indentation based on depth
 * - Expand/collapse toggle (if has children)
 * - Selection state
 * - Icon + label slots
 */

import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface TreeNodeProps {
  /** Indentation depth (0 = root) */
  depth: number;
  /** Node label text */
  label: string;
  /** Optional icon to show before label */
  icon?: React.ReactNode;
  /** Whether this node is currently selected */
  isSelected?: boolean;
  /** Whether this node has children (shows expand toggle) */
  hasChildren?: boolean;
  /** Whether children are currently expanded */
  isExpanded?: boolean;
  /** Called when node is clicked */
  onClick?: () => void;
  /** Called when expand toggle is clicked */
  onToggleExpand?: () => void;
  /** Additional content to render after label (e.g., badges) */
  trailing?: React.ReactNode;
}

const INDENT_PX = 16;

export function TreeNode({
  depth,
  label,
  icon,
  isSelected = false,
  hasChildren = false,
  isExpanded = false,
  onClick,
  onToggleExpand,
  trailing,
}: TreeNodeProps) {
  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand?.();
  };

  return (
    <div
      className={cn(
        "flex items-center h-7 px-2 cursor-pointer select-none",
        "text-sm text-surface-300 hover:bg-surface-800/50",
        isSelected && "bg-surface-800 text-surface-100"
      )}
      style={{ paddingLeft: depth * INDENT_PX + 8 }}
      onClick={onClick}
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? isExpanded : undefined}
    >
      {/* Expand/collapse toggle */}
      {hasChildren ? (
        <button
          className="w-4 h-4 flex items-center justify-center mr-1 text-surface-500 hover:text-surface-300"
          onClick={handleExpandClick}
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ) : (
        <span className="w-4 h-4 mr-1" /> // Spacer for alignment
      )}

      {/* Icon */}
      {icon && (
        <span className="w-4 h-4 mr-2 flex items-center justify-center text-surface-400">
          {icon}
        </span>
      )}

      {/* Label */}
      <span className="flex-1 truncate">{label}</span>

      {/* Trailing content */}
      {trailing && (
        <span className="ml-2 flex-shrink-0">{trailing}</span>
      )}
    </div>
  );
}
```

### 7.2 TreeView Component

**File:** `src/components/tree/tree-view.tsx`

```typescript
/**
 * TreeView
 *
 * Container for tree nodes with:
 * - Keyboard navigation (arrow keys)
 * - ARIA tree role
 * - Focus management
 */

import { useRef, useCallback, useEffect, type ReactNode } from "react";

interface TreeViewProps {
  /** Tree content (TreeNode components) */
  children: ReactNode;
  /** Currently selected node ID */
  selectedId?: string | null;
  /** IDs of all visible nodes (for keyboard nav) */
  visibleNodeIds: string[];
  /** Called when selection changes via keyboard */
  onSelectionChange?: (nodeId: string) => void;
  /** Called when Enter is pressed on selected node */
  onActivate?: (nodeId: string) => void;
  /** ARIA label for the tree */
  ariaLabel?: string;
}

export function TreeView({
  children,
  selectedId,
  visibleNodeIds,
  onSelectionChange,
  onActivate,
  ariaLabel = "Tree view",
}: TreeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!selectedId || visibleNodeIds.length === 0) return;

    const currentIndex = visibleNodeIds.indexOf(selectedId);
    if (currentIndex === -1) return;

    switch (e.key) {
      case "ArrowUp": {
        e.preventDefault();
        if (currentIndex > 0) {
          onSelectionChange?.(visibleNodeIds[currentIndex - 1]);
        }
        break;
      }
      case "ArrowDown": {
        e.preventDefault();
        if (currentIndex < visibleNodeIds.length - 1) {
          onSelectionChange?.(visibleNodeIds[currentIndex + 1]);
        }
        break;
      }
      case "Enter": {
        e.preventDefault();
        onActivate?.(selectedId);
        break;
      }
      case "Home": {
        e.preventDefault();
        if (visibleNodeIds.length > 0) {
          onSelectionChange?.(visibleNodeIds[0]);
        }
        break;
      }
      case "End": {
        e.preventDefault();
        if (visibleNodeIds.length > 0) {
          onSelectionChange?.(visibleNodeIds[visibleNodeIds.length - 1]);
        }
        break;
      }
    }
  }, [selectedId, visibleNodeIds, onSelectionChange, onActivate]);

  return (
    <div
      ref={containerRef}
      className="outline-none"
      role="tree"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}
```

### 7.3 Barrel Export

**File:** `src/components/tree/index.ts`

```typescript
export { TreeNode } from "./tree-node";
export { TreeView } from "./tree-view";
```

**Acceptance Criteria:**
- [ ] TreeNode renders with correct indentation
- [ ] Expand/collapse toggle works
- [ ] Selection styling applies
- [ ] TreeView keyboard navigation works (arrows, Enter, Home, End)
- [ ] ARIA attributes are correct for accessibility

---

## Task 8: Create Barrel Export

**File:** `src/components/content-pane/index.ts`

```typescript
// Types
export type {
  ContentPaneView,
  ContentPane,
  ContentPaneProps,
  ContentPaneHeaderProps,
  ThreadContentProps,
  PlanContentProps,
} from "./types";

// Components
export { ContentPane } from "./content-pane";
export { ContentPaneHeader } from "./content-pane-header";
export { ThreadContent } from "./thread-content";
export { PlanContent } from "./plan-content";
```

---

## Task 9: Update UI Barrel Export

**File:** `src/components/ui/index.ts`

Add ResizablePanel to existing exports:

```typescript
// ... existing exports ...

// Resizable panel
export { ResizablePanel } from "./resizable-panel";
export type { ResizablePanelProps } from "./resizable-panel";
```

---

## File Structure Summary

After this phase, the file structure should be:

```
src/
├── components/
│   ├── content-pane/
│   │   ├── index.ts                      # Barrel export
│   │   ├── types.ts                      # ContentPaneView (SINGLE definition), ContentPane, props
│   │   ├── content-pane.tsx              # Main wrapper component
│   │   ├── content-pane-header.tsx       # Header with status, tabs, actions
│   │   ├── thread-content.tsx            # Self-contained thread viewer
│   │   ├── plan-content.tsx              # Self-contained plan viewer
│   │   ├── empty-pane-content.tsx        # Empty state component
│   │   ├── suggested-actions-panel.tsx   # Quick actions (extracted)
│   │   └── queued-messages-banner.tsx    # Queue status (extracted)
│   ├── tree/
│   │   ├── index.ts                      # Barrel export
│   │   ├── tree-node.tsx                 # Single tree node
│   │   └── tree-view.tsx                 # Tree container with keyboard nav
│   └── ui/
│       ├── index.ts                      # Updated with ResizablePanel
│       └── resizable-panel.tsx           # Resizable panel primitive (includes LayoutStateSchema)
└── entities/
    └── plans/
        └── hooks/
            └── use-plan-content.ts       # Hook for loading plan content
```

---

## Testing Strategy

Since automated tests are out of scope, manually verify:

### ThreadContent Testing
1. Open existing thread - messages display correctly
2. Stream new content - auto-scrolls, status dot shows "running"
3. Cancel streaming - agent stops
4. Submit follow-up - message queues if running, resumes if idle
5. Tool response - responds correctly (e.g., permission prompts)
6. Navigate away and back - state persists

### PlanContent Testing
1. Open plan - markdown renders correctly
2. Archive plan - navigates to next item
3. Mark unread - visual update
4. Create thread from plan - new thread opens with plan context

### ResizablePanel Testing
1. Drag handle - smooth resize
2. Release drag - width persists
3. Reload app - width restored
4. Drag below threshold - panel closes

### Tree Primitives Testing
1. Click node - selection changes
2. Click expand toggle - children show/hide
3. Arrow keys - selection moves
4. Enter key - activation callback fires
5. Correct indentation at each depth level

---

## Dependencies

**This phase has NO dependencies on other phases.**

Components created here are:
- Required by Phase 2 (tree data store uses tree primitives)
- Required by Phase 3 (tree menu uses tree primitives)
- Required by Phase 4 (layout uses ContentPane and ResizablePanel)

---

## Estimated Effort

| Task | Complexity | Estimated Time |
|------|------------|----------------|
| Task 1: Types | Low | 30 min |
| Task 2: ContentPaneHeader | Medium | 2 hours |
| Task 3: ThreadContent | High | 4 hours |
| Task 4: PlanContent | Medium | 2 hours |
| Task 5: ContentPane | Low | 1 hour |
| Task 6: ResizablePanel | Medium | 2 hours |
| Task 7: Tree Primitives | Medium | 2 hours |
| Tasks 8-9: Barrel exports | Low | 15 min |
| Manual Testing | - | 2 hours |

**Total: ~15.5 hours**

---

## Notes

### Shared vs Duplicated Code

The goal is NOT to replace the existing control panel components yet. Instead:
- Extract logic into new components (`ThreadContent`, `PlanContent`)
- Keep `control-panel-window.tsx` working as-is for now
- In Phase 4, both NSPanel and main window will use the new components
- In Phase 5, we can deduplicate or refactor the control panel to use the new components

### Persistence Patterns

All persistence follows established `~/.mort/` conventions:
- Use `persistence.readJson()` and `persistence.writeJson()`
- Store UI state in `ui/` subdirectory
- No localStorage or electron-store

### Component Independence

Each extracted component must:
- Work without knowing its container (NSPanel, main window, standalone)
- Use callbacks for actions (not `invoke()` commands)
- Be testable in isolation

---

## Implementation Notes

### Duplication Strategy During Migration

During this phase, `control-panel-window.tsx` remains unchanged. This creates temporary duplication:
- `ThreadContent` (new) and `control-panel-window.tsx` (existing) both render threads
- `PlanContent` (new) and `plan-view.tsx` (existing) both render plans

**This is intentional.** The strategy is:
1. Phase 1: Create new components without breaking existing functionality
2. Phase 4: Main window uses new components
3. Phase 5: Refactor `control-panel-window.tsx` to use `ThreadContent` (eliminate duplication)

The duplication is temporary tech debt with a defined cleanup phase. Do NOT attempt to refactor control-panel-window.tsx in this phase.

### Active Thread ID Scope

`threadService.setActiveThread()` sets a **global** active thread. This affects:
- Which thread receives `AGENT_STATE` updates
- Which thread shows in the control panel (NSPanel)

For Phase 1, this remains global. If split panes are implemented (future work), this will need to change to per-pane active state. That redesign is out of scope for this phase.

### Pop-Out Flow (Phase 4 Integration)

The `onPopOut` callback is defined here but fully wired in Phase 4:
- Main window: `onPopOut` creates new NSPanel window via `invoke("open_thread_panel", { threadId })`
- NSPanel: `onPopOut` is undefined (already popped out)
- Standalone window: `onPopOut` is undefined

For this phase, pass `onPopOut={undefined}` or omit. The callback signature is defined for forward compatibility.

### Existing Component Dependencies

These components already exist and are imported as-is:
- `StatusDot` from `@/components/ui/status-dot` - existing component
- `SettingsPage` from `@/pages/settings` - existing page component
- `LogsPage` from `@/pages/logs` - existing page component

No new work required for these.

### Type Layering Note

`ContentPaneView` and related types are UI-only and correctly placed in `src/components/content-pane/types.ts`. If future requirements need these types in `agents/` (e.g., for orchestration), migrate them to `core/types/` at that time. Do not preemptively move them.
