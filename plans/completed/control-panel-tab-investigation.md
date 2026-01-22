# Control Panel Tab Investigation

## Issue

The "Control Panel" tab is not visible in the main window sidebar. After implementing `thread-plan-architecture.md`, the sidebar still shows "Tasks" instead of "Mission Control".

## Investigation

### What Was Expected (from 08-control-panel.md)

The plan specified:

> **Task 16: Update UI labels**
> - "Simple Task" -> "Control Panel"
> - Main tab label -> "Mission Control"

### Current State

1. **Sidebar tabs** (`src/components/main-window/sidebar.tsx:17`):
   ```typescript
   const navItems: NavItem[] = [
     { id: "tasks", label: "Tasks" },  // Should be "Mission Control"
     { id: "worktrees", label: "Worktrees" },
     { id: "settings", label: "Settings" },
     { id: "logs", label: "Logs" },
   ];
   ```

2. **TabId type** (`src/components/main-window/main-window-layout.tsx:16`):
   ```typescript
   export type TabId = "tasks" | "worktrees" | "logs" | "settings";
   ```
   The tab ID is still `"tasks"` rather than being renamed to something like `"inbox"` or `"mission-control"`.

3. **Tab rendering** (`src/components/main-window/main-window-layout.tsx:70`):
   ```typescript
   {activeTab === "tasks" && (
     <UnifiedInbox
       threads={threads}
       plans={plans}
       ...
     />
   )}
   ```
   The content is correctly rendering `UnifiedInbox`, but the tab is still labeled "Tasks".

### The Confusion

There are two different concepts that got conflated:

1. **Control Panel** - The separate popup window for viewing/interacting with a single thread (lives in `control-panel.html`, rendered by `ControlPanelWindow`)
2. **Mission Control** - The main tab in the sidebar that shows the inbox of all threads and plans (currently labeled "Tasks")

The rename from "simple-task" to "control-panel" was completed correctly for the popup window. However, the sidebar tab label was supposed to change from "Tasks" to "Mission Control".

## Root Cause

The implementation of 08-control-panel.md completed the "simple-task" -> "control-panel" rename but missed updating the sidebar label from "Tasks" to "Mission Control".

## Proposed Fix

### 1. Update sidebar label (cosmetic fix)

Update `src/components/main-window/sidebar.tsx`:

```typescript
const navItems: NavItem[] = [
  { id: "tasks", label: "Mission Control" },  // Change label only
  { id: "worktrees", label: "Worktrees" },
  { id: "settings", label: "Settings" },
  { id: "logs", label: "Logs" },
];
```

This is the minimal fix - just change the label while keeping the internal ID as `"tasks"`.

### 2. (Optional) Full rename of tab ID

For consistency, could also rename the internal ID:

1. `src/components/main-window/main-window-layout.tsx`:
   - Change `TabId` type from `"tasks"` to `"inbox"` or `"mission-control"`
   - Update `VALID_TABS` array
   - Update `activeTab === "tasks"` to new ID

2. `src/components/main-window/sidebar.tsx`:
   - Update `navItems` with new ID

However, this is more invasive and the current ID works fine. The ID is internal only.

## Applied Fix

Changed both the ID and label to fully deprecate the term "task":

### 1. `src/components/main-window/main-window-layout.tsx`

```diff
-export type TabId = "tasks" | "worktrees" | "logs" | "settings";
-const VALID_TABS: TabId[] = ["tasks", "worktrees", "logs", "settings"];
-const [activeTab, setActiveTab] = useState<TabId>("tasks");
-{activeTab === "tasks" && (
+export type TabId = "inbox" | "worktrees" | "logs" | "settings";
+const VALID_TABS: TabId[] = ["inbox", "worktrees", "logs", "settings"];
+const [activeTab, setActiveTab] = useState<TabId>("inbox");
+{activeTab === "inbox" && (
```

### 2. `src/components/main-window/sidebar.tsx`

```diff
 const navItems: NavItem[] = [
-  { id: "tasks", label: "Tasks" },
+  { id: "inbox", label: "Mission Control" },
   { id: "worktrees", label: "Worktrees" },
   { id: "settings", label: "Settings" },
   { id: "logs", label: "Logs" },
 ];
```

## Files Modified

| File | Change |
|------|--------|
| `src/components/main-window/main-window-layout.tsx` | Changed TabId type and all references from `"tasks"` to `"inbox"` |
| `src/components/main-window/sidebar.tsx` | Changed id to `"inbox"` and label to `"Mission Control"` |

## Verification

After the fix:
1. Open the main window
2. Verify the first sidebar tab shows "Mission Control" instead of "Tasks"
3. Verify clicking "Mission Control" shows the UnifiedInbox with threads and plans

## Status

✅ **COMPLETE** - The fix has been applied. Both files now use `"inbox"` as the tab ID and display "Mission Control" as the label.
