# Settings and Logs Navigation Fix

## Problem

When clicking on the settings (cog icon) and logs (scroll icon) buttons in the tree panel header, the main content pane shows placeholder content ("Settings (coming soon)" / "Logs (coming soon)") instead of the actual settings and logs pages.

## Root Cause

The navigation flow is working correctly:
1. Buttons in `src/components/tree-menu/tree-panel-header.tsx` have proper click handlers
2. `MainWindowLayout` correctly calls `contentPanesService.setActivePaneView({ type: "settings" })` and `{ type: "logs" }`
3. The `ContentPaneView` type in `src/components/content-pane/types.ts` properly includes `settings` and `logs` variants

**The issue is in `src/components/content-pane/content-pane.tsx`:**

Lines 79-97 define inline placeholder functions instead of using the real page components:

```typescript
function SettingsContent() {
  return (
    <div className="flex items-center justify-center h-full text-surface-500">
      <p>Settings (coming soon)</p>
    </div>
  );
}

function LogsContent() {
  return (
    <div className="flex items-center justify-center h-full text-surface-500">
      <p>Logs (coming soon)</p>
    </div>
  );
}
```

**Actual functional pages already exist:**
- `src/components/main-window/settings-page.tsx` - Full settings UI with hotkey settings, clipboard settings, repository settings, about section
- `src/components/main-window/logs-page.tsx` - Full logs viewer with filtering, auto-scroll, clear functionality

## Solution

Update `src/components/content-pane/content-pane.tsx` to use the actual page components:

### Step 1: Add imports

Add these imports at the top of the file:

```typescript
import { SettingsPage } from "../main-window/settings-page";
import { LogsPage } from "../main-window/logs-page";
```

### Step 2: Update the render logic

Replace lines 54-55:
```typescript
{view.type === "settings" && <SettingsContent />}
{view.type === "logs" && <LogsContent />}
```

With:
```typescript
{view.type === "settings" && <SettingsPage />}
{view.type === "logs" && <LogsPage />}
```

### Step 3: Remove placeholder functions

Delete the `SettingsContent` and `LogsContent` placeholder functions (lines 75-97).

## Potential Considerations

1. **Header duplication**: The `SettingsPage` component includes its own header (`<header className="px-6 py-4 border-b border-surface-800">`). The `ContentPaneHeader` already renders a `SimpleHeader` for settings/logs views. This may result in duplicate headers. Options:
   - Remove the header from `SettingsPage`/`LogsPage` and rely on `ContentPaneHeader`
   - Or keep both if the styling is intentionally different

2. **LogsPage relative positioning**: `LogsPage` has an absolutely positioned "Scroll to bottom" button (`className="absolute bottom-4 right-4"`). Ensure the parent container has `position: relative` for proper positioning.

## Files to Modify

1. `src/components/content-pane/content-pane.tsx` - Main change

## Testing

1. Click the settings icon in the tree panel header
2. Verify the full settings page renders with all setting sections
3. Click the logs icon in the tree panel header
4. Verify the logs page renders with toolbar and log entries
5. Verify the close button in the content pane header works for both views
