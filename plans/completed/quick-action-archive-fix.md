# Quick Action Archive Fix

## Problem

The archive quick action in the control panel does nothing when clicked, while the double-click archive button on inbox items works correctly.

## Investigation

### Working: Inbox Item Archive Button
In `src/components/inbox/inbox-item.tsx:27-33`, the `ArchiveButton` properly calls the services:

```typescript
const handleArchive = async () => {
  if (item.type === "thread") {
    await threadService.archive(item.data.id);
  } else {
    await planService.archive(item.data.id);
  }
};
```

This correctly uses:
- `threadService.archive()` at `src/entities/threads/service.ts:608-642`
- `planService.archive()` at `src/entities/plans/service.ts:373-416`

### Broken: Quick Action Archive
In `src/components/control-panel/control-panel-window.tsx:396-403`, the `handleSuggestedAction` callback is a stub:

```typescript
const handleSuggestedAction = useCallback(
  async (action: "markUnread" | "archive") => {
    // TODO: Implement thread-based mark unread and archive
    logger.warn(`[ControlPanelWindow] ${action} not yet implemented for threads`);
    await invoke("hide_control_panel");
  },
  []
);
```

This gets called from:
1. `handleQuickAction` at line 419 when `action === "archive"`
2. `SuggestedActionsPanel.handleClick` at line 79-81 when clicking the archive action

The implementation is missing - it just logs a warning and hides the panel without actually archiving.

### Flow Analysis

```
Quick Action "Archive" clicked
  → SuggestedActionsPanel.handleClick()
    → onAction("archive")
      → ControlPanelWindow.handleSuggestedAction("archive")
        → logger.warn("archive not yet implemented")  ← BUG: No actual archive!
        → hide_control_panel()
```

## Root Cause

The `handleSuggestedAction` callback in `control-panel-window.tsx` was never implemented - it's still a TODO stub.

## Proposed Fix

### Option 1: Direct Fix (Recommended)

Update `handleSuggestedAction` in `control-panel-window.tsx` to actually call the archive service:

```typescript
const handleSuggestedAction = useCallback(
  async (action: "markUnread" | "archive") => {
    if (action === "archive") {
      await threadService.archive(threadId);
    } else if (action === "markUnread") {
      await threadService.update(threadId, { isRead: false });
    }
    await invoke("hide_control_panel");
  },
  [threadId]
);
```

**Location:** `src/components/control-panel/control-panel-window.tsx:396-403`

### Option 2: Create Shared Helper (If Needed Later)

If archive logic becomes more complex or needs reuse, create a helper:

```typescript
// src/lib/archive-helper.ts
import { threadService } from "@/entities/threads/service";
import { planService } from "@/entities/plans/service";

export async function archiveItem(type: "thread" | "plan", id: string): Promise<void> {
  if (type === "thread") {
    await threadService.archive(id);
  } else {
    await planService.archive(id);
  }
}
```

However, for now this is not necessary since:
- `inbox-item.tsx` only archives from the inbox list context
- `control-panel-window.tsx` only archives threads (it's a thread view)
- Both already have access to the services directly

## Implementation Steps

1. Update `handleSuggestedAction` in `control-panel-window.tsx` to call `threadService.archive(threadId)`
2. Also implement `markUnread` action while we're there: `threadService.update(threadId, { isRead: false })`
3. Test both quick actions work from the control panel

## Files to Modify

- `src/components/control-panel/control-panel-window.tsx` (lines 396-403)
