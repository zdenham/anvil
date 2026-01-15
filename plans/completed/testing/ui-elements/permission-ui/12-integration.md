# Sub-Plan 12: Integration and Settings

## Scope

Integrate the PermissionUI component into the application and add settings for permission mode and display mode.

## Dependencies

- **All previous sub-plans** - This is the final integration step

## Files to Modify

### `src/components/simple-task/simple-task-window.tsx`

Add PermissionUI after ThreadView:

```typescript
import { PermissionUI } from "@/components/permission";

// In SimpleTaskWindowContent, find the appropriate location:
// After the thread content area, before the input

<PermissionUI threadId={threadId} />
```

### `src/entities/settings/types.ts`

Add permission settings:

```typescript
import type { PermissionMode, PermissionDisplayMode } from "@core/types/permissions.js";

export interface Settings {
  // ... existing fields
  permissionMode: PermissionMode;
  permissionDisplayMode: PermissionDisplayMode;
}
```

### `src/entities/settings/store.ts`

Add default values and sync mechanism:

```typescript
import type { PermissionMode, PermissionDisplayMode } from "@core/types/permissions.js";
import { usePermissionStore } from "@/entities/permissions";

// In default settings
const defaultSettings: Settings = {
  // ... existing defaults
  permissionMode: "allow-all" as PermissionMode,
  permissionDisplayMode: "modal" as PermissionDisplayMode,
};

// Add subscription to sync displayMode between settings store and permission store
// This ensures the permission store's displayMode stays in sync with user settings
//
// Option A: Add to store initialization (recommended)
// In the settings store, after creating the store, subscribe to changes:
useSettingsStore.subscribe(
  (state) => state.settings.permissionDisplayMode,
  (displayMode) => {
    // Sync to permission store when settings change
    usePermissionStore.getState().setDisplayMode(displayMode);
  }
);

// Option B: Sync on settings load
// In the loadSettings action, after loading from disk:
// usePermissionStore.getState().setDisplayMode(settings.permissionDisplayMode);
```

### Sync Mechanism Rationale

The permission store maintains its own `displayMode` for:
1. Performance - direct access without settings store subscription in components
2. Flexibility - allows programmatic mode changes without persisting

The settings store is the source of truth for user preferences. When settings load or change:
1. Settings store updates its state
2. Subscription syncs to permission store
3. UI components read from permission store for rendering

### `src/components/thread/thread-view.tsx` (Optional)

For inline mode integration within thread messages:

```typescript
import { PermissionUI } from "@/components/permission";
import { usePermissionStore } from "@/entities/permissions";

// Check display mode and render inline if appropriate
const displayMode = usePermissionStore((state) => state.displayMode);

// Render PermissionUI with displayMode="inline" at appropriate position in thread
```

## Verification

```bash
pnpm tsc --noEmit
pnpm tauri dev
```

## Manual Testing Checklist

1. Start dev server: `pnpm tauri dev`
2. Create a simple task
3. Enable permission mode (via settings or temporarily hardcode)
4. Trigger a tool that requires permission
5. Test modal mode:
   - Verify modal appears
   - Test Enter to approve
   - Test Escape to deny
   - Test clicking backdrop to deny
6. Test inline mode:
   - Verify inline prompts appear in thread
   - Test y to approve
   - Test n to deny
   - Test a to approve all
   - Test j/k navigation
7. Verify agent continues on approve
8. Verify agent stops on deny
9. Verify UI clears on agent completion/error

## Estimated Time

30-45 minutes

## Notes

- Integration point in SimpleTaskWindow is the primary location
- Settings allow users to configure permission behavior
- Default is "allow-all" to maintain current behavior until feature is tested
