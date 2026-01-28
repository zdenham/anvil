# Content Pane Navigation Fixes

## Overview

This plan addresses three related bugs in the content pane system, all stemming from a missing context system that distinguishes main window rendering from panel rendering.

## Bugs Summary

1. **Pop-out button showing in main window** - Thread content pane shows pop-out button when it shouldn't
2. **Pop-out opens standalone window** - Should open in main window instead (deprecating standalone windows)
3. **Quick actions open panel instead of updating tab** - Navigation in main window incorrectly routes to control panel

## Root Cause Analysis

All three bugs stem from a single architectural gap: **No context system to detect main window vs panel rendering**.

The control panel has context awareness via `panel-context-store.ts`:
```tsx
// Works for control panel
const { isStandaloneWindow } = usePanelContextStore.getState();
```

But the main window content pane system has no equivalent - it cannot detect that it's rendering in the main window.

## Key Files Involved

| File | Issue |
|------|-------|
| `src/components/content-pane/content-pane-header.tsx:244-253` | Always shows pop-out button |
| `src/components/content-pane/content-pane-container.tsx:31-46` | Pop-out calls `showControlPanelWithView()` |
| `src/components/content-pane/thread-content.tsx:270-278` | Quick actions use panel navigation |
| `src/hooks/use-navigate-to-next-item.ts:92-96` | Navigation calls `switchToThread()` → panel |
| `src/lib/hotkey-service.ts:220` | `switchToThread()` routes to control panel |

## Implementation Plan

### Phase 1: Create Main Window Context System

Create a context provider that components can use to detect they're rendering in the main window.

#### 1.1 Create main-window-context.tsx

**File**: `src/components/main-window/main-window-context.tsx`

```tsx
import { createContext, useContext, ReactNode } from "react";

interface MainWindowContextValue {
  isMainWindow: true;
}

const MainWindowContext = createContext<MainWindowContextValue | null>(null);

export function MainWindowProvider({ children }: { children: ReactNode }) {
  return (
    <MainWindowContext.Provider value={{ isMainWindow: true }}>
      {children}
    </MainWindowContext.Provider>
  );
}

export function useIsMainWindow(): boolean {
  const context = useContext(MainWindowContext);
  return context?.isMainWindow === true;
}
```

#### 1.2 Wrap MainWindowLayout with Provider

**File**: `src/components/main-window/main-window-layout.tsx`

Wrap the layout content with `MainWindowProvider`:

```tsx
import { MainWindowProvider } from "./main-window-context";

export function MainWindowLayout() {
  return (
    <MainWindowProvider>
      {/* existing layout content */}
    </MainWindowProvider>
  );
}
```

### Phase 2: Fix Pop-out Button Visibility (Bug #1)

#### 2.1 Update ContentPaneHeader

**File**: `src/components/content-pane/content-pane-header.tsx`

Import the context hook and conditionally hide pop-out button:

```tsx
import { useIsMainWindow } from "../main-window/main-window-context";

export function ContentPaneHeader({ onPopOut, ...props }) {
  const isMainWindow = useIsMainWindow();

  return (
    <header>
      {/* ... other header content ... */}

      {/* Only show pop-out when NOT in main window AND callback exists */}
      {onPopOut && !isMainWindow && (
        <button onClick={onPopOut}>
          <PictureInPicture2 size={16} />
        </button>
      )}
    </header>
  );
}
```

### Phase 3: Deprecate Standalone Windows (Bug #2)

#### 3.1 Update Pop-out Handler in ContentPaneContainer

**File**: `src/components/content-pane/content-pane-container.tsx`

Change the pop-out handler to open in main window instead:

```tsx
import { showMainWindowWithView } from "@/lib/hotkey-service";
import { invoke } from "@tauri-apps/api/core";

const handlePopOut = async () => {
  if (!activePane) return;
  const view = activePane.view;

  // Open in main window instead of standalone window
  await showMainWindowWithView(view);

  // Focus the main window
  await invoke("show_main_window");
};
```

Note: Since the pop-out button is now hidden in main window (Phase 2), this handler will only be called from the control panel (NSPanel). This redirects panel content to the main window.

#### 3.2 Alternative: Remove Pop-out Entirely from Content Pane

Since we're deprecating standalone windows and the button is hidden in main window context anyway, we can simplify by not passing `onPopOut` to ContentPaneHeader at all:

```tsx
// ContentPaneContainer - simplify by removing pop-out
<ContentPaneHeader
  view={activePane?.view}
  onClose={handleClose}
  // Remove: onPopOut={handlePopOut}
/>
```

### Phase 4: Fix Quick Action Navigation (Bug #3)

This requires context-aware navigation that routes differently based on rendering context.

#### 4.1 Create useContextAwareNavigation Hook

**File**: `src/hooks/use-context-aware-navigation.ts`

```tsx
import { useIsMainWindow } from "@/components/main-window/main-window-context";
import { contentPanesService } from "@/stores/content-panes/service";
import { showControlPanelWithView } from "@/lib/hotkey-service";
import type { ContentPaneView, ControlPanelViewType } from "@/types";

export function useContextAwareNavigation() {
  const isMainWindow = useIsMainWindow();

  const navigateToThread = async (threadId: string) => {
    if (isMainWindow) {
      // Update the main window's content pane
      contentPanesService.setActivePaneView({ type: "thread", threadId });
    } else {
      // Navigate via control panel (for panel/NSPanel context)
      await showControlPanelWithView({ type: "thread", threadId });
    }
  };

  const navigateToPlan = async (planId: string) => {
    if (isMainWindow) {
      contentPanesService.setActivePaneView({ type: "plan", planId });
    } else {
      await showControlPanelWithView({ type: "plan", planId });
    }
  };

  const navigateToView = async (view: ContentPaneView) => {
    if (isMainWindow) {
      contentPanesService.setActivePaneView(view);
    } else {
      // Convert to ControlPanelViewType for panel
      if (view.type === "thread" || view.type === "plan") {
        await showControlPanelWithView(view);
      }
    }
  };

  return {
    navigateToThread,
    navigateToPlan,
    navigateToView,
    isMainWindow,
  };
}
```

#### 4.2 Update useNavigateToNextItem Hook

**File**: `src/hooks/use-navigate-to-next-item.ts`

Refactor to use context-aware navigation:

```tsx
import { useContextAwareNavigation } from "./use-context-aware-navigation";

export function useNavigateToNextItem() {
  const { navigateToThread, navigateToPlan, isMainWindow } = useContextAwareNavigation();

  const navigateToItem = async (item: InboxItem) => {
    if (item.type === "thread") {
      await navigateToThread(item.id);
    } else if (item.type === "plan") {
      await navigateToPlan(item.id);
    }
  };

  const navigateToNextItemOrFallback = async (
    currentItem: InboxItem,
    options?: NavigateOptions
  ) => {
    const nextItem = getNextUnreadItem(currentItem);

    if (nextItem) {
      await navigateToItem(nextItem);
    } else {
      // Handle "no more items" case
      if (isMainWindow) {
        // Stay in main window, show empty state or first inbox item
        contentPanesService.setActivePaneView({ type: "empty" });
      } else {
        // Close panel and show inbox (existing behavior)
        await closeAndShowInbox();
      }
    }
  };

  return { navigateToNextItemOrFallback, navigateToItem };
}
```

#### 4.3 Update ThreadContent Quick Action Handler

**File**: `src/components/content-pane/thread-content.tsx`

The `navigateToNextItemOrFallback` hook already handles context now, so the existing code should work. Just verify:

```tsx
const { navigateToNextItemOrFallback } = useNavigateToNextItem();

const handleQuickAction = async (action: QuickAction) => {
  if (action === "nextItem") {
    // This now routes correctly based on context
    await navigateToNextItemOrFallback(currentItem, { actionType: "nextItem" });
  }
  // ... other actions
};
```

### Phase 5: Testing Checklist

- [ ] Main window content pane does NOT show pop-out button
- [ ] Control panel (NSPanel) still shows pop-out button
- [ ] Clicking pop-out in control panel opens main window (not standalone)
- [ ] Quick action in main window updates the tab (not opens panel)
- [ ] Quick action in control panel still navigates within panel
- [ ] "No more items" in main window shows empty state (not closes window)
- [ ] "No more items" in panel closes panel and shows inbox

### Migration Notes

**Deprecation of Standalone Windows**:
- The Rust command `pop_out_control_panel` becomes unused
- Can be removed in a future cleanup PR
- No user-facing standalone window functionality remains

**Context Propagation**:
- All components inside `MainWindowLayout` automatically get `isMainWindow=true`
- All components outside (control panel, etc.) get `isMainWindow=false`
- No manual prop drilling required

## File Changes Summary

| File | Action |
|------|--------|
| `src/components/main-window/main-window-context.tsx` | **Create** - Context provider |
| `src/components/main-window/main-window-layout.tsx` | **Edit** - Wrap with provider |
| `src/components/content-pane/content-pane-header.tsx` | **Edit** - Hide pop-out in main window |
| `src/components/content-pane/content-pane-container.tsx` | **Edit** - Update/remove pop-out handler |
| `src/hooks/use-context-aware-navigation.ts` | **Create** - Context-aware navigation |
| `src/hooks/use-navigate-to-next-item.ts` | **Edit** - Use context-aware navigation |
| `src/components/content-pane/thread-content.tsx` | **Verify** - Should work with updated hook |

## Alternatives Considered

### Alternative A: Prop Drilling
Pass `isMainWindow` prop through component tree. Rejected because:
- Requires changes to many intermediate components
- Easy to forget to pass through
- Context is cleaner for this use case

### Alternative B: Separate Components
Create separate `MainWindowThreadContent` and `PanelThreadContent`. Rejected because:
- Duplicates logic
- Harder to maintain
- Context system is more flexible

### Alternative C: URL-based Detection
Detect from window URL like panel-context-store does. Rejected because:
- Main window doesn't have distinguishing URL params
- Adding them would be intrusive
- React context is the idiomatic solution
