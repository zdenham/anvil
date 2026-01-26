# Unified Panel/Window Navigation Utilities

## Problem

The codebase now supports both NSPanel (singleton floating panel) and standalone WebviewWindows. However, many navigation actions still assume NSPanel-only behavior, calling `invoke("hide_control_panel")` directly instead of handling both window types properly.

This causes issues when:
1. Pressing Escape in a standalone window calls `hide_control_panel` (wrong)
2. Quick actions like "closePanel" only work for NSPanel
3. Navigation fallbacks (e.g., "all caught up" → inbox) incorrectly hide panels instead of closing windows
4. `stale-plan-view.tsx` dismissal only works for NSPanel

## Known Issue: Resize Conflicts

There may be custom resize logic in the codebase that conflicts with native window resizing for standalone windows. The NSPanel has custom resize handling (pin on resize, etc.) that shouldn't apply to standalone windows. This should be audited during implementation.

Relevant code to check:
- `control-panel-window.tsx` lines 271-294: `onResized` handler that pins panel
- This should be conditional on `!isStandaloneWindow`

## Current State Audit

### Files with Direct `invoke("hide_control_panel")` Calls

| File | Line(s) | Context | Issue |
|------|---------|---------|-------|
| `control-panel-window.tsx` | 431 | Quick action "closePanel" | Only hides NSPanel |
| `plan-view.tsx` | 183 | Quick action "closePanel" | Only hides NSPanel |
| `stale-plan-view.tsx` | 26, 33 | Delete/dismiss buttons | Only hides NSPanel |
| `use-navigate-to-next-item.ts` | 114 | Fallback to inbox | Only hides NSPanel |

### Files with Conditional Close Logic (Already Partial Support)

| File | Line(s) | Context | Status |
|------|---------|---------|--------|
| `control-panel-header.tsx` | 43-51 | handleClose function | ✅ Works for both |
| `control-panel-window.tsx` | 499-504 | Escape key handler | ✅ Works for both |
| `plan-view.tsx` | 269-275 | Escape key handler | ✅ Works for both |

### Other Navigation-Related Code

| File | Function | Notes |
|------|----------|-------|
| `hotkey-service.ts` | `switchToThread`, `switchToPlan` | Routes through Rust, may need window awareness |
| `use-window-drag.ts` | `hideCommand` option | Already supports conditional hide |

## Solution: Zustand Store + Navigation Utilities

Use a Zustand store to hold panel context instead of React Context (avoids adding providers).

### 1. Zustand Store: `src/stores/panel-context-store.ts`

```typescript
/**
 * Panel Context Store
 *
 * Stores the current panel/window context (NSPanel vs standalone window).
 * Initialized once at app startup based on URL params.
 */

import { create } from "zustand";

export interface PanelContext {
  /** Whether this is a standalone window (not NSPanel) */
  isStandaloneWindow: boolean;
  /** Instance ID for standalone windows (null for NSPanel) */
  instanceId: string | null;
}

interface PanelContextStore extends PanelContext {
  /** Initialize the store from URL params (call once at startup) */
  initialize: () => void;
}

export const usePanelContextStore = create<PanelContextStore>((set) => ({
  isStandaloneWindow: false,
  instanceId: null,

  initialize: () => {
    const searchParams = new URLSearchParams(window.location.search);
    const instanceId = searchParams.get("instanceId");
    const isStandaloneWindow = !!instanceId;

    set({ isStandaloneWindow, instanceId });
  },
}));

/**
 * Get the current panel context (non-reactive, for use outside React).
 */
export function getPanelContext(): PanelContext {
  const { isStandaloneWindow, instanceId } = usePanelContextStore.getState();
  return { isStandaloneWindow, instanceId };
}
```

### 2. Navigation Utilities: `src/lib/panel-navigation.ts`

```typescript
/**
 * Panel/Window Navigation Utilities
 *
 * Provides context-aware close/navigation functions that work for both
 * NSPanel (singleton) and standalone WebviewWindows.
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger-client";
import { getPanelContext, type PanelContext } from "@/stores/panel-context-store";

/**
 * Close the current panel or window.
 * Uses the global panel context from the Zustand store.
 *
 * - For NSPanel: calls hide_control_panel
 * - For standalone windows: calls close_control_panel_window
 */
export async function closeCurrentPanelOrWindow(): Promise<void> {
  const { isStandaloneWindow, instanceId } = getPanelContext();

  if (isStandaloneWindow && instanceId) {
    logger.info(`[panel-navigation] Closing standalone window: ${instanceId}`);
    await invoke("close_control_panel_window", { instanceId });
  } else {
    logger.info(`[panel-navigation] Hiding NSPanel`);
    await invoke("hide_control_panel");
  }
}

/**
 * Close panel/window and navigate to inbox.
 *
 * This is used when there are no more unread items - closes the current
 * view and shows the inbox list panel.
 */
export async function closeAndShowInbox(): Promise<void> {
  await closeCurrentPanelOrWindow();
  await invoke("open_inbox_list_panel");
}

/**
 * Focus the current panel or window.
 *
 * Currently only works for NSPanel. Standalone windows use native focus.
 */
export async function focusCurrentPanel(): Promise<void> {
  const { isStandaloneWindow } = getPanelContext();
  if (!isStandaloneWindow) {
    await invoke("focus_control_panel");
  }
}

/**
 * Pin the current panel (NSPanel only).
 *
 * Pinning prevents the panel from hiding on blur.
 * No-op for standalone windows.
 */
export async function pinCurrentPanel(): Promise<void> {
  const { isStandaloneWindow } = getPanelContext();
  if (!isStandaloneWindow) {
    await invoke("pin_control_panel");
  }
}

/**
 * Check if this is a standalone window.
 */
export function isStandaloneWindow(): boolean {
  return getPanelContext().isStandaloneWindow;
}

/**
 * Get the instance ID (null for NSPanel).
 */
export function getInstanceId(): string | null {
  return getPanelContext().instanceId;
}
```

### 3. React Hook (Optional Convenience): `src/hooks/use-panel-navigation.ts`

```typescript
/**
 * Hook providing panel navigation actions.
 * Reads from the Zustand store for reactive updates.
 */

import { useCallback } from "react";
import { usePanelContextStore } from "@/stores/panel-context-store";
import {
  closeCurrentPanelOrWindow,
  closeAndShowInbox,
  focusCurrentPanel,
  pinCurrentPanel,
} from "@/lib/panel-navigation";

export function usePanelNavigation() {
  const isStandaloneWindow = usePanelContextStore((s) => s.isStandaloneWindow);
  const instanceId = usePanelContextStore((s) => s.instanceId);

  return {
    close: closeCurrentPanelOrWindow,
    closeToInbox: closeAndShowInbox,
    focus: focusCurrentPanel,
    pin: pinCurrentPanel,
    isStandaloneWindow,
    instanceId,
  };
}
```

---

## Implementation Steps

### Phase 1: Create Infrastructure

1. **Create `src/stores/panel-context-store.ts`**
   - Export `usePanelContextStore` Zustand store
   - Export `getPanelContext()` for non-React usage
   - Export `PanelContext` interface

2. **Create `src/lib/panel-navigation.ts`**
   - Export `closeCurrentPanelOrWindow()`
   - Export `closeAndShowInbox()`
   - Export `focusCurrentPanel()`
   - Export `pinCurrentPanel()`
   - Export `isStandaloneWindow()`, `getInstanceId()` helpers

3. **Create `src/hooks/use-panel-navigation.ts`** (optional)
   - Export `usePanelNavigation()` hook for React components

### Phase 2: Initialize Store

4. **Update `src/control-panel-main.tsx`**
   - Call `usePanelContextStore.getState().initialize()` at app startup
   - This parses URL params once and sets store state

### Phase 3: Migrate Components

5. **Update `control-panel-window.tsx`**
   - Replace `invoke("hide_control_panel")` in handleQuickAction (line 431) with `closeCurrentPanelOrWindow()`
   - **Fix resize handler** (lines 271-294): Skip pin logic when `isStandaloneWindow()`
   - Simplify Escape handler to use `closeCurrentPanelOrWindow()`

6. **Update `plan-view.tsx`**
   - Replace `invoke("hide_control_panel")` in handleQuickAction (line 183) with `closeCurrentPanelOrWindow()`
   - Simplify Escape handler to use `closeCurrentPanelOrWindow()`

7. **Update `stale-plan-view.tsx`**
   - Replace both `invoke("hide_control_panel")` calls with `closeCurrentPanelOrWindow()`

8. **Update `use-navigate-to-next-item.ts`**
   - Replace direct invoke with `closeAndShowInbox()` (line 114)
   - No need to pass context - it reads from the store

### Phase 4: Fix Resize Behavior

9. **Update `control-panel-window.tsx` resize handler**
   ```typescript
   useEffect(() => {
     // Skip resize-to-pin logic for standalone windows
     if (isStandaloneWindow()) return;

     const currentWindow = getCurrentWindow();
     // ... existing pin logic
   }, []);
   ```

---

## Files to Modify (Summary)

### New Files
- `src/stores/panel-context-store.ts` - Zustand store for panel context
- `src/lib/panel-navigation.ts` - Navigation utility functions
- `src/hooks/use-panel-navigation.ts` - React hook (optional)

### Modified Files
- `src/control-panel-main.tsx` - Initialize store at startup
- `src/components/control-panel/control-panel-window.tsx` - Use utilities, fix resize
- `src/components/control-panel/plan-view.tsx` - Use utilities
- `src/components/control-panel/stale-plan-view.tsx` - Use utilities
- `src/hooks/use-navigate-to-next-item.ts` - Use `closeAndShowInbox()`

---

## Testing Checklist

- [ ] NSPanel: Escape key hides panel
- [ ] NSPanel: "Close" quick action hides panel
- [ ] NSPanel: Archive action navigates or shows inbox
- [ ] NSPanel: Stale plan dismiss hides panel
- [ ] NSPanel: Resize pins panel (existing behavior preserved)
- [ ] Standalone window: Escape key closes window
- [ ] Standalone window: "Close" quick action closes window
- [ ] Standalone window: Archive action navigates or shows inbox + closes window
- [ ] Standalone window: Stale plan dismiss closes window
- [ ] Standalone window: Resize does NOT trigger pin logic
- [ ] Both: "All caught up" shows inbox correctly

---

## Future Considerations

### Pop-In Support
Currently standalone windows only have a close button. A "pop-in" feature could:
1. Close the standalone window
2. Open the same content in the NSPanel

This would require:
- A "pop-in" button in standalone window headers
- A new `pop_in_control_panel(instanceId)` backend command
- The backend would read the window's thread/plan ID, hide the window, and show NSPanel with that content

### Cross-Window Navigation
When navigating from a standalone window to a different thread/plan:
- Currently: Uses `switchToThread`/`switchToPlan` which show NSPanel
- Alternative: Navigate within the same standalone window

This might need a `navigateInPlace` option that updates the standalone window's URL params instead of opening NSPanel.
