# Collapsible Quick Actions Panel Implementation Plan

## Overview

Make the Quick Actions panel collapsible with persistence across all windows. When collapsed, the panel should show a minimal header that can be clicked/toggled to expand.

## Current State

### Quick Actions Panel
- **Location**: `src/components/control-panel/suggested-actions-panel.tsx`
- **Used by**:
  - `control-panel-window.tsx` (thread view)
  - `plan-view.tsx` (plan view)
- **Current Structure**:
  - Header with "Quick Actions" title
  - Optional follow-up input (when streaming)
  - List of action items with keyboard navigation

### Existing Settings System
- **Settings Store**: `src/entities/settings/store.ts` - Zustand store with cross-window sync
- **Settings Service**: `src/entities/settings/service.ts` - Handles persistence to `settings.json`
- **Settings Types**: `src/entities/settings/types.ts` - `WorkspaceSettings` schema
- Already includes a UI preference (`permissionDisplayMode`) alongside operational config
- Cross-window sync happens via event bridge (`SETTINGS_UPDATED` event)

## Approach: Add to Existing WorkspaceSettings

Since `WorkspaceSettings` already contains `permissionDisplayMode` (a UI preference), adding `quickActionsCollapsed` there is consistent and avoids creating unnecessary new infrastructure. The existing settings system already handles:
- Persistence to disk
- Cross-window sync via event bridge
- Optimistic updates with rollback

## Implementation Steps

### 1. Add Setting to Types

**File**: `src/entities/settings/types.ts`

Add `quickActionsCollapsed` to the schema:

```typescript
export const WorkspaceSettingsSchema = z.object({
  // ... existing fields ...

  /**
   * Whether the quick actions panel is collapsed.
   * Persists across windows and sessions.
   */
  quickActionsCollapsed: z.boolean(),
});

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  // ... existing defaults ...
  quickActionsCollapsed: false,
};
```

### 2. Add Selector to Store

**File**: `src/entities/settings/store.ts`

Add a selector method:

```typescript
interface SettingsActions {
  // ... existing actions ...
  getQuickActionsCollapsed: () => boolean;
}

// In the store:
getQuickActionsCollapsed: () => get().workspace.quickActionsCollapsed ?? false,
```

### 3. Update SuggestedActionsPanel Component

**File**: `src/components/control-panel/suggested-actions-panel.tsx`

Add collapsible UI:

```typescript
import { ChevronDown, ChevronRight } from "lucide-react";
import { useSettingsStore } from "@/entities/settings/store";
import { settingsService } from "@/entities/settings/service";

// Inside component:
const quickActionsCollapsed = useSettingsStore((s) => s.workspace.quickActionsCollapsed);

const handleToggleCollapse = () => {
  settingsService.set("quickActionsCollapsed", !quickActionsCollapsed);
};

// Render collapsed state:
if (quickActionsCollapsed) {
  return (
    <div
      className="px-4 py-2 bg-surface-800 border-t border-surface-700 cursor-pointer hover:bg-surface-750"
      onClick={handleToggleCollapse}
    >
      <div className="flex items-center gap-2">
        <ChevronRight className="h-4 w-4 text-surface-400" />
        <h3 className="font-bold text-sm text-surface-400">Quick Actions</h3>
      </div>
    </div>
  );
}

// In expanded header, add toggle button:
<div className="mb-2 flex items-center justify-between">
  <h3 className="font-bold text-sm text-surface-200">Quick Actions</h3>
  <button
    onClick={handleToggleCollapse}
    className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200"
    aria-label="Collapse quick actions"
  >
    <ChevronDown className="h-4 w-4" />
  </button>
</div>
```

## Files to Modify

1. `src/entities/settings/types.ts` - Add `quickActionsCollapsed` to schema and defaults
2. `src/entities/settings/store.ts` - Add selector method
3. `src/components/control-panel/suggested-actions-panel.tsx` - Add collapse/expand UI

## Testing Checklist

- [ ] Quick actions panel can be collapsed by clicking the chevron
- [ ] Collapsed panel shows minimal header with expand affordance
- [ ] Clicking collapsed header expands the panel
- [ ] Collapse state persists after app restart
- [ ] Opening a new window shows the same collapse state
- [ ] Toggling in one window updates all other open windows
- [ ] Keyboard navigation still works when expanded

## Alternative Approaches Considered

### Option A: localStorage Only
- Simpler implementation
- Does NOT sync across windows
- **Rejected**: Doesn't meet the cross-window requirement

### Option B: New UIPreferences Entity
- Clean separation of concerns
- More infrastructure (new store, service, event type, listeners)
- **Rejected**: Over-engineered for a single boolean; `WorkspaceSettings` already has UI prefs

### Option C: Add to Existing WorkspaceSettings (Chosen)
- Minimal changes (3 files)
- Leverages existing persistence and cross-window sync
- Consistent with `permissionDisplayMode` already being stored there
- **Chosen**: Simplest solution that meets requirements
