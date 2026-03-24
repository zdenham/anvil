# Phase 6 & 7: NSPanel Integration + Multi-Pane Architecture

## Overview

This sub-plan covers the final two phases of the main window refactor:

- **Phase 6 (Implement Now):** NSPanel integration with spotlight modifiers
- **Phase 7 (Design Now, Implement Later):** Multi-pane architecture foundation

These phases ensure that shared content components work seamlessly across both NSPanel (floating quick access) and main window content panes, while establishing extensible data models for future multi-pane features.

---

## Pre-Flight Verification

**CRITICAL:** Before starting Phase 6, verify the following prerequisites are complete:

### Phase 5 Completion Checklist

- [ ] `src/components/main-window/sidebar.tsx` - DELETED
- [ ] `src/components/main-window/worktrees-page.tsx` - DELETED
- [ ] `src/components/inbox/unified-inbox.tsx` - DELETED
- [ ] `TabId` type removed from `main-window-layout.tsx`
- [ ] Navigation event handler updated to use content pane views
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds

### Phase 1 Component Availability

- [ ] `ContentPaneView` type exported from `src/components/content-pane/types.ts`
- [ ] `ThreadContent` component exists at `src/components/content-pane/thread-content.tsx`
- [ ] `PlanContent` component exists at `src/components/content-pane/plan-content.tsx`
- [ ] `ContentPane` wrapper component exists at `src/components/content-pane/content-pane.tsx`

### Phase 4 Store Availability

- [ ] `useContentPanesStore` exists at `src/entities/content-panes/store.ts`
- [ ] `contentPanesService` exists at `src/entities/content-panes/service.ts`
- [ ] Content panes listeners setup in `src/entities/content-panes/listeners.ts`

**Verification command:**
```bash
# Run from project root
test -f src/components/content-pane/types.ts && \
test -f src/components/content-pane/thread-content.tsx && \
test -f src/entities/content-panes/store.ts && \
echo "Prerequisites met" || echo "Prerequisites missing"
```

---

## Phase 6: NSPanel Integration (IMPLEMENT NOW)

### Goal

Support both Enter and Shift+Enter from Spotlight with distinct behaviors:
- **Enter** = Open in main window content pane + focus main window
- **Shift+Enter** = Open in NSPanel (floating, quick access)

### Component Sharing Architecture

**Critical Principle:** NSPanel and main window content panes use the SAME content components from Phase 1.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shared Content Components                     │
│         (src/components/content-pane/thread-content.tsx)        │
│         (src/components/content-pane/plan-content.tsx)          │
└─────────────────────────────────────────────────────────────────┘
                    │                           │
         ┌──────────┴──────────┐     ┌─────────┴─────────┐
         │   Main Window       │     │    NSPanel        │
         │   ContentPane       │     │    (control-panel │
         │   wrapper           │     │     -window.tsx)  │
         └─────────────────────┘     └───────────────────┘
```

**Implementation requirement:** After Phase 6, `control-panel-window.tsx` MUST be refactored to use `ThreadContent` and `PlanContent` from `src/components/content-pane/`. This eliminates duplicate logic and ensures identical behavior across contexts.

### Current State Analysis

Based on code review of `spotlight.tsx` and `hotkey-service.ts`:

1. **Spotlight already uses `openControlPanel()`** which invokes the NSPanel via `invoke("open_control_panel", { threadId, taskId, prompt })`
2. **No modifier detection exists** - all thread activations go to NSPanel
3. **`showMainWindow()`** exists but doesn't accept a view parameter
4. **`showControlPanelWithView()`** routes through Rust but still targets NSPanel

### Implementation Tasks

#### 6.1 Backend: Add Main Window Content Pane Command

**File:** `src-tauri/src/commands/window.rs`

```rust
#[tauri::command]
pub async fn show_main_window_with_view(
    view: serde_json::Value,  // ContentPaneView serialized
    app: AppHandle,
) -> Result<(), String> {
    // 1. Get or create main window
    let window = app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or("Main window not found")?;

    // 2. Show and focus main window
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    // 3. Emit event TO main window specifically using emit_to()
    //    This ensures only the main window receives the view change
    window.emit("set-content-pane-view", &view)
        .map_err(|e| e.to_string())?;

    Ok(())
}
```

**Rust command details:**
- Use `emit()` on the window handle (not `emit_all()`) to target only the main window
- If main window doesn't exist, create it first using existing window creation logic
- The `view` parameter is JSON-serialized `ContentPaneView` from Phase 1 types
- Return error if window creation fails (don't silently fail)

**Tasks:**
- [ ] Add `show_main_window_with_view` Tauri command
- [ ] Register command in `src-tauri/src/lib.rs` command list
- [ ] Handle case where main window needs to be created first
- [ ] Ensure window is focused AFTER event is emitted (view change should be visible)

#### 6.2 Frontend: Define set-content-pane-view Event

**File:** `src/entities/events.ts`

Add the new event type to `LocalEvents`:

```typescript
// src/entities/events.ts

import type { ContentPaneView } from "@/components/content-pane/types";

// Add to LocalEvents type
type LocalEvents = {
  // ... existing events ...
  "set-content-pane-view": { view: ContentPaneView };
};
```

**Event bridge configuration:**

The `set-content-pane-view` event is a **local event** (Rust -> specific window), NOT a broadcast. It should:
- Be received by main window via Tauri listener
- NOT be forwarded to other windows via event bridge
- Trigger content pane store update in the receiving window only

#### 6.3 Frontend: Update Spotlight Modifier Detection

**File:** `src/components/spotlight/spotlight.tsx`

**Current flow in `activateResult` for thread type:**
```typescript
// Current: Always opens NSPanel
await openControlPanel(threadId, taskId, content);
```

**New flow:**
```typescript
const handleActivate = async (
  result: SpotlightResult,
  event: React.KeyboardEvent | KeyboardEvent
) => {
  if (result.type === "thread") {
    const { threadId, taskId } = result;

    if (event.shiftKey) {
      // Shift+Enter: Open in NSPanel (existing behavior)
      await openControlPanel(threadId, taskId, null);
    } else {
      // Enter: Open in main window content pane
      await showMainWindowWithView({ type: "thread", threadId });
    }
    return;
  }

  if (result.type === "plan") {
    const { planId } = result;

    if (event.shiftKey) {
      // Shift+Enter: Open in NSPanel
      await showControlPanelWithView({ type: "plan", planId });
    } else {
      // Enter: Open in main window content pane
      await showMainWindowWithView({ type: "plan", planId });
    }
    return;
  }

  // Other result types - existing behavior
  // ...
};
```

**Tasks:**
- [ ] Track modifier state in keyboard handler (event object has `shiftKey`)
- [ ] Pass event object to `activateResult` function
- [ ] Add `showMainWindowWithView` to `hotkey-service.ts`
- [ ] Call appropriate function based on modifier

#### 6.4 Frontend: Add Main Window View Service

**File:** `src/lib/hotkey-service.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { ContentPaneView } from "@/components/content-pane/types";
import { logger } from "./logger";

/**
 * Opens the main window and displays a specific view in the content pane.
 * Unlike showControlPanelWithView, this targets the main window, not NSPanel.
 *
 * @param view - The ContentPaneView to display (thread, plan, settings, etc.)
 */
export const showMainWindowWithView = async (view: ContentPaneView): Promise<void> => {
  logger.info(`[hotkey-service] showMainWindowWithView:`, view);
  await invoke("show_main_window_with_view", { view });
};
```

**Tasks:**
- [ ] Add `showMainWindowWithView` function
- [ ] Import `ContentPaneView` from `@/components/content-pane/types`
- [ ] Export from hotkey-service module

#### 6.5 Main Window: Listen for View Events

**File:** `src/components/main-window/main-window-layout.tsx`

The main window needs to listen for `set-content-pane-view` events and update its state via the service layer.

```typescript
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { contentPanesService } from "@/entities/content-panes/service";
import type { ContentPaneView } from "@/components/content-pane/types";

// Inside MainWindowLayout component:
useEffect(() => {
  let unlisten: (() => void) | null = null;

  const setup = async () => {
    unlisten = await listen<{ view: ContentPaneView }>(
      "set-content-pane-view",
      (event) => {
        // Use service layer to update store (follows Entity Store Pattern)
        // This also handles disk persistence and event emission
        contentPanesService.setActivePaneView(event.payload.view);

        // Sync tree selection (bidirectional sync - pane -> tree)
        if (event.payload.view.type === "thread") {
          treeMenuService.selectItem(event.payload.view.threadId, "thread");
        } else if (event.payload.view.type === "plan") {
          treeMenuService.selectItem(event.payload.view.planId, "plan");
        }
      }
    );
  };

  setup();

  return () => {
    if (unlisten) unlisten();
  };
}, []);
```

**Tasks:**
- [ ] Add event listener in main window layout
- [ ] Wire event to content panes SERVICE (not store directly)
- [ ] Add bidirectional tree selection sync
- [ ] Ensure view change triggers re-render

#### 6.6 Bidirectional Tree/Pane Synchronization

**File:** `src/components/tree-menu/tree-menu.tsx`

Tree selection and content pane view must sync bidirectionally:

**Direction 1: Tree -> Pane (on tree item click)**
```typescript
const handleItemSelect = (item: TreeItemNode) => {
  // Update tree selection state first (no event emit yet)
  treeMenuStore.getState()._applySelection(item.id);

  // Update content pane via service
  if (item.type === "thread") {
    contentPanesService.setActivePaneView({ type: "thread", threadId: item.id });
  } else if (item.type === "plan") {
    contentPanesService.setActivePaneView({ type: "plan", planId: item.id });
  }

  // Note: No PANE_VIEW_CHANGED event needed here - this is local interaction
};
```

**Direction 2: Pane -> Tree (on external pane change via Spotlight)**

This is handled in section 6.5's event listener - when `set-content-pane-view` arrives from Spotlight, we update both the pane AND the tree selection.

**Loop prevention:**
- Tree click -> updates pane directly (no cross-window event)
- External pane change -> `set-content-pane-view` event -> updates pane AND syncs tree
- Tree selection update from pane change does NOT re-trigger pane update

**Tasks:**
- [ ] Wire tree item click to content pane SERVICE
- [ ] Sync tree selection in `set-content-pane-view` handler
- [ ] Handle edge case: selected item deleted (clear selection)
- [ ] Test: click tree item, verify pane updates without loops

#### 6.7 Cross-Window PANE_VIEW_CHANGED Event

**File:** `src/entities/content-panes/listeners.ts`

When a pane view changes, other windows may need to know (e.g., to update their tree selection if showing the same view). Add a broadcast event:

```typescript
// src/entities/events.ts - add to EventName enum
export const EventName = {
  // ... existing events ...
  PANE_VIEW_CHANGED: "pane:view-changed",
} as const;

// Event payload type
type BroadcastEvents = {
  // ... existing events ...
  [EventName.PANE_VIEW_CHANGED]: { paneId: string; view: ContentPaneView };
};
```

**File:** `src/entities/content-panes/service.ts`

```typescript
import { eventBus } from "@/lib/event-bridge";
import { EventName } from "@/entities/events";

class ContentPanesService {
  async setActivePaneView(view: ContentPaneView): Promise<void> {
    const { activePaneId } = useContentPanesStore.getState();
    if (!activePaneId) return;

    // 1. Write to disk first (disk-as-truth pattern)
    await this.persistPaneView(activePaneId, view);

    // 2. Update store
    useContentPanesStore.getState()._applyPaneView(activePaneId, view);

    // 3. Emit event AFTER disk write completes
    eventBus.emit(EventName.PANE_VIEW_CHANGED, { paneId: activePaneId, view });
  }
}
```

**File:** `src/entities/content-panes/listeners.ts`

```typescript
import { eventBus } from "@/lib/event-bridge";
import { EventName } from "@/entities/events";
import { contentPanesService } from "./service";

export function setupContentPanesListeners(): void {
  // Listen for thread/plan archival - clear pane if showing archived item
  eventBus.on(EventName.THREAD_ARCHIVED, async ({ threadId }) => {
    const { panes, activePaneId } = useContentPanesStore.getState();
    for (const [paneId, pane] of Object.entries(panes)) {
      if (pane.view.type === "thread" && pane.view.threadId === threadId) {
        await contentPanesService.setPaneView(paneId, { type: "empty" });
      }
    }
  });

  eventBus.on(EventName.PLAN_ARCHIVED, async ({ planId }) => {
    const { panes } = useContentPanesStore.getState();
    for (const [paneId, pane] of Object.entries(panes)) {
      if (pane.view.type === "plan" && pane.view.planId === planId) {
        await contentPanesService.setPaneView(paneId, { type: "empty" });
      }
    }
  });

  // Cross-window sync: when another window changes a pane view, refresh from disk
  eventBus.on(EventName.PANE_VIEW_CHANGED, async ({ paneId }) => {
    await contentPanesService.refreshPane(paneId);
  });
}
```

#### 6.8 Shared Content Components in NSPanel

**File:** `src/components/control-panel/control-panel-window.tsx`

After Phase 6, refactor the control panel to use the shared components:

```typescript
// BEFORE: Duplicate thread rendering logic in control-panel-window.tsx

// AFTER: Use shared ThreadContent component
import { ThreadContent } from "@/components/content-pane/thread-content";
import { PlanContent } from "@/components/content-pane/plan-content";

export function ControlPanelWindow() {
  const { view } = useControlPanelStore();

  return (
    <div className="flex flex-col h-full">
      {/* NSPanel-specific header with drag handle, pin, etc. */}
      <ControlPanelHeader view={view} />

      {/* Shared content - IDENTICAL to main window */}
      <div className="flex-1 min-h-0">
        {view.type === "thread" && (
          <ThreadContent threadId={view.threadId} />
        )}
        {view.type === "plan" && (
          <PlanContent planId={view.planId} />
        )}
      </div>
    </div>
  );
}
```

**Verification checklist:**
- [ ] ThreadContent renders identically in NSPanel and main window
- [ ] PlanContent renders identically in NSPanel and main window
- [ ] Keyboard shortcuts work in both contexts
- [ ] Follow-up message submission works in both contexts
- [ ] Tool responses work in both contexts
- [ ] Streaming/status indicators work in both contexts

#### 6.9 Pop-Out Button Implementation

**File:** `src/components/content-pane/content-pane-header.tsx`

**Decision (made explicit):** After pop-out, KEEP content in the original pane. Users explicitly chose to pop out for a second view - they can close the pane separately if desired. This matches VSCode/IDE behavior where "Open in New Window" doesn't close the original tab.

```typescript
const handlePopOut = async () => {
  if (view.type === "thread") {
    // Open in standalone NSPanel window
    await invoke("open_control_panel", {
      threadId: view.threadId,
      taskId: null,
      prompt: null,
    });
    // Content STAYS in the pane (user chose to duplicate, not move)
  } else if (view.type === "plan") {
    await invoke("show_control_panel_with_view", {
      view: { type: "plan", planId: view.planId },
    });
    // Content STAYS in the pane
  }
};
```

**Tasks:**
- [ ] Add pop-out button to ContentPaneHeader
- [ ] Wire to NSPanel window creation via existing Tauri commands
- [ ] **Do NOT clear pane after pop-out** (explicit decision)
- [ ] Add keyboard shortcut `Cmd+Shift+O` for pop-out

#### 6.10 Keyboard Shortcut Documentation

**Update:** `docs/keyboard-shortcuts.md` or in-app help

| Shortcut | Context | Action |
|----------|---------|--------|
| `Enter` | Spotlight with thread selected | Open in main window content pane |
| `Shift+Enter` | Spotlight with thread selected | Open in NSPanel (floating) |
| `Cmd+W` | Main window content pane | Clear content pane |
| `Cmd+W` | NSPanel | Hide panel |
| `Cmd+Shift+O` | Main window content pane | Pop out to NSPanel |
| `Escape` | NSPanel | Hide panel |

**Tasks:**
- [ ] Document new modifier behavior
- [ ] Add to settings page help section
- [ ] Consider adding keyboard shortcut overlay (Cmd+/)

---

### Phase 6 Acceptance Criteria

1. **Enter on Spotlight:**
   - [ ] Opens thread/plan in main window content pane
   - [ ] Main window comes to front and is focused
   - [ ] Tree selection syncs to opened item
   - [ ] Content renders correctly

2. **Shift+Enter on Spotlight:**
   - [ ] Opens thread/plan in NSPanel (existing behavior preserved)
   - [ ] NSPanel appears floating above other windows
   - [ ] Does NOT affect main window content pane

3. **Tree Selection Sync:**
   - [ ] Clicking tree item opens in content pane
   - [ ] External pane change (Spotlight) syncs tree selection
   - [ ] No infinite loops between tree and pane
   - [ ] Selection state persists across app restarts

4. **Pop-Out Button:**
   - [ ] Visible in content pane header
   - [ ] Opens current view in NSPanel
   - [ ] Original content remains in pane (not cleared)
   - [ ] Keyboard shortcut Cmd+Shift+O works

5. **Shared Components:**
   - [ ] `ThreadContent` works in main window, NSPanel, and standalone window
   - [ ] `PlanContent` works in main window, NSPanel, and standalone window
   - [ ] No visual differences between contexts
   - [ ] All interactions work in all contexts

6. **No Regressions:**
   - [ ] Existing NSPanel behavior unchanged
   - [ ] Existing standalone window behavior unchanged
   - [ ] Keyboard shortcuts work as before

---

## Phase 7: Multi-Pane Architecture (DESIGN NOW, IMPLEMENT LATER)

### Goal

Design an extensible foundation that supports future multi-pane features:
- Split views (horizontal/vertical)
- Tabs within panes
- Drag-and-drop pane arrangement
- Flexible layout persistence

### Design Principles

1. **UUID-Based Pane Identification:** Every pane has a unique ID for state management
2. **Recursive Split Configuration:** Splits can nest arbitrarily deep
3. **Persistence Ready:** Data model supports full serialization with Zod validation
4. **Incremental Adoption:** Single pane works today, multi-pane adds features without breaking changes

### Entity Store Structure

Following the Entity Stores Pattern, content panes are structured as:

```
src/entities/content-panes/
├── types.ts       # Zod schemas and TypeScript types
├── store.ts       # Zustand store with _apply* methods
├── service.ts     # Business logic + disk I/O
└── listeners.ts   # Event subscriptions
```

### Data Model

#### Types File (with Zod Schemas)

**File:** `src/entities/content-panes/types.ts`

```typescript
import { z } from "zod";
// Import the view type from Phase 1 - DO NOT redefine
import type { ContentPaneView } from "@/components/content-pane/types";
// Re-export for convenience
export type { ContentPaneView } from "@/components/content-pane/types";

/**
 * Zod schema for ContentPaneView - used for disk persistence validation
 * Must match the type definition in src/components/content-pane/types.ts
 */
export const ContentPaneViewSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("empty") }),
  z.object({ type: z.literal("thread"), threadId: z.string() }),
  z.object({ type: z.literal("plan"), planId: z.string() }),
  z.object({ type: z.literal("settings") }),
  z.object({ type: z.literal("logs") }),
  z.object({ type: z.literal("terminal"), terminalId: z.string() }),
]);

/**
 * Single content pane with UUID
 */
export const ContentPaneSchema = z.object({
  id: z.string().uuid(),
  view: ContentPaneViewSchema,
  // Future: tabs: z.array(z.string()).optional(),
});
export type ContentPane = z.infer<typeof ContentPaneSchema>;

/**
 * Split configuration for multi-pane layouts (Phase 7 future)
 */
export const SplitConfigurationSchema: z.ZodType<SplitConfiguration> = z.lazy(() =>
  z.object({
    type: z.enum(["horizontal", "vertical"]),
    ratio: z.number().min(0).max(1),
    first: z.union([z.string().uuid(), SplitConfigurationSchema]),
    second: z.union([z.string().uuid(), SplitConfigurationSchema]),
  })
);
export interface SplitConfiguration {
  type: "horizontal" | "vertical";
  ratio: number;
  first: string | SplitConfiguration;
  second: string | SplitConfiguration;
}

/**
 * Root state persisted to ~/.anvil/ui/content-panes.json
 */
export const ContentPanesPersistedStateSchema = z.object({
  version: z.literal(1),
  panes: z.record(z.string(), ContentPaneSchema),
  activePaneId: z.string().nullable(),
  // Phase 7 additions (implement later):
  // rootLayout: z.union([z.string(), SplitConfigurationSchema]).optional(),
  // tabGroups: z.record(z.string(), z.array(z.string())).optional(),
});
export type ContentPanesPersistedState = z.infer<typeof ContentPanesPersistedStateSchema>;
```

#### Store Implementation

**File:** `src/entities/content-panes/store.ts`

```typescript
import { create } from "zustand";
import type { ContentPane, ContentPaneView, ContentPanesPersistedState } from "./types";

interface ContentPanesState {
  version: 1;
  panes: Record<string, ContentPane>;
  activePaneId: string | null;

  // Internal mutation methods (prefixed with _apply)
  // Only called by service layer
  _applyCreate: (pane: ContentPane) => () => void;  // Returns rollback
  _applyDelete: (paneId: string) => () => void;     // Returns rollback
  _applyPaneView: (paneId: string, view: ContentPaneView) => () => void;
  _applyActivePane: (paneId: string | null) => void;
  _applyHydrate: (state: ContentPanesPersistedState) => void;
}

export const useContentPanesStore = create<ContentPanesState>()((set, get) => ({
  version: 1,
  panes: {},
  activePaneId: null,

  _applyCreate: (pane) => {
    const previous = get().panes[pane.id];
    set((state) => ({
      panes: { ...state.panes, [pane.id]: pane },
      activePaneId: state.activePaneId ?? pane.id,
    }));
    // Return rollback function
    return () => {
      if (previous) {
        set((state) => ({ panes: { ...state.panes, [pane.id]: previous } }));
      } else {
        set((state) => {
          const { [pane.id]: _, ...rest } = state.panes;
          return { panes: rest };
        });
      }
    };
  },

  _applyDelete: (paneId) => {
    const previous = get().panes[paneId];
    set((state) => {
      const { [paneId]: _, ...remaining } = state.panes;
      return {
        panes: remaining,
        activePaneId: state.activePaneId === paneId
          ? Object.keys(remaining)[0] ?? null
          : state.activePaneId,
      };
    });
    return () => {
      if (previous) {
        set((state) => ({ panes: { ...state.panes, [paneId]: previous } }));
      }
    };
  },

  _applyPaneView: (paneId, view) => {
    const previous = get().panes[paneId]?.view;
    set((state) => ({
      panes: {
        ...state.panes,
        [paneId]: { ...state.panes[paneId], view },
      },
    }));
    return () => {
      if (previous) {
        set((state) => ({
          panes: {
            ...state.panes,
            [paneId]: { ...state.panes[paneId], view: previous },
          },
        }));
      }
    };
  },

  _applyActivePane: (paneId) => {
    set({ activePaneId: paneId });
  },

  _applyHydrate: (state) => {
    set({
      version: state.version,
      panes: state.panes,
      activePaneId: state.activePaneId,
    });
  },
}));
```

#### Service Implementation

**File:** `src/entities/content-panes/service.ts`

```typescript
import { persistence } from "@/lib/persistence";
import { eventBus } from "@/lib/event-bridge";
import { EventName } from "@/entities/events";
import { useContentPanesStore } from "./store";
import { ContentPanesPersistedStateSchema, type ContentPane, type ContentPaneView } from "./types";
import { logger } from "@/lib/logger";

const PANES_PATH = "ui/content-panes.json";

class ContentPanesService {
  /**
   * Initialize store from disk on app startup
   */
  async hydrate(): Promise<void> {
    const raw = await persistence.readJson(PANES_PATH);

    if (raw) {
      const parsed = ContentPanesPersistedStateSchema.safeParse(raw);
      if (parsed.success) {
        useContentPanesStore.getState()._applyHydrate(parsed.data);
        return;
      }
      logger.warn("[content-panes] Invalid persisted state, initializing fresh", parsed.error);
    }

    // Initialize with single empty pane
    await this.createPane({ type: "empty" });
  }

  /**
   * Create a new pane with optional initial view
   */
  async createPane(view: ContentPaneView = { type: "empty" }): Promise<string> {
    const pane: ContentPane = {
      id: crypto.randomUUID(),
      view,
    };

    // 1. Write to disk FIRST (disk-as-truth)
    await this.persistState({
      ...this.getCurrentState(),
      panes: { ...useContentPanesStore.getState().panes, [pane.id]: pane },
      activePaneId: useContentPanesStore.getState().activePaneId ?? pane.id,
    });

    // 2. Update store
    useContentPanesStore.getState()._applyCreate(pane);

    return pane.id;
  }

  /**
   * Close/delete a pane
   */
  async closePane(paneId: string): Promise<void> {
    const state = useContentPanesStore.getState();
    const { [paneId]: _, ...remaining } = state.panes;

    // 1. Write to disk FIRST
    await this.persistState({
      ...this.getCurrentState(),
      panes: remaining,
      activePaneId: state.activePaneId === paneId
        ? Object.keys(remaining)[0] ?? null
        : state.activePaneId,
    });

    // 2. Update store
    useContentPanesStore.getState()._applyDelete(paneId);
  }

  /**
   * Set the view for a specific pane
   */
  async setPaneView(paneId: string, view: ContentPaneView): Promise<void> {
    const state = useContentPanesStore.getState();
    if (!state.panes[paneId]) {
      logger.warn(`[content-panes] setPaneView: pane ${paneId} not found`);
      return;
    }

    // 1. Write to disk FIRST
    await this.persistState({
      ...this.getCurrentState(),
      panes: {
        ...state.panes,
        [paneId]: { ...state.panes[paneId], view },
      },
    });

    // 2. Update store
    useContentPanesStore.getState()._applyPaneView(paneId, view);

    // 3. Emit event AFTER disk write
    eventBus.emit(EventName.PANE_VIEW_CHANGED, { paneId, view });
  }

  /**
   * Set view for the active pane (convenience method)
   */
  async setActivePaneView(view: ContentPaneView): Promise<void> {
    const { activePaneId } = useContentPanesStore.getState();
    if (!activePaneId) {
      // No active pane - create one
      await this.createPane(view);
      return;
    }
    await this.setPaneView(activePaneId, view);
  }

  /**
   * Refresh a pane from disk (for cross-window sync)
   */
  async refreshPane(paneId: string): Promise<void> {
    const raw = await persistence.readJson(PANES_PATH);
    if (!raw) return;

    const parsed = ContentPanesPersistedStateSchema.safeParse(raw);
    if (!parsed.success) return;

    const pane = parsed.data.panes[paneId];
    if (pane) {
      useContentPanesStore.getState()._applyPaneView(paneId, pane.view);
    }
  }

  /**
   * Set the active pane
   */
  async setActivePane(paneId: string): Promise<void> {
    // 1. Write to disk
    await this.persistState({
      ...this.getCurrentState(),
      activePaneId: paneId,
    });

    // 2. Update store
    useContentPanesStore.getState()._applyActivePane(paneId);
  }

  private getCurrentState() {
    const state = useContentPanesStore.getState();
    return {
      version: 1 as const,
      panes: state.panes,
      activePaneId: state.activePaneId,
    };
  }

  private async persistState(state: { version: 1; panes: Record<string, ContentPane>; activePaneId: string | null }) {
    await persistence.writeJson(PANES_PATH, state);
  }
}

export const contentPanesService = new ContentPanesService();
```

#### Listeners Implementation

**File:** `src/entities/content-panes/listeners.ts`

```typescript
import { eventBus } from "@/lib/event-bridge";
import { EventName } from "@/entities/events";
import { contentPanesService } from "./service";
import { useContentPanesStore } from "./store";

export function setupContentPanesListeners(): void {
  // Clear pane when thread is archived
  eventBus.on(EventName.THREAD_ARCHIVED, async ({ threadId }) => {
    const { panes } = useContentPanesStore.getState();
    for (const [paneId, pane] of Object.entries(panes)) {
      if (pane.view.type === "thread" && pane.view.threadId === threadId) {
        await contentPanesService.setPaneView(paneId, { type: "empty" });
      }
    }
  });

  // Clear pane when plan is archived
  eventBus.on(EventName.PLAN_ARCHIVED, async ({ planId }) => {
    const { panes } = useContentPanesStore.getState();
    for (const [paneId, pane] of Object.entries(panes)) {
      if (pane.view.type === "plan" && pane.view.planId === planId) {
        await contentPanesService.setPaneView(paneId, { type: "empty" });
      }
    }
  });

  // Cross-window sync: refresh pane when changed elsewhere
  eventBus.on(EventName.PANE_VIEW_CHANGED, async ({ paneId }) => {
    // Only refresh if this event came from another window
    // The _source field is stripped by event-bridge, but we can check
    // if the local store already has this state
    await contentPanesService.refreshPane(paneId);
  });
}
```

#### Initialization

**File:** `src/entities/index.ts`

```typescript
import { setupContentPanesListeners } from "./content-panes/listeners";
import { contentPanesService } from "./content-panes/service";

export async function setupEntityListeners(): Promise<void> {
  // ... existing setup ...
  setupContentPanesListeners();
}

export async function hydrateEntities(): Promise<void> {
  // ... existing hydration ...
  await contentPanesService.hydrate();
}
```

### Future Multi-Pane Features (Deferred)

#### 7.1 Split Views

**Visual Concept:**
```
┌──────────────────┬──────────────────┐
│                  │                  │
│   Thread View    │   Plan View      │
│   (Pane A)       │   (Pane B)       │
│                  │                  │
└──────────────────┴──────────────────┘
```

**Split Configuration Example:**
```typescript
const layout: SplitConfiguration = {
  type: "horizontal",
  ratio: 0.5,
  first: "pane-uuid-a",
  second: "pane-uuid-b",
};
```

**Future Implementation Tasks:**
- [ ] Create `SplitPane` component with drag handle
- [ ] Implement recursive split rendering
- [ ] Add split/unsplit actions to pane header
- [ ] Handle nested splits (3+ panes)

#### 7.2 Tabs Within Panes

**Visual Concept:**
```
┌──────────────────────────────────────┐
│ [Thread 1] [Thread 2] [Plan A] [+]   │ <- Tabs
├──────────────────────────────────────┤
│                                      │
│   Active Tab Content                 │
│                                      │
└──────────────────────────────────────┘
```

**Data Model Extension:**
```typescript
interface ContentPane {
  id: string;
  view: ContentPaneView;
  tabs: string[];           // Ordered tab pane IDs
  activeTabIndex: number;   // Currently visible tab
}
```

**Future Implementation Tasks:**
- [ ] Create `TabBar` component
- [ ] Add tab reordering via drag-and-drop
- [ ] Add "New Tab" button
- [ ] Handle tab close (switch to adjacent tab)

#### 7.3 Drag-and-Drop Pane Arrangement

**Visual Concept:**
```
Drag thread from tree -> drop on pane edge -> creates split
Drag tab -> drop on another pane -> moves to that pane's tabs
Drag tab -> drop on empty area -> creates new pane
```

**Future Implementation Tasks:**
- [ ] Integrate drag-and-drop library (e.g., dnd-kit)
- [ ] Add drop zones on pane edges
- [ ] Handle cross-pane tab movement
- [ ] Add visual feedback during drag

### ContentPaneContainer Component Design

```typescript
// src/components/content-pane/content-pane-container.tsx

import { useContentPanesStore } from "@/entities/content-panes/store";
import { ContentPane } from "./content-pane";
import { EmptyPaneContent } from "./empty-pane-content";
import { contentPanesService } from "@/entities/content-panes/service";

/**
 * Manages the content pane area.
 * Phase 6: Renders single pane
 * Phase 7: Renders split layout recursively
 */
export function ContentPaneContainer() {
  const panes = useContentPanesStore((s) => s.panes);
  const activePaneId = useContentPanesStore((s) => s.activePaneId);
  // const rootLayout = useContentPanesStore((s) => s.rootLayout); // Phase 7

  // Phase 6: Single pane rendering
  const pane = activePaneId ? panes[activePaneId] : null;

  if (!pane) {
    return (
      <EmptyPaneContent
        onCreatePane={() => contentPanesService.createPane()}
      />
    );
  }

  return (
    <ContentPane
      paneId={pane.id}
      view={pane.view}
      onClose={() => contentPanesService.setPaneView(pane.id, { type: "empty" })}
      onPopOut={/* handled by ContentPaneHeader */}
    />
  );

  // Phase 7: Recursive split rendering (future)
  // return <SplitLayout config={rootLayout} panes={panes} />;
}
```

### UI Design Sketches

#### Split Controls (Future)

```
┌─────────────────────────────────────────┐
│ [Thread Title]           [⊞] [⋮] [✕]   │  <- ⊞ = split menu
└─────────────────────────────────────────┘

Split Menu:
┌─────────────────────┐
│ Split Right    ⌘\   │
│ Split Down     ⌘-   │
│ ──────────────────  │
│ Close Pane     ⌘W   │
│ Pop Out        ⌘O   │
└─────────────────────┘
```

#### Tab Bar (Future)

```
┌─ Tab Bar ──────────────────────────────────────────┐
│ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│ │ Thread 1 │ │ Thread 2 │ │ Plan     │  [+]       │
│ │    ●     │ │          │ │          │            │
│ └──────────┘ └──────────┘ └──────────┘            │
│  ^ active     ^ unread indicator                   │
└────────────────────────────────────────────────────┘
```

### Migration Path

**From Single Pane (Phase 6) to Multi-Pane (Phase 7):**

1. **Version 1 (Phase 6):**
   ```json
   {
     "version": 1,
     "panes": { "uuid-1": { "id": "uuid-1", "view": {...} } },
     "activePaneId": "uuid-1"
   }
   ```

2. **Version 2 (Phase 7):**
   ```json
   {
     "version": 2,
     "panes": { "uuid-1": {...}, "uuid-2": {...} },
     "activePaneId": "uuid-1",
     "rootLayout": {
       "type": "horizontal",
       "ratio": 0.5,
       "first": "uuid-1",
       "second": "uuid-2"
     }
   }
   ```

**Migration logic:**
```typescript
function migrateContentPanesState(data: unknown): ContentPanesPersistedState {
  const parsed = ContentPanesPersistedStateSchema.safeParse(data);
  if (!parsed.success) {
    // Invalid data - return fresh state
    return { version: 1, panes: {}, activePaneId: null };
  }

  if (parsed.data.version === 1) {
    // Add rootLayout pointing to single pane (when upgrading to v2)
    return {
      ...parsed.data,
      version: 2 as any, // Future version
      rootLayout: parsed.data.activePaneId,
    };
  }

  return parsed.data;
}
```

---

## Dependencies & Sequencing

### Prerequisites for Phase 6

| Dependency | Description | Verification |
|------------|-------------|--------------|
| Phase 1 | `ContentPaneView` type and content components | Files exist in `src/components/content-pane/` |
| Phase 4 | Content panes store created | `src/entities/content-panes/store.ts` exists |
| Phase 5 | Deprecation cleanup complete | Old sidebar deleted, `pnpm build` passes |

### Phase 6 Can Run Independently of Phase 7

- Does not require Phase 7 implementation
- Only uses single-pane data model
- Multi-pane fields designed but not implemented

### Phase 7 Depends On

- Phase 6 complete (shared components verified in all contexts)
- Performance acceptable with current architecture
- User feedback indicating multi-pane is desired

---

## Risk Assessment

### Phase 6 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| NSPanel focus issues | Medium | Medium | Test extensively on multiple monitors |
| Event routing complexity | Medium | High | Log all events, add debug mode |
| Bidirectional sync loops | Medium | High | Clear ownership rules per section 6.6 |
| Performance with two render targets | Low | Medium | Profile before/after |

### Phase 7 Risks (Future)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Complex state management | High | High | Extensive unit tests |
| Drag-and-drop edge cases | High | Medium | Start with simple splits |
| Performance with many panes | Medium | Medium | Virtualize tab lists |

---

## Success Metrics

### Phase 6
- [ ] Enter/Shift+Enter behavior works as specified
- [ ] No user-reported regressions in NSPanel
- [ ] Shared components render identically in all contexts
- [ ] Pop-out button functional (content stays in pane)
- [ ] Bidirectional tree/pane sync works without loops

### Phase 7 (Future)
- [ ] Split views work with 2+ panes
- [ ] Tabs enable multi-document workflows
- [ ] Layout persists across sessions
- [ ] Performance acceptable with 5+ open panes

---

## References

- Master plan: `/plans/main-window-refactor.md`
- Content pane types: `src/components/content-pane/types.ts` (Phase 1)
- Entity stores pattern: `docs/patterns/entity-stores.md`
- Disk as truth pattern: `docs/patterns/disk-as-truth.md`
- Zod at boundaries pattern: `docs/patterns/zod-boundaries.md`
- Event bridge pattern: `docs/patterns/event-bridge.md`
- Existing hotkey service: `src/lib/hotkey-service.ts`
- Existing spotlight: `src/components/spotlight/spotlight.tsx`
- Control panel window: `src/components/control-panel/control-panel-window.tsx`
