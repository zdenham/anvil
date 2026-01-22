# Sub-Plan 03: Inbox → Control Panel Wiring

**Parallelizable with:** 01-control-panel-window.md, 02-quick-actions.md
**Depends on:** 00-type-fixes.md

## Goal

Wire up inbox item clicks to open the control panel with the correct view type (thread or plan). Support both native panel opening and client-side view switching.

## Files Owned by This Sub-Plan

- `src/components/main-window/main-window-layout.tsx`
- `src/lib/hotkey-service.ts`
- `src/lib/tauri-commands.ts`
- `src-tauri/src/panels.rs` (Rust)
- `src/components/inbox/unified-inbox.tsx`

## Implementation Steps

### Step 1: Implement Inbox Click Handlers

**File:** `src/components/main-window/main-window-layout.tsx`

Implement the TODO handlers for thread and plan selection:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { eventBus } from "@/entities";
import type { ThreadMetadata } from "@/entities/threads";
import type { PlanMetadata } from "@/entities/plans";

const handleThreadSelect = useCallback(async (thread: ThreadMetadata) => {
  // Emit event for control panel to handle the view switch
  eventBus.emit("open-control-panel", {
    view: { type: "thread", threadId: thread.id },
  });

  // Ensure panel is visible (may need to open native window)
  await invoke("show_control_panel");
}, []);

const handlePlanSelect = useCallback(async (plan: PlanMetadata) => {
  // Emit event for control panel to handle the view switch
  eventBus.emit("open-control-panel", {
    view: { type: "plan", planId: plan.id },
  });

  // Ensure panel is visible
  await invoke("show_control_panel");
}, []);
```

### Step 2: Add show_control_panel Tauri Command

**File:** `src-tauri/src/panels.rs`

Add a simple command that shows the control panel without setting thread context:

```rust
#[tauri::command]
pub async fn show_control_panel(app: AppHandle) -> Result<(), String> {
    // Get or create the control panel window
    if let Some(window) = app.get_webview_window("control-panel") {
        // Window exists - just show and focus it
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        // Window doesn't exist - create it
        // (The view will be set via eventBus from the frontend)
        create_control_panel_window(&app)?;
    }
    Ok(())
}
```

**File:** `src-tauri/src/lib.rs`

Register the new command:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    panels::show_control_panel,
])
```

### Step 3: Add TypeScript Command Wrapper

**File:** `src/lib/tauri-commands.ts`

Add typed wrapper for the new command:

```typescript
export async function showControlPanel(): Promise<void> {
  await invoke("show_control_panel");
}
```

### Step 4: Extend Client-Side Switching

**File:** `src/lib/hotkey-service.ts`

Update `switchControlPanelClientSide` to use the new discriminated union:

```typescript
import type { ControlPanelViewType } from "@/entities/events";

/**
 * Switch control panel view client-side (no native window operations).
 * Use this when the panel is already open to avoid focus flicker.
 */
export const switchControlPanelClientSide = (view: ControlPanelViewType): void => {
  import("@/entities").then(({ eventBus }) => {
    logger.debug(`[hotkey-service] Client-side switch to:`, view);
    eventBus.emit("open-control-panel", { view });
  });
};

// Convenience wrappers
export const switchToThread = (threadId: string): void => {
  switchControlPanelClientSide({ type: "thread", threadId });
};

export const switchToPlan = (planId: string): void => {
  switchControlPanelClientSide({ type: "plan", planId });
};
```

### Step 5: Integrate Navigation Mode in Inbox

**File:** `src/components/inbox/unified-inbox.tsx`

Wire up keyboard navigation to use client-side switching:

```typescript
import { useNavigationMode } from "@/hooks/use-navigation-mode";
import { switchToThread, switchToPlan } from "@/lib/hotkey-service";

// In component:
const { isNavigating, selectedIndex } = useNavigationMode({
  itemCount: items.length,
  onItemSelect: (index) => {
    const item = items[index];
    if (item.type === "thread") {
      switchToThread(item.data.id);
    } else if (item.type === "plan") {
      switchToPlan(item.data.id);
    }
  },
});

// Add visual feedback for navigation
return (
  <div>
    {items.map((item, index) => (
      <InboxItem
        key={item.id}
        item={item}
        isSelected={isNavigating && selectedIndex === index}
        onClick={() => handleItemClick(item)}
      />
    ))}
  </div>
);
```

## Verification

```bash
# Type check
pnpm tsc --noEmit

# Build Rust
cd src-tauri && cargo build

# Run inbox tests
pnpm test src/components/inbox/
pnpm test src/lib/hotkey-service

# Manual verification:
# 1. Click a thread in inbox - control panel opens with thread view
# 2. Click a plan in inbox - control panel opens with plan view
# 3. With panel open, click another thread - switches without flicker
# 4. Hold Shift, press Up/Down - highlights items in inbox
# 5. Release Shift - opens highlighted item in control panel
```

## Success Criteria

- [ ] Clicking thread in inbox opens control panel with thread view
- [ ] Clicking plan in inbox opens control panel with plan view
- [ ] Client-side switching works when panel already open
- [ ] Keyboard navigation (Shift+Up/Down) highlights items
- [ ] Releasing Shift opens the selected item
- [ ] No TypeScript errors
- [ ] Rust builds successfully
- [ ] Existing tests pass
